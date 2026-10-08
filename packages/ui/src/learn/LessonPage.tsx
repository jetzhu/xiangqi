"use client";
import { LESSON_ORDER, lessonById } from "@xq/content";
import { useEffect } from "react";
import { useNav } from "../nav.js";
import { useT } from "../settings.js";
import { LessonPlayer } from "./LessonPlayer.js";
import { useStore } from "../store/index.js";

/** One lesson on its own page (the website's /learn/<id>). */
export function LessonPage({ lessonId }: { lessonId: string }) {
  const store = useStore();
  const nav = useNav();
  const { lang } = useT();
  const lesson = lessonById(lessonId);
  const following = LESSON_ORDER[LESSON_ORDER.indexOf(lessonId) + 1];

  useEffect(() => {
    void store.lessons.setStatus(lessonId, "started");
  }, [lessonId]);

  if (!lesson) return <p className="muted">Lesson not found.</p>;
  return (
    <LessonPlayer
      lesson={lesson}
      lang={lang}
      onDone={() => void store.lessons.setStatus(lesson.id, "mastered")}
      onExit={() => (location.href = nav.href("/learn"))}
      hasNext={!!following}
      onNext={() => following && (location.href = nav.href(`/learn/${following}`))}
    />
  );
}
