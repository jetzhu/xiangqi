import type { BotConfig } from "@xq/bots";
import { useEffect, useState } from "react";
import type { Color } from "xiangqi-core";
import botsJson from "../../../../content/bots/bots.json";
import { BotGame } from "./BotGame.js";
import { BotPicker, type GameSettings, type Lang, PRESETS } from "./BotPicker.js";
import { loadCrowns } from "./crowns.js";

const BOTS = botsJson as BotConfig[];

export function BotsPage() {
  const [selected, setSelected] = useState<BotConfig>(BOTS[0]!);
  const [settings, setSettings] = useState<GameSettings>({ color: "red", time: "none", assists: PRESETS.learn });
  const [lang, setLang] = useState<Lang>("zh");
  const [crowns, setCrowns] = useState<string[]>([]);
  const [game, setGame] = useState<{ key: number; color: Color } | null>(null);

  useEffect(() => {
    if (!game) void loadCrowns().then(setCrowns);
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
      crowns={crowns}
      lang={lang}
      onLang={setLang}
      onPlay={start}
    />
  );
}
