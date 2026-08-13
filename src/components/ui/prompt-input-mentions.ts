export type PromptInputMention = {
  id: string
  label: string
}

export type PromptInputMentionSegment = {
  type: "mention"
  mention: PromptInputMention
  token: string
  start: number
  end: number
}

export type PromptInputTextSegment = {
  type: "text"
  text: string
  start: number
  end: number
}

export type PromptInputSegment =
  | PromptInputMentionSegment
  | PromptInputTextSegment

export const PROMPT_INPUT_MENTION_ATTRIBUTE = "data-prompt-mention-token"

function isTokenBoundary(value: string, index: number): boolean {
  return index === 0 || /\s/.test(value[index - 1] ?? "")
}

function isTokenEnd(value: string, index: number): boolean {
  return index === value.length || /\s/.test(value[index] ?? "")
}

export function splitPromptInputMentions(
  value: string,
  mentions: readonly PromptInputMention[],
): PromptInputSegment[] {
  const candidates: PromptInputMentionSegment[] = []

  for (const mention of mentions) {
    const token = `@${mention.label}`
    if (token.length <= 1) {
      continue
    }

    let searchStart = 0
    while (searchStart < value.length) {
      const start = value.indexOf(token, searchStart)
      if (start < 0) {
        break
      }

      const end = start + token.length
      if (isTokenBoundary(value, start) && isTokenEnd(value, end)) {
        candidates.push({
          end,
          mention,
          start,
          token,
          type: "mention",
        })
      }
      searchStart = start + token.length
    }
  }

  candidates.sort(
    (left, right) =>
      left.start - right.start || right.token.length - left.token.length,
  )

  const segments: PromptInputSegment[] = []
  let cursor = 0

  for (const candidate of candidates) {
    if (candidate.start < cursor) {
      continue
    }

    if (candidate.start > cursor) {
      segments.push({
        end: candidate.start,
        start: cursor,
        text: value.slice(cursor, candidate.start),
        type: "text",
      })
    }
    segments.push(candidate)
    cursor = candidate.end
  }

  if (cursor < value.length) {
    segments.push({
      end: value.length,
      start: cursor,
      text: value.slice(cursor),
      type: "text",
    })
  }

  if (segments.length === 0 && value.length > 0) {
    return [{ end: value.length, start: 0, text: value, type: "text" }]
  }

  return segments
}

function isMentionElement(node: Node): node is HTMLElement {
  return (
    node.nodeType === Node.ELEMENT_NODE &&
    (node as HTMLElement).hasAttribute(PROMPT_INPUT_MENTION_ATTRIBUTE)
  )
}

function getMentionToken(node: HTMLElement): string {
  return node.getAttribute(PROMPT_INPUT_MENTION_ATTRIBUTE) ?? ""
}

function getNodeTextLength(node: Node): number {
  if (isMentionElement(node)) {
    return getMentionToken(node).length
  }
  if (node.nodeType === Node.TEXT_NODE) {
    return node.nodeValue?.length ?? 0
  }
  if (node.nodeName === "BR") {
    return 1
  }

  let length = 0
  for (const child of node.childNodes) {
    length += getNodeTextLength(child)
  }
  return length
}

export function serializePromptInput(root: HTMLElement): string {
  const parts: string[] = []

  const appendNode = (node: Node): void => {
    if (isMentionElement(node)) {
      parts.push(getMentionToken(node))
      return
    }
    if (node.nodeType === Node.TEXT_NODE) {
      parts.push(node.nodeValue ?? "")
      return
    }
    if (node.nodeName === "BR") {
      parts.push("\n")
      return
    }
    for (const child of node.childNodes) {
      appendNode(child)
    }
  }

  for (const child of root.childNodes) {
    appendNode(child)
  }
  return parts.join("")
}

function getOffsetToPoint(
  node: Node,
  target: Node,
  targetOffset: number,
): number | null {
  if (node === target) {
    if (isMentionElement(node)) {
      return targetOffset === 0 ? 0 : getMentionToken(node).length
    }
    if (node.nodeType === Node.TEXT_NODE) {
      return Math.min(targetOffset, node.nodeValue?.length ?? 0)
    }
    if (node.nodeName === "BR") {
      return targetOffset === 0 ? 0 : 1
    }

    let offset = 0
    const children = Array.from(node.childNodes)
    for (let index = 0; index < Math.min(targetOffset, children.length); index += 1) {
      offset += getNodeTextLength(children[index])
    }
    return offset
  }

  if (isMentionElement(node) || node.nodeType === Node.TEXT_NODE || node.nodeName === "BR") {
    return null
  }

  let offset = 0
  for (const child of node.childNodes) {
    const childOffset = getOffsetToPoint(child, target, targetOffset)
    if (childOffset !== null) {
      return offset + childOffset
    }
    offset += getNodeTextLength(child)
  }
  return null
}

export function getPromptInputCursorOffset(root: HTMLElement): number {
  const selection = root.ownerDocument.defaultView?.getSelection()
  const anchorNode = selection?.anchorNode
  if (!anchorNode || (anchorNode !== root && !root.contains(anchorNode))) {
    return serializePromptInput(root).length
  }

  return (
    getOffsetToPoint(root, anchorNode, selection?.anchorOffset ?? 0) ??
    serializePromptInput(root).length
  )
}

type PromptInputSelectionPoint = {
  node: Node
  offset: number
}

function findPointAtOffset(
  node: Node,
  remaining: { value: number },
): PromptInputSelectionPoint | null {
  if (isMentionElement(node)) {
    const parent = node.parentNode
    if (!parent) {
      return null
    }
    const index = Array.prototype.indexOf.call(parent.childNodes, node)
    if (remaining.value <= 0) {
      return { node: parent, offset: index }
    }
    if (remaining.value <= getMentionToken(node).length) {
      return { node: parent, offset: index + 1 }
    }
    remaining.value -= getMentionToken(node).length
    return null
  }

  if (node.nodeType === Node.TEXT_NODE) {
    const length = node.nodeValue?.length ?? 0
    if (remaining.value <= length) {
      return { node, offset: remaining.value }
    }
    remaining.value -= length
    return null
  }

  if (node.nodeName === "BR") {
    const parent = node.parentNode
    if (!parent) {
      return null
    }
    const index = Array.prototype.indexOf.call(parent.childNodes, node)
    if (remaining.value <= 0) {
      return { node: parent, offset: index }
    }
    if (remaining.value === 1) {
      return { node: parent, offset: index + 1 }
    }
    remaining.value -= 1
    return null
  }

  for (const child of node.childNodes) {
    const point = findPointAtOffset(child, remaining)
    if (point) {
      return point
    }
  }

  if (remaining.value === 0) {
    return { node, offset: node.childNodes.length }
  }
  return null
}

export function setPromptInputCursorOffset(
  root: HTMLElement,
  cursorOffset: number,
): void {
  const selection = root.ownerDocument.defaultView?.getSelection()
  if (!selection) {
    return
  }

  const remaining = {
    value: Math.max(0, Math.min(cursorOffset, serializePromptInput(root).length)),
  }
  const point =
    findPointAtOffset(root, remaining) ??
    ({ node: root, offset: root.childNodes.length } satisfies PromptInputSelectionPoint)
  const range = root.ownerDocument.createRange()
  range.setStart(point.node, point.offset)
  range.collapse(true)
  selection.removeAllRanges()
  selection.addRange(range)
}
