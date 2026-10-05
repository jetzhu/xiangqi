import { useEffect, useState } from "react";
import { AnalysisPage } from "./analysis/AnalysisPage.js";
import { BotsPage } from "./bots/BotsPage.js";
import { LearnPage } from "./learn/LearnPage.js";
import { PlayPage } from "./play/PlayPage.js";

type Route = "play" | "analysis" | "bots" | "learn";
const routeFromHash = (): Route => {
  const h = location.hash;
  if (h.startsWith("#/play")) return "play";
  if (h.startsWith("#/bots")) return "bots";
  if (h.startsWith("#/learn")) return "learn";
  return "analysis";
};

export function App() {
  const [route, setRoute] = useState<Route>(routeFromHash);
  useEffect(() => {
    const onHash = () => setRoute(routeFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  return (
    <>
      <nav className="topnav">
        <strong>象棋 Xiangqi playground</strong>
        <a href="#/learn" aria-current={route === "learn" ? "page" : undefined}>
          Learn
        </a>
        <a href="#/bots" aria-current={route === "bots" ? "page" : undefined}>
          Play bots
        </a>
        <a href="#/analysis" aria-current={route === "analysis" ? "page" : undefined}>
          Analysis
        </a>
        <a href="#/play" aria-current={route === "play" ? "page" : undefined}>
          Two players
        </a>
      </nav>
      {route === "analysis" ? <AnalysisPage /> : route === "bots" ? <BotsPage /> : route === "learn" ? <LearnPage /> : <PlayPage />}
    </>
  );
}
