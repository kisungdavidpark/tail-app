use async_trait::async_trait;
use russh::client;
use russh::ChannelMsg;
use russh_keys::key::PublicKey;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, State};

use crate::commands::file::{bytes_to_latin1, decode_content, detect_level, extract_timestamp, LogLine};

// ── 핸들러 ───────────────────────────────────────────────────────────────────

pub(crate) struct SshClientHandler;

#[async_trait]
impl client::Handler for SshClientHandler {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        _server_public_key: &PublicKey,
    ) -> Result<bool, Self::Error> {
        Ok(true) // TODO: known_hosts 검증
    }
}

// ── 관리 상태 ────────────────────────────────────────────────────────────────
// Arc로 감싸 clone() 시 핸들 복사가 아닌 Arc 참조 복사가 되도록 함

#[derive(Default)]
pub struct SshSessionMap(pub Mutex<HashMap<String, Arc<client::Handle<SshClientHandler>>>>);

#[derive(Default)]
pub struct SshWatchMap(pub Mutex<HashMap<String, tokio::task::AbortHandle>>);

// ── 헬퍼 ─────────────────────────────────────────────────────────────────────

pub fn ssh_file_path(connection_id: &str, remote_path: &str) -> String {
    format!("ssh://{}:{}", connection_id, remote_path)
}

fn watch_key(connection_id: &str, remote_path: &str) -> String {
    format!("{}:{}", connection_id, remote_path)
}

fn escape_sh(s: &str) -> String {
    s.replace('\'', "'\\''")
}

fn get_handle(
    map: &std::sync::MutexGuard<HashMap<String, Arc<client::Handle<SshClientHandler>>>>,
    connection_id: &str,
) -> Result<Arc<client::Handle<SshClientHandler>>, String> {
    map.get(connection_id)
        .cloned()
        .ok_or_else(|| "SSH 연결 없음 (먼저 접속하세요)".to_string())
}

async fn exec_and_read(handle: &client::Handle<SshClientHandler>, cmd: &str) -> Result<Vec<u8>, String> {
    let mut channel = handle
        .channel_open_session()
        .await
        .map_err(|e| format!("채널 열기 실패: {e}"))?;
    channel
        .exec(true, cmd)
        .await
        .map_err(|e| format!("명령 실행 실패: {e}"))?;

    let mut buf = Vec::new();
    loop {
        match channel.wait().await {
            Some(ChannelMsg::Data { ref data }) => buf.extend_from_slice(data),
            Some(ChannelMsg::Eof) | None => break,
            _ => {}
        }
    }
    Ok(buf)
}

// ── 커맨드 ───────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn ssh_connect(
    connection_id: String,
    host: String,
    port: u16,
    username: String,
    auth_type: String,
    password: Option<String>,
    key_path: Option<String>,
    passphrase: Option<String>,
    state: State<'_, SshSessionMap>,
) -> Result<(), String> {
    if state.0.lock().unwrap().contains_key(&connection_id) {
        return Ok(());
    }

    let config = Arc::new(client::Config::default());
    let mut handle = client::connect(config, (host.as_str(), port), SshClientHandler)
        .await
        .map_err(|e| format!("SSH 연결 실패: {e}"))?;

    let authenticated = match auth_type.as_str() {
        "password" => {
            let pw = password.ok_or("비밀번호가 필요합니다")?;
            handle
                .authenticate_password(&username, pw)
                .await
                .map_err(|e| format!("인증 실패: {e}"))?
        }
        "key" => {
            let path = key_path.ok_or("키 파일 경로가 필요합니다")?;
            let key_pair = russh_keys::load_secret_key(&path, passphrase.as_deref())
                .map_err(|e| format!("키 파일 로드 실패: {e}"))?;
            handle
                .authenticate_publickey(&username, Arc::new(key_pair))
                .await
                .map_err(|e| format!("키 인증 실패: {e}"))?
        }
        "agent" => {
            // ~/.ssh 기본 키 파일 자동 탐색 (SSH Agent 대체)
            let home = std::env::var("HOME").unwrap_or_default();
            let candidates = [
                format!("{home}/.ssh/id_ed25519"),
                format!("{home}/.ssh/id_rsa"),
                format!("{home}/.ssh/id_ecdsa"),
            ];
            let mut ok = false;
            for candidate in &candidates {
                if std::path::Path::new(candidate).exists() {
                    if let Ok(kp) = russh_keys::load_secret_key(candidate, passphrase.as_deref()) {
                        if handle
                            .authenticate_publickey(&username, Arc::new(kp))
                            .await
                            .unwrap_or(false)
                        {
                            ok = true;
                            break;
                        }
                    }
                }
            }
            ok
        }
        _ => return Err(format!("알 수 없는 인증 방식: {auth_type}")),
    };

    if !authenticated {
        return Err("인증 실패 (비밀번호/키를 확인하세요)".to_string());
    }

    state.0.lock().unwrap().insert(connection_id, Arc::new(handle));
    Ok(())
}

#[tauri::command]
pub async fn ssh_disconnect(
    connection_id: String,
    sessions: State<'_, SshSessionMap>,
    watchers: State<'_, SshWatchMap>,
) -> Result<(), String> {
    {
        let mut map = watchers.0.lock().unwrap();
        let prefix = format!("{}:", connection_id);
        let keys: Vec<_> = map.keys().filter(|k| k.starts_with(&prefix)).cloned().collect();
        for key in keys {
            if let Some(h) = map.remove(&key) { h.abort(); }
        }
    }
    // MutexGuard를 await 이전에 드롭
    let handle = sessions.0.lock().unwrap().remove(&connection_id);
    if let Some(h) = handle {
        let _ = h.disconnect(russh::Disconnect::ByApplication, "", "en").await;
    }
    Ok(())
}

#[tauri::command]
pub async fn ssh_read_tail(
    connection_id: String,
    remote_path: String,
    lines: usize,
    encoding: String,
    state: State<'_, SshSessionMap>,
) -> Result<Vec<LogLine>, String> {
    let handle = { get_handle(&state.0.lock().unwrap(), &connection_id)? };
    let cmd = format!("tail -n {} '{}'", lines, escape_sh(&remote_path));
    let buf = exec_and_read(&handle, &cmd).await?;
    let chunks: Vec<&[u8]> = buf.split(|&b| b == b'\n').collect();
    let chunks_len = chunks.len();
    let chunks_ref: &[&[u8]] = if buf.ends_with(b"\n") && chunks_len > 0 {
        &chunks[..chunks_len - 1]
    } else {
        &chunks
    };

    Ok(chunks_ref
        .iter()
        .enumerate()
        .map(|(i, chunk)| {
            let line_bytes = if chunk.ends_with(b"\r") { &chunk[..chunk.len() - 1] } else { chunk };
            let raw = bytes_to_latin1(line_bytes);
            let content = decode_content(line_bytes, &encoding);
            let level = detect_level(&content);
            let timestamp = extract_timestamp(&content);
            LogLine { index: i, content, raw, level, timestamp }
        })
        .collect())
}

#[tauri::command]
pub async fn ssh_get_file_size(
    connection_id: String,
    remote_path: String,
    state: State<'_, SshSessionMap>,
) -> Result<u64, String> {
    let handle = { get_handle(&state.0.lock().unwrap(), &connection_id)? };
    let cmd = format!("wc -c < '{}'", escape_sh(&remote_path));
    let buf = exec_and_read(&handle, &cmd).await?;
    String::from_utf8_lossy(&buf).trim().parse::<u64>()
        .map_err(|e| format!("파일 크기 파싱 실패: {e}"))
}

#[tauri::command]
pub async fn ssh_start_watch(
    connection_id: String,
    remote_path: String,
    encoding: String,
    from_pos: u64,
    app: AppHandle,
    sessions: State<'_, SshSessionMap>,
    watchers: State<'_, SshWatchMap>,
) -> Result<(), String> {
    let key = watch_key(&connection_id, &remote_path);
    if watchers.0.lock().unwrap().contains_key(&key) {
        return Ok(());
    }
    let handle = { get_handle(&sessions.0.lock().unwrap(), &connection_id)? };
    let event_path = ssh_file_path(&connection_id, &remote_path);
    let cmd = if from_pos > 0 {
        format!("tail -c +{} -f '{}'", from_pos + 1, escape_sh(&remote_path))
    } else {
        format!("tail -f '{}'", escape_sh(&remote_path))
    };

    let task = tokio::spawn(async move {
        let mut channel = match handle.channel_open_session().await {
            Ok(c) => c,
            Err(e) => { eprintln!("SSH watch 채널 실패: {e}"); return; }
        };
        if let Err(e) = channel.exec(true, cmd.as_str()).await {
            eprintln!("tail -f 실행 실패: {e}"); return;
        }

        let mut buf: Vec<u8> = Vec::new();
        let mut line_index = 0usize;

        loop {
            match channel.wait().await {
                Some(ChannelMsg::Data { ref data }) => {
                    buf.extend_from_slice(data);
                    if let Some(last_nl) = buf.iter().rposition(|&b| b == b'\n') {
                        let complete = buf[..=last_nl].to_vec();
                        buf = buf[last_nl + 1..].to_vec();
                        let chunks: Vec<&[u8]> = complete.split(|&b| b == b'\n').collect();
                        let chunks_len = chunks.len();
                        let chunks_ref: &[&[u8]] = if complete.ends_with(b"\n") && chunks_len > 0 {
                            &chunks[..chunks_len - 1]
                        } else {
                            &chunks
                        };
                        let new_lines: Vec<LogLine> = chunks_ref
                            .iter()
                            .filter(|chunk| !chunk.is_empty())
                            .enumerate()
                            .map(|(i, chunk)| {
                                let line_bytes = if chunk.ends_with(b"\r") { &chunk[..chunk.len() - 1] } else { chunk };
                                let raw = bytes_to_latin1(line_bytes);
                                let content = decode_content(line_bytes, &encoding);
                                let level = detect_level(&content);
                                let timestamp = extract_timestamp(&content);
                                LogLine { index: line_index + i, content, raw, level, timestamp }
                            })
                            .collect();
                        if !new_lines.is_empty() {
                            line_index += new_lines.len();
                            let _ = app.emit("new_log_lines", serde_json::json!({
                                "path": event_path,
                                "lines": new_lines,
                                "new_pos": 0u64,
                            }));
                        }
                    }
                }
                Some(ChannelMsg::Eof) | None => break,
                _ => {}
            }
        }
    });

    watchers.0.lock().unwrap().insert(key, task.abort_handle());
    Ok(())
}

#[tauri::command]
pub async fn ssh_stop_watch(
    connection_id: String,
    remote_path: String,
    watchers: State<'_, SshWatchMap>,
) -> Result<(), String> {
    if let Some(h) = watchers.0.lock().unwrap().remove(&watch_key(&connection_id, &remote_path)) {
        h.abort();
    }
    Ok(())
}
