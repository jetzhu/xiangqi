"use client";
import { XiangqiBoard, type XiangqiBoardProps } from "@xq/board";
import { useEffect, useState } from "react";
import { ANIMATION_MS, useSettings, useT } from "./settings.js";

/**
 * The site's board: XiangqiBoard with the user's piece set, theme, coordinates, input and
 * animation settings applied. With "confirm move" on, a move is held as an arrow until the
 * player confirms or cancels it.
 */
export function Board(props: XiangqiBoardProps) {
  const s = useSettings().settings;
  const { tt } = useT();
  const [pending, setPending] = useState<string | null>(null);
  // A new position (the other side moved, a new puzzle…) drops a held move.
  useEffect(() => setPending(null), [props.fen]);

  const confirming = s.confirmMove && props.onMove !== undefined;
  const onMove = confirming ? (move: string) => setPending(move) : props.onMove;
  const arrows = pending ? [...(props.arrows ?? []), { from: pending.slice(0, 2), to: pending.slice(2, 4), color: "blue" as const }] : props.arrows;

  return (
    <>
      <XiangqiBoard
        pieceSet={s.pieceSet}
        theme={s.theme}
        showCoordinates={s.coordinates !== "off"}
        coordinates={s.coordinates === "iccs" ? "iccs" : "wxf"}
        moveMethod={s.moveMethod}
        showLegalMoves={s.showLegalMoves}
        animation={s.animation !== "off"}
        animationMs={ANIMATION_MS[s.animation]}
        {...props}
        {...(onMove ? { onMove } : {})}
        {...(arrows ? { arrows } : {})}
        {...(pending ? { movable: "none" as const } : {})}
      />
      {pending && (
        <div className="confirm-move" role="group" aria-label={tt("Confirm move", "确认走子")}>
          <button
            type="button"
            className="primary"
            autoFocus
            onClick={() => {
              const m = pending;
              setPending(null);
              props.onMove?.(m);
            }}
          >
            {tt("Confirm move", "确认走子")}
          </button>
          <button type="button" onClick={() => setPending(null)}>
            {tt("Cancel", "取消")}
          </button>
        </div>
      )}
    </>
  );
}
