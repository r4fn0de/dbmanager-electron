import { describe, expect, it } from "vitest";
import {
  getPromptInputCursorOffset,
  PROMPT_INPUT_MENTION_ATTRIBUTE,
  serializePromptInput,
  setPromptInputCursorOffset,
  splitPromptInputMentions,
} from "@/components/ui/prompt-input-mentions";

describe("splitPromptInputMentions", () => {
  it("keeps selected mentions inline with surrounding text", () => {
    expect(
      splitPromptInputMentions("antes @Produção depois", [
        { id: "production", label: "Produção" },
      ])
    ).toEqual([
      { end: 6, start: 0, text: "antes ", type: "text" },
      {
        end: 15,
        mention: { id: "production", label: "Produção" },
        start: 6,
        token: "@Produção",
        type: "mention",
      },
      { end: 22, start: 15, text: " depois", type: "text" },
    ]);
  });

  it("leaves unselected mentions as plain text", () => {
    expect(
      splitPromptInputMentions("use @Produção e @Staging", [
        { id: "production", label: "Produção" },
      ])
    ).toEqual([
      { end: 4, start: 0, text: "use ", type: "text" },
      {
        end: 13,
        mention: { id: "production", label: "Produção" },
        start: 4,
        token: "@Produção",
        type: "mention",
      },
      { end: 24, start: 13, text: " e @Staging", type: "text" },
    ]);
  });

  it("does not match a mention inside another token", () => {
    expect(
      splitPromptInputMentions("email@Produção.com", [
        { id: "production", label: "Produção" },
      ])
    ).toEqual([
      { end: 18, start: 0, text: "email@Produção.com", type: "text" },
    ]);
  });
});

describe("prompt input DOM serialization", () => {
  it("serializes text, inline mention spans, and line breaks", () => {
    const root = document.createElement("div");
    root.append("antes ");
    const mention = document.createElement("span");
    mention.setAttribute(PROMPT_INPUT_MENTION_ATTRIBUTE, "@Produção");
    mention.textContent = "Produção";
    root.append(mention, " depois", document.createElement("br"), "fim");

    expect(serializePromptInput(root)).toBe("antes @Produção depois\nfim");
  });

  it("reads the cursor before and after a mention span", () => {
    const root = document.createElement("div");
    root.append("antes ");
    const mention = document.createElement("span");
    mention.setAttribute(PROMPT_INPUT_MENTION_ATTRIBUTE, "@Produção");
    mention.textContent = "Produção";
    root.append(mention, " depois");
    document.body.append(root);

    const selection = window.getSelection();
    const before = document.createRange();
    before.setStart(root, 1);
    before.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(before);
    expect(getPromptInputCursorOffset(root)).toBe(6);

    const after = document.createRange();
    after.setStart(root, 2);
    after.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(after);
    expect(getPromptInputCursorOffset(root)).toBe(15);
  });

  it("restores the cursor to the requested serialized offset", () => {
    const root = document.createElement("div");
    root.append("antes ");
    const mention = document.createElement("span");
    mention.setAttribute(PROMPT_INPUT_MENTION_ATTRIBUTE, "@Produção");
    mention.textContent = "Produção";
    root.append(mention, " depois");
    document.body.append(root);

    setPromptInputCursorOffset(root, 15);

    const selection = window.getSelection();
    expect(selection?.anchorNode).toBe(root);
    expect(selection?.anchorOffset).toBe(2);
  });
});
