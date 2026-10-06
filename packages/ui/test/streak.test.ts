import { describe, expect, it } from "vitest";
import { computeStreak, dayOf } from "../src/streak.js";

describe("streak", () => {
  it("counts consecutive active days", () => {
    expect(computeStreak(["2026-10-04", "2026-10-05", "2026-10-06"], "2026-10-06")).toEqual({ days: 3, today: true, missed: 0 });
  });
  it("is still alive before today's activity", () => {
    expect(computeStreak(["2026-10-04", "2026-10-05"], "2026-10-06")).toEqual({ days: 2, today: false, missed: 0 });
  });
  it("forgives up to two missed days, which don't count", () => {
    // Active Oct 1 and 2, missed 3 and 4, active 5.
    expect(computeStreak(["2026-10-01", "2026-10-02", "2026-10-05"], "2026-10-05").days).toBe(3);
    // Missed Oct 4 and 5 so far: paused, not broken.
    expect(computeStreak(["2026-10-02", "2026-10-03"], "2026-10-06")).toEqual({ days: 2, today: false, missed: 2 });
  });
  it("resets on the third missed day", () => {
    expect(computeStreak(["2026-10-02", "2026-10-03"], "2026-10-07").days).toBe(0);
    // A gap of three missed days inside the history starts a new run.
    expect(computeStreak(["2026-09-28", "2026-10-02", "2026-10-03"], "2026-10-03").days).toBe(2);
  });
  it("ignores duplicates and works across months", () => {
    expect(computeStreak(["2026-09-30", "2026-10-01", "2026-10-01"], "2026-10-01").days).toBe(2);
    expect(computeStreak([], "2026-10-01").days).toBe(0);
  });
  it("uses the local calendar day", () => {
    expect(dayOf(new Date(2026, 0, 5, 23, 30))).toBe("2026-01-05");
  });
});
