import type { BotConfig } from "@xq/bots";
import { useT } from "../settings.js";
import { useEffect, useState } from "react";
import type { Color } from "xiangqi-core";
import { BOTS } from "@xq/content";
import { BotGame } from "./BotGame.js";
import { BotPicker, type GameSettings, PRESETS } from "./BotPicker.js";
import type { Stars } from "./stars.js";
import { useStore } from "../store/index.js";


export function BotsPage() {
  const store = useStore();
  const [selected, setSelected] = useState<BotConfig>(BOTS[0]!);
  const [settings, setSettings] = useState<GameSettings>({ color: "red", time: "none", assists: PRESETS.learn });
  const { lang } = useT();
  const [stars, setStars] = useState<Stars>({});
  const [game, setGame] = useState<{ key: number; color: Color } | null>(null);

  useEffect(() => {
    if (!game) void store.stars.load().then(setStars);
  }, [game]);

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
        settings={settings}
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
      lang={lang}
      onPlay={start}
    />
  );
}
