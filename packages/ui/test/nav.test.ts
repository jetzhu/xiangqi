import { describe, expect, it } from "vitest";
import { hashNav, prefixNav } from "../src/nav.js";

describe("nav", () => {
  it("builds hash links for the playground", () => {
    expect(hashNav.href("/analysis?moves=h2e2")).toBe("#/analysis?moves=h2e2");
  });
  it("builds locale links with a trailing slash before the query", () => {
    const nav = prefixNav("/zh");
    expect(nav.href("/")).toBe("/zh/");
    expect(nav.href("/learn")).toBe("/zh/learn/");
    expect(nav.href("/analysis?moves=h2e2,h9g7")).toBe("/zh/analysis/?moves=h2e2,h9g7");
    expect(nav.href("/learn/the-horse/")).toBe("/zh/learn/the-horse/");
  });
  it("puts static files and links under the site's base path", () => {
    const nav = prefixNav("/xiangqi/en", "/xiangqi");
    expect(nav.href("/puzzles")).toBe("/xiangqi/en/puzzles/");
    expect(nav.asset("/engine/fairy")).toBe("/xiangqi/engine/fairy");
    expect(prefixNav("/en").asset("/engine/fairy")).toBe("/engine/fairy");
  });
});
