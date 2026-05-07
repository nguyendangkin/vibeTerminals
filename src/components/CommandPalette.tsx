import { useState, useRef, useEffect } from "react";

interface Command {
  id: string;
  label: string;
  shortcut?: string;
  action: () => void;
}

interface CommandPaletteProps {
  commands: Command[];
  onClose: () => void;
}

export function CommandPalette({ commands, onClose }: CommandPaletteProps) {
  const [filter, setFilter] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const filtered = filter
    ? commands.filter((c) => c.label.toLowerCase().includes(filter.toLowerCase()))
    : commands;

  // Reset selection when filter changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [filter]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
        break;
      case "Enter":
        e.preventDefault();
        if (filtered[selectedIndex]) {
          filtered[selectedIndex].action();
          onClose();
        }
        break;
      case "Escape":
        e.preventDefault();
        onClose();
        break;
    }
  };

  return (
    <div className="command-palette-overlay" onClick={onClose}>
      <div className="command-palette" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="command-palette-input"
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a command..."
        />
        <div className="command-palette-list">
          {filtered.map((cmd, i) => (
            <div
              key={cmd.id}
              className={`command-item ${i === selectedIndex ? "selected" : ""}`}
              onClick={() => { cmd.action(); onClose(); }}
            >
              <span className="command-label">{cmd.label}</span>
              {cmd.shortcut && <span className="command-shortcut">{cmd.shortcut}</span>}
            </div>
          ))}
          {filtered.length === 0 && (
            <div className="command-no-results">No matching commands</div>
          )}
        </div>
      </div>
    </div>
  );
}
