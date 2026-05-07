import type { ReactNode } from "react";

export type SidebarTab = "files" | "git";

interface ActivityBarProps {
  activeTab: SidebarTab | null;
  onTabClick: (tab: SidebarTab) => void;
}

const ITEMS: { tab: SidebarTab; title: string; icon: ReactNode }[] = [
  {
    tab: "files",
    title: "Explorer (Ctrl+Shift+E)",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
      </svg>
    ),
  },
  {
    tab: "git",
    title: "Source Control (Ctrl+Shift+G)",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
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

export function ActivityBar({ activeTab, onTabClick }: ActivityBarProps) {
  return (
    <div className="activity-bar">
      {ITEMS.map(({ tab, title, icon }) => (
        <button
          key={tab}
          className={`activity-btn${activeTab === tab ? " activity-btn-active" : ""}`}
          title={title}
          onClick={() => onTabClick(tab)}
        >
          {icon}
        </button>
      ))}
    </div>
  );
}
