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

/** The first puzzles a new solver sees (unrated warm-ups); shared with the server. */
export { onboardingOf } from "@xq/puzzles";
