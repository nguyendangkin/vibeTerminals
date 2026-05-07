import { useState, useCallback, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { EditorTab, DirEntry } from "./types";
import { TabBar } from "./components/TabBar";
import { EditorPanel } from "./components/EditorPanel";
import { FileTree } from "./components/FileTree";
import { SearchPanel } from "./components/SearchPanel";
import { CommandPalette } from "./components/CommandPalette";
import { StatusBar } from "./components/StatusBar";
import { Minimap } from "./components/Minimap";
import { TerminalPanel } from "./components/TerminalPanel";
import { GitPanel } from "./components/GitPanel";
import "./App.css";

let tabCounter = 0;

function App() {
  const [tabs, setTabs] = useState<EditorTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [rootPath, setRootPath] = useState<string | null>(null);
  const [fileTree, setFileTree] = useState<DirEntry[]>([]);
  const [showSearch, setShowSearch] = useState(false);
  const [showPalette, setShowPalette] = useState(false);
  const [dark, setDark] = useState(true);
  const [cursorLine, setCursorLine] = useState(1);
  const [cursorCol, setCursorCol] = useState(1);
  const [showMinimap, setShowMinimap] = useState(true);
  const [showTerminal, setShowTerminal] = useState(false);
  const [terminalHeight, setTerminalHeight] = useState(250);
  const [terminalSplitCount, setTerminalSplitCount] = useState(1); // 1 or 2
  const [terminalSplitRatio, setTerminalSplitRatio] = useState(0.5); // left pane fraction
  const [sidebarTab, setSidebarTab] = useState<"files" | "git">("files");
  const [gitBranch, setGitBranch] = useState<string>("");
  const [terminalShell, setTerminalShell] = useState<string>(
    () => localStorage.getItem("terminalShell") || ""
  );

  // Split state: null = no split, { tabId: string } = split active
  const [splitTabId, setSplitTabId] = useState<string | null>(null);

  const shellRef = useRef<HTMLDivElement>(null);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const splitContainerRef = useRef<HTMLDivElement>(null);
  const [sidebarWidth, setSidebarWidth] = useState(240);
  const [resizing, setResizing] = useState(false);

  const activeTab = tabs.find((t) => t.id === activeTabId) || null;
  const splitTab = splitTabId ? tabs.find((t) => t.id === splitTabId) || null : null;

  const createTab = useCallback(
    (title: string, path: string | null, content: string, language: string): EditorTab => {
      return { id: `tab_${++tabCounter}`, title, path, content, dirty: false, language };
    },
    [],
  );

  const openFileInTab = useCallback(
    async (filePath: string) => {
      try {
        const existing = tabs.find((t) => t.path === filePath);
        if (existing) {
          setActiveTabId(existing.id);
          return;
        }
        const content = await invoke<string>("read_file_content", { path: filePath });
        const fileName = filePath.split(/[/\\]/).pop() || "untitled";
        const ext = fileName.split(".").pop()?.toLowerCase();
        const langMap: Record<string, string> = {
          js: "javascript", jsx: "javascript", ts: "typescript", tsx: "typescript",
          json: "json", html: "html", htm: "html", css: "css",
          rs: "rust", py: "python", md: "markdown", xml: "xml",
        };
        const lang = langMap[ext || ""] || "plaintext";
        const tab = createTab(fileName, filePath, content, lang);
        setTabs((prev) => [...prev, tab]);
        setActiveTabId(tab.id);
      } catch (err) {
        console.error("Failed to open file:", err);
      }
    },
    [tabs, createTab],
  );

  const refreshFileTree = useCallback(async (folderPath: string) => {
    try {
      const tree = await invoke<DirEntry[]>("list_dir", { path: folderPath });
      setFileTree(tree);
    } catch (err) {
      console.error("Failed to list directory:", err);
    }
  }, []);

  const handleOpenFolder = useCallback(async () => {
    try {
      const path = await invoke<string | null>("pick_folder");
      if (!path) return;
      setRootPath(path);
      await refreshFileTree(path);
    } catch (err) {
      console.error("Failed to open folder:", err);
    }
  }, [refreshFileTree]);

  useEffect(() => { handleOpenFolder(); }, []); // eslint-disable-line

  // Fetch git branch for status bar
  useEffect(() => {
    if (!rootPath) { setGitBranch(""); return; }
    let active = true;
    const fetchBranch = async () => {
      try {
        const repo: boolean = await invoke("git_has_repo", { path: rootPath });
        if (!repo) { if (active) setGitBranch(""); return; }
        const branch: string = await invoke("git_current_branch", { repoPath: rootPath });
        if (active) setGitBranch(branch);
      } catch { if (active) setGitBranch(""); }
    };
    fetchBranch();
    return () => { active = false; };
  }, [rootPath]);

  const handleDeleteEntry = useCallback(async (path: string) => {
    try {
      await invoke("delete_file", { path });
      setTabs((prev) => prev.filter((t) => t.path !== path));
      if (rootPath) await refreshFileTree(rootPath);
    } catch (err) { console.error("Failed to delete:", err); }
  }, [rootPath, refreshFileTree]);

  const handleRenameEntry = useCallback(async (oldPath: string, newName: string) => {
    try {
      const parent = oldPath.replace(/[/\\][^/\\]*$/, "");
      const newPath = parent + (parent.endsWith("/") || parent.endsWith("\\") ? "" : "/") + newName;
      await invoke("rename_entry", { oldPath, newPath });
      setTabs((prev) => prev.map((t) =>
        t.path === oldPath ? { ...t, path: newPath, title: newName } : t));
      if (rootPath) await refreshFileTree(rootPath);
    } catch (err) { console.error("Failed to rename:", err); }
  }, [rootPath, refreshFileTree]);

  const handleNewTab = useCallback(() => {
    const tab = createTab("untitled", null, "", "plaintext");
    setTabs((prev) => [...prev, tab]);
    setActiveTabId(tab.id);
  }, [createTab]);

  const handleSelectTab = useCallback((id: string) => setActiveTabId(id), []);

  const handleCloseTab = useCallback((id: string) => {
    setTabs((prev) => {
      const idx = prev.findIndex((t) => t.id === id);
      const next = prev.filter((t) => t.id !== id);
      if (activeTabId === id) {
        const newIdx = Math.min(idx, next.length - 1);
        setActiveTabId(next[newIdx]?.id || null);
      }
      if (splitTabId === id) setSplitTabId(null);
      return next;
    });
  }, [activeTabId, splitTabId]);

  const handleCloseActiveTab = useCallback(() => {
    if (activeTabId) handleCloseTab(activeTabId);
  }, [activeTabId, handleCloseTab]);

  const handleNextTab = useCallback(() => {
    if (tabs.length < 2) return;
    const idx = tabs.findIndex((t) => t.id === activeTabId);
    setActiveTabId(tabs[(idx + 1) % tabs.length].id);
  }, [tabs, activeTabId]);

  const handlePrevTab = useCallback(() => {
    if (tabs.length < 2) return;
    const idx = tabs.findIndex((t) => t.id === activeTabId);
    setActiveTabId(tabs[(idx - 1 + tabs.length) % tabs.length].id);
  }, [tabs, activeTabId]);

  const handleOpenFileDialog = useCallback(async () => {
    try {
      const path = await invoke<string | null>("pick_file");
      if (!path) return;
      await openFileInTab(path);
    } catch (err) { console.error("Failed to open file:", err); }
  }, [openFileInTab]);

  const handleSaveFile = useCallback(async () => {
    if (!activeTab) return;
    let savePath = activeTab.path;
    if (!savePath) {
      try { savePath = await invoke<string | null>("save_file_dialog"); } catch { return; }
      if (!savePath) return;
    }
    try {
      await invoke("write_file_content", { path: savePath, content: activeTab.content });
      setTabs((prev) => prev.map((t) =>
        t.id === activeTab.id
          ? { ...t, path: savePath!, title: savePath!.split(/[/\\]/).pop() || t.title, dirty: false }
          : t));
      if (rootPath) await refreshFileTree(rootPath);
    } catch (err) { console.error("Failed to save file:", err); }
  }, [activeTab, rootPath, refreshFileTree]);

  const handleContentChange = useCallback((content: string) => {
    if (!activeTabId) return;
    setTabs((prev) => prev.map((t) =>
      t.id === activeTabId ? { ...t, content, dirty: true } : t));
  }, [activeTabId]);

  const handleSplitContentChange = useCallback((content: string) => {
    if (!splitTabId) return;
    setTabs((prev) => prev.map((t) =>
      t.id === splitTabId ? { ...t, content, dirty: true } : t));
  }, [splitTabId]);

  const handleSplitOpen = useCallback(() => {
    if (!activeTabId) return;
    setSplitTabId(activeTabId);
  }, [activeTabId]);

  const handleSplitClose = useCallback(() => {
    setSplitTabId(null);
  }, []);

  // Terminal split toggle
  const handleTerminalSplitToggle = useCallback(() => {
    setTerminalSplitCount((prev) => (prev === 1 ? 2 : 1));
  }, []);

  // Sidebar resize
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setResizing(true);
  }, []);

  useEffect(() => {
    if (!resizing) return;
    const handleMouseMove = (e: MouseEvent) => {
      const w = Math.max(160, Math.min(500, e.clientX));
      setSidebarWidth(w);
    };
    const handleMouseUp = () => setResizing(false);
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [resizing]);

  // Command palette
  const commands = [
    { id: "open-folder", label: "Open Folder", shortcut: "Ctrl+O", action: handleOpenFolder },
    { id: "open-file", label: "Open File", shortcut: "Ctrl+P", action: handleOpenFileDialog },
    { id: "save", label: "Save File", shortcut: "Ctrl+S", action: handleSaveFile },
    { id: "new-tab", label: "New Tab", shortcut: "Ctrl+N", action: handleNewTab },
    { id: "close-tab", label: "Close Tab", shortcut: "Ctrl+W", action: handleCloseActiveTab },
    { id: "next-tab", label: "Next Tab", shortcut: "Ctrl+Tab", action: handleNextTab },
    { id: "prev-tab", label: "Previous Tab", shortcut: "Ctrl+Shift+Tab", action: handlePrevTab },
    { id: "search-files", label: "Search in Files", shortcut: "Ctrl+Shift+F", action: () => setShowSearch(true) },
    { id: "toggle-theme", label: "Toggle Dark/Light Theme", shortcut: "Ctrl+K Ctrl+T", action: () => setDark(!dark) },
    { id: "split-editor", label: "Split Editor", shortcut: "Ctrl+\\", action: splitTabId ? handleSplitClose : handleSplitOpen },
    { id: "toggle-minimap", label: "Toggle Minimap", action: () => setShowMinimap(!showMinimap) },
    { id: "toggle-terminal", label: "Toggle Terminal", shortcut: "Ctrl+`", action: () => setShowTerminal(!showTerminal) },
    { id: "split-terminal", label: "Split Terminal", action: handleTerminalSplitToggle },
    { id: "git-panel", label: "Source Control", shortcut: "Ctrl+Shift+G", action: () => setSidebarTab(sidebarTab === "git" ? "files" : "git") },
  ];

  // Keyboard shortcuts
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    const ctrl = e.ctrlKey || e.metaKey;
    const shift = e.shiftKey;
    const key = e.key.toLowerCase();

    if (ctrl && shift && key === "p") { e.preventDefault(); setShowPalette(true); return; }
    if (ctrl && shift && key === "f") { e.preventDefault(); setShowSearch(true); return; }
    if (ctrl && shift && key === "g") { e.preventDefault(); setSidebarTab(sidebarTab === "git" ? "files" : "git"); return; }
    if (ctrl && key === "tab") { e.preventDefault(); shift ? handlePrevTab() : handleNextTab(); return; }
    if (ctrl && key === "\\") { e.preventDefault(); splitTabId ? handleSplitClose() : handleSplitOpen(); return; }
    if (ctrl && key === "`") { e.preventDefault(); setShowTerminal(!showTerminal); return; }
    if (ctrl && shift && key === "`") { e.preventDefault(); handleTerminalSplitToggle(); return; }
    if (ctrl) {
      switch (key) {
        case "o": e.preventDefault(); handleOpenFolder(); break;
        case "s": e.preventDefault(); handleSaveFile(); break;
        case "n": e.preventDefault(); handleNewTab(); break;
        case "p": e.preventDefault(); handleOpenFileDialog(); break;
        case "w": e.preventDefault(); handleCloseActiveTab(); break;
      }
    }
  }, [handleOpenFolder, handleSaveFile, handleNewTab, handleOpenFileDialog,
      handleCloseActiveTab, handleNextTab, handlePrevTab, splitTabId, handleSplitClose, handleSplitOpen,
      dark, showTerminal, sidebarTab, handleTerminalSplitToggle]);

  useEffect(() => {
    document.documentElement.classList.toggle("light", !dark);
  }, [dark]);

  return (
    <div className={`app-shell ${resizing ? "resizing" : ""}`} ref={shellRef} onKeyDown={handleKeyDown} tabIndex={0}>
      <div className="sidebar" style={{ width: sidebarWidth }} ref={sidebarRef}>
        <div className="sidebar-tabs">
          <button
            className={`sidebar-tab-btn ${sidebarTab === "files" ? "active" : ""}`}
            onClick={() => setSidebarTab("files")}
          >
            Files
          </button>
          <button
            className={`sidebar-tab-btn ${sidebarTab === "git" ? "active" : ""}`}
            onClick={() => setSidebarTab("git")}
          >
            Git
          </button>
        </div>
        {sidebarTab === "files" && (
          <>
            <div className="sidebar-header">
              Files
              <button className="sidebar-header-btn" onClick={handleOpenFolder} title="Open Folder (Ctrl+O)">+</button>
            </div>
            <FileTree
              rootPath={rootPath}
              tree={fileTree}
              onOpenFile={openFileInTab}
              onDeleteEntry={handleDeleteEntry}
              onRenameEntry={handleRenameEntry}
            />
          </>
        )}
        {sidebarTab === "git" && (
          <GitPanel rootPath={rootPath} />
        )}
      </div>
      <div className="sidebar-resize-handle" onMouseDown={handleResizeStart} />

      <div className="main-area">
        {showSearch && (
          <SearchPanel
            rootPath={rootPath}
            onOpenFile={(path) => { openFileInTab(path); setShowSearch(false); }}
            onClose={() => setShowSearch(false)}
          />
        )}
        <TabBar
          tabs={tabs}
          activeTabId={activeTabId}
          onSelectTab={handleSelectTab}
          onCloseTab={handleCloseTab}
          onNewTab={handleNewTab}
        />

        {splitTabId ? (
          <div className="split-container">
            <div className="split-pane">
              <div className="split-pane-header">
                <span>{activeTab?.title || "No file"}</span>
                <button className="split-close-btn" onClick={handleSplitClose}>×</button>
              </div>
              <EditorPanel
                tab={activeTab}
                dark={dark}
                onChange={handleContentChange}
                onCursorChange={(l, c) => { setCursorLine(l); setCursorCol(c); }}
              />
            </div>
            <div className="split-pane">
              <div className="split-pane-header">
                <span>{splitTab?.title || "No file"}</span>
              </div>
              <EditorPanel
                tab={splitTab}
                dark={dark}
                onChange={handleSplitContentChange}
              />
            </div>
          </div>
        ) : (
          <div className="editor-with-minimap">
            <EditorPanel
              tab={activeTab}
              dark={dark}
              onChange={handleContentChange}
              onCursorChange={(l, c) => { setCursorLine(l); setCursorCol(c); }}
            />
            {showMinimap && activeTab && <Minimap tab={activeTab} dark={dark} />}
          </div>
        )}

        {showTerminal && (
          <>
            <div
              className="terminal-resize-handle"
              onMouseDown={(e) => {
                e.preventDefault();
                const startY = e.clientY;
                const startH = terminalHeight;
                const handleMouseMove = (ev: MouseEvent) => {
                  const maxH = window.innerHeight - 28;
                  const newH = Math.max(100, Math.min(maxH, startH + (startY - ev.clientY)));
                  setTerminalHeight(newH);
                };
                const handleMouseUp = () => {
                  document.removeEventListener("mousemove", handleMouseMove);
                  document.removeEventListener("mouseup", handleMouseUp);
                };
                document.addEventListener("mousemove", handleMouseMove);
                document.addEventListener("mouseup", handleMouseUp);
              }}
            />
            <div className="terminal-panel" style={{ height: terminalHeight }}>
              <div className="terminal-header">
                <span className="terminal-header-title">
                  Terminal{terminalSplitCount > 1 ? " (split)" : ""}
                </span>
                <select
                  className="terminal-shell-select"
                  value={terminalShell}
                  onChange={(e) => {
                    const v = e.target.value;
                    setTerminalShell(v);
                    localStorage.setItem("terminalShell", v);
                  }}
                >
                  <option value="">Auto-detect</option>
                  <option value="cmd">CMD</option>
                  <option value="powershell">PowerShell</option>
                  <option value="pwsh">PowerShell Core</option>
                </select>
                <button
                  className="terminal-split-btn"
                  onClick={handleTerminalSplitToggle}
                  title={terminalSplitCount === 1 ? "Split Terminal (Ctrl+Shift+`)" : "Unsplit Terminal (Ctrl+Shift+`)"}
                >
                  {terminalSplitCount === 1 ? "▦" : "▢"}
                </button>
                <button
                  className="terminal-close-btn"
                  onClick={() => setShowTerminal(false)}
                  title="Close Terminal"
                >
                  ×
                </button>
              </div>
              <div className="terminal-split-container" ref={splitContainerRef}>
                  <div
                    className={terminalSplitCount === 2 ? "terminal-split-pane" : "terminal-split-pane-full"}
                    style={terminalSplitCount === 2 ? { flex: `0 0 ${terminalSplitRatio * 100}%` } : undefined}
                  >
                    {terminalSplitCount === 2 && <div className="terminal-split-pane-label">Terminal 1</div>}
                    <TerminalPanel key="term-1" cwd={rootPath} visible={showTerminal} shell={terminalShell || undefined} />
                  </div>
                  {terminalSplitCount === 2 && (
                    <>
                      <div
                        className="terminal-split-divider"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          const container = splitContainerRef.current;
                          if (!container) return;
                          const startX = e.clientX;
                          const startRatio = terminalSplitRatio;
                          const rect = container.getBoundingClientRect();
                          const containerWidth = rect.width;
                          const handleMouseMove = (ev: MouseEvent) => {
                            const dx = ev.clientX - startX;
                            const newRatio = Math.max(0.2, Math.min(0.8, startRatio + dx / containerWidth));
                            setTerminalSplitRatio(newRatio);
                          };
                          const handleMouseUp = () => {
                            document.removeEventListener("mousemove", handleMouseMove);
                            document.removeEventListener("mouseup", handleMouseUp);
                          };
                          document.addEventListener("mousemove", handleMouseMove);
                          document.addEventListener("mouseup", handleMouseUp);
                        }}
                      />
                      <div
                        className="terminal-split-pane"
                        style={{ flex: `0 0 ${(1 - terminalSplitRatio) * 100}%` }}
                      >
                        <div className="terminal-split-pane-label">Terminal 2</div>
                        <TerminalPanel key="term-2" cwd={rootPath} visible={showTerminal} shell={terminalShell || undefined} />
                      </div>
                    </>
                  )}
                </div>
            </div>
          </>
        )}

        <StatusBar tab={activeTab} cursorLine={cursorLine} cursorCol={cursorCol} gitBranch={gitBranch} />

        {/* Quick action bar */}
        <div className="action-bar">
          <button className="action-btn" onClick={() => setDark(!dark)} title="Toggle Theme">
            {dark ? "☀" : "🌙"}
          </button>
          <button className="action-btn" onClick={splitTabId ? handleSplitClose : handleSplitOpen} title="Split Editor (Ctrl+\)">
            ⬜
          </button>
          <button className="action-btn" onClick={() => setShowMinimap(!showMinimap)} title="Toggle Minimap">
            🗺
          </button>
          <button className="action-btn" onClick={() => setShowTerminal(!showTerminal)} title="Toggle Terminal (Ctrl+`)">
            ▷
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
