import { useState, useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { getCurrentWindow } from "@tauri-apps/api/window";

export type TopTab = "terminal" | "explorer" | "note" | "git";

interface TopBarProps {
  activeTab: TopTab | null;
  onTabClick: (tab: TopTab) => void;
  onReloadAll?: () => void;
  globalShell?: string;
  onGlobalShellChange?: (shell: string) => void;
  gitChangesCount?: number;
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
    id: "note",
    label: "Notes",
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M12 20h9"/>
        <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
      </svg>
    ),
  },
  {
    id: "git",
    label: "Git",
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <circle cx="12" cy="18" r="3"/>
        <circle cx="6" cy="6" r="3"/>
        <circle cx="18" cy="6" r="3"/>
        <path d="M6 9v4a6 6 0 0 0 6 6"/>
        <path d="M18 9v4a6 6 0 0 1-6 6"/>
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
    case "note":
      return "Ctrl+Shift+N";
    case "git":
      return "Ctrl+Shift+G";
  }
}

const SHELL_LABELS: Record<string, string> = {
  powershell: "PowerShell",
  cmd: "CMD",
  pwsh: "PS Core",
};

export function TopBar({ activeTab, onTabClick, onReloadAll, globalShell, onGlobalShellChange, gitChangesCount }: TopBarProps) {
  const appWindow = getCurrentWindow();
  const [maximized, setMaximized] = useState(false);
  const [shellOpen, setShellOpen] = useState(false);
  const [shellPos, setShellPos] = useState({ top: 0, left: 0, width: 0 });
  const shellBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!shellOpen) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (shellBtnRef.current && shellBtnRef.current.contains(t)) return;
      if ((t as Element).closest?.(".top-bar-shell-menu")) return;
      setShellOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setShellOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [shellOpen]);

  const toggleShellMenu = () => {
    if (shellOpen) { setShellOpen(false); return; }
    const btn = shellBtnRef.current;
    if (!btn) return;
    const btnRect = btn.getBoundingClientRect();
    const tools = btn.parentElement?.parentElement;
    const toolsRect = tools?.getBoundingClientRect();
    setShellPos({
      top: btnRect.bottom + 2,
      left: toolsRect?.left ?? btnRect.left,
      width: toolsRect?.width ?? btnRect.width,
    });
    setShellOpen(true);
  };

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
            {id === "git" && gitChangesCount !== undefined && gitChangesCount > 0 && (
              <span className="top-tab-badge">{gitChangesCount}</span>
            )}
          </button>
        ))}
        {activeTab === "terminal" && onGlobalShellChange && (
          <div className="top-bar-term-tools">
            <div className="top-bar-shell-wrap">
              <button
                ref={shellBtnRef}
                className="top-bar-shell-select"
                onClick={toggleShellMenu}
                title="Shell for new terminals"
                aria-haspopup="menu"
                aria-expanded={shellOpen}
              >
                {SHELL_LABELS[globalShell ?? "powershell"] ?? "PowerShell"}
              </button>
              {shellOpen && createPortal(
                <div
                  className="top-bar-shell-menu"
                  role="menu"
                  style={{ top: shellPos.top, left: shellPos.left, minWidth: shellPos.width }}
                >
                  {Object.entries(SHELL_LABELS).map(([val, label]) => (
                    <button
                      key={val}
                      role="menuitem"
                      className={`top-bar-shell-item${(globalShell ?? "powershell") === val ? " top-bar-shell-item-active" : ""}`}
                      onClick={() => { onGlobalShellChange?.(val); setShellOpen(false); }}
                    >
                      {label}
                    </button>
                  ))}
                </div>,
                document.body
              )}
            </div>
            {onReloadAll && (
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
          </div>
        )}
      </div>
      <div className="top-bar-center" data-tauri-drag-region />
      <div className="top-bar-actions">
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
