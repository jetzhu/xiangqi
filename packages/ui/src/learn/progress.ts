// Lesson progress in IndexedDB (per browser). Failures fall back to "nothing saved".
import { createStore, get, set } from "idb-keyval";
import { recordActivity } from "../streak.js";

export type LessonStatus = "new" | "started" | "mastered";
export type Progress = Record<string, LessonStatus>;

const store = typeof indexedDB !== "undefined" ? createStore("xq-v1-lessons", "lessons") : undefined;

export async function loadProgress(): Promise<Progress> {
  if (!store) return {};
  try {
    return (await get<Progress>("progress", store)) ?? {};
  } catch {
    return {};
  }
}

export async function setStatus(lessonId: string, status: LessonStatus): Promise<Progress> {
  if (status === "mastered") recordActivity();
  const p = await loadProgress();
  if (p[lessonId] === "mastered" && status !== "mastered") return p; // never downgrade
  p[lessonId] = status;
  try {
    if (store) await set("progress", p, store);
  } catch {
    // storage blocked: progress just isn't remembered
  }
  return p;
}
