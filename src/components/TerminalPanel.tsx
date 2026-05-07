import { useEffect, useRef, useCallback } from "react";
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
  /** Working directory for the terminal (e.g., project root). */
  cwd: string | null;
  /** Whether this terminal panel is currently visible. */
  visible: boolean;
  /** Preferred shell: "cmd", "powershell", "pwsh", or undefined for auto-detect. */
  shell: string | undefined;
}

export function TerminalPanel({ cwd, visible, shell }: TerminalPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const termIdRef = useRef<number | null>(null);
  const unlistenOutputRef = useRef<UnlistenFn | null>(null);
  const unlistenExitRef = useRef<UnlistenFn | null>(null);
  const waRef = useRef<WritableStreamDefaultWriter<Uint8Array> | null>(null);

  const spawnAndAttach = useCallback(async () => {
    if (!containerRef.current) return;

    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: "bar",
      fontSize: 13,
      fontFamily: '"Cascadia Code", "Fira Code", "Consolas", monospace',
      theme: {
        background: "#1e1e1e",
        foreground: "#cccccc",
        cursor: "#cccccc",
        selectionBackground: "#264f78",
        black: "#000000",
        red: "#cd3131",
        green: "#0dbc79",
        yellow: "#e5e510",
        blue: "#2472c8",
        magenta: "#bc3fbc",
        cyan: "#11a8cd",
        white: "#e5e5e5",
        brightBlack: "#666666",
        brightRed: "#f14c4c",
        brightGreen: "#23d18b",
        brightYellow: "#f5f543",
        brightBlue: "#3b8eea",
        brightMagenta: "#d670d6",
        brightCyan: "#29b8db",
        brightWhite: "#ffffff",
      },
      allowProposedApi: true,
      allowTransparency: false,
      cols: 80,
      rows: 24,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    fitAddonRef.current = fitAddon;

    term.open(containerRef.current);

    // Create a WritableStream to send input
    const ws = new WritableStream<Uint8Array>({
      write(chunk) {
        if (termIdRef.current !== null) {
          const data = Array.from(chunk);
          invoke("terminal_write", { id: termIdRef.current, data }).catch(() => {});
        }
      },
    });
    waRef.current = ws.getWriter();

    // Pipe terminal input to the writer
    term.onData((data) => {
      const encoder = new TextEncoder();
      const chunk = encoder.encode(data);
      waRef.current?.write(chunk);
    });

    terminalRef.current = term;

    // Spawn the terminal process
    try {
      const id: number = await invoke("terminal_spawn", {
        cols: term.cols,
        rows: term.rows,
        cwd: cwd || undefined,
        shell: shell || undefined,
      });
      termIdRef.current = id;

      // Listen for output
      const unlistenOut = await listen<TerminalOutputPayload>("terminal-output", (event) => {
        if (event.payload.id === id) {
          const bytes = new Uint8Array(event.payload.data);
          term.write(bytes);
        }
      });
      unlistenOutputRef.current = unlistenOut;

      // Listen for exit
      const unlistenExit = await listen<TerminalExitPayload>("terminal-exit", (event) => {
        if (event.payload.id === id) {
          term.writeln("\r\n[Process exited]");
        }
      });
      unlistenExitRef.current = unlistenExit;

      // Fit after a short delay
      setTimeout(() => {
        try { fitAddon.fit(); } catch { /* ignore */ }
      }, 50);
    } catch (err) {
      term.writeln(`Failed to spawn terminal: ${err}`);
    }
  }, [cwd]);

  // Spawn terminal on first mount
  useEffect(() => {
    spawnAndAttach();

    return () => {
      // Cleanup
      const id = termIdRef.current;
      if (id !== null) {
        invoke("terminal_kill", { id }).catch(() => {});
      }
      unlistenOutputRef.current?.();
      unlistenExitRef.current?.();
      terminalRef.current?.dispose();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Handle visibility changes: fit when becoming visible
  useEffect(() => {
    if (visible && fitAddonRef.current) {
      setTimeout(() => {
        try { fitAddonRef.current?.fit(); } catch { /* ignore */ }
      }, 50);
    }
  }, [visible]);

  // Handle resize
  const handleResize = useCallback(() => {
    if (!fitAddonRef.current) return;
    try {
      fitAddonRef.current.fit();
      const term = terminalRef.current;
      const id = termIdRef.current;
      if (term && id !== null) {
        invoke("terminal_resize", { id, cols: term.cols, rows: term.rows }).catch(() => {});
      }
    } catch { /* ignore */ }
  }, []);

  // Observe container resize
  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(() => {
      handleResize();
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [handleResize, visible]);

  return (
    <div
      ref={containerRef}
      className="terminal-container"
      style={{ display: visible ? "block" : "none" }}
    />
  );
}
