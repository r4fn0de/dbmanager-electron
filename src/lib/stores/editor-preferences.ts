import { create } from "zustand";
import { persist } from "zustand/middleware";

interface EditorPreferencesState {
  setVimMode: (value: boolean) => void;
  toggleVimMode: () => void;
  vimMode: boolean;
}

export const useEditorPreferencesStore = create<EditorPreferencesState>()(
  persist(
    (set) => ({
      setVimMode: (value) => set({ vimMode: value }),
      toggleVimMode: () => set((state) => ({ vimMode: !state.vimMode })),
      vimMode: false,
    }),
    {
      name: "editor-preferences",
      partialize: (state) => ({ vimMode: state.vimMode }),
    }
  )
);
