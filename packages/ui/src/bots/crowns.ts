// Crowns: which bots this browser has beaten (IndexedDB; failures are ignored).
import { createStore, get, set } from "idb-keyval";

const store = typeof indexedDB !== "undefined" ? createStore("xq-v1-bots", "bots") : undefined;

export async function loadCrowns(): Promise<string[]> {
  if (!store) return [];
  try {
    return (await get<string[]>("crowns", store)) ?? [];
  } catch {
    return [];
  }
}

export async function addCrown(botId: string): Promise<string[]> {
  const crowns = await loadCrowns();
  if (!crowns.includes(botId)) crowns.push(botId);
  try {
    if (store) await set("crowns", crowns, store);
  } catch {
    // storage blocked: the crown just isn't remembered
  }
  return crowns;
}
