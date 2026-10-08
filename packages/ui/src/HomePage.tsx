"use client";
import { BOTS, LESSON_ORDER, lessonById } from "@xq/content";
import { learningRank } from "@xq/lessons";
import { useEffect, useState } from "react";
import { Board } from "./Board.js";
import type { Stars } from "./bots/stars.js";
import type { Progress } from "./learn/progress.js";
import { useNav } from "./nav.js";
import type { PuzzleState } from "./puzzles/store.js";
import { useT } from "./settings.js";
import { useStore } from "./store/index.js";
import { type Streak, computeStreak, dayOf } from "./streak.js";

/** The start position after 1. 炮二平五, used for decorative boards. */
const AFTER_CENTRAL_CANNON = "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C2C4/9/RNBAKABNR b - - 1 1";

/** Dashboard of next steps, built from what this browser has saved. */
export function HomePage() {
  const { tt, t } = useT();
  const nav = useNav();
  const store = useStore();
  const [progress, setProgress] = useState<Progress>({});
  const [puzzles, setPuzzles] = useState<PuzzleState | null>(null);
  const [stars, setStars] = useState<Stars>({});
  const [streak, setStreak] = useState<Streak>({ days: 0, today: false, missed: 0 });

  useEffect(() => {
    void store.lessons.load().then(setProgress);
    void store.puzzles.load().then(setPuzzles);
    void store.stars.load().then(setStars);
    void store.activity.load().then((days) => setStreak(computeStreak(days, dayOf(new Date()))));
  }, []);

  const mastered = LESSON_ORDER.filter((id) => progress[id] === "mastered").length;
  const nextId = LESSON_ORDER.find((id) => progress[id] !== "mastered");
  const next = nextId ? lessonById(nextId) : undefined;
  const { rank } = learningRank(mastered);
  const beaten = Object.keys(stars).length;
  const nextBot = BOTS.find((b) => !stars[b.id]) ?? BOTS.at(-1)!;
  const solved = puzzles?.history.filter((h) => h.score > 0).length ?? 0;
  const isNew = mastered === 0 && solved === 0 && beaten === 0;

  return (
    <div className="home">
      <section className="hero">
        <div className="hero-text">
          <h1>{tt("Learn and play Xiangqi", "学象棋，下象棋")}</h1>
          <p className="sub">
            {tt(
              "Short lessons, puzzles, friendly bots and a strong analysis engine — free, in your browser, no account needed.",
              "简短的课程、趣味题目、友好的机器人对手和强大的分析引擎——免费，在浏览器里就能用，无需注册。",
            )}
          </p>
          <a className="button primary big" href={nav.href(next ? "/learn" : "/puzzles")}>
            {isNew ? tt("Start learning", "开始学习") : tt("Continue", "继续")}
          </a>
        </div>
        <div className="hero-board" aria-hidden>
          <Board fen={AFTER_CENTRAL_CANNON} movable="none" lastMove="h2e2" showCoordinates={false} ariaLabel="" />
        </div>
      </section>

      <section className="cards" aria-label={tt("Next steps", "下一步")}>
        <a className="card" href={nav.href("/learn")}>
          <span className="card-kicker">{tt("Learn", "学习")}</span>
          <strong>{next ? t(next.title) : tt("All lessons mastered", "所有课程已掌握")}</strong>
          <span className="muted">
            {tt("Rank", "等级")}: {t(rank.name)} · {mastered}/{LESSON_ORDER.length}
          </span>
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
          <span className="card-kicker">{tt("Play a bot", "人机对弈")}</span>
          <strong>{t(nextBot.name)}</strong>
          <span className="muted">
            {nextBot.ratingLabel} · {beaten}/{BOTS.length} {tt("beaten", "已战胜")}
          </span>
        </a>
        <a className="card" href={nav.href("/analysis")}>
          <span className="card-kicker">{tt("Analysis", "分析")}</span>
          <strong>{tt("Analysis board", "分析棋盘")}</strong>
          <span className="muted">{tt("Engine, variations, PGN", "引擎、变化、棋谱")}</span>
        </a>
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
      <p className="muted small center">
        {tt("Your progress is saved in this browser. Accounts to keep it across devices are coming.", "你的进度保存在本浏览器中。跨设备同步的账号功能即将推出。")}
      </p>
    </div>
  );
}
