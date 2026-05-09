import { useState, useEffect, type ReactNode } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

export type TopTab = "terminal" | "explorer" | "git" | "note";

interface TopBarProps {
  activeTab: TopTab | null;
  onTabClick: (tab: TopTab) => void;
  onReloadAll?: () => void;
  globalShell?: string;
  onGlobalShellChange?: (shell: string) => void;
}

const TABS: { id: TopTab; label: string; icon: ReactNode }[] = [
  {
    id: "terminal",
    label: "Terminal",
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>
      </svg>
    ),
  },
  {
    id: "explorer",
    label: "Explorer",
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
      </svg>
    ),
  },
  {
    id: "git",
    label: "Git",
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <circle cx="6" cy="6" r="2.5"/>
        <circle cx="6" cy="18" r="2.5"/>
        <circle cx="18" cy="9" r="2.5"/>
        <path d="M6 8.5v7"/>
        <path d="M8.5 9a5.5 5.5 0 0 1 5.5-2.5"/>
        <path d="M18 11.5v1a5.5 5.5 0 0 1-5.5 5.5H9.5"/>
      </svg>
    ),
  },
  {
    id: "note",
    label: "Notes",
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M12 20h9"/>
        <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
      </svg>
    ),
  },
];

function getTabHint(tab: TopTab) {
  switch (tab) {
    case "terminal":
      return "Ctrl+`";
    case "explorer":
      return "Ctrl+Shift+E";
    case "git":
      return "Ctrl+Shift+G";
    case "note":
      return "Ctrl+Shift+N";
  }
}

export function TopBar({ activeTab, onTabClick, onReloadAll, globalShell, onGlobalShellChange }: TopBarProps) {
  const appWindow = getCurrentWindow();
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    async function setup() {
      const m = await appWindow.isMaximized();
      if (!cancelled) setMaximized(m);
      unlisten = await appWindow.onResized(() => {
        appWindow.isMaximized().then((v) => { if (!cancelled) setMaximized(v); });
      });
    }
    setup();
    return () => { cancelled = true; unlisten?.(); };
  }, []);

  return (
    <div className="top-bar">
      <div className="top-bar-tabs">
        {TABS.map(({ id, label, icon }) => (
          <button
            key={id}
            className={`top-tab${activeTab === id ? " top-tab-active" : ""}`}
            onClick={() => onTabClick(id)}
            aria-pressed={activeTab === id}
            title={`${label} (${getTabHint(id)})`}
          >
            <span className="top-tab-icon" aria-hidden="true">
              {icon}
            </span>
            <span className="top-tab-label">{label}</span>
          </button>
        ))}
      </div>
      <div className="top-bar-center" data-tauri-drag-region />
      <div className="top-bar-actions">
        {activeTab === "terminal" && onGlobalShellChange && (
          <select
            className="top-bar-shell-select"
            value={globalShell ?? "powershell"}
            onChange={(e) => onGlobalShellChange(e.target.value)}
            title="Shell for new terminals"
          >
            <option value="powershell">PowerShell</option>
            <option value="cmd">CMD</option>
            <option value="pwsh">PS Core</option>
          </select>
        )}
        {activeTab === "terminal" && onReloadAll && (
          <button
            className="top-bar-reload-btn"
            onClick={onReloadAll}
            title="Rerun last commands in all terminals"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
              <path fillRule="evenodd" d="M8 3a5 5 0 1 0 4.546 2.914.5.5 0 0 1 .908-.417A6 6 0 1 1 8 2v1z"/>
              <path d="M8 4.466V.534a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384L8.41 4.658A.25.25 0 0 1 8 4.466z"/>
            </svg>
          </button>
        )}
        <div className="window-controls">
          <button
            className="window-btn window-minimize"
            onClick={() => appWindow.minimize()}
            title="Minimize"
          >
            <svg width="10" height="10" viewBox="0 0 10 10">
              <rect x="0.5" y="4.5" width="9" height="1" fill="currentColor"/>
            </svg>
          </button>
          <button
            className="window-btn window-maximize"
            onClick={() => appWindow.toggleMaximize()}
            title={maximized ? "Restore" : "Maximize"}
          >
            {maximized ? (
              <svg width="10" height="10" viewBox="0 0 10 10">
                <rect x="1.5" y="0.5" width="8" height="8" fill="none" stroke="currentColor" strokeWidth="1"/>
                <rect x="0.5" y="2.5" width="8" height="8" fill="none" stroke="currentColor" strokeWidth="1"/>
              </svg>
            ) : (
              <svg width="10" height="10" viewBox="0 0 10 10">
                <rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="1"/>
              </svg>
            )}
          </button>
          <button
            className="window-btn window-close"
            onClick={() => appWindow.close()}
            title="Close"
          >
            <svg width="10" height="10" viewBox="0 0 10 10">
              <line x1="0.5" y1="0.5" x2="9.5" y2="9.5" stroke="currentColor" strokeWidth="1"/>
              <line x1="9.5" y1="0.5" x2="0.5" y2="9.5" stroke="currentColor" strokeWidth="1"/>
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
