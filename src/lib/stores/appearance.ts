import { create } from "zustand";
import { persist } from "zustand/middleware";

interface AppearanceState {
  solidBackground: boolean;
  setSolidBackground: (value: boolean) => void;
}

export const useAppearanceStore = create<AppearanceState>()(
  persist(
    (set) => ({
      solidBackground: false,
      setSolidBackground: (value) => set({ solidBackground: value }),
    }),
    {
      name: "appearance:v1",
      partialize: (state) => ({
        solidBackground: state.solidBackground,
      }),
    },
  ),
);
