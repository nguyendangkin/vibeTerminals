import { useState, useEffect, useRef } from "react";
import type { GitStatusEntry } from "../types";

interface GitPanelProps {
  entries: GitStatusEntry[];
  stagedCount: number;
  unstagedCount: number;
  untrackedCount: number;
  aheadCount?: number;
  onDiscardAll?: () => void;
  onCommit?: (message: string) => void;
}

export function GitPanel({ entries, stagedCount, unstagedCount, untrackedCount, aheadCount, onDiscardAll, onCommit }: GitPanelProps) {
  const staged = entries.filter((e) => e.staged && e.status !== "??");
  const unstaged = entries.filter((e) => !e.staged && e.status !== "??");
  const untracked = entries.filter((e) => e.status === "??");
  const [confirming, setConfirming] = useState(false);
  const [commitMsg, setCommitMsg] = useState("");
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (confirmTimerRef.current !== null) clearTimeout(confirmTimerRef.current);
    };
  }, []);

  const handleDiscardClick = () => {
    if (confirming) {
      onDiscardAll?.();
      setConfirming(false);
      if (confirmTimerRef.current !== null) {
        clearTimeout(confirmTimerRef.current);
        confirmTimerRef.current = null;
      }
    } else {
      setConfirming(true);
      confirmTimerRef.current = setTimeout(() => setConfirming(false), 3000);
    }
  };

  const handleCommit = () => {
    if (!commitMsg.trim()) return;
    onCommit?.(commitMsg.trim());
    setCommitMsg("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleCommit();
    }
  };

  if (entries.length === 0) {
    return (
      <div className="git-panel">
        <div className="git-panel-header">
          <span className="git-panel-title">SOURCE CONTROL</span>
          {aheadCount !== undefined && aheadCount > 0 && (
            <span className="git-ahead-badge">{aheadCount} to push</span>
          )}
        </div>
        <div className="git-panel-empty">No changes</div>
      </div>
    );
  }

  return (
    <div className="git-panel">
      <div className="git-panel-header">
        <span className="git-panel-title">SOURCE CONTROL</span>
        <span className="git-panel-counts">
          {stagedCount > 0 && <span className="git-count-staged">{stagedCount}</span>}
          {unstagedCount > 0 && <span className="git-count-unstaged">{unstagedCount}</span>}
          {untrackedCount > 0 && <span className="git-count-untrack">{untrackedCount}</span>}
        </span>
        {aheadCount !== undefined && aheadCount > 0 && (
          <span className="git-ahead-badge">{aheadCount} to push</span>
        )}
        {onDiscardAll && (unstagedCount > 0 || untrackedCount > 0) && (
          <button
            className={`git-discard-btn${confirming ? " git-discard-confirm" : ""}`}
            onClick={handleDiscardClick}
            title={confirming ? "Click again to confirm" : "Discard all changes"}
          >
            {confirming ? "Confirm?" : "Discard All"}
          </button>
        )}
      </div>

      <div className="git-panel-body">
        {/* Commit section */}
        {entries.length > 0 && onCommit && (
          <div className="git-commit-section">
            <textarea
              className="git-commit-input"
              placeholder="Commit message..."
              value={commitMsg}
              onChange={(e) => setCommitMsg(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={2}
            />
            <button
              className="git-commit-btn"
              onClick={handleCommit}
              disabled={!commitMsg.trim()}
              title="Commit all changes (Ctrl+Enter)"
            >
              Commit All
            </button>
          </div>
        )}

        {staged.length > 0 && (
          <div className="git-section">
            <div className="git-section-header">Staged Changes</div>
            {staged.map((e) => (
              <div key={e.file_path} className="git-file-item">
                <span className="git-file-name">{e.file_name}</span>
                <span className="git-file-dir" title={e.file_path}>
                  {e.file_path !== e.file_name ? e.file_path.replace(/[/\\][^/\\]*$/, "") : ""}
                </span>
              </div>
            ))}
          </div>
        )}

        {unstaged.length > 0 && (
          <div className="git-section">
            <div className="git-section-header">Changes</div>
            {unstaged.map((e) => (
              <div key={e.file_path} className="git-file-item">
                <span className="git-file-name">{e.file_name}</span>
                <span className="git-file-dir" title={e.file_path}>
                  {e.file_path !== e.file_name ? e.file_path.replace(/[/\\][^/\\]*$/, "") : ""}
                </span>
              </div>
            ))}
          </div>
        )}

        {untracked.length > 0 && (
          <div className="git-section">
            <div className="git-section-header">Untracked Files</div>
            {untracked.map((e) => (
              <div key={e.file_path} className="git-file-item">
                <span className="git-file-name">{e.file_name}</span>
                <span className="git-file-dir" title={e.file_path}>
                  {e.file_path !== e.file_name ? e.file_path.replace(/[/\\][^/\\]*$/, "") : ""}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
