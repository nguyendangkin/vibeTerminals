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

export interface GitFileStatus {
  path: string;
  status: string;
}

export interface GitStatusResult {
  files: GitFileStatus[];
  branch: string;
  ahead: number;
  behind: number;
}

export interface GitCommit {
  hash: string;
  short_hash: string;
  parents: string[];
  message: string;
  author: string;
  date: string;
  refs: string[];
}

export interface GraphCommit extends GitCommit {
  lane: number;
  mergeLanes: number[];
  totalLanes: number;
}

export interface Note {
  id: string;
  title: string;
  content: string;
  type: "task" | "prompt";
  createdAt: number;
  updatedAt: number;
}
