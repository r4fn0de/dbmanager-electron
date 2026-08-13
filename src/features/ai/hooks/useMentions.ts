import { useCallback, useRef, useState } from "react";
import {
  filterConnectionsByMention,
  getMentionState,
} from "@/features/ai/lib/mention-utils";
import type { Connection } from "@/ipc/db/types";

const WHITESPACE_AT_END_REGEX = /\s$/;
const WHITESPACE_AT_START_REGEX = /^\s/;

export interface UseMentionsState {
  activeIndex: number;
  filteredConnections: Connection[];
  isOpen: boolean;
  query: string;
  startIndex: number;
}

export interface UseMentionsReturn {
  clearMentions: () => void;
  closeMention: () => void;
  handleKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => boolean;
  handleTextChange: (text: string, cursorPos: number) => void;
  mentionState: UseMentionsState;
  removeMention: (connectionId: string) => void;
  selectedMentions: Map<string, Connection>;
  selectMention: (
    connection: Connection
  ) => { text: string; cursorPos: number } | null;
}

export function useMentions(connections: Connection[]): UseMentionsReturn {
  const [mentionState, setMentionState] = useState<UseMentionsState>({
    activeIndex: 0,
    filteredConnections: [],
    isOpen: false,
    query: "",
    startIndex: -1,
  });

  const [selectedMentions, setSelectedMentions] = useState<
    Map<string, Connection>
  >(new Map());

  const currentTextRef = useRef("");
  const cursorPosRef = useRef(0);

  const closeMention = useCallback(() => {
    setMentionState({
      activeIndex: 0,
      filteredConnections: [],
      isOpen: false,
      query: "",
      startIndex: -1,
    });
  }, []);

  const handleTextChange = useCallback(
    (text: string, cursorPos: number) => {
      currentTextRef.current = text;
      cursorPosRef.current = cursorPos;

      const state = getMentionState(text, cursorPos);
      if (!state) {
        if (mentionState.isOpen) {
          closeMention();
        }
        return;
      }

      const filtered = filterConnectionsByMention(connections, state.query);

      // If no matches and query is non-empty, still show dropdown (empty state)
      // If query is empty, show all connections
      setMentionState((prev) => ({
        activeIndex:
          prev.isOpen && prev.query === state.query
            ? Math.min(prev.activeIndex, Math.max(0, filtered.length - 1))
            : 0,
        filteredConnections: filtered,
        isOpen: true,
        query: state.query,
        startIndex: state.startIndex,
      }));
    },
    [connections, mentionState.isOpen, closeMention]
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>): boolean => {
      if (!mentionState.isOpen) {
        return false;
      }

      const { filteredConnections, activeIndex } = mentionState;

      switch (event.key) {
        case "ArrowDown": {
          event.preventDefault();
          setMentionState((prev) => ({
            ...prev,
            activeIndex:
              prev.activeIndex < prev.filteredConnections.length - 1
                ? prev.activeIndex + 1
                : 0,
          }));
          return true;
        }
        case "ArrowUp": {
          event.preventDefault();
          setMentionState((prev) => ({
            ...prev,
            activeIndex:
              prev.activeIndex > 0
                ? prev.activeIndex - 1
                : prev.filteredConnections.length - 1,
          }));
          return true;
        }
        case "Enter": {
          event.preventDefault();
          if (
            filteredConnections.length > 0 &&
            activeIndex >= 0 &&
            activeIndex < filteredConnections.length
          ) {
            // Selection handled by caller via selectMention
            return true;
          }
          closeMention();
          return true;
        }
        case "Escape": {
          event.preventDefault();
          closeMention();
          return true;
        }
        default:
          return false;
      }
    },
    [mentionState, closeMention]
  );

  const selectMention = useCallback(
    (connection: Connection): { text: string; cursorPos: number } | null => {
      const text = currentTextRef.current;
      const { startIndex, query } = mentionState;
      if (startIndex < 0) {
        return null;
      }

      const mentionEndIndex = startIndex + 1 + query.length;
      const before = text.slice(0, startIndex);
      const after = text.slice(mentionEndIndex);

      const mentionToken = `@${connection.name}`;
      const beforeEndsWithWhitespace = WHITESPACE_AT_END_REGEX.test(before);
      const afterStartsWithWhitespace = WHITESPACE_AT_START_REGEX.test(after);
      const separatorBefore = before && !beforeEndsWithWhitespace ? " " : "";
      let separatorAfter = " ";
      if (after && afterStartsWithWhitespace) {
        separatorAfter = "";
      } else if (after && !afterStartsWithWhitespace) {
        separatorAfter = " ";
      }
      const nextText = `${before}${separatorBefore}${mentionToken}${separatorAfter}${after}`;
      const cursorPos =
        startIndex +
        separatorBefore.length +
        mentionToken.length +
        separatorAfter.length;

      // Add to selected mentions map
      setSelectedMentions((prev) => {
        const next = new Map(prev);
        next.set(connection.id, connection);
        return next;
      });

      closeMention();
      return { cursorPos, text: nextText };
    },
    [mentionState, closeMention]
  );

  const removeMention = useCallback((connectionId: string) => {
    setSelectedMentions((prev) => {
      const next = new Map(prev);
      next.delete(connectionId);
      return next;
    });
  }, []);

  const clearMentions = useCallback(() => {
    setSelectedMentions(new Map());
  }, []);

  return {
    clearMentions,
    closeMention,
    handleKeyDown,
    handleTextChange,
    mentionState,
    removeMention,
    selectedMentions,
    selectMention,
  };
}
