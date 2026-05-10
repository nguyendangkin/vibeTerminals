mod terminal;

use regex::Regex;
use serde::Serialize;
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use tauri::{Emitter, Manager};
use notify::RecursiveMode;
use notify_debouncer_mini::{new_debouncer, Debouncer};
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

#[derive(Debug, Serialize, Clone)]
struct GitStatusEntry {
    file_path: String,
    file_name: String,
    status: String,   // e.g. "M ", "A ", " M", "??"
    staged: bool,
}

#[derive(Debug, Serialize, Clone)]
struct GitStatus {
    entries: Vec<GitStatusEntry>,
    staged_count: usize,
    unstaged_count: usize,
    untracked_count: usize,
    total_changes: usize,
}

struct GitWatcherState {
    debouncer: Option<Debouncer<notify::RecommendedWatcher>>,
    _handle: Option<JoinHandle<()>>,
}

fn run_git_status(folder: &str) -> Result<GitStatus, String> {
    let output = std::process::Command::new("git")
        .args(["status", "--porcelain"])
        .current_dir(folder)
        .output()
        .map_err(|e| format!("Failed to run git: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut entries = Vec::new();
    let mut staged_count = 0usize;
    let mut unstaged_count = 0usize;
    let mut untracked_count = 0usize;

    for line in stdout.lines() {
        if line.len() < 3 {
            continue;
        }
        let chars: Vec<char> = line.chars().collect();
        let index_status = chars[0];
        let tree_status = chars[1];
        let path = line[3..].trim().to_string();
        let file_name = std::path::Path::new(&path)
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| path.clone());

        let staged = index_status != ' ';
        let unstaged = tree_status != ' ';
        let status = format!("{}{}", index_status, tree_status);

        if status == "??" {
            untracked_count += 1;
        } else {
            if staged {
                staged_count += 1;
            }
            if unstaged {
                unstaged_count += 1;
            }
        }

        entries.push(GitStatusEntry {
            file_path: path,
            file_name,
            status,
            staged,
        });
    }

    Ok(GitStatus {
        total_changes: entries.len(),
        entries,
        staged_count,
        unstaged_count,
        untracked_count,
    })
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

#[derive(Debug, Serialize, Clone)]
struct GitLogEntry {
    graph: String,    // ASCII graph prefix (e.g. "* ", "| ", "|/", "  ")
    hash: String,
    date: String,
    message: String,
    refs: String,     // branch/tag decorations
}

#[derive(Debug, Serialize, Clone)]
struct GitLog {
    entries: Vec<GitLogEntry>,
}

#[tauri::command]
fn git_status(folder: String) -> Result<GitStatus, String> {
    run_git_status(&folder)
}

#[tauri::command]
fn git_log(folder: String) -> Result<GitLog, String> {
    let output = std::process::Command::new("git")
        .args([
            "log",
            "--graph",
            "--pretty=format:%x1f%h%x1f%ar%x1f%s%x1f%d",
            "--all",
            "-n",
            "100",
        ])
        .current_dir(&folder)
        .output()
        .map_err(|e| format!("Failed to run git log: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut entries = Vec::new();

    for line in stdout.lines() {
        // Split on \x1f (unit separator) — first occurrence marks end of graph
        if let Some((graph, rest)) = line.split_once('\x1f') {
            let fields: Vec<&str> = rest.split('\x1f').collect();
            if fields.len() >= 3 {
                entries.push(GitLogEntry {
                    graph: graph.to_string(),
                    hash: fields.get(0).unwrap_or(&"").to_string(),
                    date: fields.get(1).unwrap_or(&"").to_string(),
                    message: fields.get(2).unwrap_or(&"").to_string(),
                    refs: fields.get(3).unwrap_or(&"").to_string(),
                });
                continue;
            }
        }
        // Fallback: treat as graph-only line (like bare "|" continuation lines)
        entries.push(GitLogEntry {
            graph: line.to_string(),
            hash: String::new(),
            date: String::new(),
            message: String::new(),
            refs: String::new(),
        });
    }

    Ok(GitLog { entries })
}

#[tauri::command]
fn git_ahead_count(folder: String) -> Result<usize, String> {
    // Count commits ahead of upstream tracking branch.
    // If git is not installed, bail out.
    let output = std::process::Command::new("git")
        .args(["rev-list", "--count", "@{u}..HEAD"])
        .current_dir(&folder)
        .output()
        .map_err(|e| format!("Failed to run git: {}", e))?;

    // No upstream configured — nothing to compare
    if !output.status.success() {
        return Ok(0);
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    Ok(stdout.trim().parse::<usize>().unwrap_or(0))
}

#[tauri::command]
fn git_commit(folder: String, message: String) -> Result<String, String> {
    // Stage all changes (tracked + untracked)
    std::process::Command::new("git")
        .args(["add", "-A", "."])
        .current_dir(&folder)
        .output()
        .map_err(|e| format!("Failed to stage: {}", e))?;

    let output = std::process::Command::new("git")
        .args(["commit", "-m", &message])
        .current_dir(&folder)
        .output()
        .map_err(|e| format!("Failed to commit: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(stderr.trim().to_string());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    Ok(stdout.trim().to_string())
}

#[tauri::command]
fn git_discard_all(folder: String) -> Result<String, String> {
    // Unstage staged changes (may fail in fresh repos with no commits — ok to ignore)
    let _ = std::process::Command::new("git")
        .args(["reset", "HEAD"])
        .current_dir(&folder)
        .output();

    // Discard unstaged changes in tracked files
    std::process::Command::new("git")
        .args(["checkout", "--", "."])
        .current_dir(&folder)
        .output()
        .map_err(|e| format!("Failed to discard: {}", e))?;

    // Remove untracked files and directories
    std::process::Command::new("git")
        .args(["clean", "-fd"])
        .current_dir(&folder)
        .output()
        .map_err(|e| format!("Failed to clean: {}", e))?;

    Ok("All changes discarded".to_string())
}

#[tauri::command]
fn start_git_watch(folder: String, app: tauri::AppHandle) -> Result<(), String> {
    let state = app.state::<Arc<Mutex<GitWatcherState>>>();
    let mut guard = state.lock().map_err(|e| e.to_string())?;

    // Drop old watcher (stops it and joins the thread)
    guard.debouncer.take();
    if let Some(handle) = guard._handle.take() {
        handle.join().ok();
    }

    let (tx, rx) = std::sync::mpsc::channel();
    let mut debouncer = new_debouncer(
        std::time::Duration::from_millis(400),
        tx,
    ).map_err(|e| format!("Failed to create watcher: {:?}", e))?;

    debouncer
        .watcher()
        .watch(std::path::Path::new(&folder), RecursiveMode::Recursive)
        .map_err(|e| format!("Failed to watch: {}", e))?;

    // Spawn thread to process debounced events
    let app_handle = app.clone();
    let watch_folder = folder.clone();
    let handle = std::thread::spawn(move || {
        for events in rx {
            let events = match events {
                Ok(e) => e,
                Err(_) => continue,
            };
            if events.is_empty() {
                continue;
            }
            match run_git_status(&watch_folder) {
                Ok(status) => {
                    let _ = app_handle.emit("git-status-changed", Some(status));
                }
                Err(_) => {
                    let _ = app_handle.emit("git-status-changed", Option::<GitStatus>::None);
                }
            }
        }
    });

    guard.debouncer = Some(debouncer);
    guard._handle = Some(handle);

    Ok(())
}

#[tauri::command]
fn stop_git_watch(app: tauri::AppHandle) -> Result<(), String> {
    let state = app.state::<Arc<Mutex<GitWatcherState>>>();
    let mut guard = state.lock().map_err(|e| e.to_string())?;
    guard.debouncer.take();
    if let Some(handle) = guard._handle.take() {
        handle.join().ok();
    }
    Ok(())
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
            app.manage(Arc::new(Mutex::new(GitWatcherState {
                debouncer: None,
                _handle: None,
            })));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            read_clipboard,
            write_clipboard,
            read_file_content,
            write_file_content,
            list_dir,
            git_status,
            git_log,
            git_ahead_count,
            git_commit,
            git_discard_all,
            start_git_watch,
            stop_git_watch,
            search_in_files,
            pick_file,
            pick_folder,
            save_file_dialog,
            terminal::terminal_spawn,
            terminal::terminal_write,
            terminal::terminal_resize,
            terminal::terminal_kill,
            terminal::terminal_list,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
