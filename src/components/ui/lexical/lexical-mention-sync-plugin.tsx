import {
  $createParagraphNode,
  $createTextNode,
  $getCharacterOffsets,
  $getRoot,
  $getSelection,
  $isDecoratorNode,
  $isElementNode,
  $isNodeSelection,
  $isRangeSelection,
  $isTextNode,
  COMMAND_PRIORITY_EDITOR,
  KEY_BACKSPACE_COMMAND,
  KEY_DELETE_COMMAND,
  type LexicalEditor,
  type LexicalNode,
} from "lexical";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { useEffect } from "react";
import {
  $createConnectionMentionNode,
  $isConnectionMentionNode,
  ConnectionMentionNode,
  type ConnectionMentionProvider,
} from "@/components/ui/lexical/connection-mention-node";
import type { PromptInputMention } from "@/components/ui/prompt-input-mentions";

export type LexicalMentionDescriptor = PromptInputMention & {
  connectionId?: string;
  provider?: ConnectionMentionProvider | string;
};

const MENTION_PROVIDER_FALLBACK: ConnectionMentionProvider = "generic";

function readPlainText(editor: LexicalEditor): string {
  return editor.getEditorState().read(() => $getRoot().getTextContent());
}

function mentionOffsetsByWalkingRoot(): Map<
  string,
  { end: number; start: number; token: string }
> {
  const offsets = new Map<
    string,
    { end: number; start: number; token: string }
  >();
  let cursor = 0;
  const visit = (node: LexicalNode): void => {
    if ($isConnectionMentionNode(node)) {
      const token = node.getMentionToken();
      offsets.set(node.getKey(), {
        end: cursor + token.length,
        start: cursor,
        token,
      });
      cursor += token.length;
      return;
    }
    if ($isTextNode(node)) {
      cursor += node.getTextContentSize();
      return;
    }
    if ($isDecoratorNode(node)) {
      cursor += node.getTextContent().length;
      return;
    }
    if ($isElementNode(node)) {
      for (const child of node.getChildren()) {
        visit(child);
      }
    }
  };
  visit($getRoot());
  return offsets;
}

function setEditorText(editor: LexicalEditor, value: string): void {
  editor.update(() => {
    const root = $getRoot();
    root.clear();
    const paragraph = $createParagraphNode();
    paragraph.append($createTextNode(value));
    root.append(paragraph);
  });
}

function focusTextNodeAt(
  editor: LexicalEditor,
  offset: number
): void {
  editor.focus();
  editor.update(() => {
    const root = $getRoot();
    const textNode = root.getFirstDescendant();
    if ($isTextNode(textNode)) {
      const clamped = Math.min(offset, textNode.getTextContentSize());
      textNode.select(clamped, clamped);
    }
  });
}

/**
 * Bidirectional sync between the Lexical document and the plain-text
 * `value` contract owned by `PromptInput`. Text nodes carry free prose;
 * `ConnectionMentionNode` decorators carry `@connection` pills whose
 * `getTextContent()` serializes back to the mention token.
 */
export function LexicalMentionSyncPlugin({
  value,
  mentions,
  onChange,
  onCursorChange,
  onRemoveMention,
  registerApi,
}: {
  value: string;
  mentions: readonly LexicalMentionDescriptor[];
  onChange: (value: string) => void;
  onCursorChange?: (value: string, cursorPos: number) => void;
  onRemoveMention?: (
    mention: PromptInputMention,
    start: number,
    end: number
  ) => void;
  registerApi?: (api: {
    focusAt: (offset: number) => void;
    insertMentionAtQuery: (
      descriptor: LexicalMentionDescriptor
    ) => { cursorPos: number; text: string } | null;
    setText: (next: string) => void;
  }) => void;
}): null {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    if (readPlainText(editor) === value) {
      return;
    }
    setEditorText(editor, value);
  }, [editor, value]);

  useEffect(() => {
    registerApi?.({
      focusAt: (offset: number) => {
        focusTextNodeAt(editor, offset);
      },
      insertMentionAtQuery: (descriptor) => {
        let result: { cursorPos: number; text: string } | null = null;
        editor.update(() => {
          const selection = $getSelection();
          if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
            return;
          }
          const anchor = selection.anchor;
          const anchorNode = anchor.getNode();
          if (!$isTextNode(anchorNode)) {
            return;
          }
          const textContent = anchorNode.getTextContent();
          const caretInNode = anchor.offset;
          const atIndex = textContent.lastIndexOf("@", caretInNode - 1);
          if (atIndex < 0) {
            return;
          }
          const beforeInNode = textContent.slice(0, atIndex);
          const afterInNode = textContent.slice(caretInNode);
          const beforeNodesText: string[] = [];
          let sibling: LexicalNode | null = anchorNode.getPreviousSibling();
          const siblings: LexicalNode[] = [];
          while (sibling) {
            siblings.unshift(sibling);
            sibling = sibling.getPreviousSibling();
          }
          for (const node of siblings) {
            if ($isTextNode(node) || $isDecoratorNode(node)) {
              beforeNodesText.push(node.getTextContent());
            }
          }
          const beforeText = `${beforeNodesText.join("")}${beforeInNode}`;
          const mentionNode = $createConnectionMentionNode({
            connectionId: descriptor.connectionId ?? descriptor.id,
            connectionLabel: descriptor.label,
            provider:
              (descriptor.provider as ConnectionMentionProvider | undefined) ??
              MENTION_PROVIDER_FALLBACK,
          });
          const parent = anchorNode.getParent();
          if (!parent) {
            return;
          }
          // Split "before @query|after" into [before][@query][after], drop the
          // middle query part, then insert the mention node in its place.
          const [, queryPart, afterPart] = anchorNode.splitText(
            atIndex,
            caretInNode
          );
          queryPart?.remove();
          parent.append(mentionNode);
          const needsLeadingSpace =
            afterInNode.length > 0 && !afterInNode.startsWith(" ");
          const afterNode = $createTextNode(
            afterInNode.length > 0
              ? needsLeadingSpace
                ? ` ${afterInNode}`
                : afterInNode
              : " "
          );
          if (afterPart) {
            afterPart.remove();
          }
          parent.append(afterNode);
          afterNode.select(
            afterNode.getTextContentSize(),
            afterNode.getTextContentSize()
          );
          const nextText = $getRoot().getTextContent();
          result = {
            cursorPos: beforeText.length + descriptor.label.length + 2,
            text: nextText,
          };
        });
        return result;
      },
      setText: (next: string) => {
        setEditorText(editor, next);
      },
    });
  }, [editor, registerApi]);

  useEffect(() => {
    return editor.registerUpdateListener(
      ({ editorState, dirtyElements, dirtyLeaves, tags }) => {
        if (dirtyElements.size === 0 && dirtyLeaves.size === 0) {
          return;
        }
        if (tags.has("history-merge")) {
          return;
        }
        const text = editorState.read(() => $getRoot().getTextContent());
        onChange(text);
        const selection = editorState.read(() => $getSelection());
        if ($isRangeSelection(selection) && selection.isCollapsed()) {
          const offsets = $getCharacterOffsets(selection);
          onCursorChange?.(text, offsets[0] ?? text.length);
        }
      }
    );
  }, [editor, onChange, onCursorChange]);

  useEffect(() => {
    return editor.registerCommand(
      KEY_BACKSPACE_COMMAND,
      (event) => {
        let handled = false;
        editor.update(() => {
          const selection = $getSelection();
          if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
            return;
          }
          if ($isNodeSelection(selection)) {
            return;
          }
          const anchor = selection.anchor;
          const anchorNode = anchor.getNode();
          if (!$isTextNode(anchorNode) || anchor.offset !== 0) {
            return;
          }
          const previous = anchorNode.getPreviousSibling();
          if (!$isConnectionMentionNode(previous)) {
            return;
          }
          event?.preventDefault();
          const info = mentionOffsetsByWalkingRoot().get(previous.getKey());
          const token = previous.getMentionToken();
          const start = info?.start ?? 0;
          const end = info?.end ?? start + token.length;
          const connectionId = previous.getConnectionId();
          previous.remove();
          handled = true;
          const nextText = $getRoot().getTextContent();
          onChange(nextText);
          onCursorChange?.(nextText, start);
          const descriptor = mentions.find(
            (mention) => (mention.connectionId ?? mention.id) === connectionId
          );
          if (descriptor && onRemoveMention) {
            onRemoveMention(
              { id: descriptor.id, label: descriptor.label },
              start,
              end
            );
          }
        });
        return handled;
      },
      COMMAND_PRIORITY_EDITOR
    );
  }, [editor, mentions, onChange, onCursorChange, onRemoveMention]);

  useEffect(() => {
    return editor.registerCommand(
      KEY_DELETE_COMMAND,
      () => false,
      COMMAND_PRIORITY_EDITOR
    );
  }, [editor]);

  void ConnectionMentionNode;
  return null;
}
