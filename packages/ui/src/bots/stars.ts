// Stars: the best result against each bot. As on chess.com, a win earns 3 stars with no help,
// 2 with 1–3 hints or takebacks, 1 with more. Stored through the Store (store/index.tsx).
export type Stars = Record<string, 1 | 2 | 3>;

/** Stars for a win that used `helps` hints and takebacks. */
export function starsFor(helps: number): 1 | 2 | 3 {
  return helps === 0 ? 3 : helps <= 3 ? 2 : 1;
}
