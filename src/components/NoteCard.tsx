import type { Note } from "../types";

interface NoteCardProps {
  note: Note;
  onUpdate: (id: string, updates: Partial<Pick<Note, "title" | "content">>) => void;
  onDelete: (id: string) => void;
}

export function NoteCard({ note, onUpdate, onDelete }: NoteCardProps) {
  return (
    <div className="note-card">
      <button className="note-card-delete" onClick={() => onDelete(note.id)} title="Delete note">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
        </svg>
      </button>
      <input
        className="note-card-title-input"
        value={note.title}
        onChange={(e) => onUpdate(note.id, { title: e.target.value })}
        placeholder="Note title"
        spellCheck={false}
      />
      <textarea
        className="note-card-content-textarea"
        value={note.content}
        onChange={(e) => onUpdate(note.id, { content: e.target.value })}
        placeholder="Write your note here..."
        spellCheck={false}
        rows={4}
      />
    </div>
  );
}
