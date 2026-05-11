import { useState, useCallback, useEffect, useMemo, useRef, type MouseEvent as RMouseEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { EditorTab, DirEntry, Project, WorkspaceState, type Note, type GitStatus, type GitLog } from "./types";
import { TabBar } from "./components/TabBar";
import { EditorPanel } from "./components/EditorPanel";
import { FileTree } from "./components/FileTree";
import { CommandPalette } from "./components/CommandPalette";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { NoteList } from "./components/NoteList";
import { NoteCardList } from "./components/NoteCardList";
import { ProjectBar } from "./components/ProjectBar";
import { TopBar, type TopTab } from "./components/TopBar";
import { TerminalContainer } from "./components/TerminalContainer";
import { WelcomeScreen } from "./components/WelcomeScreen";
import { GitPanel } from "./components/GitPanel";
import { GitGraph } from "./components/GitGraph";
import "./App.css";

let tabCounter = 0;
let projectCounter = 0;

const STORAGE_KEY = "tertito_persist";

interface PersistedWorkspace {
  tabPaths: string[];
  activeTabPath: string | null;
}

interface PersistedState {
  projects: { id: string; path: string; name: string }[];
  activeProjectId: string | null;
  workspaces: Record<string, PersistedWorkspace>;
  projectTopTabs?: Record<string, TopTab | null>;
  notes?: Record<string, Note[]>;
  noteFilters?: Record<string, "task" | "prompt">;
}

function emptyWorkspace(): WorkspaceState {
  return { tabs: [], activeTabId: null };
}

function App() {
  // ── multi-project state ───────────────────────────────────────────────────
  const [projects, setProjects] = useState<Project[]>([]);
  const [workspaces, setWorkspaces] = useState<Record<string, WorkspaceState>>({});
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, Note[]>>({});
  const [noteFilter, setNoteFilter] = useState<Record<string, "task" | "prompt">>({});

  // Derived from active project/workspace
  const activeProject = projects.find((p) => p.id === activeProjectId) ?? null;
  const activeWorkspace = activeProjectId ? (workspaces[activeProjectId] ?? emptyWorkspace()) : emptyWorkspace();
  const tabs = activeWorkspace.tabs;
  const activeTabId = activeWorkspace.activeTabId;
  const rootPath = activeProject?.path ?? null;
  const fileTree = activeProject?.fileTree ?? [];
  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null;
  const activeNotes = activeProjectId ? (notes[activeProjectId] ?? []) : [];
  const activeNoteFilter = activeProjectId ? (noteFilter[activeProjectId] ?? "task") : "task";

  // ── ui state ──────────────────────────────────────────────────────────────
  const [topTab, setTopTab] = useState<TopTab | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(240);
  const [resizingSidebar, setResizingSidebar] = useState(false);
  const [showPalette, setShowPalette] = useState(false);
  const [projectDeleteTarget, setProjectDeleteTarget] = useState<Project | null>(null);
  const [closingTab, setClosingTab] = useState<{ id: string; title: string } | null>(null);

  const [gitStatus, setGitStatus] = useState<GitStatus | null>(null);
  const [gitLog, setGitLog] = useState<GitLog | null>(null);
  const [gitAhead, setGitAhead] = useState(0);
  const [gitLeftWidth, setGitLeftWidth] = useState(300);
  const [resizingGit, setResizingGit] = useState(false);

  const showTerminal = topTab === "terminal";
  const terminalReloadRef = useRef<Map<string, () => void>>(new Map());
  const terminalShellRef = useRef<Map<string, string>>(new Map());
  const [, setShellTick] = useState(0);

  const shellRef = useRef<HTMLDivElement>(null);
  const hasRestoredRef = useRef(false);
  const projectTopTabsRef = useRef<Record<string, TopTab | null>>({});
  const dirtyContentRef = useRef<Map<string, string>>(new Map());
  const getDirtyContent = useCallback((tabId: string) => dirtyContentRef.current.get(tabId), []);

  // ── persist / restore ────────────────────────────────────────────────────
  useEffect(() => {
    async function restore() {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) { hasRestoredRef.current = true; return; }
      let saved: PersistedState;
      try { saved = JSON.parse(raw); } catch { hasRestoredRef.current = true; return; }

      saved.projects.forEach((p) => {
        const n = parseInt(p.id.replace("proj_", ""));
        if (!isNaN(n) && n > projectCounter) projectCounter = n;
      });

      const restoredProjects: Project[] = [];
      const restoredWorkspaces: Record<string, WorkspaceState> = {};

      for (const sp of saved.projects) {
        let tree: DirEntry[] = [];
        try { tree = await invoke<DirEntry[]>("list_dir", { path: sp.path }); }
        catch { continue; }

        restoredProjects.push({ id: sp.id, path: sp.path, name: sp.name, fileTree: tree });

        const pw = saved.workspaces[sp.id];
        if (!pw) { restoredWorkspaces[sp.id] = emptyWorkspace(); continue; }

        const tabs: EditorTab[] = [];
        let activeTabId: string | null = null;

        for (const tabPath of pw.tabPaths) {
          let content = "";
          try { content = await invoke<string>("read_file_content", { path: tabPath }); }
          catch { continue; }
          const fileName = tabPath.split(/[\/\\]/).pop() ?? "untitled";
          const tab: EditorTab = { id: `tab_${++tabCounter}`, title: fileName, path: tabPath, content, dirty: false, language: "plaintext" };
          tabs.push(tab);
          if (tabPath === pw.activeTabPath) activeTabId = tab.id;
        }

        restoredWorkspaces[sp.id] = { tabs, activeTabId: activeTabId ?? tabs[0]?.id ?? null };
      }

      if (restoredProjects.length > 0) {
        setProjects(restoredProjects);
        setWorkspaces(restoredWorkspaces);
        const validActiveId = saved.activeProjectId && restoredProjects.some((p) => p.id === saved.activeProjectId)
          ? saved.activeProjectId
          : restoredProjects[0].id;
        setActiveProjectId(validActiveId);
        if (saved.projectTopTabs) {
          projectTopTabsRef.current = saved.projectTopTabs;
        }
        setTopTab(projectTopTabsRef.current[validActiveId] ?? "explorer");
      }
      if (saved.notes) setNotes(saved.notes);
      if (saved.noteFilters) setNoteFilter(saved.noteFilters);

      hasRestoredRef.current = true;
    }
    restore();
  }, []);

  useEffect(() => {
    if (!hasRestoredRef.current) return;
    const state: PersistedState = {
      projects: projects.map(({ id, path, name }) => ({ id, path, name })),
      activeProjectId,
      workspaces: Object.fromEntries(
        Object.entries(workspaces).map(([pid, ws]) => [
          pid,
          {
            tabPaths: ws.tabs.filter((t) => t.path).map((t) => t.path!),
            activeTabPath: ws.tabs.find((t) => t.id === ws.activeTabId)?.path ?? null,
          },
        ])
      ),
      projectTopTabs: projectTopTabsRef.current,
      notes,
      noteFilters: noteFilter,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [projects, workspaces, activeProjectId, topTab, notes, noteFilter]);

  // ── workspace helpers ─────────────────────────────────────────────────────
  const updateWorkspace = useCallback((pid: string, fn: (ws: WorkspaceState) => WorkspaceState) => {
    setWorkspaces((prev) => ({ ...prev, [pid]: fn(prev[pid] ?? emptyWorkspace()) }));
  }, []);

  const setActiveTabId = useCallback((id: string | null) => {
    if (!activeProjectId) return;
    updateWorkspace(activeProjectId, (ws) => ({ ...ws, activeTabId: id }));
  }, [activeProjectId, updateWorkspace]);

  // ── file helpers ─────────────────────────────────────────────────────────
  const createTab = useCallback(
    (title: string, path: string | null, content: string, language: string): EditorTab =>
      ({ id: `tab_${++tabCounter}`, title, path, content, dirty: false, language }),
    [],
  );

  const refreshProjectTree = useCallback(async (pid: string, path: string) => {
    try {
      const tree = await invoke<DirEntry[]>("list_dir", { path });
      setProjects((prev) => prev.map((p) => p.id === pid ? { ...p, fileTree: tree } : p));
    } catch (err) { console.error(err); }
  }, []);

  const openFileInTab = useCallback(async (filePath: string) => {
    if (!activeProjectId) return;
    const ws = workspaces[activeProjectId] ?? emptyWorkspace();
    const existing = ws.tabs.find((t) => t.path === filePath);
    if (existing) {
      updateWorkspace(activeProjectId, (w) => ({ ...w, activeTabId: existing.id }));
      return;
    }
    try {
      const content = await invoke<string>("read_file_content", { path: filePath });
      const fileName = filePath.split(/[/\\]/).pop() ?? "untitled";
      const tab = createTab(fileName, filePath, content, "plaintext");
      updateWorkspace(activeProjectId, (w) => ({ ...w, tabs: [...w.tabs, tab], activeTabId: tab.id }));
    } catch (err) { console.error("Failed to open file:", err); }
  }, [activeProjectId, workspaces, createTab, updateWorkspace]);

  // ── project actions ───────────────────────────────────────────────────────
  const handleAddProject = useCallback(async () => {
    try {
      const path = await invoke<string | null>("pick_folder");
      if (!path) return;
      const name = path.split(/[/\\]/).pop() ?? path;
      const id = `proj_${++projectCounter}`;
      const tree = await invoke<DirEntry[]>("list_dir", { path });
      setProjects((prev) => [...prev, { id, path, name, fileTree: tree }]);
      setWorkspaces((prev) => ({ ...prev, [id]: emptyWorkspace() }));
      setActiveProjectId(id);
    } catch (err) { console.error(err); }
  }, []);

  const handleCloseProject = useCallback((projectId: string) => {
    const idx = projects.findIndex((p) => p.id === projectId);
    const remaining = projects.filter((p) => p.id !== projectId);
    setProjects(remaining);

    let closingTabIds: string[] = [];
    setWorkspaces((prev) => {
      const ws = prev[projectId];
      if (ws) closingTabIds = ws.tabs.map((t) => t.id);
      const next = { ...prev };
      delete next[projectId];
      return next;
    });
    closingTabIds.forEach((id) => dirtyContentRef.current.delete(id));

    setNotes((prev) => {
      const next = { ...prev };
      delete next[projectId];
      return next;
    });
    setNoteFilter((prev) => {
      const next = { ...prev };
      delete next[projectId];
      return next;
    });

    terminalReloadRef.current.delete(projectId);
    terminalShellRef.current.delete(projectId);
    localStorage.removeItem(`tertito_terminal_${projectId}`);

    if (activeProjectId === projectId) {
      const fallback = remaining[Math.min(idx, remaining.length - 1)];
      setActiveProjectId(fallback?.id ?? null);
    }
  }, [projects, activeProjectId]);

  // ── tab actions ───────────────────────────────────────────────────────────
  const handleCloseTab = useCallback((id: string) => {
    if (!activeProjectId) return;
    const ws = workspaces[activeProjectId] ?? emptyWorkspace();
    const target = ws.tabs.find((t) => t.id === id);
    if (target?.dirty) {
      setClosingTab({ id: target.id, title: target.title });
      return;
    }
    dirtyContentRef.current.delete(id);
    updateWorkspace(activeProjectId, (w) => {
      const idx = w.tabs.findIndex((t) => t.id === id);
      const next = w.tabs.filter((t) => t.id !== id);
      return {
        ...w,
        tabs: next,
        activeTabId: w.activeTabId === id ? (next[Math.min(idx, next.length - 1)]?.id ?? null) : w.activeTabId,
      };
    });
  }, [activeProjectId, workspaces, updateWorkspace]);

  const handleConfirmCloseTab = useCallback(() => {
    if (!closingTab || !activeProjectId) return;
    dirtyContentRef.current.delete(closingTab.id);
    updateWorkspace(activeProjectId, (w) => {
      const idx = w.tabs.findIndex((t) => t.id === closingTab.id);
      const next = w.tabs.filter((t) => t.id !== closingTab.id);
      return {
        ...w,
        tabs: next,
        activeTabId: w.activeTabId === closingTab.id ? (next[Math.min(idx, next.length - 1)]?.id ?? null) : w.activeTabId,
      };
    });
    setClosingTab(null);
  }, [closingTab, activeProjectId, updateWorkspace]);

  const handleCancelCloseTab = useCallback(() => {
    setClosingTab(null);
  }, []);

  const handleSaveFile = useCallback(async () => {
    if (!activeTab || !activeProjectId) return;
    let savePath = activeTab.path;
    if (!savePath) {
      try { savePath = await invoke<string | null>("save_file_dialog"); }
      catch { return; }
      if (!savePath) return;
    }
    try {
      const content = dirtyContentRef.current.get(activeTab.id) ?? activeTab.content;
      await invoke("write_file_content", { path: savePath, content });
      dirtyContentRef.current.delete(activeTab.id);
      updateWorkspace(activeProjectId, (ws) => ({
        ...ws,
        tabs: ws.tabs.map((t) =>
          t.id === activeTab.id
            ? { ...t, path: savePath!, title: savePath!.split(/[/\\]/).pop() ?? t.title, dirty: false, content }
            : t),
      }));
      if (rootPath) await refreshProjectTree(activeProjectId, rootPath);
    } catch (err) { console.error(err); }
  }, [activeTab, activeProjectId, rootPath, updateWorkspace, refreshProjectTree]);

  const handleContentChange = useCallback((content: string) => {
    if (!activeProjectId || !activeTabId) return;
    dirtyContentRef.current.set(activeTabId, content);
    updateWorkspace(activeProjectId, (ws) => ({
      ...ws,
      tabs: ws.tabs.map((t) => t.id === activeTabId ? { ...t, dirty: true } : t),
    }));
  }, [activeProjectId, activeTabId, updateWorkspace]);

  // ── note actions ────────────────────────────────────────────────────────────
  const handleAddNote = useCallback((type: "task" | "prompt") => {
    if (!activeProjectId) return;
    const now = Date.now();
    const id = `note_${now}_${Math.random().toString(36).slice(2, 8)}`;
    const note: Note = { id, title: "", content: "", type, createdAt: now, updatedAt: now };
    setNotes((prev) => ({ ...prev, [activeProjectId]: [note, ...(prev[activeProjectId] ?? [])] }));
    setNoteFilter((prev) => ({ ...prev, [activeProjectId]: type }));
  }, [activeProjectId]);

  const handleUpdateNote = useCallback((id: string, updates: Partial<Pick<Note, "title" | "content">>) => {
    if (!activeProjectId) return;
    setNotes((prev) => ({
      ...prev,
      [activeProjectId]: (prev[activeProjectId] ?? []).map((n) =>
        n.id === id ? { ...n, ...updates, updatedAt: Date.now() } : n),
    }));
  }, [activeProjectId]);

  const handleDeleteNote = useCallback((id: string) => {
    if (!activeProjectId) return;
    setNotes((prev) => ({
      ...prev,
      [activeProjectId]: (prev[activeProjectId] ?? []).filter((n) => n.id !== id),
    }));
  }, [activeProjectId]);

  const handleReorderNotes = useCallback(
    (noteId: string, toFilteredIndex: number) => {
      if (!activeProjectId) return;
      setNotes((prev) => {
        const all = prev[activeProjectId] ?? [];
        const fromIndex = all.findIndex((n) => n.id === noteId);
        if (fromIndex === -1) return prev;

        const typeNotes = all.filter((n) => n.type === activeNoteFilter);
        const targetNote = typeNotes[toFilteredIndex];
        if (!targetNote) return prev;

        const toIndex = all.findIndex((n) => n.id === targetNote.id);
        if (toIndex === -1 || toIndex === fromIndex) return prev;

        const next = [...all];
        const [moved] = next.splice(fromIndex, 1);
        next.splice(toIndex, 0, moved);
        return { ...prev, [activeProjectId]: next };
      });
    },
    [activeProjectId, activeNoteFilter],
  );

  // ── sidebar resize ────────────────────────────────────────────────────────
  const handleResizeStart = useCallback((e: RMouseEvent) => {
    e.preventDefault(); setResizingSidebar(true);
  }, []);

  useEffect(() => {
    if (!resizingSidebar) return;
    const onMove = (e: MouseEvent) => setSidebarWidth(Math.max(160, Math.min(500, e.clientX - 52)));
    const onUp = () => setResizingSidebar(false);
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => { document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp); };
  }, [resizingSidebar]);

  // ── git panel resize ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!resizingGit) return;
    const onMove = (e: MouseEvent) =>
      setGitLeftWidth(Math.max(200, Math.min(500, e.clientX - 52)));
    const onUp = () => setResizingGit(false);
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => { document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp); };
  }, [resizingGit]);

  // ── top bar & panel handlers ─────────────────────────────────────────────
  const handleTopTab = useCallback((tab: TopTab) => {
    setTopTab((prev) => {
      const next = prev === tab ? null : tab;
      if (activeProjectId) projectTopTabsRef.current[activeProjectId] = next;
      return next;
    });
  }, [activeProjectId]);

  const handleBrandClick = useCallback(() => {
    setTopTab((prev) => {
      const next = prev === "about" ? null : "about";
      if (activeProjectId) projectTopTabsRef.current[activeProjectId] = next;
      return next;
    });
  }, [activeProjectId]);

  const handleSelectProject = useCallback((id: string) => {
    setActiveProjectId(id);
    setTopTab(projectTopTabsRef.current[id] ?? "explorer");
  }, []);

  // Stable-sorted copy for terminal area: React's insertBefore (when
  // reordering DOM nodes) detaches xterm.js canvas elements in WebView2,
  // resetting them. Terminal area only shows one project at a time, so
  // DOM order is irrelevant — sort by ID to keep it stable.
  const projectsForTerminals = useMemo(
    () => [...projects].sort((a, b) => a.id.localeCompare(b.id)),
    [projects],
  );

  const handleReorderProjects = useCallback((fromIndex: number, toIndex: number) => {
    setProjects((prev) => {
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
  }, []);

  // ── git watcher (real-time via file system events) ──────────────────────────
  useEffect(() => {
    if (!rootPath) {
      setGitStatus(null);
      return;
    }

    let cancelled = false;

    // Initial fetch
    invoke<GitStatus>("git_status", { folder: rootPath })
      .then((s) => { if (!cancelled) setGitStatus(s); })
      .catch(() => { if (!cancelled) setGitStatus(null); });

    // Start file system watcher + listen for change events
    let unlisten: (() => void) | undefined;
    (async () => {
      try {
        await invoke("start_git_watch", { folder: rootPath });
      } catch { /* not a git repo or git not installed */ }

      if (cancelled) return;

      try {
        unlisten = await listen<GitStatus | null>("git-status-changed", (event) => {
          if (!cancelled) setGitStatus(event.payload);
        });
      } catch { /* ignore */ }
    })();

    return () => {
      cancelled = true;
      unlisten?.();
      invoke("stop_git_watch").catch(() => {});
    };
  }, [rootPath]);

  // ── git log fetch (when git tab is active) ──────────────────────────────────
  useEffect(() => {
    if (!rootPath || topTab !== "git") {
      setGitLog(null);
      setGitAhead(0);
      return;
    }
    let cancelled = false;
    invoke<GitLog>("git_log", { folder: rootPath })
      .then((log) => { if (!cancelled) setGitLog(log); })
      .catch(() => { if (!cancelled) setGitLog(null); });
    invoke<number>("git_ahead_count", { folder: rootPath })
      .then((n) => { if (!cancelled) setGitAhead(n); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [rootPath, topTab]);

  // ── git actions ─────────────────────────────────────────────────────────────
  const handleDiscardAll = useCallback(async () => {
    if (!rootPath) return;
    try {
      await invoke("git_discard_all", { folder: rootPath });
      const status = await invoke<GitStatus>("git_status", { folder: rootPath });
      setGitStatus(status);
      const log = await invoke<GitLog>("git_log", { folder: rootPath });
      setGitLog(log);
      const n = await invoke<number>("git_ahead_count", { folder: rootPath });
      setGitAhead(n);
    } catch (err) { console.error("Discard failed:", err); }
  }, [rootPath]);

  const handleCommit = useCallback(async (message: string) => {
    if (!rootPath) return;
    try {
      await invoke("git_commit", { folder: rootPath, message });
      const status = await invoke<GitStatus>("git_status", { folder: rootPath });
      setGitStatus(status);
      const log = await invoke<GitLog>("git_log", { folder: rootPath });
      setGitLog(log);
      const n = await invoke<number>("git_ahead_count", { folder: rootPath });
      setGitAhead(n);
    } catch (err) { console.error("Commit failed:", err); }
  }, [rootPath]);

  const handleRequestDeleteProject = useCallback((id: string) => {
    const target = projects.find((p) => p.id === id) ?? null;
    setProjectDeleteTarget(target);
  }, [projects]);

  const handleConfirmDeleteProject = useCallback(() => {
    if (!projectDeleteTarget) return;
    handleCloseProject(projectDeleteTarget.id);
    setProjectDeleteTarget(null);
  }, [handleCloseProject, projectDeleteTarget]);

  const handleCancelDeleteProject = useCallback(() => {
    setProjectDeleteTarget(null);
  }, []);

  useEffect(() => {
    if (!projectDeleteTarget) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setProjectDeleteTarget(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [projectDeleteTarget]);

  // ── keyboard shortcuts ────────────────────────────────────────────────────
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    const ctrl = e.ctrlKey || e.metaKey;
    const shift = e.shiftKey;
    const key = e.key.toLowerCase();
    if (ctrl && shift && key === "p") { e.preventDefault(); setShowPalette(true); return; }
    if (ctrl && shift && key === "e") { e.preventDefault(); handleTopTab("explorer"); return; }
    if (ctrl && shift && key === "n") { e.preventDefault(); handleTopTab("note"); return; }
    if (ctrl && shift && key === "g") { e.preventDefault(); handleTopTab("git"); return; }
    if (ctrl && key === "tab") {
      e.preventDefault();
      if (tabs.length < 2) return;
      const idx = tabs.findIndex((t) => t.id === activeTabId);
      setActiveTabId(tabs[(idx + (shift ? -1 : 1) + tabs.length) % tabs.length].id);
      return;
    }
    if (ctrl && key === "`") { e.preventDefault(); handleTopTab("terminal"); return; }
    if (ctrl) {
      switch (key) {
        case "o": e.preventDefault(); handleAddProject(); break;
        case "s": e.preventDefault(); handleSaveFile(); break;
        case "p": e.preventDefault();
          invoke<string | null>("pick_file").then((p) => { if (p) openFileInTab(p); }).catch(() => {});
          break;
        case "w": e.preventDefault(); activeTabId && handleCloseTab(activeTabId); break;
      }
    }
  }, [tabs, activeTabId, handleAddProject, handleSaveFile,
      handleCloseTab, openFileInTab,
      setActiveTabId]);

  // ── command palette entries ───────────────────────────────────────────────
  const commands = [
    { id: "open-folder", label: "Add Project Folder", shortcut: "Ctrl+O", action: handleAddProject },
    { id: "save", label: "Save File", shortcut: "Ctrl+S", action: handleSaveFile },
    { id: "close-tab", label: "Close Tab", shortcut: "Ctrl+W", action: () => activeTabId && handleCloseTab(activeTabId) },
    { id: "toggle-terminal", label: "Toggle Terminal", shortcut: "Ctrl+`", action: () => handleTopTab("terminal") },
    { id: "note-panel", label: "Notes Panel", shortcut: "Ctrl+Shift+N", action: () => handleTopTab("note") },
    { id: "git-panel", label: "Source Control", shortcut: "Ctrl+Shift+G", action: () => handleTopTab("git") },
  ];

  // ── render ────────────────────────────────────────────────────────────────
  return (
    <div
      className={`app-shell${resizingSidebar ? " app-resizing" : ""}`}
      ref={shellRef}
      onKeyDown={handleKeyDown}
      tabIndex={0}
    >
      {/* Project bar */}
      <ProjectBar
        projects={projects}
        activeProjectId={activeProjectId}
        onSelectProject={handleSelectProject}
        onRequestDeleteProject={handleRequestDeleteProject}
        onAddProject={handleAddProject}
        onReorderProjects={handleReorderProjects}
      />

      {/* Right area: top bar + content */}
      <div className="right-area">
        <TopBar
          activeTab={topTab}
          onTabClick={handleTopTab}
          onReloadAll={() => { if (activeProjectId) terminalReloadRef.current.get(activeProjectId)?.(); }}
          globalShell={activeProjectId ? (terminalShellRef.current.get(activeProjectId) ?? "powershell") : "powershell"}
          onGlobalShellChange={(shell) => {
            if (activeProjectId) {
              terminalShellRef.current.set(activeProjectId, shell);
              setShellTick((n) => n + 1);
            }
          }}
          gitChangesCount={gitStatus?.total_changes}
          onBrandClick={handleBrandClick}
        />

        <div className="content-area" style={topTab === "terminal" ? { display: "none" } : undefined}>
          {/* Sidebar: explorer */}
          {topTab === "explorer" && (
            <>
              <div className="sidebar" style={{ width: sidebarWidth }}>
                {activeProject ? (
                  <FileTree
                    rootPath={rootPath}
                    tree={fileTree}
                    onOpenFile={openFileInTab}
                  />
                ) : (
                  <div className="project-empty-state">
                    <p>No folder opened</p>
                    <button className="project-open-btn" onClick={handleAddProject}>
                      Open Folder
                    </button>
                  </div>
                )}
              </div>
              <div className="sidebar-resize-handle" onMouseDown={handleResizeStart} />
            </>
          )}

          {/* Sidebar: note */}
          {topTab === "note" && (
            <>
              <div className="sidebar" style={{ width: sidebarWidth }}>
                <NoteList
                  activeFilter={activeNoteFilter}
                  onFilterChange={(f) => {
                    if (activeProjectId) setNoteFilter((prev) => ({ ...prev, [activeProjectId]: f }));
                  }}
                />
              </div>
              <div className="sidebar-resize-handle" onMouseDown={handleResizeStart} />
            </>
          )}

          {/* Sidebar: about */}
          {topTab === "about" && (
            <>
              <div className="sidebar" style={{ width: sidebarWidth }}>
                <div className="about-sidebar">
                  <div className="about-sidebar-body">
                    <div className="about-section-item">About</div>
                  </div>
                </div>
              </div>
              <div className="sidebar-resize-handle" onMouseDown={handleResizeStart} />
            </>
          )}

          {/* Editor area: explorer / note / about / none */}
          {(topTab === "explorer" || topTab === null || topTab === "note" || topTab === "about") && (
            <div className="main-area">
              {topTab === "about" ? (
                <div className="about-main">
                  <div className="about-main-body">
                    <div className="about-app-name">vibeTerminals</div>
                    <div className="about-version">Version 0.1.0</div>
                    <div className="about-desc">
                      A vibe coding workstation — terminal, notes, and git side by side,
                      so you can prompt, edit, and ship without leaving the flow.
                    </div>
                  </div>
                </div>
              ) : topTab === "note" ? (
                (() => {
                  const filtered = activeNotes.filter((n) => n.type === activeNoteFilter);
                  return (
                    <div className="note-main">
                      <div className="note-main-header">
                        <span className="note-main-title">
                          {activeNoteFilter === "task" ? "Task Notes" : "Prompt Notes"}
                        </span>
                        <button className="note-add-btn" onClick={() => handleAddNote(activeNoteFilter)}>
                          + Add Note
                        </button>
                      </div>
                      <NoteCardList
                        notes={filtered}
                        onUpdate={handleUpdateNote}
                        onDelete={handleDeleteNote}
                        onReorder={handleReorderNotes}
                      />
                    </div>
                  );
                })()
              ) : (
                tabs.length === 0 ? (
                  <WelcomeScreen />
                ) : (
                  <>
                    <TabBar
                      tabs={tabs}
                      activeTabId={activeTabId}
                      onSelectTab={setActiveTabId}
                      onCloseTab={handleCloseTab}
                    />

                    <div className="editor-area">
                      <EditorPanel
                        tab={activeTab}
                        getDirtyContent={getDirtyContent}
                        onChange={handleContentChange}
                      />
                    </div>
                  </>
                )
              )}
            </div>
          )}

          {/* Git page: split layout — left=changes, right=graph */}
          {topTab === "git" && (
            <div className="git-page">
              <div className="git-page-left" style={{ width: gitLeftWidth }}>
                {gitStatus ? (
                  <GitPanel
                    entries={gitStatus.entries}
                    stagedCount={gitStatus.staged_count}
                    unstagedCount={gitStatus.unstaged_count}
                    untrackedCount={gitStatus.untracked_count}
                    aheadCount={gitAhead}
                    onDiscardAll={handleDiscardAll}
                    onCommit={handleCommit}
                  />
                ) : (
                  <div className="project-empty-state">
                    <p>Not a git repository</p>
                  </div>
                )}
              </div>
              <div
                className="git-graph-resize-handle"
                onMouseDown={(e) => { e.preventDefault(); setResizingGit(true); }}
              />
              <div className="git-page-right">
                {gitLog ? (
                  <GitGraph log={gitLog} />
                ) : (
                  <div className="git-graph">
                    <div className="git-graph-empty">Loading...</div>
                  </div>
                )}
              </div>
            </div>
          )}

        </div>

        {/* Per-project terminals — always mounted, hidden via CSS when inactive.
            This preserves PTY state when switching between projects. */}
        <div className="terminal-area" style={showTerminal ? undefined : { display: "none" }}>
          {projectsForTerminals.map((p) => {
            const active = showTerminal && p.id === activeProjectId;
            return (
              <div
                key={`tc-${p.id}`}
                style={active ? { display: "contents" } : { display: "none" }}
              >
                <TerminalContainer
                  projectId={p.id}
                  cwd={p.path}
                  visible={active}
                  fullscreen
                  notes={notes[p.id] ?? []}
                  onToggleVisible={() => { if (activeProjectId) projectTopTabsRef.current[activeProjectId] = null; setTopTab(null); }}
                  onRegisterReload={(fn) => { terminalReloadRef.current.set(p.id, fn); }}
                  globalShell={terminalShellRef.current.get(p.id) ?? "powershell"}
                  onShellChange={(shell) => {
                    terminalShellRef.current.set(p.id, shell);
                    setShellTick((n) => n + 1);
                  }}
                />
              </div>
            );
          })}
        </div>
      </div>

      {showPalette && (
        <CommandPalette commands={commands} onClose={() => setShowPalette(false)} />
      )}

      {projectDeleteTarget && (
        <ConfirmDialog
          open
          title="Delete project?"
          message="This removes the project from the sidebar and closes its open tabs."
          confirmLabel="Delete project"
          onConfirm={handleConfirmDeleteProject}
          onCancel={handleCancelDeleteProject}
        >
          <div className="confirm-dialog-body-name">{projectDeleteTarget.name}</div>
          <div className="confirm-dialog-body-path">{projectDeleteTarget.path}</div>
        </ConfirmDialog>
      )}

      {closingTab && (
        <ConfirmDialog
          open
          title={`"${closingTab.title}" has unsaved changes.`}
          message="Close anyway?"
          confirmLabel="Close"
          onConfirm={handleConfirmCloseTab}
          onCancel={handleCancelCloseTab}
        />
      )}
    </div>
  );
}

export default App;
