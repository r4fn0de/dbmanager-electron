import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { PlainTextPlugin } from "@lexical/react/LexicalPlainTextPlugin";
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_EDITOR,
  KEY_ENTER_COMMAND,
  type LexicalEditor,
} from "lexical";
import { useEffect, useMemo, useRef, type JSX } from "react";
import { ConnectionMentionNode } from "@/components/ui/lexical/connection-mention-node";
import {
  LexicalMentionSyncPlugin,
  type LexicalMentionDescriptor,
} from "@/components/ui/lexical/lexical-mention-sync-plugin";
import type { PromptInputMention } from "@/components/ui/prompt-input-mentions";
import { cn } from "@/lib/utils";

export type LexicalPromptEditorApi = {
  focus: () => void;
  focusAt: (offset: number) => void;
  insertMentionAtQuery: (
    descriptor: LexicalMentionDescriptor
  ) => { cursorPos: number; text: string } | null;
  setText: (next: string) => void;
};

function LexicalEnterSubmitPlugin({
  onSubmit,
}: {
  onSubmit?: () => void;
}): null {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    return editor.registerCommand(
      KEY_ENTER_COMMAND,
      (event) => {
        if (event?.shiftKey) {
          return false;
        }
        event?.preventDefault();
        onSubmit?.();
        return true;
      },
      COMMAND_PRIORITY_EDITOR
    );
  }, [editor, onSubmit]);
  return null;
}

function LexicalKeyDownBridge({
  onKeyDown,
}: {
  onKeyDown?: React.KeyboardEventHandler<HTMLDivElement>;
}): null {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    return editor.registerRootListener((rootElement) => {
      if (!rootElement) {
        return;
      }
      const handler = (event: KeyboardEvent) => {
        onKeyDown?.(
          event as unknown as React.KeyboardEvent<HTMLDivElement>
        );
      };
      rootElement.addEventListener("keydown", handler);
      return () => {
        rootElement.removeEventListener("keydown", handler);
      };
    });
  }, [editor, onKeyDown]);
  return null;
}

function LexicalEditorHandlePlugin({
  editorRef,
}: {
  editorRef: React.RefObject<LexicalEditor | null>;
}): null {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    editorRef.current = editor;
    return () => {
      if (editorRef.current === editor) {
        editorRef.current = null;
      }
    };
  }, [editor, editorRef]);
  return null;
}

function LexicalSeedPlugin({ value }: { value: string }): null {
  const [editor] = useLexicalComposerContext();
  const seededRef = useRef(false);
  useEffect(() => {
    if (seededRef.current) {
      return;
    }
    seededRef.current = true;
    editor.update(
      () => {
        const root = $getRoot();
        root.clear();
        const paragraph = $createParagraphNode();
        paragraph.append($createTextNode(value));
        root.append(paragraph);
      },
      { tag: "history-merge" }
    );
  }, [editor, value]);
  return null;
}

function LexicalMaxHeightPlugin({
  maxHeight,
}: {
  maxHeight?: number | string;
}): null {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    if (maxHeight === undefined) {
      return;
    }
    return editor.registerRootListener((rootElement) => {
      if (!rootElement) {
        return;
      }
      rootElement.style.maxHeight =
        typeof maxHeight === "number" ? `${maxHeight}px` : maxHeight;
      rootElement.style.overflowY = "auto";
    });
  }, [editor, maxHeight]);
  return null;
}

function LexicalAutoFocusPlugin(): null {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    const timer = setTimeout(() => {
      editor.focus();
    }, 0);
    return () => clearTimeout(timer);
  }, [editor]);
  return null;
}

export function LexicalPromptEditor({
  autoFocus,
  className,
  disabled,
  initialValue,
  inlineMentions,
  maxHeight,
  onChange,
  onCursorChange,
  onInlineMentionRemove,
  onKeyDown,
  onSubmit,
  placeholder,
  registerApi,
}: {
  autoFocus?: boolean;
  className?: string;
  disabled?: boolean;
  initialValue: string;
  inlineMentions: readonly LexicalMentionDescriptor[];
  maxHeight?: number | string;
  onChange: (value: string) => void;
  onCursorChange?: (value: string, cursorPos: number) => void;
  onInlineMentionRemove?: (
    mention: PromptInputMention,
    start: number,
    end: number
  ) => void;
  onKeyDown?: React.KeyboardEventHandler<HTMLDivElement>;
  onSubmit?: () => void;
  placeholder?: string;
  registerApi?: (api: LexicalPromptEditorApi) => void;
}): JSX.Element {
  const apiRef = useRef<LexicalPromptEditorApi | null>(null);
  const editorRef = useRef<LexicalEditor | null>(null);

  const initialConfig = useMemo(
    () => ({
      editable: !disabled,
      namespace: "ai-prompt-input",
      nodes: [ConnectionMentionNode],
      onError: (error: Error) => {
        console.error("[lexical] prompt editor error", error);
      },
      theme: {
        paragraph: "m-0",
      },
    }),
    [disabled]
  );

  useEffect(() => {
    registerApi?.({
      focus: () => {
        if (editorRef.current) {
          editorRef.current.focus();
          return;
        }
        apiRef.current?.focus();
      },
      focusAt: (offset: number) => {
        apiRef.current?.focusAt(offset);
      },
      insertMentionAtQuery: (descriptor) =>
        apiRef.current?.insertMentionAtQuery(descriptor) ?? null,
      setText: (next: string) => {
        apiRef.current?.setText(next);
      },
    });
  }, [registerApi]);

  return (
    <LexicalComposer initialConfig={initialConfig}>
      <div className="relative w-full">
        <PlainTextPlugin
          contentEditable={
            placeholder ? (
              <ContentEditable
                aria-placeholder={placeholder}
                className={cn(
                  "text-foreground field-sizing-fixed min-h-11 w-full resize-none overflow-y-auto whitespace-pre-wrap break-words border-none bg-transparent py-2 shadow-none outline-none focus-visible:ring-0 focus-visible:ring-offset-0",
                  className
                )}
                placeholder={
                  <span className="pointer-events-none absolute top-2 left-0 text-muted-foreground/50 select-none">
                    {placeholder}
                  </span>
                }
              />
            ) : (
              <ContentEditable
                className={cn(
                  "text-foreground field-sizing-fixed min-h-11 w-full resize-none overflow-y-auto whitespace-pre-wrap break-words border-none bg-transparent py-2 shadow-none outline-none focus-visible:ring-0 focus-visible:ring-offset-0",
                  className
                )}
              />
            )
          }
          ErrorBoundary={LexicalErrorBoundary}
        />
        <HistoryPlugin />
        <LexicalMentionSyncPlugin
          mentions={inlineMentions}
          onChange={onChange}
          onCursorChange={onCursorChange}
          onRemoveMention={onInlineMentionRemove}
          registerApi={(api) => {
            apiRef.current = { ...api, focus: () => editorRef.current?.focus() };
          }}
          value={initialValue}
        />
        <LexicalEditorHandlePlugin editorRef={editorRef} />
        <LexicalSeedPlugin value={initialValue} />
        <LexicalMaxHeightPlugin maxHeight={maxHeight} />
        {autoFocus ? <LexicalAutoFocusPlugin /> : null}
        <LexicalKeyDownBridge onKeyDown={onKeyDown} />
        <LexicalEnterSubmitPlugin onSubmit={onSubmit} />
      </div>
    </LexicalComposer>
  );
}

export function focusLexicalSelectionToEnd(editor: LexicalEditor): void {
  editor.update(() => {
    const selection = $getSelection();
    if ($isRangeSelection(selection)) {
      selection.focus.getNode().select();
    }
  });
}
