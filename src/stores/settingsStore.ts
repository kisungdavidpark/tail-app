import { create } from "zustand";

interface SettingsStore {
  theme: "dark";
  defaultEncoding: string;
  defaultTailLines: number;
  setDefaultEncoding: (encoding: string) => void;
  setDefaultTailLines: (lines: number) => void;
}

export const useSettingsStore = create<SettingsStore>((set) => ({
  theme: "dark",
  defaultEncoding: "UTF-8",
  defaultTailLines: 1000,
  setDefaultEncoding: (encoding) => set({ defaultEncoding: encoding }),
  setDefaultTailLines: (lines) => set({ defaultTailLines: lines }),
}));
