import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { DatabaseType } from "@/ipc/db/types";

export interface AiChatContextPreview {
  connectionLabel: string;
  dbType: DatabaseType;
  selectionPreview?: string;
  errorPreview?: string;
}

export interface AiChatCurrentContext {
  mode: "global" | "sql-editor";
  connectionId: string | null;
  connectionLabel: string;
  dbType: DatabaseType;
  schemaContext?: string;
  contextPreview?: AiChatContextPreview;
  updatedAt: string;
}

interface AiChatGlobalState {
  isOpen: boolean;
  panelSize: number;
  currentContext: AiChatCurrentContext;
  currentSqlContextOwner: string | null;

  setOpen: (nextOpen: boolean) => void;
  toggleOpen: () => void;
  setPanelSize: (nextSize: number) => void;

  setSqlContext: (sourceId: string, context: Omit<AiChatCurrentContext, "mode" | "updatedAt">) => void;
  clearSqlContext: (sourceId: string) => void;
}

const DEFAULT_CONTEXT: AiChatCurrentContext = {
  mode: "global",
  connectionId: null,
  connectionLabel: "Sem conexão",
  dbType: "postgresql",
  schemaContext: undefined,
  contextPreview: {
    connectionLabel: "Sem conexão",
    dbType: "postgresql",
    selectionPreview: "",
    errorPreview: "",
  },
  updatedAt: new Date(0).toISOString(),
};

function nowIso() {
  return new Date().toISOString();
}

export const useAiChatGlobalStore = create<AiChatGlobalState>()(
  persist(
    (set) => ({
      isOpen: false,
      panelSize: 30,
      currentContext: DEFAULT_CONTEXT,
      currentSqlContextOwner: null,

      setOpen: (nextOpen) => set({ isOpen: nextOpen }),
      toggleOpen: () => set((state) => ({ isOpen: !state.isOpen })),
      setPanelSize: (nextSize) =>
        set({ panelSize: Math.max(15, Math.min(45, Number.isFinite(nextSize) ? nextSize : 30)) }),

      setSqlContext: (sourceId, context) =>
        set({
          currentSqlContextOwner: sourceId,
          currentContext: {
            ...context,
            mode: "sql-editor",
            updatedAt: nowIso(),
          },
        }),

      clearSqlContext: (sourceId) =>
        set((state) => {
          if (state.currentSqlContextOwner !== sourceId) {
            return state;
          }
          return {
            currentSqlContextOwner: null,
            currentContext: {
              ...DEFAULT_CONTEXT,
              updatedAt: nowIso(),
            },
          };
        }),
    }),
    {
      name: "ai-chat-global-ui:v1",
      partialize: (state) => ({
        isOpen: state.isOpen,
        panelSize: state.panelSize,
      }),
    },
  ),
);
