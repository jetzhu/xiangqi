// Per-browser records for the Daily and Rush modes (localStorage; failures are ignored).

export type RushMode = "3" | "5" | "survival";

const DAILY = "xq:daily:v1";
const RUSH = "xq:rush:v1";

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage blocked: not remembered
  }
}

/** Days (YYYY-MM-DD) on which the daily puzzle was solved. */
export const loadDailySolved = () => read<string[]>(DAILY, []);
export function markDailySolved(day: string): string[] {
  const days = loadDailySolved();
  if (!days.includes(day)) write(DAILY, [...days, day].slice(-400));
  return loadDailySolved();
}

export const loadRushBest = () => read<Partial<Record<RushMode, number>>>(RUSH, {});
/** Save a run's score; returns true if it is a new best. */
export function saveRushScore(mode: RushMode, score: number): boolean {
  const best = loadRushBest();
  if ((best[mode] ?? 0) >= score) return false;
  write(RUSH, { ...best, [mode]: score });
  return true;
}
