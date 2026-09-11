import { describe, expect, it } from "vitest";
import { type AiChatMessage, ensureParts } from "@/features/ai/hooks/useAiChat";

describe("ensureParts", () => {
  it("returns message as-is when parts already exist", () => {
    const msg: AiChatMessage = {
      content: "hello",
      id: "1",
      parts: [{ text: "hello", type: "text" }],
      role: "assistant",
    };
    expect(ensureParts(msg)).toBe(msg);
  });

  it("creates text part from content when no toolCalls", () => {
    const msg: AiChatMessage = {
      content: "some text",
      id: "2",
      role: "assistant",
    };
    const result = ensureParts(msg);
    expect(result.parts).toEqual([{ text: "some text", type: "text" }]);
  });

  it("converts legacy toolCalls into tool-invocation parts", () => {
    // Simulate a legacy v2 storage message by casting through LegacyAiChatMessage
    const msg = {
      content: "",
      id: "3",
      role: "assistant",
      toolCalls: [
        {
          input: { sql: "SELECT 1" },
          result: { rows: [] },
          toolCallId: "tc-1",
          toolName: "runSql",
        },
        { input: {}, toolCallId: "tc-2", toolName: "listTables" },
      ],
    } as unknown as AiChatMessage;
    const result = ensureParts(msg);
    expect(result.parts).toHaveLength(2);
    expect(result.parts![0]).toEqual({
      toolInvocation: {
        args: { sql: "SELECT 1" },
        result: { rows: [] },
        state: "result",
        toolCallId: "tc-1",
        toolName: "runSql",
      },
      type: "tool-invocation",
    });
    expect(result.parts![1]).toEqual({
      toolInvocation: {
        args: {},
        state: "call",
        toolCallId: "tc-2",
        toolName: "listTables",
      },
      type: "tool-invocation",
    });
  });

  it("converts both toolCalls and content into parts", () => {
    const msg = {
      content: "Here is the result:",
      id: "4",
      role: "assistant",
      toolCalls: [
        { input: { sql: "SELECT 1" }, toolCallId: "tc-1", toolName: "runSql" },
      ],
    } as unknown as AiChatMessage;
    const result = ensureParts(msg);
    expect(result.parts).toHaveLength(2);
    expect(result.parts![0].type).toBe("tool-invocation");
    expect(result.parts![1]).toEqual({
      text: "Here is the result:",
      type: "text",
    });
  });

  it("adds empty text part for empty assistant messages", () => {
    const msg: AiChatMessage = {
      content: "",
      id: "5",
      role: "assistant",
    };
    const result = ensureParts(msg);
    expect(result.parts).toEqual([{ text: "", type: "text" }]);
  });

  it("does not add empty text part for empty user messages", () => {
    const msg: AiChatMessage = {
      content: "",
      id: "6",
      role: "user",
    };
    const result = ensureParts(msg);
    expect(result.parts).toEqual([]);
  });

  it("handles empty parts array by reconstructing", () => {
    const msg: AiChatMessage = {
      content: "hello",
      id: "7",
      parts: [],
      role: "assistant",
    };
    const result = ensureParts(msg);
    expect(result.parts).toEqual([{ text: "hello", type: "text" }]);
  });

  it("preserves other message fields", () => {
    const msg: AiChatMessage = {
      content: "text",
      contextTag: { connectionId: "conn-1" },
      createdAt: "2024-01-01T00:00:00.000Z",
      id: "8",
      isStreaming: true,
      role: "assistant",
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
