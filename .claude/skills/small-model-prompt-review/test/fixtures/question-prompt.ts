/**
 * Question-writer prompt for a world-building game. The topic is dealt by
 * the engine from a per-game shuffled deck; the model only writes the
 * question and tags how common the thing it asks about is.
 */

export type Level = "logic" | "balanced" | "creative";

/** Temperature per prompt level, per model. Unlisted models use `default`. */
export const TEMPERATURES: Record<string, Record<Level, number>> = {
  "gemma4:e4b": { logic: 1.0, balanced: 1.0, creative: 1.0 },
  default: { logic: 0.1, balanced: 0.6, creative: 0.8 },
};

export const QUESTION_LEVEL: Level = "creative";

export function questionSystem(): string {
  return `You write one world-building question at a time for a group of players.
Return RAW JSON only. No talk. No backticks.`;
}

export function questionUser(worldSummary: string, dealtTopic: string): string {
  return `WORLD SO FAR: ${worldSummary}
TOPIC FOR THIS QUESTION: ${dealtTopic}

Write one question about that topic, up to ~40 words, that the players can answer in a sentence or two.

Return RAW JSON only:
{"question": "the question, up to ~40 words, about the dealt topic",
 "answerable": "yes/no — can a player answer this without inventing new places or people?",
 "prevalence": "One of: rare, uncommon, common, everywhere — how common is the thing the question asks about in this world?"}`;
}

export interface QuestionResult {
  question: string;
  answerable: boolean;
  prevalence: "rare" | "uncommon" | "common" | "everywhere";
}

const PREVALENCE = ["rare", "uncommon", "common", "everywhere"] as const;

/** Case-insensitive whole-first-word match. "Rare." and "rare — because…" both read as "rare". */
function firstWord(v: unknown): string | undefined {
  return String(v ?? "").trim().toLowerCase().match(/^[a-z]+/)?.[0];
}

export function parseQuestion(raw: string, log: (msg: string) => void): QuestionResult {
  const j = JSON.parse(raw) as Record<string, unknown>;

  const yn = firstWord(j.answerable);
  let answerable = true;
  if (yn === "yes" || yn === "true") answerable = true;
  else if (yn === "no" || yn === "false") answerable = false;
  else log(`answerable: unreadable value ${JSON.stringify(j.answerable)}, defaulting to yes`);

  const pw = firstWord(j.prevalence);
  const prevalence = PREVALENCE.find((p) => p === pw) ?? "common";
  if (!PREVALENCE.some((p) => p === pw)) log(`prevalence: unreadable value ${JSON.stringify(j.prevalence)}, defaulting to common`);

  return { question: String(j.question ?? "").trim(), answerable, prevalence };
}

/** The engine maps the word to a number, seeded so a replay lands on the same value. */
export const PREVALENCE_RANGES: Record<QuestionResult["prevalence"], [number, number]> = {
  rare: [0.01, 0.05],
  uncommon: [0.05, 0.15],
  common: [0.15, 0.3],
  everywhere: [0.3, 0.45],
};
