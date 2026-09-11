import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { SafeModeLevel } from "./safe-mode-types";

interface SafeModeState {
  /** Default level for connections without an explicit setting. */
  defaultLevel: SafeModeLevel;
  getLevel: (connectionId: string) => SafeModeLevel;
  /** Per-connection safe mode levels, keyed by connection ID. */
  levels: Record<string, SafeModeLevel>;
  setDefaultLevel: (level: SafeModeLevel) => void;
  setLevel: (connectionId: string, level: SafeModeLevel) => void;
}

export const useSafeModeStore = create<SafeModeState>()(
  persist(
    (set, get) => ({
      defaultLevel: "alert",
      getLevel: (connectionId) => {
        const state = get();
        return state.levels[connectionId] ?? state.defaultLevel;
      },
      levels: {},
      setDefaultLevel: (level) => set({ defaultLevel: level }),
      setLevel: (connectionId, level) =>
        set((state) => ({
          levels: { ...state.levels, [connectionId]: level },
        })),
    }),
    {
      name: "safe-mode",
      partialize: (state) => ({
        defaultLevel: state.defaultLevel,
        levels: state.levels,
      }),
    }
  )
);
