import { LESSONS } from "@xq/content";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LessonApp } from "../../../../components/pages";
import { LOCALES, type Locale, pageMetadata } from "../../../../lib/site";

export const dynamicParams = false;
export const generateStaticParams = () => LOCALES.flatMap((locale) => LESSONS.map((l) => ({ locale, lesson: l.id })));

export async function generateMetadata({ params }: { params: Promise<{ locale: string; lesson: string }> }): Promise<Metadata> {
  const { locale, lesson } = await params;
  const l = LESSONS.find((x) => x.id === lesson);
  if (!l) return {};
  const loc = locale as Locale;
  return pageMetadata("learn", loc, { title: l.title[loc], description: l.summary[loc], path: `/learn/${l.id}` });
}

export default async function LessonRoute({ params }: { params: Promise<{ locale: string; lesson: string }> }) {
  const { locale, lesson } = await params;
  const l = LESSONS.find((x) => x.id === lesson);
  if (!l) notFound();
  const loc = locale as Locale;
  return (
    <>
      <LessonApp lessonId={l.id} />
      {/* The lesson's text, rendered on the server for search engines and readers without JavaScript. */}
      <article className="lesson-text">
        <h2>{l.title[loc]}</h2>
        <p>{l.summary[loc]}</p>
        <ol>
          {l.steps.map((s, i) => (
            <li key={i}>{s.text[loc]}</li>
          ))}
        </ol>
      </article>
    </>
  );
}
