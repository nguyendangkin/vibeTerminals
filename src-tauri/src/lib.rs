mod git;
mod terminal;

use regex::Regex;
use serde::Serialize;
use std::sync::{Arc, Mutex};
use tauri::Manager;
use terminal::TerminalManager;

#[derive(Debug, Serialize, Clone)]
struct DirEntry {
    name: String, 
    path: String,
    is_dir: bool,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    children: Vec<DirEntry>,
}

#[derive(Debug, Serialize, Clone)]
struct SearchMatch {
    file_path: String,
    file_name: String,
    line_number: usize,
    line_content: String,
    match_start: usize,
    match_end: usize,
}

#[tauri::command]
fn read_clipboard() -> Result<String, String> {
    arboard::Clipboard::new()
        .map_err(|e| e.to_string())?
        .get_text()
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn write_clipboard(text: String) -> Result<(), String> {
    arboard::Clipboard::new()
        .map_err(|e| e.to_string())?
        .set_text(text)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn read_file_content(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn write_file_content(path: String, content: String) -> Result<(), String> {
    std::fs::write(&path, &content).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_file(path: String) -> Result<(), String> {
    let metadata = std::fs::metadata(&path).map_err(|e| e.to_string())?;
    if metadata.is_dir() {
        std::fs::remove_dir_all(&path).map_err(|e| e.to_string())
    } else {
        std::fs::remove_file(&path).map_err(|e| e.to_string())
    }
}

#[tauri::command]
fn rename_entry(old_path: String, new_path: String) -> Result<(), String> {
    std::fs::rename(&old_path, &new_path).map_err(|e| e.to_string())
}

fn scan_dir(path: &str, depth: usize) -> Result<Vec<DirEntry>, String> {
    let entries = std::fs::read_dir(path).map_err(|e| e.to_string())?;
    let mut result: Vec<DirEntry> = Vec::new();

    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let entry_path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        let entry_path_str = entry_path.to_string_lossy().to_string();
        let is_dir = entry_path.is_dir();

        if name.starts_with('.') {
            continue;
        }
        if is_dir && (name == "node_modules" || name == "target") {
            continue;
        }

        let children = if is_dir && depth < 3 {
            scan_dir(&entry_path_str, depth + 1)?
        } else {
            Vec::new()
        };

        result.push(DirEntry {
            name,
            path: entry_path_str,
            is_dir,
            children,
        });
    }

    result.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    Ok(result)
}

#[tauri::command]
fn list_dir(path: String) -> Result<Vec<DirEntry>, String> {
    scan_dir(&path, 0)
}

#[tauri::command]
fn search_in_files(folder: String, pattern: String) -> Result<Vec<SearchMatch>, String> {
    let re = Regex::new(&pattern).map_err(|e| format!("Invalid regex: {}", e))?;
    let mut results = Vec::new();

    fn walk(folder: &str, re: &Regex, results: &mut Vec<SearchMatch>) -> Result<(), String> {
        let entries = std::fs::read_dir(folder).map_err(|e| e.to_string())?;
        for entry in entries {
            let entry = entry.map_err(|e| e.to_string())?;
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();

            if name.starts_with('.') {
                continue;
            }

            if path.is_dir() {
                if name == "node_modules" || name == "target" {
                    continue;
                }
                walk(&path.to_string_lossy(), re, results)?;
            } else {
                // Only search text files (skip binaries by extension)
                let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
                let skip = ["exe", "dll", "pdb", "obj", "o", "a", "so",
                             "png", "jpg", "jpeg", "gif", "ico", "bmp",
                             "zip", "tar", "gz", "7z", "rar",
                             "ttf", "otf", "woff", "woff2",
                             "mp3", "mp4", "wav", "avi", "mov"];
                if skip.contains(&ext) {
                    continue;
                }

                let content = match std::fs::read_to_string(&path) {
                    Ok(c) => c,
                    Err(_) => continue,
                };

                for (line_num, line) in content.lines().enumerate() {
                    for m in re.find_iter(line) {
                        results.push(SearchMatch {
                            file_path: path.to_string_lossy().to_string(),
                            file_name: name.clone(),
                            line_number: line_num + 1,
                            line_content: line.to_string(),
                            match_start: m.start(),
                            match_end: m.end(),
                        });

                        // Limit: 500 results max
                        if results.len() >= 500 {
                            return Ok(());
                        }
                    }
                }
            }
        }
        Ok(())
    }

    walk(&folder, &re, &mut results)?;
    Ok(results)
}

#[tauri::command]
async fn pick_file(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let path = app
        .dialog()
        .file()
        .add_filter("All Files", &["*"])
        .blocking_pick_file();
    Ok(path.map(|p| p.to_string()))
}

#[tauri::command]
async fn pick_folder(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let path = app.dialog().file().blocking_pick_folder();
    Ok(path.map(|p| p.to_string()))
}

#[tauri::command]
async fn save_file_dialog(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let path = app
        .dialog()
        .file()
        .add_filter("All Files", &["*"])
        .blocking_save_file();
    Ok(path.map(|p| p.to_string()))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            app.manage(Arc::new(Mutex::new(TerminalManager::new())));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            read_clipboard,
            write_clipboard,
            read_file_content,
            write_file_content,
            delete_file,
            rename_entry,
            list_dir,
            search_in_files,
            pick_file,
            pick_folder,
            save_file_dialog,
            terminal::terminal_spawn,
            terminal::terminal_write,
            terminal::terminal_resize,
            terminal::terminal_kill,
            terminal::terminal_list,
            git::git_status,
            git::git_diff,
            git::git_diff_file,
            git::git_log,
            git::git_add,
            git::git_unstage,
            git::git_commit,
            git::git_push,
            git::git_pull,
            git::git_fetch,
            git::git_branch,
            git::git_create_branch,
            git::git_checkout,
            git::git_stash,
            git::git_stash_pop,
            git::git_stash_list,
            git::git_init,
            git::git_remote_url,
            git::git_current_branch,
            git::git_has_repo,
            git::git_ahead_behind,
            git::git_discard,
            git::git_log_graph,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
