import type { Text } from "./types.js";

/** Learning Rank by lessons mastered, from Soldier up to General. */
export const LEARNING_RANKS: { min: number; name: Text; piece: string }[] = [
  { min: 0, name: { en: "Soldier", zh: "兵" }, piece: "p" },
  { min: 1, name: { en: "Advisor", zh: "仕" }, piece: "a" },
  { min: 3, name: { en: "Elephant", zh: "相" }, piece: "b" },
  { min: 5, name: { en: "Horse", zh: "马" }, piece: "n" },
  { min: 7, name: { en: "Cannon", zh: "炮" }, piece: "c" },
  { min: 9, name: { en: "Chariot", zh: "车" }, piece: "r" },
  { min: 11, name: { en: "General", zh: "帅" }, piece: "k" },
];

export function learningRank(mastered: number): { rank: (typeof LEARNING_RANKS)[number]; next: (typeof LEARNING_RANKS)[number] | null } {
  let i = 0;
  while (i + 1 < LEARNING_RANKS.length && mastered >= LEARNING_RANKS[i + 1]!.min) i++;
  return { rank: LEARNING_RANKS[i]!, next: LEARNING_RANKS[i + 1] ?? null };
}
