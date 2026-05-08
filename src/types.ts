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
