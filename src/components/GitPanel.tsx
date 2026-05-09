import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { GitStatusResult, GitCommit, GraphCommit } from "../types";

interface Props {
  rootPath: string | null;
}

function buildGraph(commits: GitCommit[]): GraphCommit[] {
  if (commits.length === 0) return [];

  const sorted = [...commits].reverse(); // oldest first
  const activeLanes = new Map<string, number>();
  const laneColors = new Map<number, string>();
  const palette = ["#f1a33b", "#58a6ff", "#3fb950", "#d96262", "#bc8cff", "#f778ba", "#39d353", "#ff7b72"];
  let nextLane = 0;
  let colorIdx = 0;

  function getLaneColor(lane: number): string {
    if (!laneColors.has(lane)) {
      laneColors.set(lane, palette[colorIdx % palette.length]);
      colorIdx++;
    }
    return laneColors.get(lane)!;
  }

  function findFreeLane(): number {
    const used = new Set(activeLanes.values());
    let lane = 0;
    while (used.has(lane)) lane++;
    nextLane = Math.max(nextLane, lane + 1);
    return lane;
  }

  const graphData: GraphCommit[] = [];

  for (const commit of sorted) {
    let lane: number;
    const mergeLanes: number[] = [];

    if (commit.parents.length > 0 && activeLanes.has(commit.parents[0])) {
      lane = activeLanes.get(commit.parents[0])!;
      activeLanes.delete(commit.parents[0]);
    } else {
      lane = findFreeLane();
    }

    for (let i = 1; i < commit.parents.length; i++) {
      if (activeLanes.has(commit.parents[i])) {
        mergeLanes.push(activeLanes.get(commit.parents[i])!);
        activeLanes.delete(commit.parents[i]);
      }
    }

    activeLanes.set(commit.hash, lane);
    getLaneColor(lane);
    mergeLanes.forEach((ml) => getLaneColor(ml));

    graphData.push({
      ...commit,
      lane,
      mergeLanes,
      totalLanes: nextLane,
    });
  }

  // Update totalLanes to be consistent
  const maxLane = Math.max(...graphData.map((g) => Math.max(g.lane, ...g.mergeLanes)), 0) + 1;
  for (const g of graphData) {
    g.totalLanes = maxLane;
  }

  return graphData.reverse(); // newest first
}

const STATUS_LABELS: Record<string, string> = {
  M: "Modified",
  A: "Added",
  D: "Deleted",
  R: "Renamed",
  "??": "Untracked",
  "!": "Ignored",
  U: "Conflict",
};

export function GitPanel({ rootPath }: Props) {
  const [status, setStatus] = useState<GitStatusResult | null>(null);
  const [commits, setCommits] = useState<GraphCommit[]>([]);
  const [commitMessage, setCommitMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pushing, setPushing] = useState(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const refreshTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchGitData = useCallback(async () => {
    if (!rootPath) return;
    try {
      const [s, c] = await Promise.all([
        invoke<GitStatusResult>("git_status", { dir: rootPath }),
        invoke<GitCommit[]>("git_log", { dir: rootPath, count: 60 }),
      ]);
      setStatus(s);
      setCommits(buildGraph(c));
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, [rootPath]);

  useEffect(() => {
    fetchGitData();
    refreshTimer.current = setInterval(fetchGitData, 5000);
    return () => {
      if (refreshTimer.current) clearInterval(refreshTimer.current);
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, [fetchGitData]);

  const showMsg = (msg: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setActionMsg(msg);
    toastTimer.current = setTimeout(() => {
      setActionMsg(null);
      toastTimer.current = null;
    }, 3000);
  };

  const commit = async () => {
    if (!rootPath || !commitMessage.trim()) return;
    setLoading(true);
    setError(null);
    try {
      await invoke("git_commit", { dir: rootPath, message: commitMessage.trim() });
      setCommitMessage("");
      showMsg("Commit successful!");
      fetchGitData();
    } catch (e) {
      setError(String(e));
    }
    setLoading(false);
  };

  const commitAndPush = async () => {
    if (!rootPath || !commitMessage.trim()) return;
    setLoading(true);
    setError(null);
    try {
      await invoke("git_commit", { dir: rootPath, message: commitMessage.trim() });
      setCommitMessage("");
      await invoke("git_push", { dir: rootPath });
      showMsg("Commit & Push successful!");
      fetchGitData();
    } catch (e) {
      setError(String(e));
    }
    setLoading(false);
  };

  const push = async () => {
    if (!rootPath) return;
    setPushing(true);
    setError(null);
    try {
      await invoke("git_push", { dir: rootPath });
      showMsg("Push successful!");
      fetchGitData();
    } catch (e) {
      setError(String(e));
    }
    setPushing(false);
  };

  const resetAll = async () => {
    if (!rootPath) return;
    const confirmed = window.confirm(
      "Are you sure you want to reset all changes? This action cannot be undone.\n\nAll uncommitted changes will be lost."
    );
    if (!confirmed) return;
    setLoading(true);
    setError(null);
    try {
      await invoke("git_reset_all", { dir: rootPath });
      showMsg("All changes reset");
      fetchGitData();
    } catch (e) {
      setError(String(e));
    }
    setLoading(false);
  };

  if (!rootPath) {
    return (
      <div className="git-empty">
        <p>Open a folder to use Git</p>
      </div>
    );
  }

  const allFiles = status?.files ?? [];
  const hasChanges = allFiles.length > 0;

  return (
    <div className="git-panel">
      {actionMsg && (
        <div className="git-toast">{actionMsg}</div>
      )}

      {/* Branch Header */}
      <div className="git-header">
        <div className="git-branch-info">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
            <path d="M11.75 2.5a.75.75 0 100 1.5.75.75 0 000-1.5zm-2.25.75a2.25 2.25 0 113 2.122V6A2.5 2.5 0 0110 8.5H6a1 1 0 00-1 1v1.128a2.251 2.251 0 11-1.5 0V5.372a2.25 2.25 0 111.5 0v1.836A2.493 2.493 0 016 7h4a1 1 0 001-1v-.628A2.25 2.25 0 019.5 3.25zM4.25 12a.75.75 0 100 1.5.75.75 0 000-1.5zM3.5 3.25a.75.75 0 111.5 0 .75.75 0 01-1.5 0z"/>
          </svg>
          <span className="git-branch-name">{status?.branch ?? "..."}</span>
          {status && status.ahead > 0 && (
            <span className="git-ahead" title={`${status.ahead} commit phía trước`}>
              ↑{status.ahead}
            </span>
          )}
          {status && status.behind > 0 && (
            <span className="git-behind" title={`${status.behind} commit phía sau`}>
              ↓{status.behind}
            </span>
          )}
        </div>
        <div className="git-header-actions">
          <button className="git-btn git-btn-outline" onClick={push} disabled={pushing || status?.ahead === 0}>
            {pushing ? "Pushing..." : "Push"}
          </button>
        </div>
      </div>

      {error && (
        <div className="git-error">
          <span>{error}</span>
          <button className="git-error-close" onClick={() => setError(null)}>×</button>
        </div>
      )}

      <div className="git-main">
        {/* Left Panel */}
        <div className="git-left">
        {/* Commit Section */}
        <div className="git-section">
          <div className="git-section-header">
            <span className="git-section-title">Commit</span>
            <span className="git-section-hint">
              {hasChanges
                ? `${allFiles.length} file(s) to commit`
                : "No changes to commit"}
            </span>
          </div>
          <textarea
            className="git-commit-input"
            placeholder="Enter commit message..."
            value={commitMessage}
            onChange={(e) => setCommitMessage(e.target.value)}
            rows={3}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                commit();
              }
            }}
          />
          <div className="git-commit-actions">
            <button
              className="git-btn git-btn-primary"
              onClick={commit}
              disabled={loading || !commitMessage.trim() || !hasChanges}
            >
              {loading ? "Committing..." : "Commit"}
            </button>
            <button
              className="git-btn git-btn-primary"
              onClick={commitAndPush}
              disabled={loading || !commitMessage.trim() || !hasChanges}
            >
              Commit & Push
            </button>
            <span className="git-commit-hint">Ctrl+Enter</span>
          </div>
        </div>

        {/* Changes Section */}
        <div className="git-section">
          <div className="git-section-header">
            <span className="git-section-title">Changes ({allFiles.length})</span>
            <div className="git-section-actions">
              {hasChanges && (
                <button className="git-btn git-btn-small git-btn-danger" onClick={resetAll} disabled={loading}>
                  Reset all
                </button>
              )}
            </div>
          </div>

          <div className="git-changes-list">
            {hasChanges && (
              <div className="git-changes-group">
                {allFiles.map((f) => (
                  <div key={f.path} className="git-file-row">
                    <span className={`git-file-status git-status-${f.status.toLowerCase()}`}>
                      {f.status}
                    </span>
                    <span className="git-file-path">{f.path}</span>
                    <span className="git-file-label">{STATUS_LABELS[f.status] ?? f.status}</span>
                  </div>
                ))}
              </div>
            )}

            {!hasChanges && (
              <div className="git-no-changes">
                No changes. Working tree clean.
              </div>
            )}
          </div>
        </div>
      </div>

        {/* Right Panel */}
        <div className="git-right">
          <div className="git-section-header git-right-header">
            <span className="git-section-title">History ({commits.length})</span>
          </div>
          <div className="git-graph-container">
            {commits.map((commit) => (
              <GraphRow key={commit.hash} commit={commit} commits={commits} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

const PALETTE = ["#f1a33b", "#58a6ff", "#3fb950", "#d96262", "#bc8cff", "#f778ba", "#39d353", "#ff7b72"];

interface LaneCell {
  segments: string[];
  color: string;
  isCommit: boolean;
  hasRefs: boolean;
}

function GraphRow({ commit, commits }: { commit: GraphCommit; commits: GraphCommit[] }) {
  const allLanes = new Set<number>();
  for (const c of commits) {
    allLanes.add(c.lane);
    c.mergeLanes.forEach((ml) => allLanes.add(ml));
  }
  const maxLane = allLanes.size > 0 ? Math.max(...allLanes) : 0;
  const LANE_W = 14;

  const lanes: LaneCell[] = [];
  for (let lane = 0; lane <= maxLane; lane++) {
    const color = PALETTE[lane % PALETTE.length];
    const isCommitLane = lane === commit.lane;
    const isMergeSrc = commit.mergeLanes.includes(lane);
    const hasBranch = allLanes.has(lane);
    const segs: string[] = [];

    if (isCommitLane) {
      segs.push("vfull", "dot");
    } else if (isMergeSrc) {
      segs.push("vtop");
      const span = Math.abs(commit.lane - lane);
      segs.push(lane < commit.lane ? `cr:${span}` : `cl:${span}`);
    } else if (hasBranch) {
      segs.push("vfull");
    }

    // Horizontal pass-through for lanes between merge source and commit
    for (const ml of commit.mergeLanes) {
      const lo = Math.min(ml, commit.lane);
      const hi = Math.max(ml, commit.lane);
      if (lane > lo && lane < hi) {
        segs.push("hpass");
        break;
      }
    }

    lanes.push({ segments: segs, color, isCommit: isCommitLane, hasRefs: isCommitLane && commit.refs.length > 0 });
  }

  const hasRefs = commit.refs.length > 0;

  function renderSegment(seg: string, color: string, key: string) {
    switch (true) {
      case seg === "vfull":
        return <div key={key} className="gl-vfull" style={{ borderLeftColor: color }} />;
      case seg === "vtop":
        return <div key={key} className="gl-vtop" style={{ borderLeftColor: color }} />;
      case seg.startsWith("cr:"): {
        const span = parseInt(seg.split(":")[1]);
        return <div key={key} style={{ position: "absolute", left: 6, top: 14, width: span * 14, height: 14, borderTop: `2px solid ${color}`, borderRight: `2px solid ${color}` }} />;
      }
      case seg.startsWith("cl:"): {
        const span = parseInt(seg.split(":")[1]);
        const left = -(span * 14) + 6;
        return <div key={key} style={{ position: "absolute", left, top: 14, width: span * 14, height: 14, borderTop: `2px solid ${color}`, borderLeft: `2px solid ${color}` }} />;
      }
      case seg === "hpass":
        return <div key={key} className="gl-hpass" style={{ borderTopColor: color }} />;
      case seg === "dot":
        return (
          <div key={key} className="gl-dot" style={{ background: hasRefs ? "transparent" : color, borderColor: color }}>
            {hasRefs && <div className="gl-dot-inner" style={{ borderColor: color }} />}
          </div>
        );
      default:
        return null;
    }
  }

  return (
    <div className="git-graph-row">
      <div className="git-graph-lanes" style={{ width: (maxLane + 1) * LANE_W }}>
        {lanes.map((lane, i) => (
          <div key={i} className="gl-cell" style={{ width: LANE_W }}>
            {lane.segments.map((seg, j) => renderSegment(seg, lane.color, `${i}-${j}`))}
          </div>
        ))}
      </div>
      <div className="git-graph-info">
        <div className="git-graph-message">
          {commit.refs.length > 0 && (
            <span className="git-graph-refs">
              {commit.refs.map((r) => (
                <span key={r} className="git-graph-ref">{r}</span>
              ))}
            </span>
          )}
          <span className="git-graph-msg-text">{commit.message}</span>
        </div>
        <div className="git-graph-meta">
          <span className="git-graph-hash">{commit.short_hash}</span>
          <span className="git-graph-author">{commit.author}</span>
          <span className="git-graph-date">{commit.date}</span>
        </div>
      </div>
    </div>
  );
}
