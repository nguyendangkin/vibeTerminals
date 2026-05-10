import { useState, useRef, useEffect, useCallback, useLayoutEffect } from "react";
import type { Note } from "../types";
import { NoteCard } from "./NoteCard";

const DRAG_THRESHOLD = 4;
const BOUNCE_EASE = "transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)";

function getTargetIndex(clientY: number, items: NodeListOf<HTMLElement>): number {
  for (let i = 0; i < items.length; i++) {
    const rect = items[i].getBoundingClientRect();
    if (clientY < rect.top + rect.height / 2) return i;
  }
  return items.length;
}

function prepareFLIP(list: HTMLElement): Map<string, DOMRect> {
  const items = list.querySelectorAll<HTMLElement>("[data-note-id]");
  items.forEach((el) => {
    el.style.transition = "";
    el.style.transform = "";
  });
  void list.offsetHeight;
  const rects = new Map<string, DOMRect>();
  items.forEach((el) => {
    rects.set(el.dataset.noteId!, el.getBoundingClientRect());
  });
  return rects;
}

interface NoteCardListProps {
  notes: Note[];
  onUpdate: (id: string, updates: Partial<Pick<Note, "title" | "content">>) => void;
  onDelete: (id: string) => void;
  onReorder: (noteId: string, toIndex: number) => void;
}

export function NoteCardList({ notes, onUpdate, onDelete, onReorder }: NoteCardListProps) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [ghostY, setGhostY] = useState<number | null>(null);

  const listRef = useRef<HTMLDivElement>(null);
  const flipRectsRef = useRef<Map<string, DOMRect> | null>(null);
  const dragState = useRef<{
    index: number;
    startY: number;
    dragging: boolean;
    noteId: string;
  } | null>(null);
  const notesRef = useRef(notes);
  notesRef.current = notes;
  const lastTargetRef = useRef<number | null>(null);

  // FLIP animation after reorder
  useLayoutEffect(() => {
    const flipData = flipRectsRef.current;
    if (!flipData) return;
    flipRectsRef.current = null;

    const list = listRef.current;
    if (!list || flipData.size === 0) return;

    const items = list.querySelectorAll<HTMLElement>("[data-note-id]");
    if (items.length !== flipData.size) return;

    const animations: { el: HTMLElement; dy: number }[] = [];
    items.forEach((el) => {
      const id = el.dataset.noteId!;
      const prev = flipData.get(id);
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
  }, [notes]);

  // Sync dragIndex after live reorder
  useEffect(() => {
    if (dragIndex === null) return;
    const ds = dragState.current;
    if (!ds) return;
    const newIndex = notes.findIndex((n) => n.id === ds.noteId);
    if (newIndex !== -1 && newIndex !== dragIndex) {
      setDragIndex(newIndex);
    }
  }, [notes, dragIndex]);

  const endDrag = useCallback(() => {
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

      const list = listRef.current;
      if (!list) return;
      const items = list.querySelectorAll<HTMLElement>("[data-note-id]");

      const target = getTargetIndex(e.clientY, items);
      if (lastTargetRef.current === target) return;
      lastTargetRef.current = target;

      const fromIndex = notesRef.current.findIndex((n) => n.id === ds.noteId);
      if (fromIndex === -1) return;

      const toIndex = target > fromIndex ? target - 1 : target;
      if (toIndex === fromIndex) return;

      flipRectsRef.current = prepareFLIP(list);
      onReorder(ds.noteId, toIndex);
    };

    const onMouseUp = (e: MouseEvent) => {
      const ds = dragState.current;
      if (!ds) return;

      if (ds.dragging) {
        const list = listRef.current;
        if (list) {
          const items = list.querySelectorAll<HTMLElement>("[data-note-id]");
          const target = getTargetIndex(e.clientY, items);
          if (lastTargetRef.current !== target) {
            lastTargetRef.current = target;
            const fromIndex = notesRef.current.findIndex((n) => n.id === ds.noteId);
            if (fromIndex !== -1) {
              const toIndex = target > fromIndex ? target - 1 : target;
              if (toIndex !== fromIndex) {
                flipRectsRef.current = prepareFLIP(list);
                onReorder(ds.noteId, toIndex);
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
  }, [onReorder, endDrag]);

  return (
    <>
      <div className="note-main-body" ref={listRef}>
        {notes.length === 0 ? (
          <div className="note-empty">No notes yet</div>
        ) : (
          notes.map((note, i) => {
            const isDragging = dragIndex === i;
            return (
              <div
                key={note.id}
                data-note-id={note.id}
                className={`note-card-wrapper${isDragging ? " note-card-dragging" : ""}`}
                onMouseDown={(e) => {
                  const target = e.target as HTMLElement;
                  if (!target.closest(".note-card-handle")) return;
                  dragState.current = {
                    index: i,
                    startY: e.clientY,
                    dragging: false,
                    noteId: note.id,
                  };
                }}
              >
                <NoteCard
                  note={note}
                  onUpdate={onUpdate}
                  onDelete={onDelete}
                />
              </div>
            );
          })
        )}
      </div>

      {dragIndex !== null && ghostY !== null && (
        <div
          className="note-card-ghost"
          style={{
            top: ghostY - 16,
            position: "fixed",
            zIndex: 1000,
            pointerEvents: "none",
          }}
        >
          <div className="note-card-ghost-inner">
            {notes[dragIndex]?.title || "Untitled"}
          </div>
        </div>
      )}
    </>
  );
}
