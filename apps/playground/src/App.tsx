import {
  AnalysisPage,
  BotsPage,
  HomePage,
  LearnPage,
  NavProvider,
  PlayPage,
  PuzzlesPage,
  SettingsPage,
  SettingsProvider,
  SiteNav,
  hashNav,
} from "@xq/ui";
import { useEffect, useState } from "react";

type Route = "home" | "learn" | "puzzles" | "bots" | "analysis" | "play" | "settings";
const ROUTES: Route[] = ["learn", "puzzles", "bots", "analysis", "play", "settings"];
const routeFromHash = (): Route => ROUTES.find((r) => location.hash.startsWith(`#/${r}`)) ?? "home";

/** Dev playground: the site's pages under hash routes (#/learn, #/analysis?moves=…). */
export function App() {
  const [route, setRoute] = useState<Route>(routeFromHash);
  useEffect(() => {
    const onHash = () => setRoute(routeFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  const page = {
    home: <HomePage />,
    learn: <LearnPage />,
    puzzles: <PuzzlesPage />,
    bots: <BotsPage />,
    analysis: <AnalysisPage />,
    play: <PlayPage />,
    settings: <SettingsPage />,
  }[route];
  return (
    <SettingsProvider>
      <NavProvider nav={hashNav}>
        <SiteNav current={route} />
        <main key={route}>{page}</main>
      </NavProvider>
    </SettingsProvider>
  );
}
