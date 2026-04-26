/**
 * Pure utilities for @mention detection, insertion, and parsing.
 *
 * These functions are framework-agnostic and easily testable.
 */
import type { Connection } from "@/ipc/db/types";

export interface MentionState {
  isInMention: boolean;
  startIndex: number;
  query: string;
}

/**
 * Detects whether the cursor is positioned inside a potential mention
 * (i.e. immediately after an unescaped "@" with optional trailing word chars).
 *
 * Returns `null` when the cursor is NOT inside a mention context.
 */
export function getMentionState(
  text: string,
  cursorPos: number,
): MentionState | null {
  // Cursor must be at least 1 char after a potential "@"
  if (cursorPos < 1) return null;

  // Walk backwards from cursor to find the nearest "@"
  let atIndex = -1;
  for (let i = cursorPos - 1; i >= 0; i--) {
    const ch = text[i];
    if (ch === "@") {
      atIndex = i;
      break;
    }
    // Mention query stops at whitespace or newline
    if (/\s/.test(ch)) break;
  }

  if (atIndex === -1) return null;

  // Ensure "@" is preceded by whitespace or start-of-string
  // (so "email@domain" doesn't trigger)
  if (atIndex > 0) {
    const prevChar = text[atIndex - 1];
    if (!/\s/.test(prevChar)) return null;
  }

  const query = text.slice(atIndex + 1, cursorPos);

  // If query contains whitespace, the user left the mention context
  if (/\s/.test(query)) return null;

  return {
    isInMention: true,
    startIndex: atIndex,
    query,
  };
}

/**
 * Replaces the mention token (from startIndex, spanning queryLength chars)
 * with the selected connection name, appending a trailing space.
 */
export function insertMention(
  text: string,
  startIndex: number,
  queryLength: number,
  connectionName: string,
): string {
  const before = text.slice(0, startIndex);
  const after = text.slice(startIndex + 1 + queryLength);
  return `${before}@${connectionName} ${after}`;
}

/**
 * Extracts all valid mention names from a message.
 * A mention is "@word" preceded by whitespace or start-of-string.
 */
export function parseMentions(text: string): string[] {
  const mentions: string[] = [];
  const regex = /(?:^|\s)@(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    mentions.push(match[1]);
  }
  return mentions;
}

/**
 * Filters connections by a mention query (case-insensitive, partial match on name).
 */
export function filterConnectionsByMention(
  connections: Connection[],
  query: string,
): Connection[] {
  const q = query.trim().toLowerCase();
  if (!q) return connections;
  return connections.filter((c) => c.name.toLowerCase().includes(q));
}

/**
 * Finds a connection by its exact mention name (case-insensitive).
 */
export function findConnectionByMentionName(
  connections: Connection[],
  name: string,
): Connection | undefined {
  const lower = name.toLowerCase();
  return connections.find((c) => c.name.toLowerCase() === lower);
}
