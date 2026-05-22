mod commands;

use commands::watch::WatcherMap;
use commands::ssh::{SshSessionMap, SshWatchMap};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(WatcherMap::default())
        .manage(SshSessionMap::default())
        .manage(SshWatchMap::default())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            commands::file::read_tail,
            commands::file::get_file_size,
            commands::file::detect_encoding,
            commands::file::export_lines,
            commands::file::reencode_text,
            commands::file::reencode_bytes,
            commands::watch::start_watch,
            commands::watch::stop_watch,
            commands::watch::read_lines_from_pos,
            commands::search::search_file,
            commands::ssh::ssh_connect,
            commands::ssh::ssh_disconnect,
            commands::ssh::ssh_read_tail,
            commands::ssh::ssh_get_file_size,
            commands::ssh::ssh_start_watch,
            commands::ssh::ssh_stop_watch,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
