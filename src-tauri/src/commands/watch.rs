use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, State};

use crate::commands::file::{bytes_to_latin1, decode_content, detect_level, extract_timestamp, LogLine};

#[derive(Debug, Serialize, Deserialize)]
pub struct ReadFromPosResult {
    pub lines: Vec<LogLine>,
    pub new_pos: u64,
}

#[tauri::command]
pub async fn read_lines_from_pos(
    path: String,
    from_pos: u64,
    encoding: String,
) -> Result<ReadFromPosResult, String> {
    tokio::task::spawn_blocking(move || {
        let (lines, new_pos) = read_new_lines(&path, from_pos, &encoding)?;
        Ok(ReadFromPosResult { lines, new_pos })
    })
    .await
    .map_err(|e| format!("스레드 오류: {e}"))?
}

#[derive(Default)]
pub struct WatcherMap(pub Mutex<HashMap<String, RecommendedWatcher>>);

fn read_new_lines(path: &str, from_pos: u64, encoding: &str) -> Result<(Vec<LogLine>, u64), String> {
    use std::fs::File;
    use std::io::{Read, Seek, SeekFrom};

    let mut file = File::open(path).map_err(|e| e.to_string())?;
    let file_size = file.metadata().map_err(|e| e.to_string())?.len();

    // 로그 파일 로테이션 대응: 파일이 잘렸으면 처음부터 읽기
    let actual_pos = if from_pos > file_size { 0 } else { from_pos };

    if actual_pos >= file_size {
        return Ok((vec![], file_size));
    }

    file.seek(SeekFrom::Start(actual_pos))
        .map_err(|e| e.to_string())?;
    let mut buf = Vec::new();
    file.read_to_end(&mut buf).map_err(|e| e.to_string())?;

    let chunks: Vec<&[u8]> = buf.split(|&b| b == b'\n').collect();
    let chunks_len = chunks.len();
    let chunks_ref: &[&[u8]] = if buf.ends_with(b"\n") && chunks_len > 0 {
        &chunks[..chunks_len - 1]
    } else {
        &chunks
    };

    let lines: Vec<LogLine> = chunks_ref
        .iter()
        .enumerate()
        .map(|(i, chunk)| {
            let line_bytes = if chunk.ends_with(b"\r") {
                &chunk[..chunk.len() - 1]
            } else {
                chunk
            };
            let raw = bytes_to_latin1(line_bytes);
            let content = decode_content(line_bytes, encoding);
            let level = detect_level(&content);
            let timestamp = extract_timestamp(&content);
            LogLine { index: i, content, raw, level, timestamp }
        })
        .collect();

    // 마지막 완전한 줄 끝까지만 pos 업데이트 (불완전한 줄은 다음 이벤트에서 재처리)
    let new_pos = if buf.ends_with(b"\n") {
        file_size
    } else {
        match buf.iter().rposition(|&b| b == b'\n') {
            Some(last_nl) => actual_pos + last_nl as u64 + 1,
            None => actual_pos,
        }
    };

    Ok((lines, new_pos))
}

#[tauri::command]
pub async fn start_watch(
    path: String,
    encoding: String,
    from_pos: u64,
    app: AppHandle,
    state: State<'_, WatcherMap>,
) -> Result<(), String> {
    // 이미 감시 중이면 중복 등록 방지
    {
        let map = state.0.lock().map_err(|e| e.to_string())?;
        if map.contains_key(&path) {
            return Ok(());
        }
    }

    let metadata = std::fs::metadata(&path).map_err(|e| e.to_string())?;
    let file_size = metadata.len();
    let initial_pos = if from_pos > 0 && from_pos <= file_size { from_pos } else { file_size };
    let last_pos = Arc::new(Mutex::new(initial_pos));

    let path_clone = path.clone();
    let app_clone = app.clone();
    let pos_ref = last_pos.clone();
    let encoding_clone = encoding.clone();

    let mut watcher = notify::recommended_watcher(move |res: notify::Result<Event>| {
        if let Ok(event) = res {
            if matches!(event.kind, EventKind::Modify(_) | EventKind::Create(_)) {
                let mut current_pos = pos_ref.lock().unwrap();
                if let Ok((new_lines, new_pos)) =
                    read_new_lines(&path_clone, *current_pos, &encoding_clone)
                {
                    *current_pos = new_pos;
                    if !new_lines.is_empty() {
                        let _ = app_clone.emit(
                            "new_log_lines",
                            serde_json::json!({
                                "path": path_clone,
                                "lines": new_lines,
                                "new_pos": new_pos,
                            }),
                        );
                    }
                }
            }
        }
    })
    .map_err(|e| e.to_string())?;

    watcher
        .watch(
            std::path::Path::new(&path),
            RecursiveMode::NonRecursive,
        )
        .map_err(|e| e.to_string())?;

    let mut map = state.0.lock().map_err(|e| e.to_string())?;
    map.insert(path, watcher);
    Ok(())
}

#[tauri::command]
pub async fn stop_watch(
    path: String,
    state: State<'_, WatcherMap>,
) -> Result<(), String> {
    let mut map = state.0.lock().map_err(|e| e.to_string())?;
    map.remove(&path);
    Ok(())
}
