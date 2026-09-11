import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

interface AppearanceState {
  hasHydrated: boolean;
  setHasHydrated: (value: boolean) => void;
  setSolidBackground: (value: boolean) => void;
  setThemePreset: (value: "default" | "neo") => void;
  solidBackground: boolean;
  themePreset: "default" | "neo";
}

export const useAppearanceStore = create<AppearanceState>()(
  persist(
    (set) => ({
      hasHydrated: false,
      setHasHydrated: (value) => set({ hasHydrated: value }),
      setSolidBackground: (value) => set({ solidBackground: value }),
      setThemePreset: (value) => set({ themePreset: value }),
      solidBackground: false,
      themePreset: "default",
    }),
    {
      name: "appearance:v2",
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
      partialize: (state) => ({
        solidBackground: state.solidBackground,
        themePreset: state.themePreset,
      }),
      storage: createJSONStorage(() => localStorage),
    }
  )
);
