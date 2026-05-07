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

interface AheadBehind {
  ahead: number;
  behind: number;
}

interface GitPanelProps {
  rootPath: string | null;
}

const STATUS_LABEL: Record<string, string> = {
  M: "M", A: "A", D: "D", R: "R", C: "C", U: "U", "??": "U",
};

const STATUS_CLS: Record<string, string> = {
  M: "git-s-modified",
  A: "git-s-added",
  D: "git-s-deleted",
  R: "git-s-renamed",
  C: "git-s-renamed",
  U: "git-s-conflict",
  "??": "git-s-untracked",
};

function basename(p: string) { return p.split(/[/\\]/).pop() ?? p; }
function dirname(p: string) {
  const idx = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return idx > 0 ? p.slice(0, idx) : "";
}

type PanelTab = "changes" | "history";

// ── Graph parsing ─────────────────────────────────────────────────────────
interface CommitRow {
  type: "commit";
  graph: string;
  hash: string;
  subject: string;
  author: string;
  date: string;
  refs: string[];
}
interface ConnectorRow { type: "connector"; raw: string; }
type GraphRow = CommitRow | ConnectorRow;

function parseGraph(raw: string): GraphRow[] {
  return raw.split("\n").map((line): GraphRow => {
    const sep = "\x1f";
    const i = line.indexOf(sep);
    if (i === -1) return { type: "connector", raw: line };
    const before = line.slice(0, i);
    const hashMatch = before.match(/([0-9a-f]{7,40})$/);
    if (!hashMatch) return { type: "connector", raw: line };
    const hash = hashMatch[1].slice(0, 7);
    const graph = before.slice(0, before.length - hashMatch[1].length);
    const fields = line.slice(i + 1).split(sep);
    const [subject = "", author = "", date = "", refsRaw = ""] = fields;
    const refs = refsRaw.split(",").map(r => r.trim()).filter(Boolean);
    return { type: "commit", graph, hash, subject, author, date, refs };
  }).filter(r => r.type === "commit" || (r as ConnectorRow).raw !== "");
}

function RefChip({ label }: { label: string }) {
  let cls = "git-ref";
  if (label === "HEAD") cls += " git-ref-head-ptr";
  else if (label.startsWith("HEAD -> ")) cls += " git-ref-local";
  else if (label.startsWith("tag: ")) cls += " git-ref-tag";
  else if (label.includes("/")) cls += " git-ref-remote";
  else cls += " git-ref-local";
  const display = label.replace("HEAD -> ", "").replace("tag: ", "");
  return <span className={cls} title={label}>{display}</span>;
}

export function GitPanel({ rootPath }: GitPanelProps) {
  const [isRepo, setIsRepo] = useState(false);
  const [entries, setEntries] = useState<GitStatusEntry[]>([]);
  const [branch, setBranch] = useState("");
  const [branches, setBranches] = useState<GitBranch[]>([]);
  const [aheadBehind, setAheadBehind] = useState<AheadBehind>({ ahead: 0, behind: 0 });
  const [commitMsg, setCommitMsg] = useState("");
  const [selected, setSelected] = useState<{ path: string; staged: boolean } | null>(null);
  const [diffLines, setDiffLines] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<{ text: string; error: boolean } | null>(null);
  const [tab, setTab] = useState<PanelTab>("changes");
  const [graphRows, setGraphRows] = useState<GraphRow[]>([]);

  const toast = (text: string, error = false) => setMsg({ text, error });

  const refresh = useCallback(async () => {
    if (!rootPath) return;
    try {
      const repo = await invoke<boolean>("git_has_repo", { path: rootPath });
      setIsRepo(repo);
      if (!repo) return;
      const [sts, cur, brs, ab] = await Promise.all([
        invoke<GitStatusEntry[]>("git_status", { repoPath: rootPath }),
        invoke<string>("git_current_branch", { repoPath: rootPath }),
        invoke<GitBranch[]>("git_branch", { repoPath: rootPath }),
        invoke<AheadBehind>("git_ahead_behind", { repoPath: rootPath }).catch(() => ({ ahead: 0, behind: 0 })),
      ]);
      setEntries(sts);
      setBranch(cur);
      setBranches(brs);
      setAheadBehind(ab);
    } catch (err) { toast(`${err}`, true); }
  }, [rootPath]);

  useEffect(() => { refresh(); }, [refresh]);

  const loadGraph = useCallback(async () => {
    if (!rootPath) return;
    try {
      const raw = await invoke<string>("git_log_graph", { repoPath: rootPath, maxCount: 150 });
      setGraphRows(raw ? parseGraph(raw) : []);
    } catch { setGraphRows([]); }
  }, [rootPath]);

  useEffect(() => {
    if (tab === "history" && isRepo) loadGraph();
  }, [tab, isRepo, loadGraph]);

  const run = useCallback(async (fn: () => Promise<void>) => {
    setLoading(true);
    try { await fn(); }
    catch (err) { toast(`${err}`, true); }
    finally { setLoading(false); }
  }, []);

  const stage = (file: string) => run(async () => {
    await invoke("git_add", { repoPath: rootPath, files: [file] });
    await refresh();
  });

  const unstage = (file: string) => run(async () => {
    await invoke("git_unstage", { repoPath: rootPath, files: [file] });
    await refresh();
  });

  const discard = (file: string, untracked: boolean) => run(async () => {
    await invoke("git_discard", { repoPath: rootPath, filePath: file, untracked });
    if (selected?.path === file) { setSelected(null); setDiffLines([]); }
    await refresh();
  });

  const stageAll = () => run(async () => {
    await invoke("git_add", { repoPath: rootPath, files: ["."] });
    await refresh();
  });

  const unstageAll = () => run(async () => {
    const files = staged.map(e => e.path);
    if (files.length) { await invoke("git_unstage", { repoPath: rootPath, files }); await refresh(); }
  });

  const commit = () => run(async () => {
    const m = commitMsg.trim();
    if (!m) return;
    const res = await invoke<string>("git_commit", { repoPath: rootPath, message: m });
    toast(res.trim() || "Committed");
    setCommitMsg("");
    await refresh();
  });

  const push = () => run(async () => {
    const res = await invoke<string>("git_push", { repoPath: rootPath });
    toast(res.trim() || "Push successful");
    await refresh();
  });

  const pull = () => run(async () => {
    const res = await invoke<string>("git_pull", { repoPath: rootPath });
    toast(res.trim() || "Pull successful");
    await refresh();
  });

  const fetchRemote = () => run(async () => {
    const res = await invoke<string>("git_fetch", { repoPath: rootPath });
    toast(res.trim() || "Fetch done");
    await refresh();
  });

  const checkout = (target: string) => run(async () => {
    await invoke("git_checkout", { repoPath: rootPath, target });
    await refresh();
  });

  const showDiff = async (file: string, isStaged: boolean) => {
    setSelected({ path: file, staged: isStaged });
    try {
      const diff = await invoke<string>("git_diff_file", { repoPath: rootPath, filePath: file, staged: isStaged });
      setDiffLines(diff.split("\n"));
    } catch (err) { setDiffLines([`Error: ${err}`]); }
  };

  const initRepo = () => run(async () => {
    await invoke("git_init", { repoPath: rootPath });
    await refresh();
  });

  const staged = entries.filter(e => e.staged);
  const unstaged = entries.filter(e => !e.staged);

  if (!rootPath) {
    return <div className="git-empty">Open a folder to use Git</div>;
  }

  if (!isRepo) {
    return (
      <div className="git-empty">
        <p>Not a Git repository</p>
        <button className="git-btn" onClick={initRepo}>Initialize Repository</button>
      </div>
    );
  }

  return (
    <div className="git-panel">

      {/* ── Tab switcher ──────────────────────────────────────── */}
      <div className="git-tab-bar">
        <button
          className={`git-tab${tab === "changes" ? " git-tab-active" : ""}`}
          onClick={() => setTab("changes")}
        >Changes</button>
        <button
          className={`git-tab${tab === "history" ? " git-tab-active" : ""}`}
          onClick={() => setTab("history")}
        >History</button>
      </div>

      {/* ── Branch & remote (always visible) ─────────────────── */}
      <div className="git-section">
        <div className="git-branch-row">
          <span className="git-branch-icon">⎇</span>
          <select
            className="git-branch-select"
            value={branch}
            onChange={e => checkout(e.target.value)}
            disabled={loading}
          >
            {branches.map(b => (
              <option key={b.name} value={b.name}>{b.name}</option>
            ))}
          </select>
          {(aheadBehind.ahead > 0 || aheadBehind.behind > 0) && (
            <span className="git-sync-badges">
              {aheadBehind.behind > 0 && <span className="git-badge-behind">↓{aheadBehind.behind}</span>}
              {aheadBehind.ahead > 0 && <span className="git-badge-ahead">↑{aheadBehind.ahead}</span>}
            </span>
          )}
        </div>
        <div className="git-remote-row">
          <button className="git-btn" onClick={fetchRemote} disabled={loading}>Fetch</button>
          <button className="git-btn" onClick={pull} disabled={loading}>Pull</button>
          <button className="git-btn" onClick={push} disabled={loading}>Push</button>
        </div>
      </div>

      {/* ══ CHANGES TAB ═══════════════════════════════════════ */}
      {tab === "changes" && (
        <>
          {/* Commit */}
          <div className="git-section">
            <textarea
              className="git-commit-input"
              placeholder="Message (Ctrl+Enter to commit)"
              value={commitMsg}
              onChange={e => setCommitMsg(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); commit(); }
              }}
              rows={3}
            />
            <button
              className="git-btn git-btn-commit"
              disabled={loading || !commitMsg.trim() || staged.length === 0}
              onClick={commit}
            >
              Commit to {branch || "HEAD"}
            </button>
          </div>

          {/* Staged */}
          <div className="git-section">
            <div className="git-section-header">
              <span className="git-section-title">Staged Changes ({staged.length})</span>
              {staged.length > 0 && (
                <button className="git-hdr-btn" title="Unstage All" onClick={unstageAll}>↩ All</button>
              )}
            </div>
            {staged.length === 0
              ? <div className="git-section-empty">No staged changes</div>
              : staged.map(e => (
                <div
                  key={`s-${e.path}`}
                  className={`git-file-row${selected?.path === e.path && selected.staged ? " git-file-selected" : ""}`}
                  onClick={() => showDiff(e.path, true)}
                >
                  <span className={`git-badge ${STATUS_CLS[e.status] ?? ""}`}>{STATUS_LABEL[e.status] ?? e.status}</span>
                  <span className="git-file-name" title={e.path}>{basename(e.path)}</span>
                  {dirname(e.path) && <span className="git-file-dir">{dirname(e.path)}</span>}
                  <div className="git-file-btns">
                    <button className="git-icon-btn" title="Unstage" onClick={ev => { ev.stopPropagation(); unstage(e.path); }}>↩</button>
                  </div>
                </div>
              ))
            }
          </div>

          {/* Unstaged */}
          <div className="git-section">
            <div className="git-section-header">
              <span className="git-section-title">Changes ({unstaged.length})</span>
              {unstaged.length > 0 && (
                <button className="git-hdr-btn" title="Stage All" onClick={stageAll}>+ All</button>
              )}
            </div>
            {unstaged.length === 0
              ? <div className="git-section-empty">No changes</div>
              : unstaged.map(e => (
                <div
                  key={`u-${e.path}`}
                  className={`git-file-row${selected?.path === e.path && !selected.staged ? " git-file-selected" : ""}`}
                  onClick={() => showDiff(e.path, false)}
                >
                  <span className={`git-badge ${STATUS_CLS[e.status] ?? ""}`}>{STATUS_LABEL[e.status] ?? e.status}</span>
                  <span className="git-file-name" title={e.path}>{basename(e.path)}</span>
                  {dirname(e.path) && <span className="git-file-dir">{dirname(e.path)}</span>}
                  <div className="git-file-btns">
                    <button
                      className="git-icon-btn git-icon-btn-danger"
                      title="Discard Changes"
                      onClick={ev => { ev.stopPropagation(); discard(e.path, e.status === "??"); }}
                    >↺</button>
                    <button className="git-icon-btn" title="Stage" onClick={ev => { ev.stopPropagation(); stage(e.path); }}>+</button>
                  </div>
                </div>
              ))
            }
          </div>

          {/* Diff */}
          {selected && (
            <div className="git-section">
              <div className="git-section-header">
                <span className="git-section-title">
                  {basename(selected.path)} · {selected.staged ? "staged" : "working tree"}
                </span>
                <button className="git-hdr-btn" onClick={() => { setSelected(null); setDiffLines([]); }}>✕</button>
              </div>
              <div className="git-diff-view">
                {diffLines.map((line, i) => {
                  let cls = "git-diff-line";
                  if (line.startsWith("+") && !line.startsWith("+++")) cls += " git-diff-add";
                  else if (line.startsWith("-") && !line.startsWith("---")) cls += " git-diff-del";
                  else if (line.startsWith("@@")) cls += " git-diff-hunk";
                  return <div key={i} className={cls}>{line || "\u00A0"}</div>;
                })}
              </div>
            </div>
          )}

          {entries.length === 0 && !loading && (
            <div className="git-clean">Working tree clean</div>
          )}
        </>
      )}

      {/* ══ HISTORY TAB ═══════════════════════════════════════ */}
      {tab === "history" && (
        <div className="git-graph-wrap">
          <div className="git-graph-toolbar">
            <span className="git-section-title">History</span>
            <button className="git-hdr-btn" onClick={loadGraph}>↻</button>
          </div>
          <div className="git-graph-view">
            {graphRows.length === 0
              ? <div className="git-section-empty">No commits yet</div>
              : graphRows.map((row, i) => {
                  if (row.type === "connector") {
                    return (
                      <div key={i} className="git-graph-connector">
                        {row.raw || "\u00A0"}
                      </div>
                    );
                  }
                  return (
                    <div key={i} className="git-graph-commit-row">
                      <span className="git-graph-prefix">{row.graph}</span>
                      <span className="git-graph-hash">{row.hash}</span>
                      {row.refs.length > 0 && (
                        <span className="git-graph-refs">
                          {row.refs.map(r => <RefChip key={r} label={r} />)}
                        </span>
                      )}
                      <span className="git-graph-subject" title={row.subject}>{row.subject}</span>
                      <span className="git-graph-meta">{row.author} · {row.date}</span>
                    </div>
                  );
                })
            }
          </div>
        </div>
      )}

      {/* ── Message toast ─────────────────────────────────────── */}
      {msg && (
        <div className={`git-message${msg.error ? " git-message-error" : ""}`} onClick={() => setMsg(null)}>
          {msg.text}
        </div>
      )}
    </div>
  );
}
