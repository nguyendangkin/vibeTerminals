import { useEffect, useRef, useCallback, useImperativeHandle, forwardRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import "@xterm/xterm/css/xterm.css";

interface TerminalOutputPayload {
  id: number;
  data: number[];
}

interface TerminalExitPayload {
  id: number;
}

interface TerminalPanelProps {
  instanceId: string;
  cwd: string | null;
  visible: boolean;
  shell?: string;
  active?: boolean;
  initialCommand?: string;
  onFocus?: () => void;
  onContextMenu?: (selectedText: string, x: number, y: number) => void;
  onCommandChange?: (cmd: string) => void;
}

export interface TerminalPanelHandle {
  writeText: (text: string) => void;
  reload: () => void;
  getLastCommand: () => string;
}

export const TerminalPanel = forwardRef<TerminalPanelHandle, TerminalPanelProps>(
function TerminalPanel({ instanceId, cwd, visible, shell, active, initialCommand, onFocus, onContextMenu, onCommandChange }, ref) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const termIdRef = useRef<number | null>(null);
  const unlistenOutRef = useRef<UnlistenFn | null>(null);
  const unlistenExitRef = useRef<UnlistenFn | null>(null);
  const onContextMenuRef = useRef(onContextMenu);
  useEffect(() => { onContextMenuRef.current = onContextMenu; });

  const onCommandChangeRef = useRef(onCommandChange);
  useEffect(() => { onCommandChangeRef.current = onCommandChange; });

  const inputBufferRef = useRef<string>("");
  const lastCommandRef = useRef<string>("");
  const inEscapeRef = useRef(false);

  // Keep latest cwd/shell in refs so reload always picks up current values
  const cwdRef = useRef(cwd);
  const shellRef = useRef(shell);
  useEffect(() => { cwdRef.current = cwd; });
  useEffect(() => { shellRef.current = shell; });

  // Epoch counter to cancel stale connectPty calls on rapid reload
  const connectEpochRef = useRef(0);

  // Connect to a PTY: kill old session, spawn a new one, set up event listeners.
  // Returns the new terminal ID, or null on failure / if superseded by a newer call.
  const connectPty = useCallback(async (): Promise<number | null> => {
    const term = termRef.current;
    if (!term) return null;

    const epoch = ++connectEpochRef.current;

    // Clean up old listeners
    unlistenOutRef.current?.();
    unlistenExitRef.current?.();
    unlistenOutRef.current = null;
    unlistenExitRef.current = null;

    // Kill old PTY session if one exists
    const oldId = termIdRef.current;
    if (oldId !== null) {
      await invoke("terminal_kill", { id: oldId }).catch(() => {});
      termIdRef.current = null;
    }

    if (epoch !== connectEpochRef.current) return null; // superseded

    try {
      const id: number = await invoke("terminal_spawn", {
        cols: term.cols,
        rows: term.rows,
        cwd: cwdRef.current ?? undefined,
        shell: shellRef.current ?? undefined,
      });

      if (epoch !== connectEpochRef.current) {
        // Superseded while spawning — clean up and abort
        invoke("terminal_kill", { id }).catch(() => {});
        return null;
      }

      termIdRef.current = id;

      const unOut = await listen<TerminalOutputPayload>("terminal-output", (ev) => {
        if (ev.payload.id === id) {
          term.write(new Uint8Array(ev.payload.data));
        }
      });

      const unExit = await listen<TerminalExitPayload>("terminal-exit", (ev) => {
        if (ev.payload.id === id) {
          term.writeln("\r\n\x1b[2m[Process exited]\x1b[0m");
        }
      });

      if (epoch !== connectEpochRef.current) {
        // Superseded after listener setup — clean up
        unOut();
        unExit();
        invoke("terminal_kill", { id }).catch(() => {});
        return null;
      }

      unlistenOutRef.current = unOut;
      unlistenExitRef.current = unExit;

      setTimeout(() => { try { fitRef.current?.fit(); } catch { /* ignore */ } }, 60);

      return id;
    } catch (err) {
      term.writeln(`\r\n\x1b[31m[Failed to start terminal: ${err}]\x1b[0m`);
      return null;
    }
  }, []);

  const reload = useCallback(() => {
    const cmd = lastCommandRef.current;

    connectPty().then((newId) => {
      if (newId === null || !cmd) return;

      const bytes = Array.from(new TextEncoder().encode(cmd + "\r"));
      invoke("terminal_write", { id: newId, data: bytes }).catch(() => {});
    });
  }, [connectPty]);

  useImperativeHandle(ref, () => ({
    writeText: (text: string) => {
      if (termRef.current) {
        termRef.current.paste(text);
      }
    },
    reload,
    getLastCommand: () => lastCommandRef.current,
  }), [reload]);

  const doFit = useCallback(() => {
    if (!fitRef.current || !termRef.current) return;
    try {
      fitRef.current.fit();
      const id = termIdRef.current;
      if (id !== null) {
        invoke("terminal_resize", {
          id,
          cols: termRef.current.cols,
          rows: termRef.current.rows,
        }).catch(() => {});
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: "bar",
      fontSize: 13,
      fontFamily: '"Cascadia Code", "Fira Code", "Consolas", monospace',
      theme: {
        background: "#1a1a1a",
        foreground: "#d4d4d4",
        cursor: "#d4d4d4",
        selectionBackground: "#264f78",
        black: "#1e1e1e",
        red: "#f44747",
        green: "#6a9955",
        yellow: "#dcdcaa",
        blue: "#569cd6",
        magenta: "#c586c0",
        cyan: "#4ec9b0",
        white: "#d4d4d4",
        brightBlack: "#808080",
        brightRed: "#f44747",
        brightGreen: "#23d18b",
        brightYellow: "#f5f543",
        brightBlue: "#3b8eea",
        brightMagenta: "#d670d6",
        brightCyan: "#29b8db",
        brightWhite: "#ffffff",
      },
      allowProposedApi: true,
      allowTransparency: false,
      scrollback: 5000,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    fitRef.current = fitAddon;
    termRef.current = term;

    term.open(containerRef.current);
    try { fitAddon.fit(); } catch { /* ignore */ }
    setTimeout(() => { try { fitAddon.fit(); } catch { /* ignore */ } }, 60);

    if (initialCommand) {
      lastCommandRef.current = initialCommand;
    }

    term.attachCustomKeyEventHandler((e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === "v" && e.type === "keydown") {
        invoke<string>("read_clipboard").then((text) => {
          if (text) term.paste(text);
        }).catch(() => {});
        return false;
      }
      return true;
    });

    const el = containerRef.current;
    const handleCtxMenu = (e: Event) => {
      const me = e as MouseEvent;
      me.preventDefault();
      const selected = term.getSelection();
      if (selected.trim()) {
        onContextMenuRef.current?.(selected, me.clientX, me.clientY);
      }
    };
    el.addEventListener("contextmenu", handleCtxMenu);

    const handlePaste = (e: ClipboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };
    el.addEventListener("paste", handlePaste, true);

    const handleMiddleClick = (e: MouseEvent) => {
      if (e.button === 1) {
        const selected = term.getSelection();
        if (selected) {
          e.preventDefault();
          invoke("write_clipboard", { text: selected }).catch(() => {});
        }
      }
    };
    el.addEventListener("mousedown", handleMiddleClick);

    const encoder = new TextEncoder();
    term.onData((data) => {
      const id = termIdRef.current;
      if (id === null) return;

      // Track last command from user input (skip escape sequences)
      for (const ch of data) {
        if (inEscapeRef.current) {
          if (/[a-zA-Z~]/.test(ch)) inEscapeRef.current = false;
          continue;
        }
        if (ch === '\r') {
          if (inputBufferRef.current.trim()) {
            lastCommandRef.current = inputBufferRef.current.trim();
            onCommandChangeRef.current?.(lastCommandRef.current);
          }
          inputBufferRef.current = "";
        } else if (ch === '\x7f' || ch === '\x08') {
          inputBufferRef.current = inputBufferRef.current.slice(0, -1);
        } else if (ch === '\x03') {
          inputBufferRef.current = "";
        } else if (ch === '\x1b') {
          inputBufferRef.current = "";
          inEscapeRef.current = true;
        } else if (ch >= ' ') {
          inputBufferRef.current += ch;
        }
      }

      const bytes = Array.from(encoder.encode(data));
      invoke("terminal_write", { id, data: bytes }).catch(() => {});
    });

    term.onBinary((data) => {
      const id = termIdRef.current;
      if (id === null) return;
      const bytes = Array.from(data.split("").map((c) => c.charCodeAt(0)));
      invoke("terminal_write", { id, data: bytes }).catch(() => {});
    });

    let cancelled = false;

    connectPty().then((id) => {
      if (cancelled && id !== null) {
        invoke("terminal_kill", { id }).catch(() => {});
      }
    });

    return () => {
      cancelled = true;
      el.removeEventListener("contextmenu", handleCtxMenu);
      el.removeEventListener("paste", handlePaste, true);
      el.removeEventListener("mousedown", handleMiddleClick);
      unlistenOutRef.current?.();
      unlistenExitRef.current?.();
      const id = termIdRef.current;
      if (id !== null) invoke("terminal_kill", { id }).catch(() => {});
      term.dispose();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Fit when becoming visible
  useEffect(() => {
    if (visible) {
      const raf = requestAnimationFrame(() => doFit());
      const t = setTimeout(doFit, 80);
      return () => { cancelAnimationFrame(raf); clearTimeout(t); };
    }
  }, [visible, doFit]);

  // ResizeObserver for container size changes
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => doFit());
    ro.observe(el);
    return () => ro.disconnect();
  }, [doFit]);

  // Sync keyboard focus with active state
  useEffect(() => {
    if (active && termRef.current) {
      termRef.current.focus();
    }
  }, [active]);

  // Log instanceId usage to prevent lint warning
  void instanceId;

  return (
    <div
      ref={containerRef}
      className={`terminal-xterm-host${active ? " terminal-xterm-active" : ""}`}
      style={{ display: visible ? "flex" : "none", flex: 1, minHeight: 0, minWidth: 0 }}
      onMouseDown={onFocus}
    />
  );
});
