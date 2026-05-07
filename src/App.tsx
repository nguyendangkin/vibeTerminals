import { useState, useCallback, useEffect, useRef, type MouseEvent as RMouseEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { EditorTab, DirEntry, Project, WorkspaceState } from "./types";
import { TabBar } from "./components/TabBar";
import { EditorPanel } from "./components/EditorPanel";
import { FileTree } from "./components/FileTree";
import { SearchPanel } from "./components/SearchPanel";
import { CommandPalette } from "./components/CommandPalette";
import { GitPanel } from "./components/GitPanel";
import { ProjectBar } from "./components/ProjectBar";
import { TopBar, type TopTab } from "./components/TopBar";
import { TerminalContainer } from "./components/TerminalContainer";
import "./App.css";

let tabCounter = 0;
let projectCounter = 0;

const STORAGE_KEY = "tertito_persist";

const LANG_MAP: Record<string, string> = {
  js: "javascript", jsx: "javascript", ts: "typescript", tsx: "typescript",
  json: "json", html: "html", htm: "html", css: "css",
  rs: "rust", py: "python", md: "markdown", xml: "xml",
};

interface PersistedWorkspace {
  tabPaths: string[];
  activeTabPath: string | null;
}

interface PersistedState {
  projects: { id: string; path: string; name: string }[];
  activeProjectId: string | null;
  workspaces: Record<string, PersistedWorkspace>;
  topTab?: TopTab | null;
}

function emptyWorkspace(): WorkspaceState {
  return { tabs: [], activeTabId: null };
}

function App() {
  // ── multi-project state ───────────────────────────────────────────────────
  const [projects, setProjects] = useState<Project[]>([]);
  const [workspaces, setWorkspaces] = useState<Record<string, WorkspaceState>>({});
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);

  // Derived from active project/workspace
  const activeProject = projects.find((p) => p.id === activeProjectId) ?? null;
  const activeWorkspace = activeProjectId ? (workspaces[activeProjectId] ?? emptyWorkspace()) : emptyWorkspace();
  const tabs = activeWorkspace.tabs;
  const activeTabId = activeWorkspace.activeTabId;
  const rootPath = activeProject?.path ?? null;
  const fileTree = activeProject?.fileTree ?? [];
  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null;

  // ── ui state ──────────────────────────────────────────────────────────────
  const [topTab, setTopTab] = useState<TopTab | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(240);
  const [resizingSidebar, setResizingSidebar] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [showPalette, setShowPalette] = useState(false);

  const sidebarVisible = topTab === "explorer" || topTab === "git";
  const showTerminal = topTab === "terminal";

  const shellRef = useRef<HTMLDivElement>(null);
  const hasRestoredRef = useRef(false);

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
          const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
          const tab: EditorTab = { id: `tab_${++tabCounter}`, title: fileName, path: tabPath, content, dirty: false, language: LANG_MAP[ext] ?? "plaintext" };
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
        if (saved.topTab !== undefined) {
          setTopTab(saved.topTab ?? "explorer");
        } else {
          setTopTab("explorer");
        }
      }
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
      topTab,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [projects, workspaces, activeProjectId, topTab]);

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
      const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
      const tab = createTab(fileName, filePath, content, LANG_MAP[ext] ?? "plaintext");
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
    setWorkspaces((prev) => {
      const next = { ...prev };
      delete next[projectId];
      return next;
    });
    if (activeProjectId === projectId) {
      const fallback = remaining[Math.min(idx, remaining.length - 1)];
      setActiveProjectId(fallback?.id ?? null);
    }
  }, [projects, activeProjectId]);

  const handleDeleteEntry = useCallback(async (path: string) => {
    if (!activeProjectId || !rootPath) return;
    try {
      await invoke("delete_file", { path });
      updateWorkspace(activeProjectId, (ws) => {
        const nextTabs = ws.tabs.filter((t) => t.path !== path);
        const deletedId = ws.tabs.find((t) => t.path === path)?.id;
        const idx = ws.tabs.findIndex((t) => t.id === deletedId);
        return {
          ...ws,
          tabs: nextTabs,
          activeTabId: ws.activeTabId === deletedId
            ? (nextTabs[Math.min(idx, nextTabs.length - 1)]?.id ?? null)
            : ws.activeTabId,
        };
      });
      await refreshProjectTree(activeProjectId, rootPath);
    } catch (err) { console.error(err); }
  }, [activeProjectId, rootPath, updateWorkspace, refreshProjectTree]);

  const handleRenameEntry = useCallback(async (oldPath: string, newName: string) => {
    if (!activeProjectId || !rootPath) return;
    try {
      const parent = oldPath.replace(/[/\\][^/\\]*$/, "");
      const newPath = parent + "/" + newName;
      await invoke("rename_entry", { oldPath, newPath });
      updateWorkspace(activeProjectId, (ws) => ({
        ...ws,
        tabs: ws.tabs.map((t) => t.path === oldPath ? { ...t, path: newPath, title: newName } : t),
      }));
      await refreshProjectTree(activeProjectId, rootPath);
    } catch (err) { console.error(err); }
  }, [activeProjectId, rootPath, updateWorkspace, refreshProjectTree]);

  // ── tab actions ───────────────────────────────────────────────────────────
  const handleNewTab = useCallback(() => {
    if (!activeProjectId) return;
    const tab = createTab("untitled", null, "", "plaintext");
    updateWorkspace(activeProjectId, (ws) => ({ ...ws, tabs: [...ws.tabs, tab], activeTabId: tab.id }));
  }, [activeProjectId, createTab, updateWorkspace]);

  const handleCloseTab = useCallback((id: string) => {
    if (!activeProjectId) return;
    updateWorkspace(activeProjectId, (ws) => {
      const idx = ws.tabs.findIndex((t) => t.id === id);
      const next = ws.tabs.filter((t) => t.id !== id);
      return {
        ...ws,
        tabs: next,
        activeTabId: ws.activeTabId === id ? (next[Math.min(idx, next.length - 1)]?.id ?? null) : ws.activeTabId,
      };
    });
  }, [activeProjectId, updateWorkspace]);

  const handleSaveFile = useCallback(async () => {
    if (!activeTab || !activeProjectId) return;
    let savePath = activeTab.path;
    if (!savePath) {
      try { savePath = await invoke<string | null>("save_file_dialog"); }
      catch { return; }
      if (!savePath) return;
    }
    try {
      await invoke("write_file_content", { path: savePath, content: activeTab.content });
      updateWorkspace(activeProjectId, (ws) => ({
        ...ws,
        tabs: ws.tabs.map((t) =>
          t.id === activeTab.id
            ? { ...t, path: savePath!, title: savePath!.split(/[/\\]/).pop() ?? t.title, dirty: false }
            : t),
      }));
      if (rootPath) await refreshProjectTree(activeProjectId, rootPath);
    } catch (err) { console.error(err); }
  }, [activeTab, activeProjectId, rootPath, updateWorkspace, refreshProjectTree]);

  const handleContentChange = useCallback((content: string) => {
    if (!activeProjectId || !activeTabId) return;
    updateWorkspace(activeProjectId, (ws) => ({
      ...ws,
      tabs: ws.tabs.map((t) => t.id === activeTabId ? { ...t, content, dirty: true } : t),
    }));
  }, [activeProjectId, activeTabId, updateWorkspace]);

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

  // ── top bar & panel handlers ─────────────────────────────────────────────
  const handleTopTab = useCallback((tab: TopTab) => {
    setTopTab((prev) => (prev === tab ? null : tab));
  }, []);

  const handleSelectProject = useCallback((id: string) => {
    if (activeProjectId === id && topTab === "explorer") {
      setTopTab(null);
    } else {
      setActiveProjectId(id);
      setTopTab("explorer");
    }
  }, [activeProjectId, topTab]);

  const handleToggleGit = useCallback(() => {
    setTopTab((prev) => (prev === "git" ? null : "git"));
  }, []);

  // ── keyboard shortcuts ────────────────────────────────────────────────────
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    const ctrl = e.ctrlKey || e.metaKey;
    const shift = e.shiftKey;
    const key = e.key.toLowerCase();
    if (ctrl && shift && key === "p") { e.preventDefault(); setShowPalette(true); return; }
    if (ctrl && shift && key === "f") { e.preventDefault(); setShowSearch(true); return; }
    if (ctrl && shift && key === "g") { e.preventDefault(); handleToggleGit(); return; }
    if (ctrl && shift && key === "e") { e.preventDefault(); setTopTab((prev) => (prev === "explorer" ? null : "explorer")); return; }
    if (ctrl && key === "tab") {
      e.preventDefault();
      if (tabs.length < 2) return;
      const idx = tabs.findIndex((t) => t.id === activeTabId);
      setActiveTabId(tabs[(idx + (shift ? -1 : 1) + tabs.length) % tabs.length].id);
      return;
    }
    if (ctrl && key === "`") { e.preventDefault(); setTopTab((prev) => (prev === "terminal" ? null : "terminal")); return; }
    if (ctrl) {
      switch (key) {
        case "o": e.preventDefault(); handleAddProject(); break;
        case "s": e.preventDefault(); handleSaveFile(); break;
        case "n": e.preventDefault(); handleNewTab(); break;
        case "p": e.preventDefault();
          invoke<string | null>("pick_file").then((p) => { if (p) openFileInTab(p); }).catch(() => {});
          break;
        case "w": e.preventDefault(); activeTabId && handleCloseTab(activeTabId); break;
      }
    }
  }, [tabs, activeTabId, handleAddProject, handleSaveFile,
      handleNewTab, handleCloseTab, openFileInTab, handleToggleGit,
      setActiveTabId]);

  // ── command palette entries ───────────────────────────────────────────────
  const commands = [
    { id: "open-folder", label: "Add Project Folder", shortcut: "Ctrl+O", action: handleAddProject },
    { id: "save", label: "Save File", shortcut: "Ctrl+S", action: handleSaveFile },
    { id: "new-tab", label: "New Tab", shortcut: "Ctrl+N", action: handleNewTab },
    { id: "close-tab", label: "Close Tab", shortcut: "Ctrl+W", action: () => activeTabId && handleCloseTab(activeTabId) },
    { id: "search", label: "Search in Files", shortcut: "Ctrl+Shift+F", action: () => setShowSearch(true) },
    { id: "toggle-terminal", label: "Toggle Terminal", shortcut: "Ctrl+`", action: () => setTopTab((prev) => (prev === "terminal" ? null : "terminal")) },
    { id: "git-panel", label: "Source Control", shortcut: "Ctrl+Shift+G", action: handleToggleGit },
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
        activeTopTab={topTab}
        onSelectProject={handleSelectProject}
        onCloseProject={handleCloseProject}
        onAddProject={handleAddProject}
      />

      {/* Right area: top bar + content */}
      <div className="right-area">
        <TopBar activeTab={topTab} onTabClick={handleTopTab} />

        <div className="content-area" style={topTab === "terminal" ? { display: "none" } : undefined}>
          {/* Sidebar (explorer / git) */}
          {sidebarVisible && (
            <>
              <div className="sidebar" style={{ width: sidebarWidth }}>
                <div className="sidebar-header">
                  <span className="sidebar-header-title">
                    {topTab === "explorer" ? "Explorer" : "Source Control"}
                  </span>
                  {topTab === "explorer" && activeProject && (
                    <span className="sidebar-header-project">{activeProject.name}</span>
                  )}
                </div>

                {topTab === "explorer" && (
                  activeProject ? (
                    <FileTree
                      rootPath={rootPath}
                      tree={fileTree}
                      onOpenFile={openFileInTab}
                      onDeleteEntry={handleDeleteEntry}
                      onRenameEntry={handleRenameEntry}
                    />
                  ) : (
                    <div className="project-empty-state">
                      <p>No folder opened</p>
                      <button className="project-open-btn" onClick={handleAddProject}>
                        Open Folder
                      </button>
                    </div>
                  )
                )}

                {topTab === "git" && <GitPanel rootPath={rootPath} />}
              </div>
              <div className="sidebar-resize-handle" onMouseDown={handleResizeStart} />
            </>
          )}

          {/* Main editor area */}
          <div className="main-area">
            {showSearch && (
              <SearchPanel
                rootPath={rootPath}
                onOpenFile={(p) => { openFileInTab(p); setShowSearch(false); }}
                onClose={() => setShowSearch(false)}
              />
            )}

            <TabBar
              tabs={tabs}
              activeTabId={activeTabId}
              onSelectTab={setActiveTabId}
              onCloseTab={handleCloseTab}
              onNewTab={handleNewTab}
            />

            <div className="editor-area">
              <EditorPanel tab={activeTab} onChange={handleContentChange} />
            </div>
          </div>
        </div>

        {/* Per-project terminals — always mounted, hidden via CSS when inactive */}
        {projects.map((p) => {
          const active = showTerminal && p.id === activeProjectId;
          return (
            <div
              key={`tc-${p.id}`}
              style={active ? { display: "contents" } : { display: "none" }}
            >
              <TerminalContainer
                cwd={p.path}
                visible={active}
                fullscreen
                onToggleVisible={() => setTopTab(null)}
              />
            </div>
          );
        })}
      </div>

      {showPalette && (
        <CommandPalette commands={commands} onClose={() => setShowPalette(false)} />
      )}
    </div>
  );
}

export default App;
