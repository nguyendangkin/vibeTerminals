import { useState, useRef, useEffect, useCallback, useLayoutEffect, type CSSProperties } from "react";
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

const DRAG_THRESHOLD = 4;
const BOUNCE_EASE = "transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)";

interface ProjectBarProps {
  projects: Project[];
  activeProjectId: string | null;
  onSelectProject: (id: string) => void;
  onRequestDeleteProject: (id: string) => void;
  onAddProject: () => void;
  onReorderProjects: (fromIndex: number, toIndex: number) => void;
}

export function ProjectBar({
  projects,
  activeProjectId,
  onSelectProject,
  onRequestDeleteProject,
  onAddProject,
  onReorderProjects,
}: ProjectBarProps) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [ghostY, setGhostY] = useState<number | null>(null);

  const listRef = useRef<HTMLDivElement>(null);
  const flipRectsRef = useRef<{ rects: Map<string, DOMRect> } | null>(null);
  const dragState = useRef<{
    index: number;
    startY: number;
    dragging: boolean;
    projectId: string;
  } | null>(null);
  const dragJustEnded = useRef(false);
  const projectsRef = useRef(projects);
  projectsRef.current = projects;
  const lastTargetRef = useRef<number | null>(null);

  // ── FLIP animation after reorder ────────────────────────────────────────
  useLayoutEffect(() => {
    const flipData = flipRectsRef.current;
    if (!flipData) return;

    const { rects: prevRects } = flipData;
    flipRectsRef.current = null;

    const list = listRef.current;
    if (!list || prevRects.size === 0) return;

    const items = list.querySelectorAll<HTMLElement>("[data-project-id]");
    if (items.length !== prevRects.size) return;

    const animations: { el: HTMLElement; dy: number }[] = [];

    items.forEach((el) => {
      const id = el.dataset.projectId!;
      const prev = prevRects.get(id);
      if (!prev) return;
      const next = el.getBoundingClientRect();
      const dy = prev.top - next.top;
      if (Math.abs(dy) > 0.5) {
        el.style.transition = "none";
        el.style.transform = `translateY(${dy}px)`;
        animations.push({ el, dy });
      }
    });

    if (animations.length > 0) {
      // Double rAF to ensure the "none" transition + transform are painted
      // before we switch to the bounce transition and remove the transform.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (!listRef.current?.isConnected) return;
          animations.forEach(({ el }) => {
            el.style.transition = BOUNCE_EASE;
            el.style.transform = "translateY(0)";
          });
        });
      });
    }
  }, [projects]);

  // Sync dragIndex after live reorder (item moves in the array, index changes)
  useEffect(() => {
    if (dragIndex === null) return;
    const ds = dragState.current;
    if (!ds) return;
    const newIndex = projects.findIndex((p) => p.id === ds.projectId);
    if (newIndex !== -1 && newIndex !== dragIndex) {
      setDragIndex(newIndex);
    }
  }, [projects, dragIndex]);

  // ── document-level mouse listeners ──────────────────────────────────────
  const endDrag = useCallback(() => {
    if (dragState.current?.dragging) {
      dragJustEnded.current = true;
      setTimeout(() => { dragJustEnded.current = false; }, 0);
    }
    dragState.current = null;
    setDragIndex(null);
    setGhostY(null);
    lastTargetRef.current = null;
  }, []);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      const ds = dragState.current;
      if (!ds) return;

      if (!ds.dragging) {
        if (Math.abs(e.clientY - ds.startY) > DRAG_THRESHOLD) {
          ds.dragging = true;
          setDragIndex(ds.index);
          setGhostY(e.clientY);
          lastTargetRef.current = ds.index;
        }
        return;
      }

      setGhostY(e.clientY);

      // Live reorder: shift items out of the way as the cursor moves
      const list = listRef.current;
      if (!list) return;
      const items = list.querySelectorAll<HTMLElement>("[data-project-id]");

      let target = 0;
      for (let i = 0; i < items.length; i++) {
        const rect = items[i].getBoundingClientRect();
        if (e.clientY < rect.top + rect.height / 2) {
          target = i;
          break;
        }
        target = i + 1;
      }

      if (lastTargetRef.current === target) return;
      lastTargetRef.current = target;

      const projs = projectsRef.current;
      const fromIndex = projs.findIndex((p) => p.id === ds.projectId);
      if (fromIndex === -1) return;

      const toIndex = target > fromIndex ? target - 1 : target;
      if (toIndex === fromIndex) return;

      // Cancel in-progress FLIP animations for clean rect reads
      items.forEach((el) => {
        el.style.transition = "";
        el.style.transform = "";
      });
      void list.offsetHeight;

      // Capture FLIP first positions
      const rects = new Map<string, DOMRect>();
      items.forEach((el) => {
        rects.set(el.dataset.projectId!, el.getBoundingClientRect());
      });
      flipRectsRef.current = { rects };
      onReorderProjects(fromIndex, toIndex);
    };

    const onMouseUp = (e: MouseEvent) => {
      const ds = dragState.current;
      if (!ds) return;

      if (ds.dragging) {
        // Final check: cursor may have moved slightly since last mousemove
        const list = listRef.current;
        if (list) {
          const items = list.querySelectorAll<HTMLElement>("[data-project-id]");
          let target = 0;
          for (let i = 0; i < items.length; i++) {
            const rect = items[i].getBoundingClientRect();
            if (e.clientY < rect.top + rect.height / 2) {
              target = i;
              break;
            }
            target = i + 1;
          }

          if (lastTargetRef.current !== target) {
            lastTargetRef.current = target;
            const projs = projectsRef.current;
            const fromIndex = projs.findIndex((p) => p.id === ds.projectId);
            if (fromIndex !== -1) {
              const toIndex = target > fromIndex ? target - 1 : target;
              if (toIndex !== fromIndex) {
                items.forEach((el) => {
                  el.style.transition = "";
                  el.style.transform = "";
                });
                void list.offsetHeight;

                const rects = new Map<string, DOMRect>();
                items.forEach((el) => {
                  rects.set(el.dataset.projectId!, el.getBoundingClientRect());
                });
                flipRectsRef.current = { rects };
                onReorderProjects(fromIndex, toIndex);
              }
            }
          }
        }
      }

      endDrag();
    };

    const onBlur = () => endDrag();
    window.addEventListener("blur", onBlur);
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      window.removeEventListener("blur", onBlur);
    };
  }, [onReorderProjects, endDrag]);

  // ── render ──────────────────────────────────────────────────────────────
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

      <div className="project-bar-list" ref={listRef}>
        {projects.map((p, i) => {
          const isActive = p.id === activeProjectId;
          const isDragging = dragIndex === i;
          return (
            <div
              key={p.id}
              data-project-id={p.id}
              className={`project-bar-item${isActive ? " project-bar-item-active" : ""}${isDragging ? " project-bar-item-dragging" : ""}`}
              title={`${p.name}\n${p.path}`}
              role="button"
              tabIndex={0}
              aria-label={`Select ${p.name}`}
              onMouseDown={(e) => {
                dragState.current = {
                  index: i,
                  startY: e.clientY,
                  dragging: false,
                  projectId: p.id,
                };
              }}
              onClick={() => {
                if (dragJustEnded.current) {
                  dragJustEnded.current = false;
                  return;
                }
                onSelectProject(p.id);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                onRequestDeleteProject(p.id);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelectProject(p.id);
                }
              }}
            >
              <div
                className="project-bar-avatar-btn"
                style={{ "--avatar-bg": avatarColor(p.id) } as CSSProperties}
              >
                <span className="project-bar-avatar">
                  {p.name}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Ghost cursor follower */}
      {dragIndex !== null && ghostY !== null && (
        <div
          className="project-bar-ghost"
          style={{
            top: ghostY - 18,
            left: 8,
            position: "fixed",
            zIndex: 1000,
            pointerEvents: "none",
          }}
        >
          <div
            className="project-bar-avatar-btn"
            style={{ "--avatar-bg": avatarColor(projects[dragIndex].id) } as CSSProperties}
          >
            <span className="project-bar-avatar">
              {projects[dragIndex].name}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
