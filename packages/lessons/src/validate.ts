// Content checks run in CI: a broken lesson fails the build.

import { Position, parseSquare } from "xiangqi-core";
import { acceptedMoves, fewestStarMoves, judgeFindMove, movesOf } from "./steps.js";
import type { Lesson, Step, Text, Unit } from "./types.js";

const textOk = (t: Text | undefined) => !!t && t.en.trim().length > 0 && t.zh.trim().length > 0;

function fenErrors(fen: string): string[] {
  try {
    return Position.fromFen(fen).validate();
  } catch (e) {
    return [(e as Error).message];
  }
}

function pieceSideMatches(fen: string, square: string): boolean {
  const p = Position.fromFen(fen);
  const code = p.board[parseSquare(square)]!;
  return code !== 0 && code > 0 === (p.turn === 1);
}

export function validateStep(step: Step): string[] {
  const errs: string[] = [];
  if (!textOk(step.text)) errs.push("coach text missing in one language");
  const fen = "fen" in step ? step.fen : undefined;
  if (fen) errs.push(...fenErrors(fen).map((e) => `illegal position: ${e}`));
  if (errs.length) return errs;

  switch (step.type) {
    case "explain":
      break;
    case "show-moves":
      if (!pieceSideMatches(step.fen, step.square)) errs.push(`no piece of the side to move on ${step.square}`);
      else if (movesOf(step.fen, step.square).length === 0) errs.push(`piece on ${step.square} has no legal move`);
      else if (!step.restricted) {
        // Showing how a piece moves: rules about check or facing generals shouldn't hide moves by accident.
        const pseudo = Position.fromFen(step.fen).pieceMoves(parseSquare(step.square)).length;
        const legal = movesOf(step.fen, step.square).length;
        if (legal < pseudo) errs.push(`${pseudo - legal} move(s) hidden by check or facing generals (set "restricted" if intended)`);
      }
      break;
    case "capture-stars": {
      if (!pieceSideMatches(step.fen, step.square)) errs.push(`no piece of the side to move on ${step.square}`);
      if (step.stars.length === 0) errs.push("no stars");
      if (step.stars.includes(step.square)) errs.push("a star sits under the piece");
      const n = fewestStarMoves(step, step.maxMoves);
      if (n === null) errs.push(`stars cannot all be collected within ${step.maxMoves} moves`);
      break;
    }
    case "find-move": {
      if (!textOk(step.hint) || !textOk(step.success)) errs.push("hint or success text missing");
      if (step.accept !== "checkmate") {
        for (const m of step.accept) if (judgeFindMove(step, m) === "illegal") errs.push(`accepted move ${m} is illegal`);
      }
      if (acceptedMoves(step).length === 0) errs.push("no move is accepted");
      break;
    }
    case "play-out":
      if (!textOk(step.hint) || !textOk(step.success)) errs.push("hint or success text missing");
      if (step.maxMoves < 1) errs.push("maxMoves must be at least 1");
      break;
    case "quiz":
      if (step.options.length < 2) errs.push("a quiz needs at least two options");
      if (step.options.filter((o) => o.correct).length !== 1) errs.push("a quiz needs exactly one correct option");
      if (!step.options.every((o) => textOk(o.text)) || !textOk(step.explanation)) errs.push("quiz text missing");
      break;
  }
  return errs;
}

export function validateLesson(lesson: Lesson): string[] {
  const errs: string[] = [];
  if (!textOk(lesson.title) || !textOk(lesson.summary)) errs.push(`${lesson.id}: title or summary missing`);
  if (lesson.steps.length === 0) errs.push(`${lesson.id}: no steps`);
  lesson.steps.forEach((s, i) => errs.push(...validateStep(s).map((e) => `${lesson.id} step ${i + 1} (${s.type}): ${e}`)));
  return errs;
}

export function validateUnits(units: Unit[], lessons: Lesson[]): string[] {
  const ids = new Set(lessons.map((l) => l.id));
  const errs: string[] = [];
  for (const u of units) {
    if (!textOk(u.title)) errs.push(`unit ${u.id}: title missing`);
    for (const l of u.lessons) if (!ids.has(l)) errs.push(`unit ${u.id}: unknown lesson ${l}`);
  }
  return errs;
}
