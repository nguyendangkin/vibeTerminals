import { useState } from "react";
import { DirEntry } from "../types";

interface FileTreeProps {
  rootPath: string | null;
  tree: DirEntry[];
  onOpenFile: (path: string) => void;
}

function getIcon(entry: DirEntry, expanded: boolean): string {
  if (entry.is_dir) return expanded ? "▾" : "▸";
  return "";
}

interface TreeNodeProps {
  entry: DirEntry;
  depth: number;
  onOpenFile: (path: string) => void;
}

function TreeNode({ entry, depth, onOpenFile }: TreeNodeProps) {
  const [expanded, setExpanded] = useState(depth < 1);

  const handleClick = () => {
    if (entry.is_dir) {
      setExpanded(!expanded);
    } else {
      onOpenFile(entry.path);
    }
  };

  return (
    <div className="tree-node">
      <div
        className="tree-row"
        style={{ paddingLeft: `${depth * 16 + 6}px` }}
        onClick={handleClick}
      >
        <span className="tree-icon">{getIcon(entry, expanded)}</span>
        <span className="tree-name">{entry.name}</span>
      </div>

      {entry.is_dir && expanded && entry.children.length > 0 && (
        <div className="tree-children">
          {entry.children.map((child) => (
            <TreeNode
              key={child.path}
              entry={child}
              depth={depth + 1}
              onOpenFile={onOpenFile}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function FileTree({ rootPath, tree, onOpenFile }: FileTreeProps) {
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
          <span className="tree-name">{rootName}</span>
        </div>
        <div className="tree-children">
          {tree.map((entry) => (
            <TreeNode
              key={entry.path}
              entry={entry}
              depth={1}
              onOpenFile={onOpenFile}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
