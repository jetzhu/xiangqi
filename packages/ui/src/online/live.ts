import { useEffect, useState } from "react";

/** While an online game is on in this browser, the analysis board stays off (GamePage keeps this mark fresh). */
export const LIVE_GAME_KEY = "xq:live-game";

/** The online game in progress in this browser, if any: its id. */
export function useLiveGame(): string | null {
  const read = () => {
    try {
      const v = JSON.parse(localStorage.getItem(LIVE_GAME_KEY) ?? "null") as { id?: string; until?: number } | null;
      return v && typeof v.until === "number" && v.until > Date.now() ? (v.id ?? "") : null;
    } catch {
      return null;
    }
  };
  const [live, setLive] = useState<string | null>(null);
  useEffect(() => {
    setLive(read());
    const timer = setInterval(() => setLive(read()), 2_000);
    return () => clearInterval(timer);
  }, []);
  return live;
}
