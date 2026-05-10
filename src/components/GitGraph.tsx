import type { GitLog } from "../types";

interface GitGraphProps {
  log: GitLog;
}

export function GitGraph({ log }: GitGraphProps) {
  if (log.entries.length === 0) {
    return (
      <div className="git-graph">
        <div className="git-graph-empty">No commits yet</div>
      </div>
    );
  }

  return (
    <div className="git-graph">
      <div className="git-graph-header">Commit History</div>
      <div className="git-graph-body">
        {log.entries.map((entry, i) => (
          <div key={entry.hash || `g-${i}`} className="git-graph-row">
            <span className="git-graph-graph">{entry.graph}</span>
            {entry.hash ? (
              <>
                <span className="git-graph-hash">{entry.hash}</span>
                <span className="git-graph-date">{entry.date}</span>
                <span className="git-graph-msg">{entry.message}</span>
                {entry.refs && (
                  <span className="git-graph-refs">{entry.refs}</span>
                )}
              </>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
