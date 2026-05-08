import { forwardRef, useImperativeHandle, useRef, useEffect, useCallback } from "react";
import { EditorTab } from "../types";

export interface EditorPanelHandle {
  getContent: () => string;
}

interface EditorPanelProps {
  tab: EditorTab | null;
  getDirtyContent: (tabId: string) => string | undefined;
  onChange: (content: string) => void;
}

export const EditorPanel = forwardRef<EditorPanelHandle, EditorPanelProps>(
  function EditorPanel({ tab, getDirtyContent, onChange }, ref) {
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    useImperativeHandle(ref, () => ({
      getContent: () => textareaRef.current?.value ?? "",
    }));

    useEffect(() => {
      if (tab && textareaRef.current) {
        textareaRef.current.value = getDirtyContent(tab.id) ?? tab.content;
      }
    }, [tab?.id, getDirtyContent, tab?.content]);

    const handleChange = useCallback(
      (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        onChange(e.target.value);
      },
      [onChange],
    );

    if (!tab) return null;

    return (
      <div className="editor-panel">
        <textarea
          ref={textareaRef}
          className="editor-textarea"
          defaultValue={tab.content}
          onChange={handleChange}
          spellCheck={false}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          wrap="off"
        />
      </div>
    );
  },
);
