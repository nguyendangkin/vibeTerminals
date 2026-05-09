use serde::Serialize;
use std::process::Command;

#[derive(Debug, Serialize, Clone)]
pub struct GitFileStatus {
    pub path: String,
    pub status: String,
}

#[derive(Debug, Serialize, Clone)]
pub struct GitStatusResult {
    pub files: Vec<GitFileStatus>,
    pub branch: String,
    pub ahead: i32,
    pub behind: i32,
}

#[derive(Debug, Serialize, Clone)]
pub struct GitCommit {
    pub hash: String,
    pub short_hash: String,
    pub parents: Vec<String>,
    pub message: String,
    pub author: String,
    pub date: String,
    pub refs: Vec<String>,
}

fn run_git(dir: &str, args: &[&str]) -> Result<String, String> {
    let output = Command::new("git")
        .args(args)
        .current_dir(dir)
        .output()
        .map_err(|e| format!("Failed to run git: {}", e))?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        Err(if stderr.is_empty() { "Unknown error".to_string() } else { stderr })
    }
}

#[tauri::command]
pub fn git_status(dir: String) -> Result<GitStatusResult, String> {
    let branch = run_git(&dir, &["rev-parse", "--abbrev-ref", "HEAD"])?
        .trim()
        .to_string();

    let output = run_git(&dir, &["status", "--porcelain"])?;
    let mut files = Vec::new();

    for line in output.lines() {
        if line.len() < 3 {
            continue;
        }
        let chars: Vec<char> = line.chars().collect();
        let x = chars[0]; // index (staging) status
        let y = chars[1]; // working tree status
        let path = line[3..].trim().to_string();

        let status = if x == '?' && y == '?' {
            "??".to_string()
        } else if y != ' ' {
            y.to_string()
        } else {
            x.to_string()
        };
        files.push(GitFileStatus {
            path,
            status,
        });
    }

    // Parse ahead/behind from status -b
    let mut ahead = 0i32;
    let mut behind = 0i32;
    if let Ok(branch_info) = run_git(&dir, &["status", "-b", "--porcelain"]) {
        if let Some(info_line) = branch_info.lines().next() {
            if let Some(bracket) = info_line.find('[') {
                let info = &info_line[bracket..];
                for part in info.split(", ") {
                    let part = part.trim_matches(|c| c == '[' || c == ']');
                    if let Some(rest) = part.strip_prefix("ahead ") {
                        ahead = rest.parse().unwrap_or(0);
                    } else if let Some(rest) = part.strip_prefix("behind ") {
                        behind = rest.parse().unwrap_or(0);
                    }
                }
            }
        }
    }

    Ok(GitStatusResult { files, branch, ahead, behind })
}

#[tauri::command]
pub fn git_commit(dir: String, message: String) -> Result<(), String> {
    run_git(&dir, &["add", "--all"])?;
    run_git(&dir, &["commit", "-m", &message])?;
    Ok(())
}

#[tauri::command]
pub fn git_push(dir: String) -> Result<String, String> {
    run_git(&dir, &["push"])?;
    Ok("Push successful".to_string())
}

#[tauri::command]
pub fn git_log(dir: String, count: Option<usize>) -> Result<Vec<GitCommit>, String> {
    let n = count.unwrap_or(50);
    let fmt = format!("--format=%H|%P|%h|%s|%ar|%an|%D");
    let limit = format!("-n{}", n);
    let output = run_git(
        &dir,
        &["log", "--all", &limit, &fmt],
    )?;

    let mut commits = Vec::new();
    for line in output.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let parts: Vec<&str> = line.split('|').collect();
        if parts.len() < 6 {
            continue;
        }

        let parents: Vec<String> = parts[1]
            .split_whitespace()
            .map(|s| s.to_string())
            .collect();

        let refs: Vec<String> = if parts.len() > 6 {
            parts[6]
                .split(", ")
                .filter(|r| {
                    let r = r.trim();
                    !r.is_empty() && !r.starts_with("tag: ")
                })
                .map(|r| r.trim().to_string())
                .collect()
        } else {
            Vec::new()
        };

        commits.push(GitCommit {
            hash: parts[0].to_string(),
            short_hash: parts[2].to_string(),
            parents,
            message: parts[3].to_string(),
            date: parts[4].to_string(),
            author: parts[5].to_string(),
            refs,
        });
    }

    Ok(commits)
}

#[tauri::command]
pub fn git_reset_all(dir: String) -> Result<(), String> {
    run_git(&dir, &["checkout", "--", "."])?;
    let _ = run_git(&dir, &["reset", "HEAD"]);
    let _ = run_git(&dir, &["clean", "-fd"]);
    Ok(())
}
