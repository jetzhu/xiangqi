import { LESSONS } from "@xq/content";
import type { MetadataRoute } from "next";
import { LOCALES, urlOf } from "../lib/site";

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  const paths = ["/", "/learn", "/puzzles", "/bots", "/analysis", "/play", ...LESSONS.map((l) => `/learn/${l.id}`)];
  return paths.flatMap((path) =>
    LOCALES.map((locale) => ({
      url: urlOf(locale, path),
      alternates: { languages: { "zh-CN": urlOf("zh", path), en: urlOf("en", path) } },
      changeFrequency: "weekly" as const,
      priority: path === "/" ? 1 : path.startsWith("/learn") ? 0.8 : 0.6,
    })),
  );
}
