/**
 * A deliberately tiny toy world, shared by the demos.
 *
 * The point of this file is what it does NOT contain: there is no LLM
 * anywhere in it. Board state, scoring, and outcome are plain functions.
 * The model's only input is a quality word; the functions below decide
 * what that word is worth and cap how far it can move a card.
 */

/** The 20-card domain deck (demo 01). The real game uses exactly this list. */
export const DOMAINS = [
  "governance", "economy", "law", "religion", "family",
  "labor", "class", "warfare", "travel", "ecology",
  "food", "education", "art", "communication",
  "medicine", "taboo", "diplomacy", "technology",
  "fashion", "spectacle",
] as const;
export type Domain = (typeof DOMAINS)[number];

/** What a card does on the board. Decided in code from the judge's answers,
 *  never asked of the model as a single N-way choice. */
export type RewardMode = "place" | "capture" | "trap";

/** The judge's one scalar. A word, never a number. */
export type Quality = "excellent" | "good" | "adequate" | "poor";

// ─── Deterministic RNG ───────────────────────────────────────────────────
// One LCG, one hash, used everywhere. (In the real codebase this once
// drifted into four near-copies with different masks. Keep one.)

/** djb2 string hash → 32-bit unsigned. */
export function hashString(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** Numerical Recipes LCG. Returns a stream of [0,1). */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

// ─── The engine owns the numbers ─────────────────────────────────────────

/** Card VALUE is a pure function of the quality word. No RNG, no model. */
export function valueFromQuality(q: Quality, mode: RewardMode): number | undefined {
  if (mode === "trap") return undefined;
  return { poor: 1, adequate: 1, good: 2, excellent: 3 }[q];
}

/** Card INITIATIVE: the quality word gates a NARROW seeded band. The model
 *  picked the word; the server rolls inside the band it earned. Note how
 *  little room "excellent" buys over "good" — a model that grades
 *  everything excellent gains +1 VALUE, not a runaway. */
export function initFromQuality(q: Quality, mode: RewardMode, seed: number): number {
  if (mode === "trap") return 0;
  const r = seededRandom(seed)();
  switch (q) {
    case "poor":      return 1;
    case "adequate":  return r < 0.5 ? 1 : 2;
    case "good":      return r < 0.7 ? 2 : 3;
    case "excellent": return r < 0.5 ? 2 : 3;
  }
}

/** Quality can VETO a mode the model asked for. A "poor" narrative does not
 *  get to be a trap no matter how the model felt about it. */
export function modeForQuality(mode: RewardMode, q: Quality): RewardMode | null {
  if (q !== "poor") return mode;
  if (mode === "trap") return null;        // suppressed entirely
  if (mode === "capture") return "place";  // downgraded
  return mode;
}

// ─── Narrative scale: tile counts → words, before the prompt is built ──────

export type NarrativeScale = "none" | "minor" | "solid" | "major" | "decisive";

/** The model is handed THIS, never the tile count. It cannot anchor on a
 *  number it never sees, and it has no field in which to change one. */
export function scaleFromTiles(tilesGained: number, failed = false): NarrativeScale {
  if (failed || tilesGained <= 0) return "none";
  if (tilesGained === 1) return "minor";
  if (tilesGained <= 3) return "solid";
  if (tilesGained <= 5) return "major";
  return "decisive";
}

/** How the result compares to what the QUALITY led the player to expect.
 *  This — not raw scale — is what the reveal animation reads.
 *
 *  `under` is deliberately unreachable for adequate/poor: a weak card
 *  landing little is expected, not a nerf. Surfacing it as a down-beat
 *  would lie about a downgrade that never happened. */
export type ExpectationDelta = "under" | "met" | "over";

export function expectationDelta(q: Quality, s: NarrativeScale): ExpectationDelta {
  switch (q) {
    case "excellent":
      if (s === "none" || s === "minor") return "under";
      if (s === "decisive") return "over";
      return "met";
    case "good":
      if (s === "none") return "under";
      if (s === "major" || s === "decisive") return "over";
      return "met";
    case "adequate":
      if (s === "major" || s === "decisive") return "over";
      return "met";
    case "poor":
      if (s === "solid" || s === "major" || s === "decisive") return "over";
      return "met";
  }
}
