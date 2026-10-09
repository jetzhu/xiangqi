"use client";
import { BOTS, LESSON_ORDER, lessonById } from "@xq/content";
import { learningRank } from "@xq/lessons";
import { PROVISIONAL_RD } from "@xq/puzzles";
import { useEffect, useState } from "react";
import { Board } from "./Board.js";
import { useAccount } from "./account/session.js";
import { type BotRating, NEW_BOT_RATING } from "./bots/rating.js";
import type { Stars } from "./bots/stars.js";
import { milestones } from "./home/milestones.js";
import type { Progress } from "./learn/progress.js";
import { useNav } from "./nav.js";
import type { PuzzleState } from "./puzzles/store.js";
import { useT } from "./settings.js";
import { type GameRecord, useStore } from "./store/index.js";
import { type Streak, computeStreak, dayOf } from "./streak.js";

/** The start position after 1. 炮二平五, used for decorative boards. */
const AFTER_CENTRAL_CANNON = "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C2C4/9/RNBAKABNR b - - 1 1";

const RESULT = { win: { en: "Won", zh: "胜" }, loss: { en: "Lost", zh: "负" }, draw: { en: "Draw", zh: "和" } } as const;

/** Dashboard of next steps, built from the player's saved progress (this browser's, or the account's). */
export function HomePage() {
  const { tt, t } = useT();
  const nav = useNav();
  const store = useStore();
  const account = useAccount().state;
  const [progress, setProgress] = useState<Progress>({});
  const [puzzles, setPuzzles] = useState<PuzzleState | null>(null);
  const [stars, setStars] = useState<Stars>({});
  const [streak, setStreak] = useState<Streak>({ days: 0, today: false, missed: 0 });
  const [botRating, setBotRating] = useState<BotRating>(NEW_BOT_RATING);
  const [games, setGames] = useState<GameRecord[]>([]);
  const [dailyDone, setDailyDone] = useState(false);

  useEffect(() => {
    void store.lessons.load().then(setProgress);
    void store.puzzles.load().then(setPuzzles);
    void store.stars.load().then(setStars);
    void store.activity.load().then((days) => setStreak(computeStreak(days, dayOf(new Date()))));
    void store.botRating.load().then(setBotRating);
    void store.games.list().then((g) => setGames(g.filter((x) => x.result !== null).slice(0, 5)));
    void store.daily.load().then((days) => setDailyDone(days.includes(dayOf(new Date()))));
  }, [store]);

  const mastered = LESSON_ORDER.filter((id) => progress[id] === "mastered").length;
  const nextId = LESSON_ORDER.find((id) => progress[id] !== "mastered");
  const next = nextId ? lessonById(nextId) : undefined;
  const { rank } = learningRank(mastered);
  const beaten = Object.keys(stars).length;
  const nextBot = BOTS.find((b) => !stars[b.id]) ?? BOTS.at(-1)!;
  const solved = puzzles?.history.filter((h) => h.score > 0).length ?? 0;
  const isNew = mastered === 0 && solved === 0 && beaten === 0 && games.length === 0;
  const earned = milestones({ mastered, botsBeaten: beaten, puzzles: puzzles?.history ?? [] });

  return (
    <div className="home">
      {isNew ? (
        <Hero />
      ) : (
        <section className="dash-head">
          <h1>
            {account.status === "signedIn"
              ? tt(`Welcome back, ${account.user.username}`, `欢迎回来，${account.user.username}`)
              : tt("Welcome back", "欢迎回来")}
          </h1>
          <a className="button primary" href={nav.href(next ? `/learn/${next.id}` : "/puzzles")}>
            {next ? `${tt("Continue", "继续")}: ${t(next.title)}` : tt("Solve puzzles", "去解题")}
          </a>
        </section>
      )}

      <section className="cards" aria-label={tt("Next steps", "下一步")}>
        <a className="card" href={nav.href("/learn")}>
          <span className="card-kicker">{tt("Learn", "学习")}</span>
          <strong>{next ? t(next.title) : tt("All lessons mastered", "所有课程已掌握")}</strong>
          <span className="muted">
            {tt("Rank", "等级")}: {t(rank.name)} · {mastered}/{LESSON_ORDER.length}
          </span>
        </a>
        <a className="card" href={nav.href("/puzzles?mode=daily")}>
          <span className="card-kicker">{tt("Today's puzzle", "每日一题")}</span>
          <strong>{dailyDone ? tt("Solved today ✓", "今日已完成 ✓") : tt("Not solved yet", "今日未完成")}</strong>
          <span className="muted">{tt("A new one every day", "每天一道新题")}</span>
        </a>
        <a className="card" href={nav.href("/puzzles")}>
          <span className="card-kicker">{tt("Puzzles", "题目")}</span>
          <strong>
            {tt("Rating", "等级分")} {puzzles?.rating.rating ?? 800}
          </strong>
          <span className="muted">
            {solved} {tt("solved", "道已解")}
          </span>
        </a>
        <a className="card" href={nav.href("/bots")}>
          <span className="card-kicker">{tt("Next bot to beat", "下一个对手")}</span>
          <strong>{t(nextBot.name)}</strong>
          <span className="muted">
            {nextBot.ratingLabel} · {beaten}/{BOTS.length} {tt("beaten", "已战胜")} · {tt("your rating", "你的等级分")} {botRating.rating}
            {botRating.rd >= PROVISIONAL_RD ? "?" : ""}
          </span>
        </a>
      </section>

      {games.length > 0 && (
        <section className="recent" aria-labelledby="h-recent">
          <div className="stats-head">
            <h2 id="h-recent">{tt("Recent games", "最近对局")}</h2>
            <a href={nav.href("/stats?tab=games")}>{tt("All games", "全部对局")}</a>
          </div>
          <ul className="recent-games">
            {games.map((g) => {
              const bot = BOTS.find((b) => b.id === g.botId);
              const change = g.ratingBefore !== null && g.ratingAfter !== null ? g.ratingAfter - g.ratingBefore : null;
              return (
                <li key={g.id}>
                  <span className={`result ${g.result}`}>{t(RESULT[g.result!])}</span>
                  <span className="who">
                    {tt("vs", "对")} {bot ? t(bot.name) : g.botId}
                  </span>
                  <span className="muted">
                    {!g.rated ? tt("casual", "不计分") : change === null ? tt("rated", "计分") : `${change >= 0 ? "+" : ""}${change}`}
                  </span>
                  <a href={nav.href(`/analysis?moves=${g.moves.join(",")}`)}>{tt("Review", "复盘")}</a>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section aria-labelledby="h-milestones">
        <h2 id="h-milestones" className="sr-only">
          {tt("Milestones", "里程碑")}
        </h2>
        <ul className="milestones">
          {earned.map((m) => (
            <li key={m.id} className={m.earned ? "earned" : ""}>
              <strong>{t(m.title)}</strong>
              <span className="muted small">{m.earned ? tt("Earned", "已达成") : t(m.how)}</span>
            </li>
          ))}
        </ul>
      </section>

      <p className={`streak${streak.today ? " done" : ""}`}>
        <strong>
          {tt("Streak", "连续学习")}: {streak.days} {tt(streak.days === 1 ? "day" : "days", "天")}
        </strong>{" "}
        <span className="muted">
          {streak.today
            ? tt("Today counts. Come back tomorrow.", "今天已完成，明天再来。")
            : streak.days > 0
              ? tt(
                  `Play a game, solve a puzzle or finish a lesson today to keep it${streak.missed ? ` (${streak.missed} of 2 rest days used)` : ""}.`,
                  `今天下一盘棋、解一道题或学完一课即可保持${streak.missed ? `（已用 ${streak.missed}/2 天休息）` : ""}。`,
                )
              : tt("Play a game, solve a puzzle or finish a lesson to start one.", "下一盘棋、解一道题或学完一课即可开始。")}
        </span>
      </p>
      {account.status === "guest" && (
        <p className="muted small center">
          {tt("Your progress is saved in this browser.", "你的进度保存在本浏览器中。")}{" "}
          <a href={nav.href("/signup")}>{tt("Sign up to keep it on every device.", "注册账号，在所有设备上保留进度。")}</a>
        </p>
      )}
    </div>
  );
}

/** For a first visit: what the site is, and where to start. */
function Hero() {
  const { tt } = useT();
  const nav = useNav();
  return (
    <section className="hero">
      <div className="hero-text">
        <h1>{tt("Learn and play Xiangqi", "学象棋，下象棋")}</h1>
        <p className="sub">
          {tt(
            "Short lessons, puzzles, friendly bots and a strong analysis engine — free, in your browser, no account needed.",
            "简短的课程、趣味题目、友好的机器人对手和强大的分析引擎——免费，在浏览器里就能用，无需注册。",
          )}
        </p>
        <a className="button primary big" href={nav.href("/learn")}>
          {tt("Start learning", "开始学习")}
        </a>
      </div>
      <div className="hero-board" aria-hidden>
        <Board fen={AFTER_CENTRAL_CANNON} movable="none" lastMove="h2e2" showCoordinates={false} ariaLabel="" />
      </div>
    </section>
  );
}
