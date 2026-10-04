import { useEffect, useState } from "react";
import { AnalysisPage } from "./analysis/AnalysisPage.js";
import { PlayPage } from "./play/PlayPage.js";

type Route = "play" | "analysis";
const routeFromHash = (): Route => (location.hash.startsWith("#/play") ? "play" : "analysis");

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
        <a href="#/analysis" aria-current={route === "analysis" ? "page" : undefined}>
          Analysis
        </a>
        <a href="#/play" aria-current={route === "play" ? "page" : undefined}>
          Two players
        </a>
      </nav>
      {route === "analysis" ? <AnalysisPage /> : <PlayPage />}
    </>
  );
}
