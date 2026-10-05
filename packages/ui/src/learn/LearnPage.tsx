import { PieceGlyph, THEMES } from "@xq/board";
import { LESSON_ORDER, LESSONS as LESSON_LIST, UNITS } from "@xq/content";
import { learningRank } from "@xq/lessons";
import { type CSSProperties, useEffect, useState } from "react";
import type { PieceType } from "xiangqi-core";
import { useT } from "../settings.js";
import { LessonPlayer } from "./LessonPlayer.js";
import { type Progress, loadProgress, setStatus } from "./progress.js";

const LESSONS = new Map(LESSON_LIST.map((l) => [l.id, l] as const));
const ORDER = LESSON_ORDER;

function UnitIcon({ icon }: { icon: string }) {
  if (icon === "board")
    return (
      <svg viewBox="-0.5 -0.5 1 1" width="46" height="46" aria-hidden>
        <circle r={0.45} fill="#e9c88f" stroke="#8a5f2e" strokeWidth={0.04} />
        <path d="M-0.22,-0.22H0.22V0.22H-0.22ZM-0.22,0H0.22M0,-0.22V0.22" fill="none" stroke="#5b3a1c" strokeWidth={0.04} />
      </svg>
    );
  return (
    <svg viewBox="-0.5 -0.5 1 1" width="46" height="46" aria-hidden>
      <PieceGlyph type={icon as PieceType} color="red" set="traditional" theme={THEMES.wood} forwardUp />
    </svg>
  );
}

export interface LearnPageProps {
  /** On the website each lesson has its own URL; the playground opens lessons in place. */
  lessonHref?: (id: string) => string;
}

export function LearnPage({ lessonHref }: LearnPageProps = {}) {
  const { lang } = useT();
  const [progress, setProgress] = useState<Progress>({});
  const [open, setOpen] = useState<string | null>(null);
  const tt = (en: string, zh: string) => (lang === "zh" ? zh : en);

  useEffect(() => {
    void loadProgress().then(setProgress);
  }, [open]);

  const mastered = ORDER.filter((id) => progress[id] === "mastered").length;
  const { rank, next } = learningRank(mastered);
  const nextLesson = ORDER.find((id) => progress[id] !== "mastered") ?? null;
  const lesson = open ? LESSONS.get(open) : undefined;

  const openLesson = (id: string) => {
    if (lessonHref) {
      location.href = lessonHref(id);
      return;
    }
    setOpen(id);
    void setStatus(id, "started").then(setProgress);
  };

  if (lesson) {
    const i = ORDER.indexOf(lesson.id);
    const following = ORDER[i + 1];
    return (
      <LessonPlayer
        key={lesson.id}
        lesson={lesson}
        lang={lang}
        onDone={() => void setStatus(lesson.id, "mastered").then(setProgress)}
        onExit={() => setOpen(null)}
        hasNext={!!following}
        onNext={() => following && openLesson(following)}
      />
    );
  }

  return (
    <div className="learn">
      <section className="path" aria-label={tt("Learning path", "学习路线")}>
        {UNITS.map((u, i) => {
          const id = u.lessons[0]!;
          const status = progress[id] ?? "new";
          const isNext = id === nextLesson;
          return (
            <div key={u.id} className="path-row" style={{ "--shift": `${[0, 60, 90, 60, 0, -60, -90, -60][i % 8]}px` } as CSSProperties}>
              <button
                type="button"
                className={`path-node ${status}${isNext ? " next" : ""}`}
                onClick={() => openLesson(id)}
                aria-label={`${u.title[lang]}${status === "mastered" ? ` (${tt("mastered", "已掌握")})` : ""}`}
              >
                <UnitIcon icon={u.icon} />
                {status === "mastered" && <span className="tick">✓</span>}
                {isNext && <span className="next-tag">{tt("Next", "下一课")}</span>}
              </button>
              <span className="path-label">
                {i + 1}. {u.title[lang]}
              </span>
            </div>
          );
        })}
      </section>

      <aside className="panel learn-side">
        <h1>{tt("Learn to play", "学下象棋")}</h1>
        <p className="sub">{tt("Short interactive lessons, from the board to your first game.", "简短的互动课程，从认识棋盘到下第一盘棋。")}</p>
        <div className="rank">
          <span className="avatar" style={{ width: 56, height: 56, background: "#c0262d", fontSize: 26 }} aria-hidden>
            {rank.name.zh}
          </span>
          <div>
            <div className="muted">{tt("Learning rank", "学习等级")}</div>
            <strong>{rank.name[lang]}</strong>
            <div className="muted">
              {mastered}/{ORDER.length} {tt("lessons mastered", "课已掌握")}
              {next ? ` · ${tt("next rank at", "下一级需")} ${next.min}` : ""}
            </div>
          </div>
        </div>
        {nextLesson && (
          <button type="button" className="primary play" onClick={() => openLesson(nextLesson)}>
            {tt("Next lesson", "下一课")}: {LESSONS.get(nextLesson)?.title[lang]}
          </button>
        )}
      </aside>
    </div>
  );
}
