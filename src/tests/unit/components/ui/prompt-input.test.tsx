import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PromptInput, PromptInputTextarea } from "@/components/ui/prompt-input";
import { setPromptInputCursorOffset } from "@/components/ui/prompt-input-mentions";

describe("PromptInputTextarea", () => {
  it("renders selected mentions inline in the prompt flow", () => {
    render(
      <PromptInput value="antes @Production depois">
        <PromptInputTextarea
          inlineMentions={[{ id: "production", label: "Production" }]}
        />
      </PromptInput>
    );

    const editor = screen.getByRole("textbox");
    const mentionElement = editor.querySelector("[data-prompt-mention-token]");

    expect(mentionElement?.getAttribute("data-prompt-mention-token")).toBe(
      "@Production"
    );
    expect(editor.textContent).toContain("antes ");
    expect(editor.textContent).toContain("Production");
    expect(editor.textContent).toContain(" depois");
  });

  it("removes an adjacent mention atomically with Backspace", () => {
    const onValueChange = vi.fn();
    const onInlineMentionRemove = vi.fn();
    render(
      <PromptInput
        onValueChange={onValueChange}
        value="antes @Production depois"
      >
        <PromptInputTextarea
          inlineMentions={[{ id: "production", label: "Production" }]}
          onInlineMentionRemove={onInlineMentionRemove}
        />
      </PromptInput>
    );

    const editor = screen.getByRole("textbox");
    setPromptInputCursorOffset(editor, 17);
    fireEvent.keyDown(editor, { key: "Backspace" });

    expect(onValueChange).toHaveBeenCalledWith("antes depois");
    expect(onInlineMentionRemove).toHaveBeenCalledWith(
      { id: "production", label: "Production" },
      6,
      17
    );
  });

  it("submits on Enter and keeps Shift+Enter available for new lines", () => {
    const onSubmit = vi.fn();
    render(
      <PromptInput onSubmit={onSubmit} value="prompt">
        <PromptInputTextarea />
      </PromptInput>
    );

    const editor = screen.getByRole("textbox");
    editor.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, key: "Enter" })
    );
    expect(onSubmit).toHaveBeenCalledOnce();

    editor.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        key: "Enter",
        shiftKey: true,
      })
    );
    expect(onSubmit).toHaveBeenCalledOnce();
  });
});
