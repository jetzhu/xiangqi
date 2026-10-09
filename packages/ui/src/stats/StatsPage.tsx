"use client";
// My stats: ratings with charts, results, and the full game history with filters. Everything
// comes from this browser's store (and, from v0.2, the account's).
import { BOTS, LESSON_ORDER } from "@xq/content";
import { learningRank } from "@xq/lessons";
import { PROVISIONAL_RD } from "@xq/puzzles";
import { useEffect, useMemo, useState } from "react";
import { Avatar } from "../bots/Avatar.js";
import { type BotRating, NEW_BOT_RATING } from "../bots/rating.js";
import type { Progress } from "../learn/progress.js";
import { useNav } from "../nav.js";
import type { PuzzleState } from "../puzzles/store.js";
import { useT } from "../settings.js";
import { type GameRecord, useStore } from "../store/index.js";
import { type Streak, computeStreak, dayOf } from "../streak.js";
import { useAccount } from "../account/session.js";
import { usePuzzles } from "../puzzles/data.js";
import { THEME_NAMES } from "../puzzles/themes.js";
import { type GameFilter, NO_FILTER, type Tally, filterGames, pct, puzzlePeak, puzzleThemes, since, summarize } from "./summary.js";

type Tab = "overview" | "games";
type Period = "90" | "all";

const botById = (id: string) => BOTS.find((b) => b.id === id);
const fmtDate = (iso: string, lang: string) => new Date(iso).toLocaleDateString(lang === "zh" ? "zh-CN" : "en", { year: "numeric", month: "short", day: "numeric" });

export function StatsPage() {
  const { tt, t, lang } = useT();
  const nav = useNav();
  const store = useStore();
  const [tab, setTab] = useState<Tab>("overview");
  const [period, setPeriod] = useState<Period>("90");
  const [games, setGames] = useState<GameRecord[] | null>(null);
  const [rating, setRating] = useState<BotRating>(NEW_BOT_RATING);
  const [puzzles, setPuzzles] = useState<PuzzleState | null>(null);
  const [progress, setProgress] = useState<Progress>({});
  const [streak, setStreak] = useState<Streak>({ days: 0, today: false, missed: 0 });
  const [filter, setFilter] = useState<GameFilter>(NO_FILTER);
  const signedIn = useAccount().state.status === "signedIn";
  const allPuzzles = usePuzzles();

  useEffect(() => {
    setTab(nav.params().get("tab") === "games" ? "games" : "overview");
    void store.games.list().then(setGames);
    void store.botRating.load().then(setRating);
    void store.puzzles.load().then(setPuzzles);
    void store.lessons.load().then(setProgress);
    void store.activity.load().then((d) => setStreak(computeStreak(d, dayOf(new Date()))));
  }, [store]); // eslint-disable-line react-hooks/exhaustive-deps

  const summary = useMemo(() => summarize(games ?? []), [games]);
  const from = period === "90" ? new Date(Date.now() - 90 * 864e5).toISOString() : null;
  const botPoints = since(summary.ratingHistory, from);
  const puzzlePoints = since((puzzles?.history ?? []).map((h) => ({ at: h.at, rating: h.ratingAfter })), from);
  const peak = useMemo(() => puzzlePeak(puzzles?.history ?? []), [puzzles]);
  const themes = useMemo(() => {
    if (!allPuzzles || !puzzles) return [];
    const byId = new Map(allPuzzles.map((p) => [p.id, p.themes]));
    return puzzleThemes(puzzles.history, (id) => byId.get(id)).slice(0, 10);
  }, [allPuzzles, puzzles]);
  const mastered = LESSON_ORDER.filter((id) => progress[id] === "mastered").length;
  const { rank } = learningRank(mastered);
  const go = (next: Tab) => {
    setTab(next);
    nav.replace(next === "games" ? "/stats?tab=games" : "/stats");
  };

  if (games === null) return <p className="muted" style={{ padding: 24 }}>…</p>;

  return (
    <div className="stats">
      <h1>{tt("My stats", "我的统计")}</h1>
      <p className="muted small">
        {signedIn
          ? tt("Saved to your account: the same on every device you sign in on.", "已保存到你的账号：在你登录的所有设备上都一样。")
          : tt("Kept in this browser. Sign up to keep them on every device.", "保存在本浏览器中。注册账号即可在所有设备上保留。")}
      </p>
      <div className="tabs" role="tablist" aria-label={tt("Stats sections", "统计分区")}>
        {(
          [
            ["overview", tt("Overview", "概览")],
            ["games", tt(`Games (${summary.all.games})`, `对局（${summary.all.games}）`)],
          ] as [Tab, string][]
        ).map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? "active" : ""} onClick={() => go(k)}>
            {label}
          </button>
        ))}
      </div>

      {tab === "overview" ? (
        <>
          <section className="stat-cards" aria-label={tt("Ratings", "等级分")}>
            <div className="stat-card">
              <span className="muted">{tt("Bot rating", "人机等级分")}</span>
              <strong>
                {rating.rating}
                {rating.rd >= PROVISIONAL_RD && <span title={tt("Provisional: play more rated games", "暂定：再下几盘计分对局")}>?</span>}
              </strong>
              <span className="muted small">
                {rating.games} {tt("rated games", "盘计分对局")}
                {rating.peak !== null && rating.peakAt && ` · ${tt("peak", "最高")} ${rating.peak} (${fmtDate(rating.peakAt, lang)})`}
              </span>
            </div>
            <div className="stat-card">
              <span className="muted">{tt("Puzzle rating", "解题等级分")}</span>
              <strong>{puzzles?.rating.rating ?? 800}</strong>
              <span className="muted small">
                {puzzles?.history.filter((h) => h.score > 0).length ?? 0} {tt("solved", "道已解")}
                {peak && ` · ${tt("peak", "最高")} ${peak.rating} (${fmtDate(peak.at, lang)})`}
              </span>
            </div>
            <div className="stat-card">
              <span className="muted">{tt("Learning rank", "学习等级")}</span>
              <strong>{t(rank.name)}</strong>
              <span className="muted small">
                {mastered}/{LESSON_ORDER.length} {tt("lessons mastered", "课已掌握")}
              </span>
            </div>
            <div className="stat-card">
              <span className="muted">{tt("Streak", "连续学习")}</span>
              <strong>
                {streak.days} {tt(streak.days === 1 ? "day" : "days", "天")}
              </strong>
              <span className="muted small">{streak.today ? tt("today counts", "今天已完成") : tt("not yet today", "今天尚未完成")}</span>
            </div>
          </section>

          <section aria-labelledby="h-charts">
            <div className="stats-head">
              <h2 id="h-charts">{tt("Rating over time", "等级分变化")}</h2>
              <label>
                <span className="sr-only">{tt("Period", "时间范围")}</span>
                <select value={period} onChange={(e) => setPeriod(e.target.value as Period)}>
                  <option value="90">{tt("Last 90 days", "最近 90 天")}</option>
                  <option value="all">{tt("All time", "全部")}</option>
                </select>
              </label>
            </div>
            <div className="charts">
              <RatingChart title={tt("Bot rating", "人机等级分")} points={botPoints} empty={tt("No rated bot games yet.", "还没有计分的人机对局。")} />
              <RatingChart title={tt("Puzzle rating", "解题等级分")} points={puzzlePoints} empty={tt("No puzzles yet.", "还没有解题。")} />
            </div>
          </section>

          <section aria-labelledby="h-results">
            <h2 id="h-results">{tt("Results against bots", "人机对局战绩")}</h2>
            {summary.all.games === 0 ? (
              <p className="muted">
                {tt("No games yet.", "还没有对局。")} <a href={nav.href("/bots")}>{tt("Play a bot", "去下一盘")}</a>
              </p>
            ) : (
              <>
                <table className="results">
                  <thead>
                    <tr>
                      <th />
                      <th>{tt("Games", "局数")}</th>
                      <th>{tt("Won", "胜")}</th>
                      <th>{tt("Drawn", "和")}</th>
                      <th>{tt("Lost", "负")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <TallyRow label={tt("All", "全部")} t={summary.all} />
                    <TallyRow label={tt("As Red", "执红")} t={summary.red} />
                    <TallyRow label={tt("As Black", "执黑")} t={summary.black} />
                    {Object.entries(summary.byBot).map(([id, tl]) => (
                      <TallyRow key={id} label={botById(id) ? t(botById(id)!.name) : id} t={tl} />
                    ))}
                  </tbody>
                </table>
                <p>
                  {summary.bestWin && (
                    <>
                      {tt("Best win:", "最佳胜局：")}{" "}
                      <strong>
                        {botById(summary.bestWin.botId) ? t(botById(summary.bestWin.botId)!.name) : summary.bestWin.botId} ({summary.bestWin.botRating})
                      </strong>
                      {" · "}
                    </>
                  )}
                  {tt("Longest win streak:", "最长连胜：")} <strong>{summary.longestWinStreak}</strong>
                </p>
              </>
            )}
          </section>

          {themes.length > 0 && (
            <section aria-labelledby="h-themes">
              <h2 id="h-themes">{tt("Puzzles by theme", "按主题的解题情况")}</h2>
              <table className="results">
                <thead>
                  <tr>
                    <th />
                    <th>{tt("Tried", "尝试")}</th>
                    <th>{tt("Solved first time", "一次解出")}</th>
                  </tr>
                </thead>
                <tbody>
                  {themes.map((a) => (
                    <tr key={a.theme}>
                      <th scope="row">{THEME_NAMES[a.theme] ? tt(...THEME_NAMES[a.theme]!) : a.theme}</th>
                      <td>{a.tried}</td>
                      <td>
                        {a.solved} <span className="muted small">({pct(a.solved, a.tried)}%)</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
        </>
      ) : (
        <GameList games={games} filter={filter} onFilter={setFilter} />
      )}
    </div>
  );
}

function TallyRow({ label, t }: { label: string; t: Tally }) {
  return (
    <tr>
      <th scope="row">{label}</th>
      <td>{t.games}</td>
      <td>
        {t.wins} <span className="muted small">({pct(t.wins, t.games)}%)</span>
      </td>
      <td>{t.draws}</td>
      <td>{t.losses}</td>
    </tr>
  );
}

/** A small line chart of ratings in play order. */
function RatingChart({ title, points, empty }: { title: string; points: { at: string; rating: number }[]; empty: string }) {
  const { tt, lang } = useT();
  if (points.length === 0)
    return (
      <figure className="chart">
        <figcaption>{title}</figcaption>
        <p className="muted small">{empty}</p>
      </figure>
    );
  const W = 300;
  const H = 120;
  const rs = points.map((p) => p.rating);
  const lo = Math.min(...rs) - 20;
  const hi = Math.max(...rs) + 20;
  const x = (i: number) => (points.length === 1 ? W / 2 : 8 + (i / (points.length - 1)) * (W - 16));
  const y = (r: number) => 8 + (1 - (r - lo) / (hi - lo)) * (H - 24);
  const first = rs[0]!;
  const last = rs.at(-1)!;
  return (
    <figure className="chart">
      <figcaption>
        {title}: <strong>{last}</strong>{" "}
        <span className="muted small">
          {fmtDate(points[0]!.at, lang)}
          {points.length > 1 && ` – ${fmtDate(points.at(-1)!.at, lang)}`}
        </span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={tt(`${title} went from ${first} to ${last} over ${points.length} results`, `${title}从 ${first} 变为 ${last}，共 ${points.length} 次`)}>
        <line x1="0" x2={W} y1={y(Math.max(...rs))} y2={y(Math.max(...rs))} className="chart-grid" />
        <line x1="0" x2={W} y1={y(Math.min(...rs))} y2={y(Math.min(...rs))} className="chart-grid" />
        <text x="2" y={y(Math.max(...rs)) - 3} className="chart-label">
          {Math.max(...rs)}
        </text>
        <text x="2" y={y(Math.min(...rs)) + 11} className="chart-label">
          {Math.min(...rs)}
        </text>
        <polyline points={points.map((p, i) => `${x(i).toFixed(1)},${y(p.rating).toFixed(1)}`).join(" ")} className="chart-line" />
        <circle cx={x(points.length - 1)} cy={y(last)} r="3" className="chart-dot" />
      </svg>
    </figure>
  );
}

function GameList({ games, filter, onFilter }: { games: GameRecord[]; filter: GameFilter; onFilter: (f: GameFilter) => void }) {
  const { tt, t, lang } = useT();
  const nav = useNav();
  const shown = filterGames(games, filter);
  const played = [...new Set(games.map((g) => g.botId))];
  const reasonText = (r: string | null) =>
    ({
      checkmate: tt("checkmate", "将死"),
      stalemate: tt("no legal move", "困毙"),
      resign: tt("resigned", "认输"),
      timeout: tt("on time", "超时"),
      abandoned: tt("left the game", "离开对局"),
    })[r ?? ""] ?? r ?? "";
  return (
    <section aria-label={tt("Game history", "对局记录")}>
      <div className="filters">
        <label>
          {tt("Bot", "对手")}
          <select value={filter.botId} onChange={(e) => onFilter({ ...filter, botId: e.target.value })}>
            <option value="all">{tt("All", "全部")}</option>
            {played.map((id) => (
              <option key={id} value={id}>
                {botById(id) ? t(botById(id)!.name) : id}
              </option>
            ))}
          </select>
        </label>
        <label>
          {tt("Result", "结果")}
          <select value={filter.result} onChange={(e) => onFilter({ ...filter, result: e.target.value as GameFilter["result"] })}>
            <option value="all">{tt("All", "全部")}</option>
            <option value="win">{tt("Won", "胜")}</option>
            <option value="draw">{tt("Drawn", "和")}</option>
            <option value="loss">{tt("Lost", "负")}</option>
          </select>
        </label>
        <label>
          {tt("Colour", "执子")}
          <select value={filter.color} onChange={(e) => onFilter({ ...filter, color: e.target.value as GameFilter["color"] })}>
            <option value="all">{tt("All", "全部")}</option>
            <option value="red">{tt("Red", "红方")}</option>
            <option value="black">{tt("Black", "黑方")}</option>
          </select>
        </label>
        <label>
          {tt("Type", "类型")}
          <select value={filter.type} onChange={(e) => onFilter({ ...filter, type: e.target.value as GameFilter["type"] })}>
            <option value="all">{tt("All", "全部")}</option>
            <option value="rated">{tt("Rated", "计分")}</option>
            <option value="casual">{tt("Casual", "休闲")}</option>
          </select>
        </label>
      </div>
      {shown.length === 0 ? (
        <p className="muted">
          {games.length === 0 ? (
            <>
              {tt("No games yet.", "还没有对局。")} <a href={nav.href("/bots")}>{tt("Play a bot", "去下一盘")}</a>
            </>
          ) : (
            tt("No games match these filters.", "没有符合条件的对局。")
          )}
        </p>
      ) : (
        <table className="game-list">
          <thead>
            <tr>
              <th>{tt("Date", "日期")}</th>
              <th>{tt("Opponent", "对手")}</th>
              <th>{tt("Result", "结果")}</th>
              <th>{tt("Rating", "等级分")}</th>
              <th>{tt("Moves", "步数")}</th>
              <th>{tt("Accuracy", "准确率")}</th>
              <th>
                <span className="sr-only">{tt("Review", "复盘")}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.map((g) => {
              const bot = botById(g.botId);
              const d = g.ratingAfter !== null && g.ratingBefore !== null ? g.ratingAfter - g.ratingBefore : null;
              return (
                <tr key={g.id} className={`r-${g.result}`}>
                  <td>{fmtDate(g.startedAt, lang)}</td>
                  <td className="opponent">
                    {bot && <Avatar bot={bot} size={24} />} {bot ? t(bot.name) : g.botId} <span className="muted small">{g.botRating}</span>
                    <span className="muted small"> · {g.playerColor === "red" ? tt("as Red", "执红") : tt("as Black", "执黑")}</span>
                  </td>
                  <td>
                    <strong>{g.result === "win" ? tt("Won", "胜") : g.result === "draw" ? tt("Drawn", "和") : tt("Lost", "负")}</strong>{" "}
                    <span className="muted small">{reasonText(g.reason)}</span>
                  </td>
                  <td>{g.rated ? (d === null ? "–" : <span className={d >= 0 ? "up" : "down"}>{d >= 0 ? `+${d}` : d}</span>) : <span className="muted small">{tt("casual", "休闲")}</span>}</td>
                  <td>{Math.ceil(g.moves.length / 2)}</td>
                  <td>{g.accuracy === null ? "–" : g.accuracy.toFixed(1)}</td>
                  <td>
                    <a href={nav.href(`/analysis?moves=${g.moves.join(",")}`)}>{tt("Review", "复盘")}</a>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}
