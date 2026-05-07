import { EditorTab } from "../types";

interface StatusBarProps {
  tab: EditorTab | null;
  cursorLine: number;
  cursorCol: number;
  gitBranch: string;
}

export function StatusBar({ tab, cursorLine, cursorCol, gitBranch }: StatusBarProps) {
  return (
    <div className="status-bar">
      {gitBranch && (
        <span className="status-item status-git-branch" title={`Branch: ${gitBranch}`}>
          ⎇ {gitBranch}
        </span>
      )}
      {tab ? (
        <>
          <span className="status-item" title={tab.path || "Unsaved"}>
            {tab.path || "Untitled"}
          </span>
          <span className="status-item">{tab.language}</span>
          <span className="status-item">UTF-8</span>
          <span className="status-item">
            Ln {cursorLine}, Col {cursorCol}
          </span>
          <span className="status-item">{tab.dirty ? "● Unsaved" : "Saved"}</span>
        </>
      ) : (
        <span className="status-item">No file open</span>
      )}
    </div>
  );
}
