import type { BotConfig } from "@xq/bots";

/** A round avatar: the bot's colour with the first character of its Chinese name. */
/** `stars` (1–3) marks a bot the player has beaten, and how cleanly. */
export function Avatar({ bot, size = 48, stars = 0 }: { bot: BotConfig; size?: number; stars?: number }) {
  return (
    <span className="avatar" style={{ width: size, height: size, background: bot.color, fontSize: size * 0.45 }} aria-hidden>
      {bot.name.zh[0]}
      {stars > 0 && (
        <span className="stars" title={`${stars}/3`}>
          {"★".repeat(stars)}
        </span>
      )}
    </span>
  );
}
