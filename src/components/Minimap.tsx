import { useEffect, useRef } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView, drawSelection } from "@codemirror/view";
import { syntaxHighlighting, defaultHighlightStyle } from "@codemirror/language";
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

interface MinimapProps {
  tab: EditorTab | null;
  dark: boolean;
  scrollRatio?: number;
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

export function Minimap({ tab, dark }: MinimapProps) {
  const minimapRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);

  useEffect(() => {
    if (!minimapRef.current || !tab) return;

    const lang = detectLanguage(tab.path);
    const content = tab.content;

    const extensions: any[] = [
      drawSelection(),
      syntaxHighlighting(defaultHighlightStyle),
      getLanguageExtension(lang),
      EditorState.readOnly.of(true),
      EditorView.editable.of(false),
    ];

    if (dark) {
      extensions.push(oneDark);
    }

    const state = EditorState.create({ doc: content, extensions });
    const view = new EditorView({
      state,
      parent: minimapRef.current,
    });

    // Disable interactions
    view.contentDOM.style.pointerEvents = "none";
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [tab?.id, dark]);

  useEffect(() => {
    if (!viewRef.current || !tab) return;
    const currentContent = viewRef.current.state.doc.toString();
    if (tab.content !== currentContent) {
      viewRef.current.dispatch({
        changes: { from: 0, to: currentContent.length, insert: tab.content },
      });
    }
  }, [tab?.content]);

  if (!tab) return null;

  return (
    <div className="minimap">
      <div className="minimap-canvas" ref={minimapRef} />
    </div>
  );
}
