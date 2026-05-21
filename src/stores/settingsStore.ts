import { create } from "zustand";
import type { Language } from "../i18n/translations";

interface SettingsStore {
  theme: "dark";
  defaultEncoding: string;
  defaultTailLines: number;
  language: Language;
  sidebarCollapsed: boolean;
  sidebarWidth: number;
  wrapLines: boolean;
  setDefaultEncoding: (encoding: string) => void;
  setDefaultTailLines: (lines: number) => void;
  setLanguage: (lang: Language) => void;
  setSidebarCollapsed: (v: boolean) => void;
  setSidebarWidth: (w: number) => void;
  setWrapLines: (v: boolean) => void;
}

export const useSettingsStore = create<SettingsStore>((set) => ({
  theme: "dark",
  defaultEncoding: "UTF-8",
  defaultTailLines: 1000,
  language: "ko",
  sidebarCollapsed: false,
  sidebarWidth: 220,
  wrapLines: false,
  setDefaultEncoding: (encoding) => set({ defaultEncoding: encoding }),
  setDefaultTailLines: (lines) => set({ defaultTailLines: lines }),
  setLanguage: (language) => set({ language }),
  setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
  setSidebarWidth: (sidebarWidth) => set({ sidebarWidth }),
  setWrapLines: (wrapLines) => set({ wrapLines }),
}));
