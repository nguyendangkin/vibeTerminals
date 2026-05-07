import { type TerminalInstance } from "../types";

const SHELL_LABELS: Record<string, string> = {
  cmd: "cmd",
  powershell: "ps",
  pwsh: "pwsh",
};

function shellLabel(shell?: string) {
  return shell ? (SHELL_LABELS[shell] ?? shell) : "shell";
}

function shellIcon(shell?: string) {
  if (shell === "cmd") return "›_";
  if (shell === "powershell" || shell === "pwsh") return "PS";
  return "⌨";
}

interface TerminalTabBarProps {
  instances: TerminalInstance[];
  activeId: string | null;
  splitId: string | null;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  onNew: () => void;
  onClosePanel: () => void;
  globalShell: string;
  onGlobalShellChange: (shell: string) => void;
}

export function TerminalTabBar({
  instances,
  activeId,
  splitId,
  onActivate,
  onClose,
  onNew,
  onClosePanel,
  globalShell,
  onGlobalShellChange,
}: TerminalTabBarProps) {
  return (
    <div className="term-tabbar">
      <div className="term-tabbar-tabs">
        {instances.map((inst) => {
          const isActive = inst.id === activeId;
          const isSplit = inst.id === splitId;
          return (
            <button
              key={inst.id}
              className={`term-tab${isActive ? " term-tab-active" : ""}${isSplit ? " term-tab-split" : ""}`}
              onClick={() => onActivate(inst.id)}
              title={`${inst.name} (${shellLabel(inst.shell)})`}
            >
              <span className="term-tab-icon">{shellIcon(inst.shell)}</span>
              <span className="term-tab-name">{inst.name}</span>
              {isSplit && <span className="term-tab-split-dot" title="Shown in split" />}
              <span
                className="term-tab-close"
                role="button"
                tabIndex={-1}
                onClick={(e) => { e.stopPropagation(); onClose(inst.id); }}
                title="Close terminal"
              >
                ×
              </span>
            </button>
          );
        })}
        <button className="term-tab-new" onClick={onNew} title="New Terminal">
          +
        </button>
      </div>

      <div className="term-tabbar-actions">
        <select
          className="term-shell-select"
          value={globalShell}
          onChange={(e) => onGlobalShellChange(e.target.value)}
          title="Shell for new terminals"
        >
          <option value="">Auto</option>
          <option value="cmd">CMD</option>
          <option value="powershell">PowerShell</option>
          <option value="pwsh">PS Core</option>
        </select>
        <button
          className="term-action-btn term-action-close"
          onClick={onClosePanel}
          title="Close Terminal Panel (Ctrl+`)"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 8.707l3.646 3.647.708-.707L8.707 8l3.647-3.646-.707-.708L8 7.293 4.354 3.646l-.707.708L7.293 8l-3.646 3.647.707.707L8 8.707z"/>
          </svg>
        </button>
      </div>
    </div>
  );
}
