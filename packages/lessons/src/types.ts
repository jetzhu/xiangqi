export interface Text {
  en: string;
  zh: string;
}

export type ArrowSpec = { from: string; to: string; color?: "green" | "red" | "blue" | "orange" };
export type HighlightSpec = { square: string; kind: "hint" | "good" | "bad" };

interface StepBase {
  /** What the coach says. */
  text: Text;
}

/** The coach explains something on a fixed position (or no board). */
export interface ExplainStep extends StepBase {
  type: "explain";
  fen?: string;
  arrows?: ArrowSpec[];
  highlights?: HighlightSpec[];
}

/** The board shows every legal move of one piece as arrows. */
export interface ShowMovesStep extends StepBase {
  type: "show-moves";
  fen: string;
  square: string;
}

/** Move one piece to collect every star; other pieces don't move. */
export interface CaptureStarsStep extends StepBase {
  type: "capture-stars";
  fen: string;
  square: string;
  stars: string[];
  /** Most moves allowed (checked by the validator to be enough). */
  maxMoves: number;
}

/** Find the right move. */
export interface FindMoveStep extends StepBase {
  type: "find-move";
  fen: string;
  /** Accepted moves in ICCS, or "checkmate" to accept any mating move. */
  accept: string[] | "checkmate";
  hint: Text;
  /** Said after a legal but wrong move. */
  wrong?: Text;
  /** Said after the right move. */
  success: Text;
}

/** Play on against the engine until the goal is reached. */
export interface PlayOutStep extends StepBase {
  type: "play-out";
  fen: string;
  goal: "checkmate";
  /** Learner moves allowed. */
  maxMoves: number;
  hint: Text;
  success: Text;
}

export interface QuizStep extends StepBase {
  type: "quiz";
  fen?: string;
  options: { text: Text; correct?: boolean }[];
  explanation: Text;
}

export type Step = ExplainStep | ShowMovesStep | CaptureStarsStep | FindMoveStep | PlayOutStep | QuizStep;

export interface Lesson {
  id: string;
  title: Text;
  summary: Text;
  steps: Step[];
}

export interface Unit {
  id: string;
  title: Text;
  /** Piece type drawn on the path node (k a b n r c p), or "board". */
  icon: string;
  lessons: string[];
}
