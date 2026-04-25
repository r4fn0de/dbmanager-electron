import { describe, expect, it } from "vitest";
import { ensureParts, type AiChatMessage } from "@/features/ai/hooks/useAiChat";

describe("ensureParts", () => {
  it("returns message as-is when parts already exist", () => {
    const msg: AiChatMessage = {
      id: "1",
      role: "assistant",
      content: "hello",
      parts: [{ type: "text", text: "hello" }],
    };
    expect(ensureParts(msg)).toBe(msg);
  });

  it("creates text part from content when no toolCalls", () => {
    const msg: AiChatMessage = {
      id: "2",
      role: "assistant",
      content: "some text",
    };
    const result = ensureParts(msg);
    expect(result.parts).toEqual([{ type: "text", text: "some text" }]);
  });

  it("converts legacy toolCalls into tool-invocation parts", () => {
    // Simulate a legacy v2 storage message by casting through LegacyAiChatMessage
    const msg = {
      id: "3",
      role: "assistant",
      content: "",
      toolCalls: [
        { toolCallId: "tc-1", toolName: "runSql", input: { sql: "SELECT 1" }, result: { rows: [] } },
        { toolCallId: "tc-2", toolName: "listTables", input: {} },
      ],
    } as unknown as AiChatMessage;
    const result = ensureParts(msg);
    expect(result.parts).toHaveLength(2);
    expect(result.parts![0]).toEqual({
      type: "tool-invocation",
      toolInvocation: {
        toolCallId: "tc-1",
        toolName: "runSql",
        args: { sql: "SELECT 1" },
        result: { rows: [] },
        state: "result",
      },
    });
    expect(result.parts![1]).toEqual({
      type: "tool-invocation",
      toolInvocation: {
        toolCallId: "tc-2",
        toolName: "listTables",
        args: {},
        state: "call",
      },
    });
  });

  it("converts both toolCalls and content into parts", () => {
    const msg = {
      id: "4",
      role: "assistant",
      content: "Here is the result:",
      toolCalls: [
        { toolCallId: "tc-1", toolName: "runSql", input: { sql: "SELECT 1" } },
      ],
    } as unknown as AiChatMessage;
    const result = ensureParts(msg);
    expect(result.parts).toHaveLength(2);
    expect(result.parts![0].type).toBe("tool-invocation");
    expect(result.parts![1]).toEqual({ type: "text", text: "Here is the result:" });
  });

  it("adds empty text part for empty assistant messages", () => {
    const msg: AiChatMessage = {
      id: "5",
      role: "assistant",
      content: "",
    };
    const result = ensureParts(msg);
    expect(result.parts).toEqual([{ type: "text", text: "" }]);
  });

  it("does not add empty text part for empty user messages", () => {
    const msg: AiChatMessage = {
      id: "6",
      role: "user",
      content: "",
    };
    const result = ensureParts(msg);
    expect(result.parts).toEqual([]);
  });

  it("handles empty parts array by reconstructing", () => {
    const msg: AiChatMessage = {
      id: "7",
      role: "assistant",
      content: "hello",
      parts: [],
    };
    const result = ensureParts(msg);
    expect(result.parts).toEqual([{ type: "text", text: "hello" }]);
  });

  it("preserves other message fields", () => {
    const msg: AiChatMessage = {
      id: "8",
      role: "assistant",
      content: "text",
      createdAt: "2024-01-01T00:00:00.000Z",
      contextTag: { connectionId: "conn-1" },
      isStreaming: true,
    };
    const result = ensureParts(msg);
    expect(result.id).toBe("8");
    expect(result.role).toBe("assistant");
    expect(result.content).toBe("text");
    expect(result.createdAt).toBe("2024-01-01T00:00:00.000Z");
    expect(result.contextTag).toEqual({ connectionId: "conn-1" });
    expect(result.isStreaming).toBe(true);
  });
});
