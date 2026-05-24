import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { SafeModeLevel } from "./safe-mode-types";

interface SafeModeState {
  /** Per-connection safe mode levels, keyed by connection ID. */
  levels: Record<string, SafeModeLevel>;
  /** Default level for connections without an explicit setting. */
  defaultLevel: SafeModeLevel;
  setLevel: (connectionId: string, level: SafeModeLevel) => void;
  getLevel: (connectionId: string) => SafeModeLevel;
  setDefaultLevel: (level: SafeModeLevel) => void;
}

export const useSafeModeStore = create<SafeModeState>()(
  persist(
    (set, get) => ({
      levels: {},
      defaultLevel: "alert",
      setLevel: (connectionId, level) =>
        set((state) => ({
          levels: { ...state.levels, [connectionId]: level },
        })),
      getLevel: (connectionId) => {
        const state = get();
        return state.levels[connectionId] ?? state.defaultLevel;
      },
      setDefaultLevel: (level) => set({ defaultLevel: level }),
    }),
    {
      name: "safe-mode",
      partialize: (state) => ({
        levels: state.levels,
        defaultLevel: state.defaultLevel,
      }),
    },
  ),
);
