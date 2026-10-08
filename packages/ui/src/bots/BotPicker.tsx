import type { BotConfig, BotGroup } from "@xq/bots";
import { Avatar } from "./Avatar.js";

export type { Lang } from "../settings.js";
import type { Lang } from "../settings.js";
export type TimeControl = "none" | "10" | "15+10" | "30";

export interface Assists {
  hint: boolean;
  takeback: boolean;
  evalBar: boolean;
  threats: boolean;
  suggestions: boolean;
  feedback: boolean;
}

export interface GameSettings {
  color: "red" | "black" | "random";
  time: TimeControl;
  assists: Assists;
  /** Rated games change the bot rating and turn every assist off. */
  rated: boolean;
}

export const PRESETS: Record<"learn" | "fair" | "challenge", Assists> = {
  learn: { hint: true, takeback: true, evalBar: true, threats: true, suggestions: false, feedback: true },
  fair: { hint: true, takeback: false, evalBar: false, threats: false, suggestions: false, feedback: false },
  challenge: { hint: false, takeback: false, evalBar: false, threats: false, suggestions: false, feedback: false },
};

const GROUPS: { id: BotGroup; en: string; zh: string }[] = [
  { id: "beginner", en: "Beginner", zh: "入门" },
  { id: "casual", en: "Casual", zh: "休闲" },
  { id: "club", en: "Club", zh: "俱乐部" },
  { id: "master", en: "Master", zh: "大师" },
];

const ASSIST_LABELS: Record<keyof Assists, { en: string; zh: string }> = {
  hint: { en: "Hints", zh: "提示" },
  takeback: { en: "Takebacks", zh: "悔棋" },
  evalBar: { en: "Evaluation bar", zh: "形势条" },
  threats: { en: "Threat arrows", zh: "威胁箭头" },
  suggestions: { en: "Suggestion arrows", zh: "建议箭头" },
  feedback: { en: "Move feedback", zh: "着法评价" },
};

interface Props {
  bots: BotConfig[];
  selected: BotConfig;
  onSelect: (b: BotConfig) => void;
  settings: GameSettings;
  onSettings: (s: GameSettings) => void;
  stars: Record<string, number>;
  /** The player's bot rating, shown beside the Rated choice. */
  rating: { rating: number; provisional: boolean } | null;
  lang: Lang;
  onPlay: () => void;
}

export function BotPicker({ bots, selected, onSelect, settings, onSettings, stars, rating, lang, onPlay }: Props) {
  const preset = (Object.keys(PRESETS) as (keyof typeof PRESETS)[]).find((k) =>
    (Object.keys(PRESETS[k]) as (keyof Assists)[]).every((a) => PRESETS[k][a] === settings.assists[a]),
  );
  const zh = lang === "zh";
  return (
    <div className="picker">
      <section className="bot-groups">
        {GROUPS.map((g) => (
          <div key={g.id} className="bot-group">
            <h2>{zh ? g.zh : g.en}</h2>
            <div className="bot-cards">
              {bots
                .filter((b) => b.group === g.id)
                .map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    className={`bot-card${b.id === selected.id ? " active" : ""}`}
                    onClick={() => onSelect(b)}
                    aria-pressed={b.id === selected.id}
                  >
                    <Avatar bot={b} stars={stars[b.id] ?? 0} />
                    <span className="bot-name">{b.name[lang]}</span>
                    <span className="bot-rating">{b.ratingLabel}</span>
                  </button>
                ))}
            </div>
          </div>
        ))}
      </section>

      <aside className="panel bot-detail">
        <div className="bot-head">
          <Avatar bot={selected} size={64} stars={stars[selected.id] ?? 0} />
          <div>
            <h1>
              {selected.name[lang]} <span className="bot-rating">{selected.ratingLabel}</span>
            </h1>
            <p className="sub">{selected.bio[lang]}</p>
          </div>
        </div>

        <div className="rated-choice" role="radiogroup" aria-label={zh ? "对局类型" : "Game type"}>
          {([false, true] as const).map((r) => (
            <label key={String(r)} className={`choice${settings.rated === r ? " active" : ""}`}>
              <input type="radio" name="rated" checked={settings.rated === r} onChange={() => onSettings({ ...settings, rated: r })} />
              <strong>{r ? (zh ? "计分" : "Rated") : zh ? "休闲" : "Casual"}</strong>
              <span className="muted">
                {r
                  ? zh
                    ? `无辅助，计入人机等级分${rating ? `（当前 ${rating.rating}${rating.provisional ? "?" : ""}）` : ""}`
                    : `No help; counts for your bot rating${rating ? ` (now ${rating.rating}${rating.provisional ? "?" : ""})` : ""}`
                  : zh
                    ? "可用提示、悔棋等辅助，不计分"
                    : "Hints, takebacks and other help; not rated"}
              </span>
            </label>
          ))}
        </div>

        <div className="options">
          <label>
            {zh ? "我执" : "I play"}
            <select value={settings.color} onChange={(e) => onSettings({ ...settings, color: e.target.value as GameSettings["color"] })}>
              <option value="red">{zh ? "红方（先走）" : "Red (moves first)"}</option>
              <option value="black">{zh ? "黑方" : "Black"}</option>
              <option value="random">{zh ? "随机" : "Random"}</option>
            </select>
          </label>
          <label>
            {zh ? "用时" : "Timer"}
            <select value={settings.time} onChange={(e) => onSettings({ ...settings, time: e.target.value as TimeControl })}>
              <option value="none">{zh ? "不计时" : "No timer"}</option>
              <option value="10">10 min</option>
              <option value="15+10">15 + 10</option>
              <option value="30">30 min</option>
            </select>
          </label>
          <label>
            {zh ? "辅助" : "Help"}
            <select
              disabled={settings.rated}
              value={settings.rated ? "challenge" : (preset ?? "custom")}
              onChange={(e) => e.target.value !== "custom" && onSettings({ ...settings, assists: PRESETS[e.target.value as keyof typeof PRESETS] })}
            >
              <option value="learn">{zh ? "学习（全部辅助）" : "Learn (all help)"}</option>
              <option value="fair">{zh ? "公平（仅提示）" : "Fair (hints only)"}</option>
              <option value="challenge">{zh ? "挑战（无辅助）" : "Challenge (no help)"}</option>
              {!preset && <option value="custom">{zh ? "自定义" : "Custom"}</option>}
            </select>
          </label>
        </div>
        <fieldset className="assists">
          {(Object.keys(ASSIST_LABELS) as (keyof Assists)[]).map((a) => (
            <label key={a} className="check">
              <input
                type="checkbox"
                disabled={settings.rated}
                checked={!settings.rated && settings.assists[a]}
                onChange={(e) => onSettings({ ...settings, assists: { ...settings.assists, [a]: e.target.checked } })}
              />
              {ASSIST_LABELS[a][lang]}
            </label>
          ))}
        </fieldset>
        <button type="button" className="primary play" onClick={onPlay}>
          {zh ? "开始对局" : "Play"}
        </button>
      </aside>
    </div>
  );
}
