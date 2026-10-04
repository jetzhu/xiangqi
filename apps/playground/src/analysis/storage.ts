// Saved analyses in IndexedDB (per browser). Errors (private mode, blocked storage) are
// reported to the caller rather than thrown into React.

import { createStore, del, entries, set } from "idb-keyval";

export interface SavedAnalysis {
  id: string;
  title: string;
  pgn: string;
  savedAt: string;
}

const store = typeof indexedDB !== "undefined" ? createStore("xq-v1", "analyses") : undefined;

export async function listSaved(): Promise<SavedAnalysis[]> {
  if (!store) return [];
  const all = await entries<string, SavedAnalysis>(store);
  return all.map(([, v]) => v).sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

export async function saveAnalysis(title: string, pgn: string): Promise<SavedAnalysis> {
  if (!store) throw new Error("storage is not available in this browser");
  const item: SavedAnalysis = { id: crypto.randomUUID(), title: title.trim() || "Untitled analysis", pgn, savedAt: new Date().toISOString() };
  await set(item.id, item, store);
  return item;
}

export async function deleteSaved(id: string): Promise<void> {
  if (store) await del(id, store);
}
