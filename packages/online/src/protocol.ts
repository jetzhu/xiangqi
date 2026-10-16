// What the two browsers send each other over the link (direct WebRTC, or the relay), and what
// each reports to the server (docs/v0.3-online-design.md, "Architecture").
import type { Color } from "xiangqi-core";
import type { OnlineResult } from "./result.js";

/** Preset chat phrases (decision D7): no free text. */
export const PHRASES = {
  hello: { en: "Hello!", zh: "你好！" },
  luck: { en: "Good luck", zh: "祝你好运" },
  gg: { en: "Good game", zh: "好棋" },
  thanks: { en: "Thanks", zh: "谢谢" },
  well: { en: "Well played", zh: "下得好" },
  oops: { en: "Oops", zh: "失误了" },
  wow: { en: "Wow!", zh: "厉害！" },
  bye: { en: "Bye", zh: "再见" },
} as const;
export type Phrase = keyof typeof PHRASES;
export const isPhrase = (p: unknown): p is Phrase => typeof p === "string" && Object.hasOwn(PHRASES, p);

/** Clock readings in milliseconds left, as one browser holds them. */
export type Clocks = Record<Color, number>;

export type LinkMsg =
  /** A move: the mover's clock after it (increment added), the mover's view of the other clock, and the game's hash so far. */
  | { t: "move"; ply: number; iccs: string; clock: number; seen: number; hash: string }
  | { t: "ping"; at: number }
  | { t: "pong"; at: number }
  | { t: "offer-draw" }
  | { t: "accept-draw" }
  | { t: "decline-draw" }
  | { t: "resign" }
  | { t: "abort" }
  /** Asks to go back to `plies` plies. */
  | { t: "takeback"; plies: number }
  | { t: "accept-takeback"; plies: number }
  | { t: "decline-takeback" }
  | { t: "chat"; phrase: Phrase }
  /** The sender holds that the side to move has run out of time (or out of first-move time). */
  | { t: "flag" }
  /** The sender is closing the page. */
  | { t: "bye" }
  /** After (re)connecting: how far the sender's game has got. */
  | { t: "hello"; plies: number; hash: string }
  /** The whole game so far, for a browser that's behind; `elapsed` is the time spent on the current turn. */
  | { t: "sync"; moves: string[]; clocks: Clocks; elapsed: number; result: OnlineResult | null };

const TYPES = new Set(["move", "ping", "pong", "offer-draw", "accept-draw", "decline-draw", "resign", "abort", "takeback", "accept-takeback", "decline-takeback", "chat", "flag", "bye", "hello", "sync"]);

/** A message from the other browser, or null if it isn't one. The opponent's browser isn't trusted. */
export function parseLinkMsg(data: unknown): LinkMsg | null {
  let m: unknown = data;
  if (typeof data === "string") {
    try {
      m = JSON.parse(data);
    } catch {
      return null;
    }
  }
  if (!m || typeof m !== "object" || !TYPES.has((m as { t?: unknown }).t as string)) return null;
  const x = m as Record<string, unknown>;
  const num = (k: string) => typeof x[k] === "number" && Number.isFinite(x[k]);
  const str = (k: string) => typeof x[k] === "string";
  switch (x.t) {
    case "move":
      return num("ply") && str("iccs") && num("clock") && num("seen") && str("hash") ? (m as LinkMsg) : null;
    case "ping":
    case "pong":
      return num("at") ? (m as LinkMsg) : null;
    case "takeback":
    case "accept-takeback":
      return num("plies") ? (m as LinkMsg) : null;
    case "chat":
      return isPhrase(x.phrase) ? (m as LinkMsg) : null;
    case "hello":
      return num("plies") && str("hash") ? (m as LinkMsg) : null;
    case "sync": {
      const c = x.clocks as Record<string, unknown> | undefined;
      const ok = Array.isArray(x.moves) && x.moves.every((v) => typeof v === "string") && !!c && typeof c.red === "number" && typeof c.black === "number" && num("elapsed");
      return ok ? (m as LinkMsg) : null;
    }
    default:
      return m as LinkMsg;
  }
}

/** A short hash of the moves so far (FNV-1a), so the two browsers notice if their records differ. */
export function movesHash(moves: readonly string[]): string {
  let h = 0x811c9dc5;
  for (const ch of moves.join(" ")) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** What a browser reports to the server's queue. */
export type Report =
  /** `blur` (the mover's own moves only, M18): the page lost focus during the mover's turn. */
  | { kind: "move"; ply: number; iccs: string; clocks: Clocks; hash: string; blur?: boolean }
  /** The opponent has gone quiet over the link (since `since`, ms ago when sent). */
  | { kind: "away"; ms: number }
  | { kind: "back" }
  | { kind: "end"; result: OnlineResult; moves: string[]; clocks: Clocks };
