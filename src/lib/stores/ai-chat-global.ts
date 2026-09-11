import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { DatabaseType } from "@/ipc/db/types";

export interface AiChatContextPreview {
  connectionLabel: string;
  dbType: DatabaseType;
  errorPreview?: string;
  selectionPreview?: string;
  tablePreview?: string;
}

export interface AiChatCurrentContext {
  connectionId: string | null;
  connectionLabel: string;
  contextPreview?: AiChatContextPreview;
  dbType: DatabaseType;
  mode: "global" | "sql-editor";
  schemaContext?: string;
  updatedAt: string;
}

interface AiChatGlobalState {
  clearSqlContext: (sourceId: string) => void;
  consumeSqlInsert: () => { key: string; text: string } | null;
  currentContext: AiChatCurrentContext;
  currentSqlContextOwner: string | null;
  isOpen: boolean;
  panelSize: number;
  pendingSqlInsert: { key: string; text: string } | null;
  requestSqlInsert: (text: string) => void;

  setOpen: (nextOpen: boolean) => void;
  setPanelSize: (nextSize: number) => void;

  setSqlContext: (
    sourceId: string,
    context: Omit<AiChatCurrentContext, "mode" | "updatedAt">
  ) => void;
  toggleOpen: () => void;
}

const DEFAULT_CONTEXT: AiChatCurrentContext = {
  connectionId: null,
  connectionLabel: "No connection",
  contextPreview: {
    connectionLabel: "No connection",
    dbType: "postgresql",
    errorPreview: "",
    selectionPreview: "",
    tablePreview: undefined,
  },
  dbType: "postgresql",
  mode: "global",
  schemaContext: undefined,
  updatedAt: new Date(0).toISOString(),
};

function nowIso() {
  return new Date().toISOString();
}

export const useAiChatGlobalStore = create<AiChatGlobalState>()(
  persist(
    (set, get) => ({
      clearSqlContext: (sourceId) =>
        set((state) => {
          if (state.currentSqlContextOwner !== sourceId) {
            return state;
          }
          return {
            currentContext: {
              ...DEFAULT_CONTEXT,
              updatedAt: nowIso(),
            },
            currentSqlContextOwner: null,
          };
        }),

      consumeSqlInsert: () => {
        const pending = get().pendingSqlInsert;
        if (!pending) {
          return null;
        }
        set({ pendingSqlInsert: null });
        return pending;
      },
      currentContext: DEFAULT_CONTEXT,
      currentSqlContextOwner: null,
      isOpen: false,
      panelSize: 30,
      pendingSqlInsert: null,

      requestSqlInsert: (text) =>
        set({
          pendingSqlInsert: {
            key: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
            text,
          },
        }),

      setOpen: (nextOpen) => set({ isOpen: nextOpen }),
      setPanelSize: (nextSize) =>
        set({
          panelSize: Math.max(
            15,
            Math.min(45, Number.isFinite(nextSize) ? nextSize : 30)
          ),
        }),

      setSqlContext: (sourceId, context) =>
        set((state) => ({
          currentContext: {
            ...state.currentContext,
            ...context,
            contextPreview: {
              ...(state.currentContext.contextPreview ?? {
                connectionLabel: context.connectionLabel,
                dbType: context.dbType,
              }),
              ...(context.contextPreview ?? {}),
            },
            mode: "sql-editor",
            updatedAt: nowIso(),
          },
          currentSqlContextOwner: sourceId,
        })),
      toggleOpen: () => set((state) => ({ isOpen: !state.isOpen })),
    }),
    {
      merge: (persisted, current) => ({
        ...current,
        ...(persisted as Partial<AiChatGlobalState>),
        pendingSqlInsert: null,
      }),
      name: "ai-chat-global-ui:v1",
      partialize: (state) => ({
        isOpen: state.isOpen,
        panelSize: state.panelSize,
      }),
    }
  )
);
