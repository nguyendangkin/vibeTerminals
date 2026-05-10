interface NoteListProps {
  activeFilter: "task" | "prompt";
  onFilterChange: (filter: "task" | "prompt") => void;
}

export function NoteList({ activeFilter, onFilterChange }: NoteListProps) {
  return (
    <div className="note-sidebar">
      <div className="note-sidebar-header">
        <span className="note-sidebar-title">NOTES</span>
      </div>
      <div className="note-sidebar-body">
        <button
          className={`note-filter-item${activeFilter === "task" ? " active" : ""}`}
          onClick={() => onFilterChange("task")}
        >
          Task Notes
        </button>
        <button
          className={`note-filter-item${activeFilter === "prompt" ? " active" : ""}`}
          onClick={() => onFilterChange("prompt")}
        >
          Prompt Notes
        </button>
      </div>
    </div>
  );
}
