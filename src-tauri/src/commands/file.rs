use serde::{Deserialize, Serialize};
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogLine {
    pub index: usize,
    pub content: String,
    pub raw: String,
    pub level: Option<String>,
    pub timestamp: Option<String>,
}

pub fn detect_level(line: &str) -> Option<String> {
    let upper = line.to_uppercase();
    if upper.contains("[ERROR]") || upper.contains("ERROR:") || upper.contains(" ERROR ") {
        Some("ERROR".to_string())
    } else if upper.contains("[WARN]")
        || upper.contains("WARNING")
        || upper.contains("WARN:")
        || upper.contains(" WARN ")
    {
        Some("WARN".to_string())
    } else if upper.contains("[INFO]") || upper.contains("INFO:") || upper.contains(" INFO ") {
        Some("INFO".to_string())
    } else if upper.contains("[DEBUG]") || upper.contains("DEBUG:") || upper.contains(" DEBUG ") {
        Some("DEBUG".to_string())
    } else {
        None
    }
}

pub fn extract_timestamp(line: &str) -> Option<String> {
    let candidate = line.get(..19)?;
    let bytes = candidate.as_bytes();
    let valid = bytes[4] == b'-'
        && bytes[7] == b'-'
        && (bytes[10] == b'T' || bytes[10] == b' ')
        && bytes[13] == b':'
        && bytes[16] == b':';
    if valid { Some(candidate.to_string()) } else { None }
}

/// 원본 바이트를 Latin-1 문자열로 변환 (각 바이트를 동일한 코드포인트 문자로)
/// 이를 통해 모든 바이트 시퀀스를 손실 없이 String으로 보존 가능
pub fn bytes_to_latin1(bytes: &[u8]) -> String {
    bytes.iter().map(|&b| b as char).collect()
}

pub fn decode_content(bytes: &[u8], encoding: &str) -> String {
    match encoding.to_uppercase().as_str() {
        "EUC-KR" | "EUCKR" => {
            let (cow, _, _) = encoding_rs::EUC_KR.decode(bytes);
            cow.into_owned()
        }
        "UTF-16" | "UTF-16LE" => {
            let (cow, _, _) = encoding_rs::UTF_16LE.decode(bytes);
            cow.into_owned()
        }
        "UTF-16BE" => {
            let (cow, _, _) = encoding_rs::UTF_16BE.decode(bytes);
            cow.into_owned()
        }
        _ => String::from_utf8(bytes.to_vec())
            .unwrap_or_else(|_| String::from_utf8_lossy(bytes).into_owned()),
    }
}

#[tauri::command]
pub async fn detect_encoding(path: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        use std::io::Read;
        let mut file = std::fs::File::open(&path).map_err(|e| format!("파일 열기 실패: {e}"))?;
        let mut buf = vec![0u8; 8192];
        let n = file.read(&mut buf).map_err(|e| e.to_string())?;
        let sample = &buf[..n];

        let result = chardet::detect(sample);
        let raw = chardet::charset2encoding(&result.0).to_uppercase();

        let normalized = if raw.contains("UTF-16") {
            "UTF-16".to_string()
        } else if raw.contains("EUC-KR") || raw.contains("CP949") || raw.contains("949") || raw.contains("WINDOWS-949") {
            "EUC-KR".to_string()
        } else if raw.is_empty() || raw.contains("ASCII") || raw.contains("UTF-8") {
            "UTF-8".to_string()
        } else {
            raw
        };
        Ok(normalized)
    })
    .await
    .map_err(|e| format!("스레드 오류: {e}"))?
}

#[tauri::command]
pub async fn export_lines(path: String, content: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        std::fs::write(&path, content.as_bytes())
            .map_err(|e| format!("파일 저장 실패: {e}"))
    })
    .await
    .map_err(|e| format!("스레드 오류: {e}"))?
}

/// 현재 표시 인코딩(from_encoding)으로 텍스트를 바이트로 역변환한 뒤 to_encoding으로 재해석
/// 예) EUC-KR로 열린 UTF-8 파일에서 선택 → from=EUC-KR, to=UTF-8 → 원본 복원
pub fn encode_content(text: &str, encoding: &str) -> Vec<u8> {
    match encoding.to_uppercase().as_str() {
        "EUC-KR" | "EUCKR" => {
            let (bytes, _, _) = encoding_rs::EUC_KR.encode(text);
            bytes.into_owned()
        }
        "UTF-16" | "UTF-16LE" => {
            let (bytes, _, _) = encoding_rs::UTF_16LE.encode(text);
            bytes.into_owned()
        }
        "UTF-16BE" => {
            let (bytes, _, _) = encoding_rs::UTF_16BE.encode(text);
            bytes.into_owned()
        }
        _ => text.as_bytes().to_vec(),
    }
}

#[tauri::command]
pub async fn reencode_text(text: String, from_encoding: String, to_encoding: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        let bytes = encode_content(&text, &from_encoding);
        let result = decode_content(&bytes, &to_encoding);
        Ok(result)
    })
    .await
    .map_err(|e| format!("스레드 오류: {e}"))?
}

/// LogLine.raw (Latin-1 인코딩된 원본 바이트)를 목표 인코딩으로 재해석
/// UTF-8로 열었을 때 대체문자(U+FFFD)로 깨진 경우에도 원본 바이트를 복원 가능
#[tauri::command]
pub async fn reencode_bytes(raw_latin1: String, to_encoding: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        // Latin-1 문자열 → 원본 바이트 복원 (각 char의 코드포인트가 곧 바이트값)
        let bytes: Vec<u8> = raw_latin1.chars().map(|c| c as u8).collect();
        Ok(decode_content(&bytes, &to_encoding))
    })
    .await
    .map_err(|e| format!("스레드 오류: {e}"))?
}

#[tauri::command]
pub async fn get_file_size(path: String) -> Result<u64, String> {
    tokio::task::spawn_blocking(move || {
        std::fs::metadata(&path)
            .map(|m| m.len())
            .map_err(|e| format!("메타데이터 실패: {e}"))
    })
    .await
    .map_err(|e| format!("스레드 오류: {e}"))?
}

fn read_last_n_lines_bytes(
    mut file: File,
    file_size: u64,
    n: usize,
) -> Result<Vec<u8>, String> {
    if file_size == 0 {
        return Ok(Vec::new());
    }

    const CHUNK: u64 = 65536;
    let mut newlines_found = 0usize;
    let mut pos = file_size;
    let mut start_pos = 0u64;

    'outer: loop {
        let read_from = pos.saturating_sub(CHUNK);
        let chunk_size = (pos - read_from) as usize;
        file.seek(SeekFrom::Start(read_from))
            .map_err(|e| e.to_string())?;
        let mut buf = vec![0u8; chunk_size];
        file.read_exact(&mut buf).map_err(|e| e.to_string())?;

        for i in (0..chunk_size).rev() {
            if buf[i] == b'\n' {
                newlines_found += 1;
                if newlines_found > n {
                    start_pos = read_from + i as u64 + 1;
                    break 'outer;
                }
            }
        }

        if read_from == 0 {
            break;
        }
        pos = read_from;
    }

    let tail_size = (file_size - start_pos) as usize;
    file.seek(SeekFrom::Start(start_pos))
        .map_err(|e| e.to_string())?;
    let mut result = vec![0u8; tail_size];
    file.read_exact(&mut result).map_err(|e| e.to_string())?;
    Ok(result)
}

#[tauri::command]
pub async fn read_tail(
    path: String,
    lines: usize,
    encoding: String,
) -> Result<Vec<LogLine>, String> {
    tokio::task::spawn_blocking(move || {
        let file = File::open(&path).map_err(|e| format!("파일 열기 실패: {e}"))?;
        let file_size = file
            .metadata()
            .map_err(|e| format!("메타데이터 실패: {e}"))?
            .len();

        let raw_bytes = read_last_n_lines_bytes(file, file_size, lines)?;

        // 디코딩 전에 줄별로 원본 바이트를 분리해 저장 (U+FFFD 대체문자 문제 방지)
        let chunks: Vec<&[u8]> = raw_bytes.split(|&b| b == b'\n').collect();
        let chunks_len = chunks.len();
        let chunks_ref: &[&[u8]] = if raw_bytes.ends_with(b"\n") && chunks_len > 0 {
            &chunks[..chunks_len - 1]
        } else {
            &chunks
        };

        let result: Vec<LogLine> = chunks_ref
            .iter()
            .enumerate()
            .map(|(i, chunk)| {
                // Windows CRLF 대응: 줄 끝 \r 제거
                let line_bytes = if chunk.ends_with(b"\r") {
                    &chunk[..chunk.len() - 1]
                } else {
                    chunk
                };
                let raw = bytes_to_latin1(line_bytes);
                let content = decode_content(line_bytes, &encoding);
                let level = detect_level(&content);
                let timestamp = extract_timestamp(&content);
                LogLine { index: i, content, raw, level, timestamp }
            })
            .collect();

        Ok(result)
    })
    .await
    .map_err(|e| format!("스레드 오류: {e}"))?
}
