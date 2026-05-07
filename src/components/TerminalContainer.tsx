import {
  useState,
  useCallback,
  useRef,
  useLayoutEffect,
  useMemo,
  type MouseEvent as RMouseEvent,
} from "react";
import { TerminalPanel } from "./TerminalPanel";

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

// ── Helpers ────────────────────────────────────────────────────────────────

let instCounter = 0;
let splitCounter = 0;

function makeLeaf(_shell?: string): TerminalLeaf {
  const n = ++instCounter;
  return { type: "leaf", id: `term_${n}`, name: `PowerShell ${n}`, shell: "powershell" };
}

function makeSplitId(): string { return `split_${++splitCounter}`; }

// ── Tree operations ────────────────────────────────────────────────────────

function doSplit(root: PaneNode, leafId: string, dir: "row" | "col", newLeaf: TerminalLeaf): PaneNode {
  if (root.type === "leaf") {
    if (root.id !== leafId) return root;
    return { type: "split", id: makeSplitId(), dir, ratio: 0.5, a: root, b: newLeaf };
  }
  return { ...root, a: doSplit(root.a, leafId, dir, newLeaf), b: doSplit(root.b, leafId, dir, newLeaf) };
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
  cwd: string | null;
  visible: boolean;
  fullscreen?: boolean;
  onToggleVisible: () => void;
}

export function TerminalContainer({ cwd, visible, fullscreen, onToggleVisible }: TerminalContainerProps) {
  const [root, setRoot] = useState<PaneNode>(makeLeaf);
  const [activeId, setActiveId] = useState<string>(() => `term_${instCounter}`);
  const [height, setHeight] = useState(260);
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

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

  // ── Compute flat layout from tree ──────────────────────────────────────
  const { leaves, dividers } = useMemo(() => {
    const leaves: LeafLayout[] = [];
    const dividers: DividerLayout[] = [];
    if (containerSize.w > 0 && containerSize.h > 0) {
      computeLayout(root, 0, 0, containerSize.w, containerSize.h, leaves, dividers);
    }
    return { leaves, dividers };
  }, [root, containerSize]);

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
      const leaf = makeLeaf();
      setRoot((prev) => doSplit(prev, leafId, "row", leaf));
      setActiveId(leaf.id);
    },
    [],
  );

  const handleSplitV = useCallback(
    (leafId: string) => {
      const leaf = makeLeaf();
      setRoot((prev) => doSplit(prev, leafId, "col", leaf));
      setActiveId(leaf.id);
    },
    [],
  );

  const handleClose = useCallback(
    (leafId: string) => {
      const ids = leafIds(root);
      if (ids.length <= 1) {
        onToggleVisible();
        return;
      }
      setRoot((prev) => doClose(prev, leafId) ?? makeLeaf());
      setActiveId((prev) => (prev !== leafId ? prev : ids.find((id) => id !== leafId) ?? ""));
    },
    [root, onToggleVisible],
  );

  const handleRatioChange = useCallback((splitId: string, ratio: number) => {
    setRoot((prev) => doUpdateRatio(prev, splitId, ratio));
  }, []);

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <>
      {!fullscreen && <div className="term-resize-handle" onMouseDown={handleResizeStart} />}
      <div className="term-panel" style={fullscreen ? { flex: 1, minHeight: 0 } : { height }}>
        <div className="term-panel-header">
          <span className="term-panel-title">TERMINAL</span>
          <div className="term-panel-actions">
            <button
              className="term-action-btn term-action-close"
              onClick={onToggleVisible}
              title="Close Terminal Panel (Ctrl+`)"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <path d="M8 8.707l3.646 3.647.708-.707L8.707 8l3.647-3.646-.707-.708L8 7.293 4.354 3.646l-.707.708L7.293 8l-3.646 3.647.707.707L8 8.707z" />
              </svg>
            </button>
          </div>
        </div>

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
                instanceId={leaf.id}
                cwd={cwd}
                shell={leaf.shell}
                visible={visible}
                active={leaf.id === activeId}
                onFocus={() => setActiveId(leaf.id)}
              />
            </div>
          ))}

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
                const onMove = (ev: MouseEvent) => {
                  const rel = dir === "row"
                    ? (ev.clientX - bounds.left) - splitRect.left
                    : (ev.clientY - bounds.top) - splitRect.top;
                  const size = dir === "row" ? splitRect.width : splitRect.height;
                  handleRatioChange(splitId, Math.max(0.1, Math.min(0.9, rel / size)));
                };
                const onUp = () => {
                  document.removeEventListener("mousemove", onMove);
                  document.removeEventListener("mouseup", onUp);
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
