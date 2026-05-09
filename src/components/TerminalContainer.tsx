import React, {
  useState,
  useCallback,
  useRef,
  useLayoutEffect,
  useMemo,
  useEffect,
  type MouseEvent as RMouseEvent,
} from "react";
import type { Note } from "../types";
import { TerminalPanel, type TerminalPanelHandle } from "./TerminalPanel";

// ── Utils ────────────────────────────────────────────────────────────────────

function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

// ── Pane tree types ────────────────────────────────────────────────────────

interface TerminalLeaf {
  type: "leaf";
  id: string;
  name: string;
  shell?: string;
}

interface SplitNode {
  type: "split";
  id: string;
  dir: "row" | "col";
  ratio: number;
  a: PaneNode;
  b: PaneNode;
}

type PaneNode = TerminalLeaf | SplitNode;

// ── Flat layout types ──────────────────────────────────────────────────────

interface PixelRect { left: number; top: number; width: number; height: number }

interface LeafLayout {
  id: string;
  name: string;
  shell?: string;
  rect: PixelRect;
}

interface DividerLayout {
  splitId: string;
  dir: "row" | "col";
  rect: PixelRect;
  splitRect: PixelRect;
}

// ── Persistence ───────────────────────────────────────────────────────────

interface PersistedTerminalLayout {
  root: PaneNode;
  activeId: string;
  height: number;
  nameCounter: number;
  lastCommands: Record<string, string>;
  globalShell: string;
}

const terminalStorageKey = (pid: string) => `tertito_terminal_${pid}`;

function seedNodeCounter(node: PaneNode, counter: React.MutableRefObject<number>): void {
  const n = parseInt(node.id.replace(/^(term_|split_)/, ""));
  if (!isNaN(n) && n > counter.current) counter.current = n;
  if (node.type === "split") { seedNodeCounter(node.a, counter); seedNodeCounter(node.b, counter); }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function makeLeaf(nodeCounter: React.MutableRefObject<number>, nameCounter: React.MutableRefObject<number>, shell: string): TerminalLeaf {
  const id = ++nodeCounter.current;
  const n = ++nameCounter.current;
  const label = shell === "cmd" ? "CMD" : shell === "pwsh" ? "PS Core" : "PowerShell";
  return { type: "leaf", id: `term_${id}`, name: `${label} ${n}`, shell };
}

function makeSplitId(nodeCounter: React.MutableRefObject<number>): string { return `split_${++nodeCounter.current}`; }

// ── Tree operations ────────────────────────────────────────────────────────

function doSplit(root: PaneNode, leafId: string, dir: "row" | "col", newLeaf: TerminalLeaf, nodeCounter: React.MutableRefObject<number>): PaneNode {
  if (root.type === "leaf") {
    if (root.id !== leafId) return root;
    return { type: "split", id: makeSplitId(nodeCounter), dir, ratio: 0.5, a: root, b: newLeaf };
  }
  const newA = doSplit(root.a, leafId, dir, newLeaf, nodeCounter);
  if (newA !== root.a) return { ...root, a: newA };
  const newB = doSplit(root.b, leafId, dir, newLeaf, nodeCounter);
  if (newB !== root.b) return { ...root, b: newB };
  return root;
}


function doClose(root: PaneNode, leafId: string): PaneNode | null {
  if (root.type === "leaf") return root.id === leafId ? null : root;
  const a = doClose(root.a, leafId);
  const b = doClose(root.b, leafId);
  if (a === null) return b;
  if (b === null) return a;
  return { ...root, a, b };
}

function doUpdateRatio(root: PaneNode, splitId: string, ratio: number): PaneNode {
  if (root.type === "leaf") return root;
  if (root.id === splitId) return { ...root, ratio };
  return { ...root, a: doUpdateRatio(root.a, splitId, ratio), b: doUpdateRatio(root.b, splitId, ratio) };
}

function leafIds(root: PaneNode): string[] {
  if (root.type === "leaf") return [root.id];
  return [...leafIds(root.a), ...leafIds(root.b)];
}

// ── Layout computation ─────────────────────────────────────────────────────
// Produces a flat list of leaf rects + divider rects in root-container pixels.
// TerminalPanels are always rendered at the same depth in the virtual DOM
// (direct children of term-body), so they never remount when the tree changes.

const DIV_PX = 4;

function computeLayout(
  node: PaneNode,
  l: number, t: number, w: number, h: number,
  leaves: LeafLayout[],
  dividers: DividerLayout[],
): void {
  if (node.type === "leaf") {
    leaves.push({ id: node.id, name: node.name, shell: node.shell,
      rect: { left: l, top: t, width: w, height: h } });
    return;
  }
  const splitRect: PixelRect = { left: l, top: t, width: w, height: h };
  if (node.dir === "row") {
    const wA = Math.round(w * node.ratio - DIV_PX / 2);
    const wB = w - wA - DIV_PX;
    dividers.push({ splitId: node.id, dir: "row",
      rect: { left: l + wA, top: t, width: DIV_PX, height: h }, splitRect });
    computeLayout(node.a, l,          t, wA, h, leaves, dividers);
    computeLayout(node.b, l + wA + DIV_PX, t, wB, h, leaves, dividers);
  } else {
    const hA = Math.round(h * node.ratio - DIV_PX / 2);
    const hB = h - hA - DIV_PX;
    dividers.push({ splitId: node.id, dir: "col",
      rect: { left: l, top: t + hA, width: w, height: DIV_PX }, splitRect });
    computeLayout(node.a, l, t,          w, hA, leaves, dividers);
    computeLayout(node.b, l, t + hA + DIV_PX, w, hB, leaves, dividers);
  }
}

// ── TerminalContainer ──────────────────────────────────────────────────────

interface TerminalContainerProps {
  projectId: string;
  cwd: string | null;
  visible: boolean;
  fullscreen?: boolean;
  notes?: Note[];
  onToggleVisible: () => void;
  onRegisterReload?: (fn: () => void) => void;
  globalShell: string;
  onShellChange?: (shell: string) => void;
}

function TerminalContainerImpl({ projectId, cwd, visible, fullscreen, notes, onToggleVisible, onRegisterReload, globalShell, onShellChange }: TerminalContainerProps) {
  // Keep notes in a ref so note edits don't re-render the terminal tree.
  // Notes are only read when the context menu opens, so stale closure is impossible.
  const notesRef = useRef(notes);
  useEffect(() => { notesRef.current = notes; }, [notes]);
  const nodeCounterRef = useRef(0);
  const mountRef = useRef<{ root: PaneNode; activeId: string; nameCounter: number; height: number; lastCommands: Record<string, string>; restoredShell?: string } | null>(null);
  if (mountRef.current === null) {
    const saved = localStorage.getItem(terminalStorageKey(projectId));
    if (saved) {
      try {
        const parsed: PersistedTerminalLayout = JSON.parse(saved);
        seedNodeCounter(parsed.root, nodeCounterRef);
        mountRef.current = { root: parsed.root, activeId: parsed.activeId, nameCounter: parsed.nameCounter, height: parsed.height, lastCommands: parsed.lastCommands ?? {}, restoredShell: parsed.globalShell };
      } catch { /* fall through */ }
    }
    if (mountRef.current === null) {
      const id = `term_${++nodeCounterRef.current}`;
      mountRef.current = { root: { type: "leaf", id, name: "PowerShell 1", shell: "powershell" }, activeId: id, nameCounter: 1, height: 260, lastCommands: {} };
    }
  }

  // Notify parent of restored shell preference (deferred so we don't setState during render)
  useEffect(() => {
    if (mountRef.current?.restoredShell) {
      onShellChange?.(mountRef.current.restoredShell);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const instCounter = useRef(mountRef.current.nameCounter);
  const [root, setRoot] = useState<PaneNode>(mountRef.current.root);
  const [activeId, setActiveId] = useState<string>(mountRef.current.activeId);
  const [height, setHeight] = useState(mountRef.current.height);
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 });
  const debouncedSize = useDebouncedValue(containerSize, 16);
  const containerRef = useRef<HTMLDivElement>(null);
  const panelRefsMap = useRef(new Map<string, TerminalPanelHandle>());
  const [lastCommands, setLastCommands] = useState<Record<string, string>>(mountRef.current.lastCommands);
  const [ctxMenu, setCtxMenu] = useState<{
    text: string; x: number; y: number; sourceId: string;
  } | null>(null);
  const [submenuType, setSubmenuType] = useState<"task" | "prompt" | null>(null);
  const [submenuPos, setSubmenuPos] = useState({ x: 0, y: 0 });
  const submenuTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (submenuTimerRef.current) clearTimeout(submenuTimerRef.current);
  }, []);

  const handleCommandChange = useCallback((leafId: string, cmd: string) => {
    setLastCommands((prev) => {
      if (prev[leafId] === cmd) return prev;
      return { ...prev, [leafId]: cmd };
    });
  }, []);

  // ── Measure container for flat pixel layout ────────────────────────────
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const { width, height: h } = entries[0].contentRect;
      if (width > 0 && h > 0) {
        setContainerSize({ w: Math.floor(width), h: Math.floor(h) });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── Compute flat layout from tree (debounced for performance) ──────────
  const { leaves, dividers } = useMemo(() => {
    const leaves: LeafLayout[] = [];
    const dividers: DividerLayout[] = [];
    if (debouncedSize.w > 0 && debouncedSize.h > 0) {
      computeLayout(root, 0, 0, debouncedSize.w, debouncedSize.h, leaves, dividers);
    }
    return { leaves, dividers };
  }, [root, debouncedSize]);

  // ── Panel height resize ────────────────────────────────────────────────
  const handleResizeStart = useCallback(
    (e: RMouseEvent) => {
      e.preventDefault();
      const handle = e.currentTarget as HTMLElement;
      let mainArea: HTMLElement | null = handle.parentElement;
      while (mainArea && mainArea.clientHeight === 0) mainArea = mainArea.parentElement;
      const maxH = mainArea ? mainArea.clientHeight - 38 : window.innerHeight - 80;
      const startY = e.clientY;
      const startH = height;
      const onMove = (ev: MouseEvent) => {
        setHeight(Math.max(120, Math.min(maxH, startH + (startY - ev.clientY))));
      };
      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [height],
  );

  // ── Pane actions ──────────────────────────────────────────────────────
  const handleSplitH = useCallback(
    (leafId: string) => {
      const leaf = makeLeaf(nodeCounterRef, instCounter, globalShell);
      setRoot((prev) => doSplit(prev, leafId, "row", leaf, nodeCounterRef));
      setActiveId(leaf.id);
    },
    [globalShell],
  );

  const handleSplitV = useCallback(
    (leafId: string) => {
      const leaf = makeLeaf(nodeCounterRef, instCounter, globalShell);
      setRoot((prev) => doSplit(prev, leafId, "col", leaf, nodeCounterRef));
      setActiveId(leaf.id);
    },
    [globalShell],
  );

  const handleClose = useCallback(
    (leafId: string) => {
      const ids = leafIds(root);
      if (ids.length <= 1) {
        onToggleVisible();
        return;
      }
      setRoot((prev) => doClose(prev, leafId) ?? makeLeaf(nodeCounterRef, instCounter, globalShell));
      setActiveId((prev) => (prev !== leafId ? prev : ids.find((id) => id !== leafId) ?? ""));
    },
    [root, globalShell, onToggleVisible],
  );

  const handleRatioChange = useCallback((splitId: string, ratio: number) => {
    setRoot((prev) => doUpdateRatio(prev, splitId, ratio));
  }, []);

  const handleReloadAll = useCallback(() => {
    panelRefsMap.current.forEach((panel) => {
      panel.reload();
    });
  }, []);

  useEffect(() => {
    onRegisterReload?.(handleReloadAll);
  }, [handleReloadAll, onRegisterReload]);

  const handleTermContextMenu = useCallback(
    (leafId: string, text: string, x: number, y: number) => {
      setCtxMenu({ text, x, y, sourceId: leafId });
    },
    [],
  );

  const handleSendTo = useCallback(
    (targetId: string) => {
      const panel = panelRefsMap.current.get(targetId);
      if (panel && ctxMenu) {
        panel.writeText(ctxMenu.text);
        setActiveId(targetId);
        setCtxMenu(null);
      }
    },
    [ctxMenu],
  );

  const handleGetOutputFrom = useCallback(
    (fromLeafId: string) => {
      const fromPanel = panelRefsMap.current.get(fromLeafId);
      const toPanel = panelRefsMap.current.get(ctxMenu?.sourceId ?? "");
      if (fromPanel && toPanel) {
        const output = fromPanel.getLastOutput();
        if (output) {
          toPanel.writeText(output);
        }
      }
      setCtxMenu(null);
    },
    [ctxMenu],
  );

  const handleNoteSend = useCallback(
    (note: Note) => {
      const panel = panelRefsMap.current.get(ctxMenu?.sourceId ?? "");
      if (panel) {
        panel.sendCommand(note.content);
      }
      setCtxMenu(null);
      setSubmenuType(null);
    },
    [ctxMenu],
  );

  // ── Persist layout (debounced) ──────────────────────────────────────────
  useEffect(() => {
    const state: PersistedTerminalLayout = {
      root,
      activeId,
      height,
      nameCounter: instCounter.current,
      lastCommands,
      globalShell,
    };
    const key = terminalStorageKey(projectId);
    const serialized = JSON.stringify(state);
    const id = setTimeout(() => localStorage.setItem(key, serialized), 400);
    return () => clearTimeout(id);
  }, [root, activeId, height, lastCommands, globalShell, projectId]);

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <>
      {!fullscreen && <div className="term-resize-handle" onMouseDown={handleResizeStart} />}
      <div className="term-panel" style={fullscreen ? { flex: 1, minHeight: 0 } : { height }}>
        {/* Flat pane render — all TerminalPanels stay at the same React depth,
            so they never remount when the tree is restructured */}
        <div
          ref={containerRef}
          className="term-body"
          style={{ flex: 1, position: "relative", overflow: "hidden" }}
        >
          {leaves.map((leaf) => (
            <div
              key={leaf.id}
              className={leaf.id === activeId ? "term-pane-wrapper term-pane-wrapper-active" : "term-pane-wrapper"}
              style={{
                position: "absolute",
                left: leaf.rect.left,
                top: leaf.rect.top,
                width: leaf.rect.width,
                height: leaf.rect.height,
                display: "flex",
                flexDirection: "column",
              }}
              onMouseDown={() => setActiveId(leaf.id)}
            >
              <div className="term-pane-toolbar">
                <span className="term-pane-title">{leaf.name}</span>
                <div className="term-pane-actions">
                  <button
                    className="term-pane-btn term-pane-reload-btn"
                    onClick={() => {
                      const panel = panelRefsMap.current.get(leaf.id);
                      panel?.reload();
                    }}
                    title="Rerun last command"
                  >
                    <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
                      <path fillRule="evenodd" d="M8 3a5 5 0 1 0 4.546 2.914.5.5 0 0 1 .908-.417A6 6 0 1 1 8 2v1z"/>
                      <path d="M8 4.466V.534a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384L8.41 4.658A.25.25 0 0 1 8 4.466z"/>
                    </svg>
                  </button>
                  <button
                    className="term-pane-btn"
                    onClick={() => handleSplitH(leaf.id)}
                    title="Split Right"
                  >
                    <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
                      <rect x="1" y="2" width="6" height="12" rx="1" opacity="0.5" />
                      <rect x="9" y="2" width="6" height="12" rx="1" />
                    </svg>
                  </button>
                  <button
                    className="term-pane-btn"
                    onClick={() => handleSplitV(leaf.id)}
                    title="Split Down"
                  >
                    <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
                      <rect x="2" y="1" width="12" height="6" rx="1" opacity="0.5" />
                      <rect x="2" y="9" width="12" height="6" rx="1" />
                    </svg>
                  </button>
                  <button
                    className="term-pane-btn term-pane-close-btn"
                    onClick={() => handleClose(leaf.id)}
                    title="Close"
                  >
                    ×
                  </button>
                </div>
              </div>
              <TerminalPanel
                ref={(handle: TerminalPanelHandle | null) => {
                  if (handle) panelRefsMap.current.set(leaf.id, handle);
                  else panelRefsMap.current.delete(leaf.id);
                }}
                instanceId={leaf.id}
                cwd={cwd}
                shell={leaf.shell}
                visible={visible}
                active={leaf.id === activeId}
                initialCommand={lastCommands[leaf.id]}
                onFocus={() => setActiveId(leaf.id)}
                onContextMenu={(text, x, y) => handleTermContextMenu(leaf.id, text, x, y)}
                onCommandChange={(cmd) => handleCommandChange(leaf.id, cmd)}
              />
            </div>
          ))}

          {/* Context menu */}
          {ctxMenu && (() => {
            const hasSelection = ctxMenu.text.trim().length > 0;
            const others = leaves.filter((l) => l.id !== ctxMenu.sourceId);
            const taskNotes = (notesRef.current ?? []).filter((n) => n.type === "task");
            const promptNotes = (notesRef.current ?? []).filter((n) => n.type === "prompt");
            const hasNotes = taskNotes.length > 0 || promptNotes.length > 0;
            const hasOthers = others.length > 0;
            const closeAll = () => { setCtxMenu(null); setSubmenuType(null); };
            const noteTypes = [
              { type: "task" as const, label: "Task Note", items: taskNotes },
              { type: "prompt" as const, label: "Prompt Note", items: promptNotes },
            ].filter(({ items }) => items.length > 0);

            // Don't show menu if nothing to show
            if (!hasSelection && !hasNotes && !hasOthers) return null;

            return (
              <div
                className="context-menu-overlay"
                onClick={closeAll}
                onContextMenu={(e) => { e.preventDefault(); closeAll(); }}
              >
                <div
                  className="context-menu"
                  style={{ left: ctxMenu.x, top: ctxMenu.y }}
                  onClick={(e) => e.stopPropagation()}
                >
                  {hasSelection && (
                    <>
                      <div
                        className="context-item"
                        onClick={() => {
                          navigator.clipboard.writeText(ctxMenu.text).catch(() => {});
                          closeAll();
                        }}
                      >
                        Copy
                      </div>
                      {others.length > 0 && <div className="context-separator" />}
                      {others.map((l) => (
                        <div
                          key={l.id}
                          className="context-item"
                          onClick={() => handleSendTo(l.id)}
                        >
                          Send to {l.name}
                        </div>
                      ))}
                    </>
                  )}
                  {hasOthers && !hasSelection && (
                    others.map((l) => (
                      <div
                        key={`out-${l.id}`}
                        className="context-item"
                        onClick={() => handleGetOutputFrom(l.id)}
                      >
                        Get output from {l.name}
                      </div>
                    ))
                  )}
                  {!hasSelection && hasOthers && noteTypes.length > 0 && <div className="context-separator" />}
                  {!hasSelection && noteTypes.map(({ type, label, items }) => (
                    <div
                      key={type}
                      className="context-item context-item-has-submenu"
                      onMouseEnter={(e) => {
                        if (items.length === 0) return;
                        const rect = e.currentTarget.getBoundingClientRect();
                        // Clamp submenu within viewport
                        const subW = 180;
                        const subH = Math.min(items.length * 28 + 8, 300);
                        const x = rect.right + subW > window.innerWidth ? rect.left - subW : rect.right;
                        const y = rect.top + subH > window.innerHeight ? window.innerHeight - subH - 8 : rect.top;
                        setSubmenuType(type);
                        setSubmenuPos({ x: Math.max(0, x), y: Math.max(0, y) });
                      }}
                      onMouseLeave={() => {
                        submenuTimerRef.current = setTimeout(() => {
                          submenuTimerRef.current = null;
                          setSubmenuType((prev) => prev === type ? null : prev);
                        }, 200);
                      }}
                    >
                      <span>{label}</span>
                      <span className="context-submenu-arrow">&#x25B8;</span>
                    </div>
                  ))}
                </div>

                {/* Submenu */}
                {submenuType && (
                  <div
                    className="context-menu context-submenu"
                    style={{ left: submenuPos.x, top: submenuPos.y }}
                    onClick={(e) => e.stopPropagation()}
                    onMouseEnter={() => {
                      if (submenuTimerRef.current) {
                        clearTimeout(submenuTimerRef.current);
                        submenuTimerRef.current = null;
                      }
                    }}
                    onMouseLeave={() => {
                      submenuTimerRef.current = setTimeout(() => {
                        submenuTimerRef.current = null;
                        setSubmenuType(null);
                      }, 200);
                    }}
                  >
                    {(notesRef.current ?? [])
                      .filter((n) => n.type === submenuType)
                      .map((note) => (
                        <div
                          key={note.id}
                          className="context-item"
                          onClick={() => handleNoteSend(note)}
                        >
                          {note.title || "Untitled"}
                        </div>
                      ))}
                  </div>
                )}
              </div>
            );
          })()}

          {/* Draggable dividers */}
          {dividers.map((div) => (
            <div
              key={div.splitId}
              className={`term-split-divider ${div.dir === "row" ? "term-split-divider-h" : "term-split-divider-v"}`}
              style={{
                position: "absolute",
                left: div.rect.left,
                top: div.rect.top,
                width: div.rect.width,
                height: div.rect.height,
                zIndex: 10,
              }}
              onMouseDown={(e) => {
                e.preventDefault();
                const containerEl = containerRef.current;
                if (!containerEl) return;
                const bounds = containerEl.getBoundingClientRect();
                const { splitRect, splitId, dir } = div;
                let raf = 0;
                let pendingRatio = 0.5;
                const onMove = (ev: MouseEvent) => {
                  const rel = dir === "row"
                    ? (ev.clientX - bounds.left) - splitRect.left
                    : (ev.clientY - bounds.top) - splitRect.top;
                  const size = dir === "row" ? splitRect.width : splitRect.height;
                  pendingRatio = Math.max(0.1, Math.min(0.9, rel / size));
                  if (!raf) {
                    raf = requestAnimationFrame(() => {
                      raf = 0;
                      handleRatioChange(splitId, pendingRatio);
                    });
                  }
                };
                const onUp = () => {
                  if (raf) { cancelAnimationFrame(raf); raf = 0; }
                  document.removeEventListener("mousemove", onMove);
                  document.removeEventListener("mouseup", onUp);
                  handleRatioChange(splitId, pendingRatio);
                };
                document.addEventListener("mousemove", onMove);
                document.addEventListener("mouseup", onUp);
              }}
            />
          ))}
        </div>
      </div>
    </>
  );
}

export const TerminalContainer = React.memo(TerminalContainerImpl, (prev, next) =>
  prev.projectId === next.projectId &&
  prev.cwd === next.cwd &&
  prev.visible === next.visible &&
  prev.fullscreen === next.fullscreen &&
  prev.globalShell === next.globalShell &&
  prev.notes === next.notes
);
