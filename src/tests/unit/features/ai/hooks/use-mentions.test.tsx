import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useMentions } from "@/features/ai/hooks/useMentions";
import type { Connection } from "@/ipc/db/types";

const productionConnection: Connection = {
  database: "app",
  db_type: "postgresql",
  host: "localhost",
  id: "production",
  name: "Production",
  password: "secret",
  port: 5432,
  ssl_mode: "disable",
  username: "postgres",
};

describe("useMentions", () => {
  it("keeps a selected mention in the middle of the prompt", () => {
    const { result } = renderHook(() => useMentions([productionConnection]));

    act(() => {
      result.current.handleTextChange("ask @pro now", 8);
    });

    let selection: { text: string; cursorPos: number } | null = null;
    act(() => {
      selection = result.current.selectMention(productionConnection);
    });

    expect(selection).toEqual({
      cursorPos: 15,
      text: "ask @Production now",
    });
    expect(Array.from(result.current.selectedMentions.keys())).toEqual([
      "production",
    ]);
  });

  it("adds a trailing separator when a mention is selected at the end", () => {
    const { result } = renderHook(() => useMentions([productionConnection]));

    act(() => {
      result.current.handleTextChange("ask @pro", 8);
    });

    let selection: { text: string; cursorPos: number } | null = null;
    act(() => {
      selection = result.current.selectMention(productionConnection);
    });

    expect(selection).toEqual({
      cursorPos: 16,
      text: "ask @Production ",
    });
  });

  it("removes and clears selected mentions without affecting text", () => {
    const { result } = renderHook(() => useMentions([productionConnection]));

    act(() => {
      result.current.handleTextChange("@pro", 4);
    });
    act(() => {
      result.current.selectMention(productionConnection);
    });
    expect(result.current.selectedMentions).toHaveProperty("size", 1);

    act(() => {
      result.current.removeMention(productionConnection.id);
    });
    expect(result.current.selectedMentions).toHaveProperty("size", 0);
  });
});
