"use client";
import { XiangqiBoard, type XiangqiBoardProps } from "@xq/board";
import { useSettings } from "./settings.js";

/** The site's board: XiangqiBoard with the user's piece set, theme, coordinates and input settings applied. */
export function Board(props: XiangqiBoardProps) {
  const s = useSettings().settings;
  return (
    <XiangqiBoard
      pieceSet={s.pieceSet}
      theme={s.theme}
      showCoordinates={s.coordinates !== "off"}
      coordinates={s.coordinates === "iccs" ? "iccs" : "wxf"}
      moveMethod={s.moveMethod}
      showLegalMoves={s.showLegalMoves}
      {...props}
    />
  );
}
