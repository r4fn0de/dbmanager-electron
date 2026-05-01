import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

interface AppearanceState {
  solidBackground: boolean;
  setSolidBackground: (value: boolean) => void;
  hasHydrated: boolean;
  setHasHydrated: (value: boolean) => void;
}

export const useAppearanceStore = create<AppearanceState>()(
  persist(
    (set) => ({
      solidBackground: false,
      setSolidBackground: (value) => set({ solidBackground: value }),
      hasHydrated: false,
      setHasHydrated: (value) => set({ hasHydrated: value }),
    }),
    {
      name: "appearance:v1",
      storage: createJSONStorage(() => localStorage),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
      partialize: (state) => ({
        solidBackground: state.solidBackground,
      }),
    },
  ),
);
