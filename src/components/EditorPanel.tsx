import { useEffect, useRef } from "react";
import { EditorState } from "@codemirror/state";
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  drawSelection,
} from "@codemirror/view";
import {
  defaultKeymap,
  history,
  historyKeymap,
} from "@codemirror/commands";
import {
  syntaxHighlighting,
  defaultHighlightStyle,
  bracketMatching,
} from "@codemirror/language";
import {
  searchKeymap,
  highlightSelectionMatches,
} from "@codemirror/search";
import { oneDark } from "@codemirror/theme-one-dark";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { rust } from "@codemirror/lang-rust";
import { python } from "@codemirror/lang-python";
import { markdown } from "@codemirror/lang-markdown";
import { xml } from "@codemirror/lang-xml";
import { EditorTab } from "../types";

interface EditorPanelProps {
  tab: EditorTab | null;
  onChange: (content: string) => void;
  onCursorChange?: (line: number, col: number) => void;
}

function getLanguageExtension(lang: string) {
  const map: Record<string, () => any> = {
    javascript,
    typescript: () => javascript({ typescript: true }),
    json,
    html,
    css,
    rust,
    python,
    markdown,
    xml,
  };
  const fn = map[lang];
  return fn ? fn() : [];
}

function detectLanguage(path: string | null): string {
  if (!path) return "plaintext";
  const ext = path.split(".").pop()?.toLowerCase();
  const map: Record<string, string> = {
    js: "javascript", jsx: "javascript",
    ts: "typescript", tsx: "typescript",
    json: "json", html: "html", htm: "html", css: "css",
    rs: "rust", py: "python", md: "markdown",
    xml: "xml", svg: "xml", txt: "plaintext",
  };
  return map[ext || ""] || "plaintext";
}

export function EditorPanel({ tab, onChange, onCursorChange }: EditorPanelProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);

  useEffect(() => {
    if (!editorRef.current) return;

    const content = tab?.content || "";
    const lang = tab ? detectLanguage(tab.path) : "plaintext";

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        onChange(update.state.doc.toString());
      }
      if (onCursorChange && update.selectionSet) {
        const pos = update.state.selection.main.head;
        const line = update.state.doc.lineAt(pos);
        onCursorChange(line.number, pos - line.from + 1);
      }
    });

    const extensions: any[] = [
      lineNumbers(),
      highlightActiveLine(),
      drawSelection(),
      history(),
      bracketMatching(),
      highlightSelectionMatches(),
      syntaxHighlighting(defaultHighlightStyle),
      keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
      getLanguageExtension(lang),
      oneDark,
      updateListener,
    ];

    const state = EditorState.create({ doc: content, extensions });
    const view = new EditorView({ state, parent: editorRef.current });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [tab?.id]);

  useEffect(() => {
    if (!viewRef.current || !tab) return;
    const currentContent = viewRef.current.state.doc.toString();
    if (tab.content !== currentContent) {
      viewRef.current.dispatch({
        changes: { from: 0, to: currentContent.length, insert: tab.content },
      });
    }
  }, [tab?.content]);

  if (!tab) {
    return null;
  }

  return <div className="editor-panel" ref={editorRef} />;
}
