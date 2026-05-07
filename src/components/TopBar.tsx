import type { ReactNode } from "react";

export type TopTab = "terminal" | "explorer" | "git";

interface TopBarProps {
  activeTab: TopTab | null;
  onTabClick: (tab: TopTab) => void;
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
];

export function TopBar({ activeTab, onTabClick }: TopBarProps) {
  return (
    <div className="top-bar">
      {TABS.map(({ id, label, icon }) => (
        <button
          key={id}
          className={`top-tab${activeTab === id ? " top-tab-active" : ""}`}
          onClick={() => onTabClick(id)}
          title={id === "terminal" ? "Terminal (Ctrl+`)" : id === "explorer" ? "Explorer (Ctrl+Shift+E)" : "Source Control (Ctrl+Shift+G)"}
        >
          {icon}
          {label}
        </button>
      ))}
    </div>
  );
}
