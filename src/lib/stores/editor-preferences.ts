import { create } from "zustand";
import { persist } from "zustand/middleware";

interface EditorPreferencesState {
  vimMode: boolean;
  setVimMode: (value: boolean) => void;
  toggleVimMode: () => void;
}

export const useEditorPreferencesStore = create<EditorPreferencesState>()(
  persist(
    (set) => ({
      vimMode: false,
      setVimMode: (value) => set({ vimMode: value }),
      toggleVimMode: () => set((state) => ({ vimMode: !state.vimMode })),
    }),
    {
      name: "editor-preferences",
      partialize: (state) => ({ vimMode: state.vimMode }),
    },
  ),
);
