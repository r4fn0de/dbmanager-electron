"use client"

import {
  getPromptInputCursorOffset,
  PROMPT_INPUT_MENTION_ATTRIBUTE,
  serializePromptInput,
  setPromptInputCursorOffset,
  splitPromptInputMentions,
  type PromptInputMention,
} from "@/components/ui/prompt-input-mentions"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import React, {
  createContext,
  use,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"

type PromptInputContextType = {
  isLoading: boolean
  value: string
  setValue: (value: string) => void
  onCursorChange?: (value: string, cursorPos: number) => void
  maxHeight: number | string
  onSubmit?: () => void
  disabled?: boolean
  editorRef: React.RefObject<HTMLDivElement | null>
}

const PromptInputContext = createContext<PromptInputContextType>({
  isLoading: false,
  value: "",
  setValue: () => {},
  onCursorChange: undefined,
  maxHeight: 240,
  onSubmit: undefined,
  disabled: false,
  editorRef: React.createRef<HTMLDivElement>(),
})

function usePromptInput() {
  return use(PromptInputContext)
}

export type PromptInputProps = {
  isLoading?: boolean
  value?: string
  onValueChange?: (value: string) => void
  onCursorChange?: (value: string, cursorPos: number) => void
  maxHeight?: number | string
  onSubmit?: () => void
  children: React.ReactNode
  className?: string
  disabled?: boolean
} & React.ComponentProps<"div">

function PromptInput({
  className,
  isLoading = false,
  maxHeight = 240,
  value,
  onValueChange,
  onCursorChange,
  onSubmit,
  children,
  disabled = false,
  onClick,
  ...props
}: PromptInputProps) {
  const [internalValue, setInternalValue] = useState(value || "")
  const editorRef = useRef<HTMLDivElement>(null)

  const updatePromptValue = (newValue: string) => {
    setInternalValue(newValue)
    onValueChange?.(newValue)
  }

  const focusEditorFromContainer: React.MouseEventHandler<HTMLDivElement> = (e) => {
    if (!disabled) editorRef.current?.focus()
    onClick?.(e)
  }

  return (
    <TooltipProvider>
      <PromptInputContext.Provider
        value={{
          isLoading,
          value: value ?? internalValue,
          setValue: onValueChange ?? updatePromptValue,
          onCursorChange,
          maxHeight,
          onSubmit,
          disabled,
          editorRef,
        }}
      >
        <div
          role="button"
          tabIndex={disabled ? -1 : 0}
          onClick={focusEditorFromContainer}
          onKeyDown={(event) => {
            if (event.target !== event.currentTarget) return
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault()
              if (!disabled) editorRef.current?.focus()
            }
          }}
          className={cn(
            "border-input bg-background cursor-text rounded-3xl p-2 shadow-xs",
            disabled && "cursor-not-allowed opacity-60",
            className,
          )}
          {...props}
        >
          {children}
        </div>
      </PromptInputContext.Provider>
    </TooltipProvider>
  )
}

export type PromptInputTextareaProps = {
  disableAutosize?: boolean
  inlineMentions?: readonly PromptInputMention[]
  onInlineMentionRemove?: (mention: PromptInputMention, start: number, end: number) => void
  onKeyDown?: React.KeyboardEventHandler<HTMLDivElement>
  placeholder?: string
  ref?: React.Ref<HTMLDivElement>
} & Omit<
  React.HTMLAttributes<HTMLDivElement>,
  "children" | "contentEditable" | "onInput" | "onKeyDown"
>

function appendPromptInputText(
  fragment: DocumentFragment,
  document: Document,
  text: string,
): void {
  const lines = text.split("\n")
  for (const [index, line] of lines.entries()) {
    if (line) {
      fragment.append(document.createTextNode(line))
    }
    if (index < lines.length - 1) {
      fragment.append(document.createElement("br"))
    }
  }
}

function PromptInputTextarea({
  className,
  onKeyDown,
  disableAutosize = false,
  inlineMentions = [],
  onInlineMentionRemove,
  placeholder,
  ref: forwardedRef,
  ...props
}: PromptInputTextareaProps) {
  const { value, setValue, onCursorChange, maxHeight, onSubmit, disabled, editorRef } =
    usePromptInput()
  const internalEditorRef = useRef<HTMLDivElement | null>(null)
  const pendingCursorRef = useRef<number | null>(null)
  const segments = useMemo(
    () => splitPromptInputMentions(value, inlineMentions),
    [inlineMentions, value],
  )

  const adjustHeight = (element: HTMLDivElement | null) => {
    if (!element || disableAutosize) return

    element.style.height = "auto"

    if (typeof maxHeight === "number") {
      element.style.height = `${Math.min(element.scrollHeight, maxHeight)}px`
    } else {
      element.style.height = `min(${element.scrollHeight}px, ${maxHeight})`
    }
  }

  const handleRef = (element: HTMLDivElement | null) => {
    internalEditorRef.current = element
    editorRef.current = element
    if (typeof forwardedRef === "function") {
      forwardedRef(element)
    } else if (forwardedRef) {
      forwardedRef.current = element
    }
    adjustHeight(element)
  }

  const mentionSignature = useMemo(
    () =>
      segments
        .filter((segment) => segment.type === "mention")
        .map(
          (segment) =>
            `${segment.start}:${segment.end}:${segment.mention.id}:${segment.token}`,
        )
        .join("|"),
    [segments],
  )

  useLayoutEffect(() => {
    const editor = internalEditorRef.current
    if (!editor) {
      return
    }

    const currentValue = serializePromptInput(editor)
    const currentSignature = editor.dataset.promptInputMentionSignature ?? ""
    if (currentValue === value && currentSignature === mentionSignature) {
      adjustHeight(editor)
      return
    }

    const cursorPos = pendingCursorRef.current ?? getPromptInputCursorOffset(editor)
    const fragment = editor.ownerDocument.createDocumentFragment()
    for (const segment of segments) {
      if (segment.type === "text") {
        appendPromptInputText(fragment, editor.ownerDocument, segment.text)
        continue
      }

      const mentionElement = editor.ownerDocument.createElement("span")
      mentionElement.className =
        "inline-flex max-w-full select-none items-center rounded bg-primary/10 px-1 font-medium text-primary align-baseline"
      mentionElement.contentEditable = "false"
      mentionElement.setAttribute("data-prompt-input-mention-id", segment.mention.id)
      mentionElement.setAttribute(PROMPT_INPUT_MENTION_ATTRIBUTE, segment.token)
      mentionElement.title = segment.mention.label
      mentionElement.textContent = `@${segment.mention.label}`
      fragment.append(mentionElement)
    }

    editor.replaceChildren(fragment)
    editor.dataset.promptInputMentionSignature = mentionSignature
    pendingCursorRef.current = null
    if (editor.ownerDocument.activeElement === editor) {
      setPromptInputCursorOffset(editor, cursorPos)
    }
    adjustHeight(editor)
  }, [mentionSignature, maxHeight, disableAutosize, segments, value])

  const removeMentionAtCursor = (event: React.KeyboardEvent<HTMLDivElement>): boolean => {
    if (event.key !== "Backspace" && event.key !== "Delete") {
      return false
    }

    const editor = internalEditorRef.current
    if (!editor) {
      return false
    }

    const cursorPos = getPromptInputCursorOffset(editor)
    const mention =
      event.key === "Backspace"
        ? segments.find((segment) => segment.type === "mention" && segment.end === cursorPos)
        : segments.find((segment) => segment.type === "mention" && segment.start === cursorPos)

    if (!mention || mention.type !== "mention") {
      return false
    }

    event.preventDefault()
    event.stopPropagation()
    const beforeMention = value.slice(0, mention.start)
    const afterMention = value.slice(mention.end)
    const hasDuplicateSpacing = /\s$/.test(beforeMention) && /^\s/.test(afterMention)
    const nextValue = `${beforeMention}${hasDuplicateSpacing ? afterMention.slice(1) : afterMention}`
    pendingCursorRef.current = mention.start
    setValue(nextValue)
    onCursorChange?.(nextValue, mention.start)
    onInlineMentionRemove?.(mention.mention, mention.start, mention.end)

    requestAnimationFrame(() => {
      const nextEditor = internalEditorRef.current
      if (!nextEditor) return
      nextEditor.focus()
      setPromptInputCursorOffset(nextEditor, mention.start)
      adjustHeight(nextEditor)
    })
    return true
  }

  const updateEditorValue = (event: React.FormEvent<HTMLDivElement>) => {
    const editor = event.currentTarget
    const nextValue = serializePromptInput(editor)
    const cursorPos = getPromptInputCursorOffset(editor)
    setValue(nextValue)
    onCursorChange?.(nextValue, cursorPos)
    adjustHeight(editor)
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (removeMentionAtCursor(event)) {
      return
    }

    onKeyDown?.(event)

    if (event.key === "Enter" && !event.shiftKey && !event.defaultPrevented) {
      event.preventDefault()
      onSubmit?.()
    }
  }

  return (
    <div className="relative w-full">
      <div
        aria-multiline="true"
        aria-placeholder={placeholder}
        contentEditable={!disabled}
        onInput={updateEditorValue}
        onKeyDown={handleKeyDown}
        ref={handleRef}
        role="textbox"
        suppressContentEditableWarning
        className={cn(
          "text-foreground field-sizing-fixed min-h-11 w-full resize-none overflow-y-auto whitespace-pre-wrap break-words border-none bg-transparent py-2 shadow-none outline-none focus-visible:ring-0 focus-visible:ring-offset-0",
          !value && "empty:before:pointer-events-none empty:before:text-muted-foreground/50 empty:before:content-[attr(aria-placeholder)]",
          className,
        )}
        {...props}
      />
    </div>
  )
}

export type PromptInputActionsProps = React.HTMLAttributes<HTMLDivElement>

function PromptInputActions({
  children,
  className,
  ...props
}: PromptInputActionsProps) {
  return (
    <div className={cn("flex items-center gap-2", className)} {...props}>
      {children}
    </div>
  )
}

export type PromptInputActionProps = {
  className?: string
  tooltip: React.ReactNode
  children: React.ReactNode
  side?: "top" | "bottom" | "left" | "right"
} & React.ComponentProps<typeof Tooltip>

function PromptInputAction({
  tooltip,
  children,
  className,
  side = "top",
  ...props
}: PromptInputActionProps) {
  const { disabled } = usePromptInput()

  return (
    <Tooltip {...props}>
      <TooltipTrigger
        disabled={disabled}
        onClick={(event) => event.stopPropagation()}
      >
        {children}
      </TooltipTrigger>
      <TooltipContent side={side} className={className}>
        {tooltip}
      </TooltipContent>
    </Tooltip>
  )
}

export {
  PromptInput,
  PromptInputTextarea,
  PromptInputActions,
  PromptInputAction,
}
