use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::collections::HashMap;
use std::fmt;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use std::thread;
use tauri::{AppHandle, Emitter};

pub struct TerminalSession {
    pub pty_master: Box<dyn portable_pty::MasterPty + Send>,
    pub child: Box<dyn portable_pty::Child + Send + Sync>,
    pub writer: Box<dyn Write + Send>,
}

impl fmt::Debug for TerminalSession {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("TerminalSession").finish()
    }
}

pub struct TerminalManager {
    sessions: HashMap<u64, TerminalSession>,
    next_id: u64,
}

impl TerminalManager {
    pub fn new() -> Self {
        Self { sessions: HashMap::new(), next_id: 1 }
    }
}

fn get_shell_command(preferred: Option<&str>) -> (String, Vec<String>) {
    #[cfg(target_os = "windows")]
    {
        match preferred {
            Some("cmd") => return ("cmd.exe".into(), vec![]),
            Some("powershell") => return ("powershell.exe".into(), vec!["-NoLogo".into()]),
            Some("pwsh") => return ("pwsh.exe".into(), vec!["-NoLogo".into()]),
            _ => {}
        }
        // Auto-detect: prefer pwsh if available
        if std::process::Command::new("pwsh.exe")
            .arg("-NoProfile")
            .arg("-Command")
            .arg("exit 0")
            .output()
            .is_ok()
        {
            return ("pwsh.exe".into(), vec!["-NoLogo".into()]);
        }
        ("cmd.exe".into(), vec![])
    }
    #[cfg(not(target_os = "windows"))]
    {
        // On Unix, ignore preference and use $SHELL or bash
        let _ = preferred;
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".into());
        (shell, vec![])
    }
}

fn spawn_output_reader(
    mut reader: Box<dyn Read + Send>,
    app_handle: AppHandle,
    terminal_id: u64,
) {
    thread::spawn(move || {
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => {
                    // EOF – terminal process exited
                    let _ = app_handle.emit("terminal-exit", serde_json::json!({
                        "id": terminal_id,
                    }));
                    break;
                }
                Ok(n) => {
                    // Send raw bytes as a Vec<u8>
                    let data: Vec<u8> = buf[..n].to_vec();
                    let _ = app_handle.emit("terminal-output", serde_json::json!({
                        "id": terminal_id,
                        "data": data,
                    }));
                }
                Err(_) => {
                    let _ = app_handle.emit("terminal-exit", serde_json::json!({
                        "id": terminal_id,
                    }));
                    break;
                }
            }
        }
    });
}

#[tauri::command]
pub fn terminal_spawn(
    app_handle: AppHandle,
    state: tauri::State<'_, Arc<Mutex<TerminalManager>>>,
    cols: Option<u16>,
    rows: Option<u16>,
    cwd: Option<String>,
    shell: Option<String>,
) -> Result<u64, String> {
    let pty_system = native_pty_system();
    let size = PtySize {
        rows: rows.unwrap_or(24),
        cols: cols.unwrap_or(80),
        pixel_width: 0,
        pixel_height: 0,
    };

    let pty_pair = pty_system.openpty(size).map_err(|e| format!("Failed to open PTY: {}", e))?;
    let (shell_path, shell_args) = get_shell_command(shell.as_deref());
    let mut cmd = CommandBuilder::new(&shell_path);
    cmd.args(&shell_args);

    // Set working directory
    if let Some(dir) = &cwd {
        cmd.cwd(dir);
    }

    // Set environment for a proper shell
    cmd.env("TERM", "xterm-256color");
    if cfg!(target_os = "windows") {
        cmd.env("COLORTERM", "truecolor");
    }

    let child = pty_pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("Failed to spawn shell: {}", e))?;

    let reader = pty_pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("Failed to clone reader: {}", e))?;

    let writer = pty_pair
        .master
        .take_writer()
        .map_err(|e| format!("Failed to take writer: {}", e))?;

    let mut manager = state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let id = manager.next_id;
    manager.next_id += 1;

    spawn_output_reader(reader, app_handle, id);

    manager.sessions.insert(
        id,
        TerminalSession {
            pty_master: pty_pair.master,
            child,
            writer,
        },
    );

    Ok(id)
}

#[tauri::command]
pub fn terminal_write(
    state: tauri::State<'_, Arc<Mutex<TerminalManager>>>,
    id: u64,
    data: Vec<u8>,
) -> Result<(), String> {
    let mut manager = state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let session = manager
        .sessions
        .get_mut(&id)
        .ok_or_else(|| format!("Terminal session {} not found", id))?;

    session
        .writer
        .write_all(&data)
        .map_err(|e| format!("Write error: {}", e))?;
    session.writer.flush().map_err(|e| format!("Flush error: {}", e))?;

    Ok(())
}

#[tauri::command]
pub fn terminal_resize(
    state: tauri::State<'_, Arc<Mutex<TerminalManager>>>,
    id: u64,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let manager = state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let session = manager
        .sessions
        .get(&id)
        .ok_or_else(|| format!("Terminal session {} not found", id))?;

    let size = PtySize {
        rows,
        cols,
        pixel_width: 0,
        pixel_height: 0,
    };

    session
        .pty_master
        .resize(size)
        .map_err(|e| format!("Resize error: {}", e))?;

    Ok(())
}

#[tauri::command]
pub fn terminal_kill(
    state: tauri::State<'_, Arc<Mutex<TerminalManager>>>,
    id: u64,
) -> Result<(), String> {
    let mut manager = state.lock().map_err(|e| format!("Lock error: {}", e))?;
    if let Some(mut session) = manager.sessions.remove(&id) {
        // Try graceful kill first
        let _ = session.child.kill();
        // Wait briefly for cleanup
        let _ = session.child.wait();
    }
    Ok(())
}
