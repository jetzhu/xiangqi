// Lesson progress types; reading and writing goes through the Store (store/index.tsx).
export type LessonStatus = "new" | "started" | "mastered";
export type Progress = Record<string, LessonStatus>;
