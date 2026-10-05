import { type Arrow, type Highlight, XiangqiBoard, playSound } from "@xq/board";
import {
  type Lesson,
  type StarsState,
  type Step,
  type Text,
  acceptedMoves,
  judgeFindMove,
  movesOf,
  playStarMove,
  startStars,
} from "@xq/lessons";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Game, Position, explainIllegal, parseSquare, squareName, toIccs } from "xiangqi-core";
import { useEngineInstance } from "../bots/useEngineInstance.js";

export type Lang = "en" | "zh";

interface Props {
  lesson: Lesson;
  lang: Lang;
  onDone: () => void;
  onExit: () => void;
  hasNext: boolean;
  onNext: () => void;
}

const sideOf = (fen: string) => (fen.split(" ")[1] === "b" ? "black" : "red");
const checkSquareOf = (fen: string) => {
  const p = Position.fromFen(fen);
  return p.isInCheck(p.turn) ? squareName(p.kings[p.turn === 1 ? 0 : 1]) : null;
};

export function LessonPlayer({ lesson, lang, onDone, onExit, hasNext, onNext }: Props) {
  const [index, setIndex] = useState(0);
  const [finished, setFinished] = useState(false);
  const step = lesson.steps[index]!;
  const needsEngine = lesson.steps.some((s) => s.type === "play-out");
  const engine = useEngineInstance(needsEngine);
  const t = (x: Text) => x[lang];
  const tt = (en: string, zh: string) => (lang === "zh" ? zh : en);

  const next = () => {
    if (index + 1 < lesson.steps.length) setIndex(index + 1);
    else {
      setFinished(true);
      playSound("end");
      onDone();
    }
  };

  if (finished) {
    return (
      <div className="lesson">
        <section className="panel lesson-done">
          <div className="big-check" aria-hidden>
            ✓
          </div>
          <h1>{tt("Lesson complete!", "课程完成！")}</h1>
          <p>
            {t(lesson.title)} — {t(lesson.summary)}
          </p>
          <div className="buttons">
            {hasNext && (
              <button type="button" className="primary" onClick={onNext}>
                {tt("Next lesson", "下一课")}
              </button>
            )}
            <button type="button" onClick={onExit}>
              {tt("Back to the path", "返回课程地图")}
            </button>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="lesson">
      <header className="lesson-head">
        <button type="button" className="link" onClick={onExit} aria-label={tt("Back", "返回")}>
          ←
        </button>
        <h1>{t(lesson.title)}</h1>
        <div className="steps-bar" role="progressbar" aria-valuemin={0} aria-valuemax={lesson.steps.length} aria-valuenow={index}>
          {lesson.steps.map((_, i) => (
            <span key={i} className={i < index ? "done" : i === index ? "now" : ""} />
          ))}
        </div>
      </header>
      <StepView key={`${lesson.id}-${index}`} step={step} lang={lang} onComplete={next} engine={engine} />
    </div>
  );
}

interface StepProps {
  step: Step;
  lang: Lang;
  onComplete: () => void;
  engine: ReturnType<typeof useEngineInstance>;
}

/** One step. Remounted per step (key), so all state starts fresh. */
function StepView({ step, lang, onComplete, engine }: StepProps) {
  const t = (x: Text) => x[lang];
  const tt = (en: string, zh: string) => (lang === "zh" ? zh : en);
  const [done, setDone] = useState(step.type === "explain" || step.type === "show-moves");
  const [say, setSay] = useState<string | null>(null);
  const [mood, setMood] = useState<"ok" | "bad" | null>(null);
  const [showHint, setShowHint] = useState(false);

  // capture-stars
  const [stars, setStars] = useState<StarsState | null>(step.type === "capture-stars" ? startStars(step) : null);
  // find-move / play-out
  const [fen, setFen] = useState<string>("fen" in step && step.fen ? step.fen : "");
  const [lastMove, setLastMove] = useState<string | null>(null);
  const gameRef = useRef<Game | null>(step.type === "play-out" ? new Game(step.fen) : null);
  const [learnerMoves, setLearnerMoves] = useState(0);
  const [thinking, setThinking] = useState(false);
  // quiz
  const [picked, setPicked] = useState<number[]>([]);

  const learner = "fen" in step && step.fen ? sideOf(step.fen) : "red";

  const illegal = (from: string, to: string, atFen: string) => {
    const why = explainIllegal(Position.fromFen(atFen), parseSquare(from), parseSquare(to));
    if (why) {
      setSay(why[lang]);
      setMood("bad");
      playSound("illegal");
    }
  };

  // play-out: the engine replies for the other side.
  useEffect(() => {
    const g = gameRef.current;
    const e = engine.engine;
    if (step.type !== "play-out" || !g || !e || done || g.result || g.turn === learner) return;
    let cancelled = false;
    setThinking(true);
    void e.analyze(g.fen, { depth: 6 }).then(async (r) => {
      await new Promise((res) => setTimeout(res, 400));
      if (cancelled || !r.bestmove) return;
      const rec = g.move(r.bestmove);
      setThinking(false);
      if (!rec) return;
      playSound(rec.check ? "check" : rec.captured ? "capture" : "move");
      setFen(g.fen);
      setLastMove(rec.iccs);
    });
    return () => {
      cancelled = true;
      setThinking(false);
    };
  }, [fen, engine.engine]); // eslint-disable-line react-hooks/exhaustive-deps

  let board: ReactNode = null;
  let controls: ReactNode = null;

  switch (step.type) {
    case "explain":
      if (step.fen)
        board = (
          <XiangqiBoard
            fen={step.fen}
            movable="none"
            arrows={step.arrows ?? []}
            highlights={(step.highlights ?? []) as Highlight[]}
            check={checkSquareOf(step.fen)}
          />
        );
      break;

    case "show-moves": {
      const arrows: Arrow[] = movesOf(step.fen, step.square).map((m) => ({ from: m.slice(0, 2), to: m.slice(2, 4), color: "green" }));
      board = <XiangqiBoard fen={step.fen} movable="none" arrows={arrows} highlights={[{ square: step.square, kind: "hint" }]} />;
      break;
    }

    case "capture-stars": {
      const s = stars!;
      board = (
        <XiangqiBoard
          fen={s.fen}
          movable={learner}
          legalMoves={done ? [] : movesOf(s.fen, s.square)}
          stars={s.stars}
          lastMove={lastMove}
          onMove={(m) => {
            const n = playStarMove(s, m);
            if (!n) return;
            setStars(n);
            setLastMove(m);
            const got = n.stars.length < s.stars.length;
            playSound(got ? "capture" : "move");
            if (n.stars.length === 0) {
              setDone(true);
              setMood("ok");
              setSay(n.moves <= step.maxMoves ? tt(`All stars in ${n.moves} moves!`, `${n.moves}步吃掉所有星星！`) : tt("All stars collected!", "星星全部吃掉了！"));
            } else if (got) {
              setMood("ok");
              setSay(tt("Nice! Now the next star.", "好！再吃下一颗星星。"));
            }
          }}
          onIllegal={(from, to) => illegal(from, to, s.fen)}
        />
      );
      controls = (
        <>
          <span className="muted">
            {tt("Moves", "步数")}: {s.moves}
          </span>
          <button
            type="button"
            onClick={() => {
              setStars(startStars(step));
              setLastMove(null);
              setDone(false);
              setSay(null);
            }}
          >
            {tt("Restart", "重来")}
          </button>
        </>
      );
      break;
    }

    case "find-move": {
      const hintMove = showHint ? acceptedMoves(step)[0] : undefined;
      board = (
        <XiangqiBoard
          fen={fen}
          movable={done ? "none" : learner}
          legalMoves={done ? [] : new Game(fen).legalMoves().map(toIccs)}
          lastMove={lastMove}
          check={checkSquareOf(fen)}
          highlights={hintMove ? [{ square: hintMove.slice(0, 2), kind: "hint" }] : []}
          onMove={(m) => {
            const verdict = judgeFindMove(step, m);
            const g = new Game(fen);
            const rec = g.move(m)!;
            playSound(rec.check ? "check" : rec.captured ? "capture" : "move");
            setFen(g.fen);
            setLastMove(m);
            if (verdict === "correct") {
              setDone(true);
              setMood("ok");
              setSay(t(step.success));
            } else {
              setMood("bad");
              setSay(step.wrong ? t(step.wrong) : tt("Not quite. Try again.", "不太对，再试一次。"));
              setTimeout(() => {
                setFen(step.fen);
                setLastMove(null);
              }, 900);
            }
          }}
          onIllegal={(from, to) => illegal(from, to, fen)}
        />
      );
      controls = !done && (
        <button
          type="button"
          onClick={() => {
            setShowHint(true);
            setSay(t(step.hint));
            setMood(null);
          }}
        >
          {tt("Hint", "提示")}
        </button>
      );
      break;
    }

    case "play-out": {
      const g = gameRef.current!;
      const myTurn = g.turn === learner && !done && !g.result;
      board = (
        <XiangqiBoard
          fen={fen}
          movable={myTurn ? learner : "none"}
          legalMoves={myTurn ? g.legalMoves().map(toIccs) : []}
          lastMove={lastMove}
          check={checkSquareOf(fen)}
          onMove={(m) => {
            const rec = g.move(m);
            if (!rec) return;
            const n = learnerMoves + 1;
            setLearnerMoves(n);
            playSound(rec.check ? "check" : rec.captured ? "capture" : "move");
            setFen(g.fen);
            setLastMove(m);
            setSay(null);
            if (g.result?.reason === "checkmate" && g.result.winner === learner) {
              setDone(true);
              setMood("ok");
              setSay(t(step.success));
            } else if (g.result || n >= step.maxMoves) {
              setMood("bad");
              setSay(tt(`Not mate within ${step.maxMoves} moves. Try again!`, `${step.maxMoves}步内没有将死，再试一次！`));
            }
          }}
          onIllegal={(from, to) => illegal(from, to, fen)}
        />
      );
      const failed = !done && (g.result !== null || learnerMoves >= step.maxMoves);
      controls = (
        <>
          <span className="muted">
            {tt("Your moves", "你的步数")}: {learnerMoves}/{step.maxMoves}
            {thinking ? tt(" · Black is thinking…", " · 对方思考中…") : ""}
            {engine.status === "loading" ? tt(" · loading engine…", " · 正在加载引擎…") : ""}
          </span>
          {!done && (
            <button
              type="button"
              onClick={() => {
                setSay(t(step.hint));
                setMood(null);
              }}
            >
              {tt("Hint", "提示")}
            </button>
          )}
          {(failed || learnerMoves > 0) && !done && (
            <button
              type="button"
              onClick={() => {
                gameRef.current = new Game(step.fen);
                setFen(step.fen);
                setLastMove(null);
                setLearnerMoves(0);
                setSay(null);
              }}
            >
              {tt("Restart", "重来")}
            </button>
          )}
        </>
      );
      break;
    }

    case "quiz":
      if (step.fen) board = <XiangqiBoard fen={step.fen} movable="none" />;
      controls = (
        <div className="quiz">
          {step.options.map((o, i) => {
            const state = picked.includes(i) ? (o.correct ? "right" : "wrong") : "";
            return (
              <button
                key={i}
                type="button"
                className={`option ${state}`}
                disabled={done}
                onClick={() => {
                  setPicked((p) => [...p, i]);
                  if (o.correct) {
                    setDone(true);
                    setMood("ok");
                    setSay(t(step.explanation));
                    playSound("capture");
                  } else {
                    setMood("bad");
                    setSay(tt("Not quite — try another answer.", "不对，再选一个。"));
                    playSound("illegal");
                  }
                }}
              >
                {t(o.text)}
              </button>
            );
          })}
        </div>
      );
      break;
  }

  return (
    <div className={`lesson-body${board ? "" : " no-board"}`}>
      {board && <div className="lesson-board">{board}</div>}
      <aside className="panel lesson-side">
        <div className="coach">
          <span className="avatar" style={{ width: 44, height: 44, background: "#3a7d44", fontSize: 20 }} aria-hidden>
            师
          </span>
          <div className="bubble">{t(step.text)}</div>
        </div>
        {say && (
          <div className={`say ${mood ?? ""}`} role="status">
            {say}
          </div>
        )}
        <div className="buttons">{controls}</div>
        <button type="button" className="primary continue" disabled={!done} onClick={onComplete}>
          {tt("Continue", "继续")}
        </button>
      </aside>
    </div>
  );
}
