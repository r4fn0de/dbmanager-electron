import { useCallback, useRef, useState } from "react";
import type { Connection } from "@/ipc/db/types";
import {
  getMentionState,
  filterConnectionsByMention,
} from "@/features/ai/lib/mention-utils";

export interface UseMentionsState {
  isOpen: boolean;
  query: string;
  startIndex: number;
  activeIndex: number;
  filteredConnections: Connection[];
}

export interface UseMentionsReturn {
  mentionState: UseMentionsState;
  handleTextChange: (text: string, cursorPos: number) => void;
  handleKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => boolean;
  selectMention: (
    connection: Connection,
  ) => { text: string; cursorPos: number } | null;
  closeMention: () => void;
  selectedMentions: Map<string, Connection>;
  removeMention: (connectionId: string) => void;
  clearMentions: () => void;
}

export function useMentions(connections: Connection[]): UseMentionsReturn {
  const [mentionState, setMentionState] = useState<UseMentionsState>({
    isOpen: false,
    query: "",
    startIndex: -1,
    activeIndex: 0,
    filteredConnections: [],
  });

  const [selectedMentions, setSelectedMentions] = useState<Map<string, Connection>>(new Map());

  const currentTextRef = useRef("");
  const cursorPosRef = useRef(0);

  const closeMention = useCallback(() => {
    setMentionState({
      isOpen: false,
      query: "",
      startIndex: -1,
      activeIndex: 0,
      filteredConnections: [],
    });
  }, []);

  const handleTextChange = useCallback(
    (text: string, cursorPos: number) => {
      currentTextRef.current = text;
      cursorPosRef.current = cursorPos;

      const state = getMentionState(text, cursorPos);
      if (!state) {
        if (mentionState.isOpen) closeMention();
        return;
      }

      const filtered = filterConnectionsByMention(connections, state.query);

      // If no matches and query is non-empty, still show dropdown (empty state)
      // If query is empty, show all connections
      setMentionState((prev) => ({
        isOpen: true,
        query: state.query,
        startIndex: state.startIndex,
        activeIndex:
          prev.isOpen && prev.query === state.query
            ? Math.min(prev.activeIndex, Math.max(0, filtered.length - 1))
            : 0,
        filteredConnections: filtered,
      }));
    },
    [connections, mentionState.isOpen, mentionState.query, closeMention],
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>): boolean => {
      if (!mentionState.isOpen) return false;

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
    [mentionState, closeMention],
  );

  const selectMention = useCallback(
    (connection: Connection): { text: string; cursorPos: number } | null => {
      const text = currentTextRef.current;
      const { startIndex, query } = mentionState;
      if (startIndex < 0) return null;

      const mentionEndIndex = startIndex + 1 + query.length;
      const before = text.slice(0, startIndex);
      const after = text.slice(mentionEndIndex);

      let nextText = `${before}${after}`;
      let cursorPos = startIndex;

      // Keep spacing natural when mention was in the middle of the sentence.
      const beforeEndsWithWhitespace = /\s$/.test(before);
      const afterStartsWithWhitespace = /^\s/.test(after);
      if (before && after && !beforeEndsWithWhitespace && !afterStartsWithWhitespace) {
        nextText = `${before} ${after}`;
        cursorPos = startIndex + 1;
      } else if (beforeEndsWithWhitespace && afterStartsWithWhitespace) {
        nextText = `${before}${after.slice(1)}`;
      }

      // Add to selected mentions map
      setSelectedMentions((prev) => {
        const next = new Map(prev);
        next.set(connection.id, connection);
        return next;
      });

      closeMention();
      return { text: nextText, cursorPos };
    },
    [mentionState, closeMention],
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
    mentionState,
    handleTextChange,
    handleKeyDown,
    selectMention,
    closeMention,
    selectedMentions,
    removeMention,
    clearMentions,
  };
}
