// A small catalogue of named openings, for the live opening label and "book" moves.
// Lines are ICCS from the standard start; mirror images (files a↔i) match too.

export interface Opening {
  en: string;
  zh: string;
  moves: readonly string[];
}

export const OPENINGS: readonly Opening[] = [
  // Red's first move
  { en: "Central Cannon", zh: "中炮", moves: ["h2e2"] },
  { en: "Elephant Opening", zh: "飞相局", moves: ["g0e2"] },
  { en: "Pawn Opening", zh: "仙人指路", moves: ["c3c4"] },
  { en: "Horse Opening", zh: "起马局", moves: ["h0g2"] },
  { en: "Palace-Crossing Cannon", zh: "过宫炮", moves: ["h2d2"] },
  { en: "Advisor-Corner Cannon", zh: "士角炮", moves: ["h2f2"] },
  // Replies to the Central Cannon
  { en: "Central Cannon vs Screen Horses", zh: "中炮对屏风马", moves: ["h2e2", "h9g7", "h0g2", "b9c7"] },
  { en: "Central Cannon vs Screen Horses", zh: "中炮对屏风马", moves: ["h2e2", "b9c7", "h0g2", "h9g7"] },
  { en: "Same-Direction Cannons", zh: "顺炮", moves: ["h2e2", "h7e7"] },
  { en: "Opposite-Direction Cannons", zh: "列炮", moves: ["h2e2", "b7e7"] },
  { en: "Central Cannon vs Reverse Palace Horse", zh: "中炮对反宫马", moves: ["h2e2", "b9c7", "h0g2", "h7f7"] },
  // Replies to the Pawn Opening
  { en: "Pawn Opening vs Cannon Behind the Pawn", zh: "仙人指路对卒底炮", moves: ["c3c4", "b7c7"] },
];

const mirror = (m: string) => m.replace(/[a-i]/g, (f) => "ihgfedcba"["abcdefghi".indexOf(f)]!);

/**
 * The opening a game is in: the longest catalogue line that the game's first moves
 * start with (allowing a mirror image). `moves` are ICCS from the standard start.
 */
export function openingOf(moves: readonly string[]): Opening | null {
  let best: Opening | null = null;
  for (const o of OPENINGS) {
    if (o.moves.length > moves.length || (best && o.moves.length <= best.moves.length)) continue;
    const plain = o.moves.every((m, i) => moves[i] === m);
    const mirrored = o.moves.every((m, i) => moves[i] === mirror(m));
    if (plain || mirrored) best = o;
  }
  return best;
}

/** True if move `index` of the game is still inside a catalogue line (a "book" move). */
export function isBookMove(moves: readonly string[], index: number): boolean {
  const prefix = moves.slice(0, index + 1);
  return OPENINGS.some(
    (o) =>
      o.moves.length > index &&
      (prefix.every((m, i) => o.moves[i] === m) || prefix.every((m, i) => mirror(o.moves[i]!) === m)),
  );
}
