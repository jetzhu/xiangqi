import type { BotConfig } from "@xq/bots";
import { useT } from "../settings.js";
import { useEffect, useState } from "react";
import type { Color } from "xiangqi-core";
import { BOTS } from "@xq/content";
import { BotGame } from "./BotGame.js";
import { BotPicker, type GameSettings, PRESETS } from "./BotPicker.js";
import type { Stars } from "./stars.js";
import { useStore } from "../store/index.js";
import { type BotRating, isProvisional } from "./rating.js";
import { settleAbandoned } from "./records.js";


export function BotsPage() {
  const store = useStore();
  const [selected, setSelected] = useState<BotConfig>(BOTS[0]!);
  const [settings, setSettings] = useState<GameSettings>({ color: "red", time: "none", assists: PRESETS.learn, rated: false });
  const [rating, setRating] = useState<BotRating | null>(null);
  const { lang } = useT();
  const [stars, setStars] = useState<Stars>({});
  const [game, setGame] = useState<{ key: number; color: Color } | null>(null);

  useEffect(() => {
    if (game) return;
    void store.stars.load().then(setStars);
    // Rated games left unfinished (tab closed, page left) count as losses before anything else.
    void settleAbandoned(store).then(() => store.botRating.load().then(setRating));
  }, [game, store]);

  const start = () => {
    const color: Color = settings.color === "random" ? (Math.random() < 0.5 ? "red" : "black") : settings.color;
    setGame((g) => ({ key: (g?.key ?? 0) + 1, color }));
  };

  if (game) {
    return (
      <BotGame
        key={game.key}
        bot={selected}
        playerColor={game.color}
        settings={settings.rated ? { ...settings, assists: PRESETS.challenge } : settings}
        lang={lang}
        onExit={() => setGame(null)}
        onRematch={start}
      />
    );
  }
  return (
    <BotPicker
      bots={BOTS}
      selected={selected}
      onSelect={setSelected}
      settings={settings}
      onSettings={setSettings}
      stars={stars}
      rating={rating && { rating: rating.rating, provisional: isProvisional(rating) }}
      lang={lang}
      onPlay={start}
    />
  );
}
