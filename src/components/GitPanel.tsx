import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

interface GitStatusEntry {
  path: string;
  status: string;
  staged: boolean;
}

interface GitBranch {
  name: string;
  current: boolean;
}

interface GitPanelProps {
  rootPath: string | null;
}

function statusClass(s: string): string {
  switch (s) {
    case "M": return "git-status-modified";
    case "A": return "git-status-added";
    case "D": return "git-status-deleted";
    case "R": return "git-status-renamed";
    case "??": return "git-status-untracked";
    default: return "";
  }
}

export function GitPanel({ rootPath }: GitPanelProps) {
  const [isRepo, setIsRepo] = useState(false);
  const [entries, setEntries] = useState<GitStatusEntry[]>([]);
  const [branch, setBranch] = useState<string>("");
  const [branches, setBranches] = useState<GitBranch[]>([]);
  const [commitMsg, setCommitMsg] = useState("");
  const [diffText, setDiffText] = useState<string | null>(null);
  const [diffFile, setDiffFile] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [log, setLog] = useState<string>(""); // status messages

  const refreshStatus = useCallback(async () => {
    if (!rootPath) return;
    try {
      const repo: boolean = await invoke("git_has_repo", { path: rootPath });
      setIsRepo(repo);
      if (!repo) return;

      const [statusEntries, currentBranch, allBranches] = await Promise.all([
        invoke<GitStatusEntry[]>("git_status", { repoPath: rootPath }),
        invoke<string>("git_current_branch", { repoPath: rootPath }),
        invoke<GitBranch[]>("git_branch", { repoPath: rootPath }),
      ]);
      setEntries(statusEntries);
      setBranch(currentBranch);
      setBranches(allBranches);
      setDiffText(null);
      setDiffFile(null);
    } catch (err) {
      setLog(`Error: ${err}`);
    }
  }, [rootPath]);

  useEffect(() => {
    refreshStatus();
  }, [refreshStatus]);

  // Initial check when rootPath changes
  useEffect(() => {
    if (rootPath) {
      invoke<boolean>("git_has_repo", { path: rootPath })
        .then(setIsRepo)
        .catch(() => setIsRepo(false));
    } else {
      setIsRepo(false);
    }
  }, [rootPath]);

  const handleStage = async (file: string) => {
    if (!rootPath) return;
    setLoading(true);
    try {
      await invoke("git_add", { repoPath: rootPath, files: [file] });
      await refreshStatus();
    } catch (err) { setLog(`Error: ${err}`); }
    setLoading(false);
  };

  const handleUnstage = async (file: string) => {
    if (!rootPath) return;
    setLoading(true);
    try {
      await invoke("git_unstage", { repoPath: rootPath, files: [file] });
      await refreshStatus();
    } catch (err) { setLog(`Error: ${err}`); }
    setLoading(false);
  };

  const handleStageAll = async () => {
    if (!rootPath) return;
    setLoading(true);
    try {
      const files = entries.filter(e => !e.staged && e.status !== "??").map(e => e.path);
      if (files.length > 0) {
        await invoke("git_add", { repoPath: rootPath, files });
        await refreshStatus();
      }
    } catch (err) { setLog(`Error: ${err}`); }
    setLoading(false);
  };

  const handleUnstageAll = async () => {
    if (!rootPath) return;
    setLoading(true);
    try {
      const files = entries.filter(e => e.staged).map(e => e.path);
      if (files.length > 0) {
        await invoke("git_unstage", { repoPath: rootPath, files });
        await refreshStatus();
      }
    } catch (err) { setLog(`Error: ${err}`); }
    setLoading(false);
  };

  const handleCommit = async () => {
    if (!rootPath || !commitMsg.trim()) return;
    setLoading(true);
    try {
      const result: string = await invoke("git_commit", { repoPath: rootPath, message: commitMsg.trim() });
      setLog(result.trim());
      setCommitMsg("");
      await refreshStatus();
    } catch (err) { setLog(`Error: ${err}`); }
    setLoading(false);
  };

  const handlePush = async () => {
    if (!rootPath) return;
    setLoading(true);
    try {
      const result: string = await invoke("git_push", { repoPath: rootPath });
      setLog(result.trim() || "Push successful");
      await refreshStatus();
    } catch (err) { setLog(`Error: ${err}`); }
    setLoading(false);
  };

  const handlePull = async () => {
    if (!rootPath) return;
    setLoading(true);
    try {
      const result: string = await invoke("git_pull", { repoPath: rootPath });
      setLog(result.trim() || "Pull successful");
      await refreshStatus();
    } catch (err) { setLog(`Error: ${err}`); }
    setLoading(false);
  };

  const handleFetch = async () => {
    if (!rootPath) return;
    setLoading(true);
    try {
      const result: string = await invoke("git_fetch", { repoPath: rootPath });
      setLog(result.trim() || "Fetch successful");
      await refreshStatus();
    } catch (err) { setLog(`Error: ${err}`); }
    setLoading(false);
  };

  const handleCheckout = async (target: string) => {
    if (!rootPath) return;
    setLoading(true);
    try {
      await invoke("git_checkout", { repoPath: rootPath, target });
      await refreshStatus();
    } catch (err) { setLog(`Error: ${err}`); }
    setLoading(false);
  };

  const handleShowDiff = async (file: string, staged: boolean) => {
    if (!rootPath) return;
    try {
      const diff: string = await invoke("git_diff_file", { repoPath: rootPath, filePath: file, staged });
      setDiffText(diff);
      setDiffFile(file);
    } catch (err) { setLog(`Error: ${err}`); }
  };

  const handleInit = async () => {
    if (!rootPath) return;
    setLoading(true);
    try {
      await invoke("git_init", { repoPath: rootPath });
      await refreshStatus();
    } catch (err) { setLog(`Error: ${err}`); }
    setLoading(false);
  };

  // Group entries
  const staged = entries.filter(e => e.staged);
  const unstaged = entries.filter(e => !e.staged);

  if (!rootPath) {
    return <div className="git-panel-empty">Open a folder to use Git</div>;
  }

  if (!isRepo) {
    return (
      <div className="git-panel-empty">
        <p>Not a Git repository</p>
        <button className="git-btn" onClick={handleInit}>Initialize Repository</button>
      </div>
    );
  }

  return (
    <div className="git-panel">
      {/* Branch info & actions */}
      <div className="git-section">
        <div className="git-section-header">
          <span className="git-branch-icon">⎇</span>
          <select
            className="git-branch-select"
            value={branch}
            onChange={(e) => handleCheckout(e.target.value)}
          >
            {branches.map((b) => (
              <option key={b.name} value={b.name}>
                {b.name} {b.current ? "(current)" : ""}
              </option>
            ))}
          </select>
        </div>
        <div className="git-actions-row">
          <button className="git-btn" onClick={handleFetch} disabled={loading}>Fetch</button>
          <button className="git-btn" onClick={handlePull} disabled={loading}>Pull</button>
          <button className="git-btn" onClick={handlePush} disabled={loading}>Push</button>
        </div>
      </div>

      {/* Staged changes */}
      {staged.length > 0 && (
        <div className="git-section">
          <div className="git-section-header">
            <span className="git-section-title">Staged Changes</span>
            <button className="git-link-btn" onClick={handleUnstageAll}>Unstage All</button>
          </div>
          {staged.map((e) => (
            <div
              key={`s-${e.path}`}
              className={`git-file-row ${diffFile === e.path ? "git-file-selected" : ""}`}
              onClick={() => handleShowDiff(e.path, true)}
            >
              <span className={`git-status-badge ${statusClass(e.status)}`}>{e.status}</span>
              <span className="git-file-name">{e.path}</span>
              <button
                className="git-link-btn"
                onClick={(ev) => { ev.stopPropagation(); handleUnstage(e.path); }}
              >−</button>
            </div>
          ))}
        </div>
      )}

      {/* Unstaged changes */}
      {unstaged.length > 0 && (
        <div className="git-section">
          <div className="git-section-header">
            <span className="git-section-title">Changes</span>
            <button className="git-link-btn" onClick={handleStageAll}>Stage All</button>
          </div>
          {unstaged.map((e) => (
            <div
              key={`u-${e.path}`}
              className={`git-file-row ${diffFile === e.path && !e.staged ? "git-file-selected" : ""}`}
              onClick={() => handleShowDiff(e.path, false)}
            >
              <span className={`git-status-badge ${statusClass(e.status)}`}>{e.status}</span>
              <span className="git-file-name">{e.path}</span>
              <button
                className="git-link-btn"
                onClick={(ev) => { ev.stopPropagation(); handleStage(e.path); }}
              >+</button>
            </div>
          ))}
        </div>
      )}

      {/* Commit */}
      {entries.length > 0 && (
        <div className="git-section">
          <textarea
            className="git-commit-input"
            placeholder="Commit message..."
            value={commitMsg}
            onChange={(e) => setCommitMsg(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                handleCommit();
              }
            }}
            rows={3}
          />
          <button
            className="git-btn git-btn-commit"
            disabled={loading || !commitMsg.trim() || staged.length === 0}
            onClick={handleCommit}
          >
            Commit
          </button>
        </div>
      )}

      {/* Diff view */}
      {diffText && (
        <div className="git-section">
          <div className="git-section-header">
            <span className="git-section-title">Diff: {diffFile}</span>
            <button className="git-link-btn" onClick={() => { setDiffText(null); setDiffFile(null); }}>Close</button>
          </div>
          <pre className="git-diff-view">{diffText}</pre>
        </div>
      )}

      {/* Log */}
      {log && (
        <div className="git-log" onClick={() => setLog("")}>
          {log}
        </div>
      )}

      {entries.length === 0 && !loading && (
        <div className="git-panel-empty">No changes. Working tree clean.</div>
      )}
    </div>
  );
}
