import { useRef } from "react";
import { LexicalPromptEditor } from "@/components/ui/lexical/lexical-prompt-editor";
import type { LexicalMentionDescriptor } from "@/components/ui/lexical/lexical-mention-sync-plugin";
import { usePromptInputInternal } from "@/components/ui/prompt-input";
import type { PromptInputMention } from "@/components/ui/prompt-input-mentions";

export function LexicalPromptTextareaBridge({
  className,
  inlineMentions,
  lexicalMentions,
  onInlineMentionRemove,
  onKeyDown,
  placeholder,
}: {
  className?: string;
  disableAutosize?: boolean;
  inlineMentions?: readonly PromptInputMention[];
  lexicalMentions: readonly LexicalMentionDescriptor[];
  onInlineMentionRemove?: (
    mention: PromptInputMention,
    start: number,
    end: number
  ) => void;
  onKeyDown?: React.KeyboardEventHandler<HTMLDivElement>;
  placeholder?: string;
}): React.JSX.Element {
  const { value, setValue, onCursorChange, maxHeight, onSubmit, disabled } =
    usePromptInputInternal();
  const apiRef = useRef<{
    focusAt: (offset: number) => void;
    setText: (next: string) => void;
  } | null>(null);

  void inlineMentions;

  return (
    <LexicalPromptEditor
      className={className}
      disabled={disabled}
      initialValue={value}
      inlineMentions={lexicalMentions}
      maxHeight={maxHeight}
      onChange={(next) => {
        setValue(next);
      }}
      onCursorChange={onCursorChange}
      onInlineMentionRemove={onInlineMentionRemove}
      onKeyDown={onKeyDown}
      onSubmit={onSubmit}
      placeholder={placeholder}
      registerApi={(api) => {
        apiRef.current = api;
      }}
    />
  );
}
