import { useState, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";

export interface SearchMatch {
  file_path: string;
  file_name: string;
  line_number: number;
  line_content: string;
  match_start: number;
  match_end: number;
}

interface SearchPanelProps {
  rootPath: string | null;
  onOpenFile: (path: string) => void;
  onClose: () => void;
}

export function SearchPanel({ rootPath, onOpenFile, onClose }: SearchPanelProps) {
  const [pattern, setPattern] = useState("");
  const [results, setResults] = useState<SearchMatch[]>([]);
  const [searching, setSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSearch = async () => {
    if (!rootPath || !pattern.trim()) return;
    setSearching(true);
    try {
      const matches = await invoke<SearchMatch[]>("search_in_files", {
        folder: rootPath,
        pattern: pattern,
      });
      setResults(matches);
    } catch (err) {
      console.error("Search failed:", err);
    } finally {
      setSearching(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSearch();
    } else if (e.key === "Escape") {
      onClose();
    }
  };

  // Group results by file
  const grouped: Record<string, SearchMatch[]> = {};
  for (const m of results) {
    if (!grouped[m.file_path]) grouped[m.file_path] = [];
    grouped[m.file_path].push(m);
  }

  return (
    <div className="search-panel">
      <div className="search-panel-header">
        <input
          ref={inputRef}
          className="search-input"
          type="text"
          value={pattern}
          onChange={(e) => setPattern(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Search across files (regex)..."
        />
        <button className="search-btn" onClick={handleSearch} disabled={!rootPath}>
          {searching ? "..." : "Search"}
        </button>
        <button className="search-btn" onClick={onClose}>×</button>
      </div>
      <div className="search-results">
        {results.length === 0 && !searching && pattern && (
          <div className="search-no-results">No results found.</div>
        )}
        {Object.entries(grouped).map(([filePath, matches]) => (
          <div key={filePath} className="search-file-group">
            <div className="search-file-name">
              {matches[0].file_name}
              <span className="search-match-count">({matches.length})</span>
            </div>
            {matches.map((m, i) => (
              <div
                key={`${filePath}:${m.line_number}:${i}`}
                className="search-match"
                onClick={() => onOpenFile(filePath)}
              >
                <span className="search-line-num">{m.line_number}</span>
                <span className="search-line-text">
                  {m.line_content.substring(0, 120)}
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
