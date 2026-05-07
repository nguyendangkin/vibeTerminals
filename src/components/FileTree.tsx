import { useState } from "react";
import { DirEntry } from "../types";

interface FileTreeProps {
  rootPath: string | null;
  tree: DirEntry[];
  onOpenFile: (path: string) => void;
  onDeleteEntry: (path: string) => void;
  onRenameEntry: (oldPath: string, newName: string) => void;
}

function getIcon(entry: DirEntry, expanded: boolean): string {
  if (entry.is_dir) return expanded ? "📂" : "📁";
  const ext = entry.name.split(".").pop()?.toLowerCase();
  const icons: Record<string, string> = {
    ts: "🟦", tsx: "⚛️", js: "🟨", jsx: "⚛️", json: "📋",
    html: "🌐", htm: "🌐", css: "🎨",
    rs: "🦀", py: "🐍", md: "📝", xml: "📰", svg: "🖼️",
  };
  return icons[ext || ""] || "📄";
}

interface TreeNodeProps {
  entry: DirEntry;
  depth: number;
  onOpenFile: (path: string) => void;
  onDeleteEntry: (path: string) => void;
  onRenameEntry: (oldPath: string, newName: string) => void;
}

function TreeNode({ entry, depth, onOpenFile, onDeleteEntry, onRenameEntry }: TreeNodeProps) {
  const [expanded, setExpanded] = useState(depth < 1);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

  const handleClick = () => {
    if (entry.is_dir) {
      setExpanded(!expanded);
    } else {
      onOpenFile(entry.path);
    }
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY });
  };

  const closeContextMenu = () => setContextMenu(null);

  return (
    <div className="tree-node">
      <div
        className="tree-row"
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
      >
        <span className="tree-icon">{getIcon(entry, expanded)}</span>
        <span className="tree-name">{entry.name}</span>
      </div>

      {contextMenu && (
        <div
          className="context-menu-overlay"
          onClick={closeContextMenu}
          onContextMenu={(e) => { e.preventDefault(); closeContextMenu(); }}
        >
          <div
            className="context-menu"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            {!entry.is_dir && (
              <div className="context-item" onClick={() => { onOpenFile(entry.path); closeContextMenu(); }}>
                Open
              </div>
            )}
            <div className="context-item" onClick={() => {
              const name = prompt("New name:", entry.name);
              if (name && name !== entry.name) {
                onRenameEntry(entry.path, name);
              }
              closeContextMenu();
            }}>
              Rename
            </div>
            <div className="context-separator" />
            <div className="context-item context-danger" onClick={() => {
              if (confirm(`Delete "${entry.name}"?`)) {
                onDeleteEntry(entry.path);
              }
              closeContextMenu();
            }}>
              Delete
            </div>
          </div>
        </div>
      )}

      {entry.is_dir && expanded && entry.children.length > 0 && (
        <div className="tree-children">
          {entry.children.map((child) => (
            <TreeNode
              key={child.path}
              entry={child}
              depth={depth + 1}
              onOpenFile={onOpenFile}
              onDeleteEntry={onDeleteEntry}
              onRenameEntry={onRenameEntry}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function FileTree({ rootPath, tree, onOpenFile, onDeleteEntry, onRenameEntry }: FileTreeProps) {
  if (!rootPath) {
    return (
      <div className="filetree-empty">
        No folder opened.
      </div>
    );
  }

  if (tree.length === 0) {
    return (
      <div className="filetree-empty">
        Empty folder.
      </div>
    );
  }

  const rootName = rootPath.split(/[/\\]/).pop() || rootPath;

  return (
    <div className="filetree">
      <div className="tree-node">
        <div className="tree-row tree-root">
          <span className="tree-icon">📁</span>
          <span className="tree-name">{rootName}</span>
        </div>
        <div className="tree-children">
          {tree.map((entry) => (
            <TreeNode
              key={entry.path}
              entry={entry}
              depth={1}
              onOpenFile={onOpenFile}
              onDeleteEntry={onDeleteEntry}
              onRenameEntry={onRenameEntry}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
