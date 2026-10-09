import { describe, expect, it } from "vitest";
import { minAgeFor, oldEnough } from "../src/account/age.js";

describe("age check", () => {
  const now = new Date("2026-10-09T12:00:00Z");

  it("uses chess.com's minimum ages, 13 elsewhere", () => {
    expect([minAgeFor("US"), minAgeFor("CN"), minAgeFor("IT"), minAgeFor("FR"), minAgeFor("DE"), minAgeFor("HK")]).toEqual([13, 13, 14, 15, 16, 18]);
  });

  it("counts a birthday this month as not yet reached", () => {
    expect(oldEnough(2013, 9, "US", now)).toBe(true); // 13 in September
    expect(oldEnough(2013, 10, "US", now)).toBe(false); // 13 later this month, perhaps
    expect(oldEnough(2013, 11, "US", now)).toBe(false);
    expect(oldEnough(2010, 1, "DE", now)).toBe(true); // 16
    expect(oldEnough(2011, 1, "DE", now)).toBe(false); // 15
    expect(oldEnough(2008, 9, "HK", now)).toBe(true); // 18
  });
});
