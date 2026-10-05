// Validates every lesson in content/lessons. A broken lesson fails the build.
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Transport, XiangqiEngine } from "@xq/engine";
import type { Lesson, PlayOutStep, Unit } from "../src/index.js";
import { validateLesson, validateUnits } from "../src/index.js";

const dir = new URL("../../../content/lessons/", import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith(".json") && f !== "units.json");
const lessons: Lesson[] = files.map((f) => JSON.parse(readFileSync(new URL(f, dir), "utf8")));
const units: Unit[] = JSON.parse(readFileSync(new URL("units.json", dir), "utf8"));

describe("lesson content", () => {
  it("has 11 units, each with a lesson", () => {
    expect(units).toHaveLength(11);
    expect(validateUnits(units, lessons)).toEqual([]);
  });
  it.each(lessons.map((l) => [l.id, l] as const))("%s is valid", (_id, lesson) => {
    expect(validateLesson(lesson)).toEqual([]);
  });
  it("file names match lesson ids", () => {
    files.forEach((f, i) => expect(f).toBe(`${lessons[i]!.id}.json`));
  });
});

describe("play-out steps can be won in time (Fairy-Stockfish)", () => {
  const require = createRequire(import.meta.url);
  let engine: XiangqiEngine;
  let stop: () => void = () => {};
  beforeAll(async () => {
    const fsfDir = dirname(require.resolve("fairy-stockfish-nnue.wasm/package.json", { paths: [new URL("../../engine/", import.meta.url).pathname] }));
    const sf = await require(join(fsfDir, "stockfish.js"))({ wasmBinary: readFileSync(join(fsfDir, "stockfish.wasm")) });
    const t: Transport = { send: (c) => sf.postMessage(c), onLine: (cb) => sf.addMessageListener(cb), terminate: () => sf.terminate() };
    stop = () => sf.terminate();
    engine = await XiangqiEngine.create(t, { coords: "fairy", setup: ["setoption name UCI_Variant value xiangqi"] });
  });
  afterAll(() => stop());

  const playOuts = lessons.flatMap((l) => l.steps.filter((s): s is PlayOutStep => s.type === "play-out").map((s) => [l.id, s] as const));
  it.each(playOuts)("%s: forced mate within maxMoves", async (_id, step) => {
    const r = await engine.analyze(step.fen, { depth: 2 * step.maxMoves + 2 });
    const mate = r.lines[0]?.score.mate;
    expect(mate, "engine should report a forced mate for Red").toBeGreaterThan(0);
    expect(mate!).toBeLessThanOrEqual(step.maxMoves);
  });
});
