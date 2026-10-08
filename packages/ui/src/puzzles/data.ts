// The puzzle set, loaded on first use (it is the biggest piece of content; see @xq/content).
import { loadPuzzles } from "@xq/content";
import type { Puzzle } from "@xq/puzzles";
import { useEffect, useState } from "react";

let cache: Puzzle[] | null = null;

/** All puzzles, or null while they load. */
export function usePuzzles(): Puzzle[] | null {
  const [puzzles, setPuzzles] = useState<Puzzle[] | null>(cache);
  useEffect(() => {
    if (!cache) void loadPuzzles().then((p) => setPuzzles((cache = p)));
  }, []);
  return puzzles;
}

/** The first puzzles a new solver sees: the easiest mates in one. */
export const onboardingOf = (puzzles: readonly Puzzle[]) =>
  puzzles
    .filter((p) => p.themes.includes("mateIn1"))
    .sort((a, b) => a.rating - b.rating)
    .slice(0, 5);
