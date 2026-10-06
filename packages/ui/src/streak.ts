// Daily streak, kept per browser. As on chess.com: a game, a puzzle, a finished lesson or a
// game review keeps the day; up to 2 missed days in a row are forgiven (they pause the
// streak without adding to it), and a third missed day resets it to 0.

const KEY = "xq:activity:v1";
const KEEP = 400; // days of history kept

/** Local calendar day as YYYY-MM-DD. */
export function dayOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const dayNumber = (day: string) => Math.round(Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10)) / 864e5);

export interface Streak {
  /** Active days in the current run (0 when broken). */
  days: number;
  /** Whether today already counts. */
  today: boolean;
  /** Missed days so far in the current pause (0–2); 0 when today counts. */
  missed: number;
}

/** The streak on `today` given the days with activity (any order, duplicates allowed). */
export function computeStreak(activeDays: readonly string[], today: string): Streak {
  const t = dayNumber(today);
  const days = [...new Set(activeDays)].map(dayNumber).filter((d) => d <= t).sort((a, b) => b - a);
  const last = days[0];
  // Missed days are those strictly between the last active day and today.
  if (last === undefined || t - last - 1 > 2) return { days: 0, today: false, missed: 0 };
  let run = 1;
  for (let i = 1; i < days.length && days[i - 1]! - days[i]! - 1 <= 2; i++) run++;
  return { days: run, today: last === t, missed: last === t ? 0 : t - last - 1 };
}

export function loadActivity(): string[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]") as string[];
  } catch {
    return [];
  }
}

/** Note that the player did something that counts toward the streak today. */
export function recordActivity(now = new Date()): void {
  const today = dayOf(now);
  const days = loadActivity();
  if (days.includes(today)) return;
  try {
    localStorage.setItem(KEY, JSON.stringify([...days, today].slice(-KEEP)));
  } catch {
    // storage blocked: the streak just isn't remembered
  }
}
