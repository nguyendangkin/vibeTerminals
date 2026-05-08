interface NoteListProps {
  activeFilter: "task" | "prompt";
  onFilterChange: (filter: "task" | "prompt") => void;
}

export function NoteList({ activeFilter, onFilterChange }: NoteListProps) {
  return (
    <div className="note-sidebar">
      <div className="note-sidebar-header">
        <span>NOTES</span>
      </div>

      <div className="note-filter-cards">
        <button
          className={`note-filter-card${activeFilter === "task" ? " active" : ""}`}
          onClick={() => onFilterChange("task")}
        >
          Task Notes
        </button>
        <button
          className={`note-filter-card${activeFilter === "prompt" ? " active" : ""}`}
          onClick={() => onFilterChange("prompt")}
        >
          Prompt Notes
        </button>
      </div>
    </div>
  );
}
