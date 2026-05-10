export interface DirEntry {
  name: string;
  path: string;
  is_dir: boolean;
  children: DirEntry[];
}

export interface EditorTab {
  id: string;
  title: string;
  path: string | null;
  content: string;
  dirty: boolean;
  language: string;
}

export interface Project {
  id: string;
  path: string;
  name: string;
  fileTree: DirEntry[];
}

export interface WorkspaceState {
  tabs: EditorTab[];
  activeTabId: string | null;
}

export interface Note {
  id: string;
  title: string;
  content: string;
  type: "task" | "prompt";
  createdAt: number;
  updatedAt: number;
}

export interface GitStatusEntry {
  file_path: string;
  file_name: string;
  status: string;
  staged: boolean;
}

export interface GitStatus {
  entries: GitStatusEntry[];
  staged_count: number;
  unstaged_count: number;
  untracked_count: number;
  total_changes: number;
}

export interface GitLogEntry {
  graph: string;
  hash: string;
  date: string;
  message: string;
  refs: string;
}

export interface GitLog {
  entries: GitLogEntry[];
}
