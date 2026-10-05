import type { BotConfig } from "@xq/bots";

/** A round avatar: the bot's colour with the first character of its Chinese name. */
export function Avatar({ bot, size = 48, crown = false }: { bot: BotConfig; size?: number; crown?: boolean }) {
  return (
    <span className="avatar" style={{ width: size, height: size, background: bot.color, fontSize: size * 0.45 }} aria-hidden>
      {bot.name.zh[0]}
      {crown && (
        <span className="crown" title="Beaten">
          ♛
        </span>
      )}
    </span>
  );
}
