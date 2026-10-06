"use client";
// Offers a reload when a newer build has been deployed: the site polls version.json (written
// at build time) and compares it with the build id it was built with.
import { useT } from "@xq/ui";
import { useEffect, useState } from "react";
import { BUILD, withBase } from "../lib/site";

const EVERY_MS = 10 * 60_000;

export function UpdateBanner() {
  const { tt } = useT();
  const [newer, setNewer] = useState(false);
  useEffect(() => {
    if (BUILD === "dev") return;
    const check = async () => {
      try {
        const res = await fetch(withBase("/version.json"), { cache: "no-store" });
        const { build } = (await res.json()) as { build: string };
        if (build && build !== BUILD) setNewer(true);
      } catch {
        // offline or blocked: try again later
      }
    };
    const onVisible = () => document.visibilityState === "visible" && void check();
    const id = setInterval(check, EVERY_MS);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  if (!newer) return null;
  return (
    <div className="update-banner" role="status">
      {tt("A new version of the site is available.", "网站有新版本。")}{" "}
      <button type="button" className="primary" onClick={() => location.reload()}>
        {tt("Reload", "刷新")}
      </button>
    </div>
  );
}
