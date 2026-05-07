import type { CSSProperties } from "react";
import type { Project } from "../types";

const AVATAR_COLORS = [
  "#007acc", "#6a9955", "#ce9178", "#c586c0",
  "#f14c4c", "#4ec9b0", "#d4a72c", "#3b8eea",
];

function avatarColor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

function initials(name: string): string {
  const parts = name.split(/[-_\s.]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

interface ProjectBarProps {
  projects: Project[];
  activeProjectId: string | null;
  onSelectProject: (id: string) => void;
  onCloseProject: (id: string) => void;
  onAddProject: () => void;
}

export function ProjectBar({
  projects,
  activeProjectId,
  onSelectProject,
  onCloseProject,
  onAddProject,
}: ProjectBarProps) {
  return (
    <div className="project-bar">
      <button
        className="project-bar-add"
        onClick={onAddProject}
        title="Add Project Folder (Ctrl+O)"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path d="M12 5v14M5 12h14"/>
        </svg>
      </button>

      <div className="project-bar-list">
        {projects.map((p) => {
          const isActive = p.id === activeProjectId;
          return (
            <div
              key={p.id}
              className={`project-bar-item${isActive ? " project-bar-item-active" : ""}`}
              title={p.path}
              onContextMenu={(e) => { e.preventDefault(); onCloseProject(p.id); }}
            >
              <button
                className="project-bar-avatar-btn"
                onClick={() => onSelectProject(p.id)}
                style={{ "--avatar-bg": avatarColor(p.id) } as CSSProperties}
              >
                <span className="project-bar-avatar">{initials(p.name)}</span>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
