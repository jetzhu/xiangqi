"use client";
// A moderator analyses an unchecked or disputed game in their own browser (M19); the `game`
// function scores it with that analysis.
import { analysePositions } from "@xq/engine";
import { type AnalysisData, FAIRPLAY_DEPTH, FAIRPLAY_LINES, encodeScore } from "@xq/online";
import { useEffect, useState } from "react";
import { Game } from "xiangqi-core";
import { useAccount } from "../account/session.js";
import { useEngineInstance } from "../bots/useEngineInstance.js";
import { useT } from "../settings.js";
import { submitAnalysis } from "./api.js";

export default function ModAnalyse({ game, moves, onDone }: { game: string; moves: string[]; onDone: (message: string) => void }) {
  const { tt } = useT();
  const account = useAccount();
  const { engine, status } = useEngineInstance(true);
  const [done, setDone] = useState(0);

  useEffect(() => {
    if (status === "error") onDone(tt("The engine can't run in this browser.", "此浏览器无法运行引擎。"));
    if (!engine) return;
    const g = new Game();
    const fens = [g.fen];
    for (const m of moves) {
      g.move(m);
      fens.push(g.fen);
    }
    void analysePositions(engine, fens, { depth: FAIRPLAY_DEPTH, multipv: FAIRPLAY_LINES, onProgress: setDone })
      .then(async (evals) => {
        const data: AnalysisData = { v: 1, depth: FAIRPLAY_DEPTH, positions: evals.map((p) => ({ b: p.best, s: p.scores.map(encodeScore) })) };
        await submitAnalysis(await account.client(), game, data);
        onDone(tt("Game checked.", "对局已检查。"));
      })
      .catch((e: Error) => onDone(e.message));
  }, [engine, status]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <span className="muted small">
      {" "}
      {tt(`Analysing… ${done} of ${moves.length + 1}`, `分析中… ${done}/${moves.length + 1}`)}
    </span>
  );
}
