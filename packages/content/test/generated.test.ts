import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
// @ts-expect-error: plain ESM script
import { render } from "../scripts/generate.mjs";

describe("generated content", () => {
  it("is up to date with content/ (run `pnpm --filter @xq/content generate`)", () => {
    expect(readFileSync(new URL("../src/generated.ts", import.meta.url), "utf8")).toBe(render());
  });
});
