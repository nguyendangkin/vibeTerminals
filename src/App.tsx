import { useState, useCallback, useEffect, useRef, type MouseEvent as RMouseEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { EditorTab, DirEntry } from "./types";
import { TabBar } from "./components/TabBar";
import { EditorPanel } from "./components/EditorPanel";
import { FileTree } from "./components/FileTree";
import { SearchPanel } from "./components/SearchPanel";
import { CommandPalette } from "./components/CommandPalette";
import { Minimap } from "./components/Minimap";
import { GitPanel } from "./components/GitPanel";
import { ActivityBar, type SidebarTab } from "./components/ActivityBar";
import { TerminalContainer } from "./components/TerminalContainer";
import "./App.css";

let tabCounter = 0;

function App() {
  // ── editor state ─────────────────────────────────────────────────────────
  const [tabs, setTabs] = useState<EditorTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [splitTabId, setSplitTabId] = useState<string | null>(null);
  const [dark, setDark] = useState(true);
  const [showMinimap, setShowMinimap] = useState(true);

  // ── workspace ─────────────────────────────────────────────────────────────
  const [rootPath, setRootPath] = useState<string | null>(null);
  const [fileTree, setFileTree] = useState<DirEntry[]>([]);

  // ── sidebar ───────────────────────────────────────────────────────────────
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>("files");
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(240);
  const [resizingSidebar, setResizingSidebar] = useState(false);

  // ── overlays ──────────────────────────────────────────────────────────────
  const [showSearch, setShowSearch] = useState(false);
  const [showPalette, setShowPalette] = useState(false);

  // ── terminal ──────────────────────────────────────────────────────────────
  const [showTerminal, setShowTerminal] = useState(false);

  const shellRef = useRef<HTMLDivElement>(null);
  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null;
  const splitTab = splitTabId ? (tabs.find((t) => t.id === splitTabId) ?? null) : null;

  // ── file system ──────────────────────────────────────────────────────────
  const createTab = useCallback(
    (title: string, path: string | null, content: string, language: string): EditorTab =>
      ({ id: `tab_${++tabCounter}`, title, path, content, dirty: false, language }),
    [],
  );

  const refreshFileTree = useCallback(async (p: string) => {
    try { setFileTree(await invoke<DirEntry[]>("list_dir", { path: p })); }
    catch (err) { console.error(err); }
  }, []);

  const openFileInTab = useCallback(async (filePath: string) => {
    const existing = tabs.find((t) => t.path === filePath);
    if (existing) { setActiveTabId(existing.id); return; }
    try {
      const content = await invoke<string>("read_file_content", { path: filePath });
      const fileName = filePath.split(/[/\\]/).pop() ?? "untitled";
      const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
      const langMap: Record<string, string> = {
        js: "javascript", jsx: "javascript", ts: "typescript", tsx: "typescript",
        json: "json", html: "html", htm: "html", css: "css",
        rs: "rust", py: "python", md: "markdown", xml: "xml",
      };
      const tab = createTab(fileName, filePath, content, langMap[ext] ?? "plaintext");
      setTabs((p) => [...p, tab]);
      setActiveTabId(tab.id);
    } catch (err) { console.error("Failed to open file:", err); }
  }, [tabs, createTab]);

  const handleOpenFolder = useCallback(async () => {
    try {
      const path = await invoke<string | null>("pick_folder");
      if (!path) return;
      setRootPath(path);
      await refreshFileTree(path);
    } catch (err) { console.error(err); }
  }, [refreshFileTree]);

  useEffect(() => { handleOpenFolder(); }, []); // eslint-disable-line

  const handleDeleteEntry = useCallback(async (path: string) => {
    try {
      await invoke("delete_file", { path });
      setTabs((p) => p.filter((t) => t.path !== path));
      if (rootPath) await refreshFileTree(rootPath);
    } catch (err) { console.error(err); }
  }, [rootPath, refreshFileTree]);

  const handleRenameEntry = useCallback(async (oldPath: string, newName: string) => {
    try {
      const parent = oldPath.replace(/[/\\][^/\\]*$/, "");
      const newPath = parent + "/" + newName;
      await invoke("rename_entry", { oldPath, newPath });
      setTabs((p) => p.map((t) =>
        t.path === oldPath ? { ...t, path: newPath, title: newName } : t));
      if (rootPath) await refreshFileTree(rootPath);
    } catch (err) { console.error(err); }
  }, [rootPath, refreshFileTree]);

  // ── tab actions ──────────────────────────────────────────────────────────
  const handleNewTab = useCallback(() => {
    const tab = createTab("untitled", null, "", "plaintext");
    setTabs((p) => [...p, tab]);
    setActiveTabId(tab.id);
  }, [createTab]);

  const handleCloseTab = useCallback((id: string) => {
    setTabs((prev) => {
      const idx = prev.findIndex((t) => t.id === id);
      const next = prev.filter((t) => t.id !== id);
      if (activeTabId === id) setActiveTabId(next[Math.min(idx, next.length - 1)]?.id ?? null);
      if (splitTabId === id) setSplitTabId(null);
      return next;
    });
  }, [activeTabId, splitTabId]);

  const handleSaveFile = useCallback(async () => {
    if (!activeTab) return;
    let savePath = activeTab.path;
    if (!savePath) {
      try { savePath = await invoke<string | null>("save_file_dialog"); }
      catch { return; }
      if (!savePath) return;
    }
    try {
      await invoke("write_file_content", { path: savePath, content: activeTab.content });
      setTabs((p) => p.map((t) =>
        t.id === activeTab.id
          ? { ...t, path: savePath!, title: savePath!.split(/[/\\]/).pop() ?? t.title, dirty: false }
          : t));
      if (rootPath) await refreshFileTree(rootPath);
    } catch (err) { console.error(err); }
  }, [activeTab, rootPath, refreshFileTree]);

  const handleContentChange = useCallback((content: string) => {
    if (!activeTabId) return;
    setTabs((p) => p.map((t) => t.id === activeTabId ? { ...t, content, dirty: true } : t));
  }, [activeTabId]);

  const handleSplitContentChange = useCallback((content: string) => {
    if (!splitTabId) return;
    setTabs((p) => p.map((t) => t.id === splitTabId ? { ...t, content, dirty: true } : t));
  }, [splitTabId]);

  // ── sidebar resize ───────────────────────────────────────────────────────
  const handleResizeStart = useCallback((e: RMouseEvent) => {
    e.preventDefault(); setResizingSidebar(true);
  }, []);

  useEffect(() => {
    if (!resizingSidebar) return;
    const onMove = (e: MouseEvent) => setSidebarWidth(Math.max(160, Math.min(500, e.clientX - 48)));
    const onUp = () => setResizingSidebar(false);
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => { document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp); };
  }, [resizingSidebar]);

  // ── activity bar ─────────────────────────────────────────────────────────
  const handleActivityClick = useCallback((tab: SidebarTab) => {
    if (sidebarTab === tab && sidebarVisible) {
      setSidebarVisible(false);
    } else {
      setSidebarTab(tab);
      setSidebarVisible(true);
    }
  }, [sidebarTab, sidebarVisible]);

  // ── keyboard shortcuts ───────────────────────────────────────────────────
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    const ctrl = e.ctrlKey || e.metaKey;
    const shift = e.shiftKey;
    const key = e.key.toLowerCase();
    if (ctrl && shift && key === "p") { e.preventDefault(); setShowPalette(true); return; }
    if (ctrl && shift && key === "f") { e.preventDefault(); setShowSearch(true); return; }
    if (ctrl && shift && key === "g") { e.preventDefault(); handleActivityClick("git"); return; }
    if (ctrl && shift && key === "e") { e.preventDefault(); handleActivityClick("files"); return; }
    if (ctrl && key === "tab") {
      e.preventDefault();
      if (tabs.length < 2) return;
      const idx = tabs.findIndex((t) => t.id === activeTabId);
      setActiveTabId(tabs[(idx + (shift ? -1 : 1) + tabs.length) % tabs.length].id);
      return;
    }
    if (ctrl && key === "`") { e.preventDefault(); setShowTerminal((v) => !v); return; }
    if (ctrl && key === "\\") {
      e.preventDefault();
      splitTabId ? setSplitTabId(null) : setSplitTabId(activeTabId);
      return;
    }
    if (ctrl) {
      switch (key) {
        case "o": e.preventDefault(); handleOpenFolder(); break;
        case "s": e.preventDefault(); handleSaveFile(); break;
        case "n": e.preventDefault(); handleNewTab(); break;
        case "p": e.preventDefault();
          invoke<string | null>("pick_file").then((p) => { if (p) openFileInTab(p); }).catch(() => {});
          break;
        case "w": e.preventDefault(); activeTabId && handleCloseTab(activeTabId); break;
      }
    }
  }, [tabs, activeTabId, splitTabId, handleOpenFolder, handleSaveFile,
      handleNewTab, handleCloseTab, openFileInTab, handleActivityClick]);

  useEffect(() => { document.documentElement.classList.toggle("light", !dark); }, [dark]);

  // ── command palette entries ──────────────────────────────────────────────
  const commands = [
    { id: "open-folder", label: "Open Folder", shortcut: "Ctrl+O", action: handleOpenFolder },
    { id: "save", label: "Save File", shortcut: "Ctrl+S", action: handleSaveFile },
    { id: "new-tab", label: "New Tab", shortcut: "Ctrl+N", action: handleNewTab },
    { id: "close-tab", label: "Close Tab", shortcut: "Ctrl+W", action: () => activeTabId && handleCloseTab(activeTabId) },
    { id: "search", label: "Search in Files", shortcut: "Ctrl+Shift+F", action: () => setShowSearch(true) },
    { id: "toggle-theme", label: "Toggle Dark/Light Theme", action: () => setDark((d) => !d) },
    { id: "split-editor", label: "Split Editor", shortcut: "Ctrl+\\", action: () => splitTabId ? setSplitTabId(null) : setSplitTabId(activeTabId) },
    { id: "toggle-minimap", label: "Toggle Minimap", action: () => setShowMinimap((v) => !v) },
    { id: "toggle-terminal", label: "Toggle Terminal", shortcut: "Ctrl+`", action: () => setShowTerminal((v) => !v) },
    { id: "git-panel", label: "Source Control", shortcut: "Ctrl+Shift+G", action: () => handleActivityClick("git") },
  ];

  // ── render ────────────────────────────────────────────────────────────────
  return (
    <div
      className={`app-shell${resizingSidebar ? " app-resizing" : ""}`}
      ref={shellRef}
      onKeyDown={handleKeyDown}
      tabIndex={0}
    >
      {/* Activity bar */}
      <ActivityBar
        activeTab={sidebarVisible ? sidebarTab : null}
        onTabClick={handleActivityClick}
      />

      {/* Sidebar */}
      {sidebarVisible && (
        <>
          <div className="sidebar" style={{ width: sidebarWidth }}>
            <div className="sidebar-header">
              <span className="sidebar-header-title">
                {sidebarTab === "files" ? "Explorer" : sidebarTab === "git" ? "Source Control" : "Files"}
              </span>
              {sidebarTab === "files" && (
                <button className="sidebar-header-btn" onClick={handleOpenFolder} title="Open Folder">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 5v14M5 12h14"/>
                  </svg>
                </button>
              )}
            </div>
            {sidebarTab === "files" && (
              <FileTree
                rootPath={rootPath}
                tree={fileTree}
                onOpenFile={(p) => { openFileInTab(p); }}
                onDeleteEntry={handleDeleteEntry}
                onRenameEntry={handleRenameEntry}
              />
            )}
            {sidebarTab === "git" && <GitPanel rootPath={rootPath} />}
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

        {/* Editor(s) */}
        {splitTabId ? (
          <div className="split-container">
            <div className="split-pane">
              <div className="split-pane-header">
                <span>{activeTab?.title ?? "No file"}</span>
                <button className="split-close-btn" onClick={() => setSplitTabId(null)}>×</button>
              </div>
              <EditorPanel tab={activeTab} dark={dark} onChange={handleContentChange} />
            </div>
            <div className="split-pane">
              <div className="split-pane-header">
                <span>{splitTab?.title ?? "No file"}</span>
              </div>
              <EditorPanel tab={splitTab} dark={dark} onChange={handleSplitContentChange} />
            </div>
          </div>
        ) : (
          <div className="editor-with-minimap">
            <EditorPanel tab={activeTab} dark={dark} onChange={handleContentChange} />
            {showMinimap && activeTab && <Minimap tab={activeTab} dark={dark} />}
          </div>
        )}

        {/* Terminal */}
        {showTerminal && (
          <TerminalContainer
            cwd={rootPath}
            visible={showTerminal}
            onToggleVisible={() => setShowTerminal(false)}
          />
        )}

        {/* Quick action bar */}
        <div className="action-bar">
          <button className="action-btn" onClick={() => setDark((d) => !d)} title="Toggle Theme (light/dark)">
            {dark
              ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>
              : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
            }
          </button>
          <button className="action-btn" onClick={() => splitTabId ? setSplitTabId(null) : setSplitTabId(activeTabId)} title="Split Editor (Ctrl+\)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="18" height="18" rx="2"/><line x1="12" y1="3" x2="12" y2="21"/>
            </svg>
          </button>
          <button className="action-btn" onClick={() => setShowMinimap((v) => !v)} title="Toggle Minimap">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="18" height="18" rx="2"/><rect x="15" y="3" width="6" height="18" rx="1" opacity="0.5"/>
            </svg>
          </button>
          <button className="action-btn" onClick={() => setShowTerminal((v) => !v)} title="Toggle Terminal (Ctrl+`)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>
            </svg>
          </button>
        </div>
      </div>

      {showPalette && (
        <CommandPalette commands={commands} onClose={() => setShowPalette(false)} />
      )}
    </div>
  );
}

export default App;
