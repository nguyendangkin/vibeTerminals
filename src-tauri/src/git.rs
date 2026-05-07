use serde::Serialize;
use std::process::Command;

#[derive(Debug, Serialize, Clone)]
pub struct GitStatusEntry {
    pub path: String,
    pub status: String,  // "M", "A", "D", "R", "??", "MM", etc.
    pub staged: bool,
}

#[derive(Debug, Serialize, Clone)]
pub struct GitCommit {
    pub hash: String,
    pub message: String,
    pub author: String,
    pub date: String,
}

#[derive(Debug, Serialize, Clone)]
pub struct GitBranch {
    pub name: String,
    pub current: bool,
}

fn run_git(repo_path: &str, args: &[&str]) -> Result<String, String> {
    let output = Command::new("git")
        .args(args)
        .current_dir(repo_path)
        .output()
        .map_err(|e| format!("Failed to run git: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        // Don't error on empty output (e.g., clean status)
        if stderr.trim().is_empty() {
            return Ok(String::from_utf8_lossy(&output.stdout).to_string());
        }
        return Err(format!("Git error: {}", stderr.trim()));
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

#[tauri::command]
pub fn git_status(repo_path: String) -> Result<Vec<GitStatusEntry>, String> {
    let output = run_git(&repo_path, &["status", "--porcelain"])?;
    let mut entries = Vec::new();

    for line in output.lines() {
        if line.len() < 3 {
            continue;
        }
        let status_code = &line[..2];
        let path = line[3..].trim().to_string();

        // Parse staged + unstaged
        let index_status = &status_code[..1];
        let worktree_status = &status_code[1..2];

        // Staged entry
        if index_status != " " && index_status != "?" {
            entries.push(GitStatusEntry {
                path: path.clone(),
                status: index_status.to_string(),
                staged: true,
            });
        }

        // Unstaged entry (exclude untracked — handled separately below)
        if worktree_status != " " && status_code != "??" {
            entries.push(GitStatusEntry {
                path: path.clone(),
                status: worktree_status.to_string(),
                staged: false,
            });
        }

        // Untracked
        if status_code == "??" {
            entries.push(GitStatusEntry {
                path: path.clone(),
                status: "??".to_string(),
                staged: false,
            });
        }
    }

    Ok(entries)
}

#[tauri::command]
pub fn git_diff(repo_path: String, staged: bool) -> Result<String, String> {
    let mut args = vec!["diff"];
    if staged {
        args.push("--staged");
    }
    run_git(&repo_path, &args)
}

#[tauri::command]
pub fn git_diff_file(repo_path: String, file_path: String, staged: bool) -> Result<String, String> {
    let mut args = vec!["diff"];
    if staged {
        args.push("--staged");
    }
    args.push("--");
    args.push(&file_path);
    run_git(&repo_path, &args)
}

#[tauri::command]
pub fn git_log(repo_path: String, max_count: Option<usize>) -> Result<Vec<GitCommit>, String> {
    let count = max_count.unwrap_or(50);
    let output = run_git(
        &repo_path,
        &[
            "log",
            &format!("--max-count={}", count),
            "--pretty=format:%H|%s|%an|%ai",
        ],
    )?;

    let mut commits = Vec::new();
    for line in output.lines() {
        let parts: Vec<&str> = line.splitn(4, '|').collect();
        if parts.len() == 4 {
            commits.push(GitCommit {
                hash: parts[0].to_string(),
                message: parts[1].to_string(),
                author: parts[2].to_string(),
                date: parts[3].to_string(),
            });
        }
    }
    Ok(commits)
}

#[tauri::command]
pub fn git_add(repo_path: String, files: Vec<String>) -> Result<(), String> {
    let mut args = vec!["add"];
    for f in &files {
        args.push(f);
    }
    run_git(&repo_path, &args).map(|_| ())
}

#[tauri::command]
pub fn git_unstage(repo_path: String, files: Vec<String>) -> Result<(), String> {
    let mut args = vec!["reset", "HEAD", "--"];
    for f in &files {
        args.push(f);
    }
    run_git(&repo_path, &args).map(|_| ())
}

#[tauri::command]
pub fn git_commit(repo_path: String, message: String) -> Result<String, String> {
    run_git(&repo_path, &["commit", "-m", &message])
}

#[tauri::command]
pub fn git_push(repo_path: String, remote: Option<String>, branch: Option<String>) -> Result<String, String> {
    let remote = remote.unwrap_or_else(|| "origin".to_string());
    let mut args = vec!["push", &remote];
    if let Some(b) = &branch {
        args.push(b);
    }
    run_git(&repo_path, &args)
}

#[tauri::command]
pub fn git_pull(repo_path: String, remote: Option<String>, branch: Option<String>) -> Result<String, String> {
    let remote = remote.unwrap_or_else(|| "origin".to_string());
    let mut args = vec!["pull"];
    if let Some(b) = &branch {
        args.push(&remote);
        args.push(b);
    }
    run_git(&repo_path, &args)
}

#[tauri::command]
pub fn git_fetch(repo_path: String, remote: Option<String>) -> Result<String, String> {
    let remote = remote.unwrap_or_else(|| "origin".to_string());
    run_git(&repo_path, &["fetch", &remote])
}

#[tauri::command]
pub fn git_branch(repo_path: String) -> Result<Vec<GitBranch>, String> {
    let output = run_git(&repo_path, &["branch"])?;
    let mut branches = Vec::new();
    for line in output.lines() {
        let current = line.starts_with('*');
        let name = line.trim_start_matches("* ").trim().to_string();
        branches.push(GitBranch { name, current });
    }
    Ok(branches)
}

#[tauri::command]
pub fn git_create_branch(repo_path: String, name: String) -> Result<(), String> {
    run_git(&repo_path, &["branch", &name]).map(|_| ())
}

#[tauri::command]
pub fn git_checkout(repo_path: String, target: String) -> Result<String, String> {
    run_git(&repo_path, &["checkout", &target])
}

#[tauri::command]
pub fn git_stash(repo_path: String) -> Result<String, String> {
    run_git(&repo_path, &["stash"])
}

#[tauri::command]
pub fn git_stash_pop(repo_path: String) -> Result<String, String> {
    run_git(&repo_path, &["stash", "pop"])
}

#[tauri::command]
pub fn git_stash_list(repo_path: String) -> Result<String, String> {
    run_git(&repo_path, &["stash", "list"])
}

#[tauri::command]
pub fn git_init(repo_path: String) -> Result<String, String> {
    run_git(&repo_path, &["init"])
}

#[tauri::command]
pub fn git_remote_url(repo_path: String) -> Result<String, String> {
    run_git(&repo_path, &["remote", "get-url", "origin"]).map(|s| s.trim().to_string())
}

#[tauri::command]
pub fn git_current_branch(repo_path: String) -> Result<String, String> {
    run_git(&repo_path, &["rev-parse", "--abbrev-ref", "HEAD"]).map(|s| s.trim().to_string())
}

#[tauri::command]
pub fn git_has_repo(path: String) -> Result<bool, String> {
    match run_git(&path, &["rev-parse", "--git-dir"]) {
        Ok(_) => Ok(true),
        Err(_) => Ok(false),
    }
}

#[derive(Debug, Serialize, Clone)]
pub struct AheadBehind {
    pub ahead: usize,
    pub behind: usize,
}

#[tauri::command]
pub fn git_ahead_behind(repo_path: String) -> Result<AheadBehind, String> {
    // Returns (0, 0) if no tracking branch is set
    let tracking = run_git(&repo_path, &["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);
    if tracking.is_err() {
        return Ok(AheadBehind { ahead: 0, behind: 0 });
    }
    match run_git(&repo_path, &["rev-list", "--left-right", "--count", "HEAD...@{u}"]) {
        Ok(output) => {
            let parts: Vec<&str> = output.trim().split_whitespace().collect();
            if parts.len() == 2 {
                Ok(AheadBehind {
                    ahead: parts[0].parse().unwrap_or(0),
                    behind: parts[1].parse().unwrap_or(0),
                })
            } else {
                Ok(AheadBehind { ahead: 0, behind: 0 })
            }
        }
        Err(_) => Ok(AheadBehind { ahead: 0, behind: 0 }),
    }
}

#[tauri::command]
pub fn git_log_graph(repo_path: String, max_count: Option<usize>) -> Result<String, String> {
    let count = max_count.unwrap_or(150).to_string();
    // Each commit line: <graph chars><hash>\x1f<subject>\x1f<author>\x1f<relative date>\x1f<refs>
    // Connector lines (|, \, /) have no \x1f and are left as-is
    run_git(
        &repo_path,
        &[
            "log",
            "--graph",
            "--format=%h%x1f%s%x1f%an%x1f%ar%x1f%D",
            "--all",
            &format!("--max-count={}", count),
        ],
    )
}

#[tauri::command]
pub fn git_discard(repo_path: String, file_path: String, untracked: bool) -> Result<(), String> {
    if untracked {
        run_git(&repo_path, &["clean", "-f", "--", &file_path]).map(|_| ())
    } else {
        run_git(&repo_path, &["checkout", "--", &file_path]).map(|_| ())
    }
}
