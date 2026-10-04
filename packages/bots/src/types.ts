export interface Text {
  en: string;
  zh: string;
}

export type BotGroup = "beginner" | "casual" | "club" | "master";
export type ChatEvent = "greet" | "botCheck" | "botCapture" | "lostPiece" | "win" | "lose" | "draw";

export interface BotStrength {
  /** Engine search depth per move. */
  depth: number;
  /** Candidate lines asked from the engine. */
  multipv: number;
  /** Softmax temperature in centipawns; 0 always plays the best candidate. */
  temperature: number;
  /** Candidates more than this many centipawns worse than the best are never chosen. */
  maxLoss: number;
  /** Chance (0–1) of playing a random legal move instead. */
  blunderChance: number;
  /** Minimum time a move takes, so the bot doesn't reply instantly. */
  thinkMs: number;
}

/** Centipawn bonuses that shape a bot's taste among near-equal candidates. */
export interface BotStyle {
  captures: number;
  checks: number;
  /** Bonus for moving a soldier forward (negative: prefers to keep soldiers home). */
  advance: number;
  /** Bonus for cannon moves. */
  cannon: number;
}

export interface BotConfig {
  id: string;
  name: Text;
  group: BotGroup;
  /** Shown as the bot's strength; not a measured rating. */
  ratingLabel: number;
  color: string;
  bio: Text;
  strength: BotStrength;
  style: BotStyle;
  /** Preferred lines in ICCS from the standard start; the bot follows one while the game matches. */
  book: string[][];
  chat: Record<ChatEvent, Text[]>;
}
