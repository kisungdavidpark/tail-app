import { create } from "zustand";
import { Bookmark } from "../types";

interface BookmarkStore {
  bookmarks: Bookmark[];
  addBookmark: (bookmark: Omit<Bookmark, "id">) => void;
  removeBookmark: (id: string) => void;
  updateBookmark: (id: string, updates: Partial<Bookmark>) => void;
}

export const useBookmarkStore = create<BookmarkStore>((set) => ({
  bookmarks: [],

  addBookmark: (bookmarkData) => {
    const id = `bm-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    set((state) => ({
      bookmarks: [...state.bookmarks, { ...bookmarkData, id }],
    }));
  },

  removeBookmark: (id) => {
    set((state) => ({
      bookmarks: state.bookmarks.filter((b) => b.id !== id),
    }));
  },

  updateBookmark: (id, updates) => {
    set((state) => ({
      bookmarks: state.bookmarks.map((b) =>
        b.id === id ? { ...b, ...updates } : b
      ),
    }));
  },
}));
