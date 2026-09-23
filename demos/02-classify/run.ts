/**
 * DEMO 02 — Stop asking small models to classify.
 *
 * A judge prompt asked the model to pick one of three card modes
 * (place / capture / trap) and one of two lanes. In production, on an
 * 8B model, `capture` came back 0% of the time and `lane` came back
 * aLayer 100% of the time. Prompt-tweaking did not move either number.
 *
 * The fix was to stop asking the model to CLASSIFY and instead ask it
 * several independent questions it is genuinely good at:
 *
 *     landsAsCapture : does this story take something from an enemy?
 *     landsAsTrap    : does it spring a consequence on an enemy?
 *     isIndirect     : is the act covert rather than forceful?
 *
 * Then derive the category server-side. Models are bad at picking one of
 * N. They are good at emotional plausibility. Ask for the thing they are
 * good at, and do the taxonomy yourself.
 */
import type { RewardMode, LaneId, Quality } from "../../src/world.js";
import { modeForQuality, valueFromQuality, initFromQuality, hashString } from "../../src/world.js";
import { getClient, extractJson, isLive, header, section, bar, runDemo } from "../../src/llm.js";

// ── Sample plans the judge grades ────────────────────────────────────────

const PLANS = [
  "Bribe the harbour clerk to misfile the rival tide manifest.",
  "March the militia down the causeway at dawn and take the granary.",
  "Leave the west gate unbarred, and wait in the bell tower.",
  "Buy every bushel of blackroot before the rival caravan arrives.",
  "Spread word that the rival well is fouled; let the crowd do the rest.",
  "Burn the pontoon bridge behind us as we withdraw.",
  "Slip a forged writ into the magistrate morning papers.",
  "Storm the counting-house and seize the ledgers outright.",
];

// ── (a) The enum version — what collapsed ────────────────────────────────

const ENUM_PROMPT = (plan: string) => `You are judging a plan in a strategy game.
PLAN: "${plan}"
Pick the card mode and the lane.
Return RAW JSON only:
{"mode": "one of: place, capture, trap", "lane": "one of: aLayer, bLayer"}`;

/** Recorded: 8 calls, 8B model. Every mode came back "place"; every lane
 *  came back "aLayer". The model is not choosing — it is defaulting. */
const RECORDED_ENUM = PLANS.map(() => ({ mode: "place", lane: "aLayer" }));

// ── (b) The decomposed version — what fixed it ───────────────────────────

const BOOL_PROMPT = (plan: string) => `You are judging a plan in a strategy game.
PLAN: "${plan}"
Answer each question.
Return RAW JSON only:
{"landsAsCapture": "yes/no — does it take something from an enemy?",
 "landsAsTrap": "yes/no — does it spring a consequence on an enemy?",
 "isIndirect": "yes/no — is the act covert rather than forceful?",
 "quality": "one of: excellent, good, adequate, poor"}`;

/** Recorded from the same 8 plans, same model, after the rewrite. The
 *  model answers each question on its merits and the spread appears. */
const RECORDED_BOOL = [
  { landsAsCapture: "no",  landsAsTrap: "no",  isIndirect: "yes", quality: "good" },
  { landsAsCapture: "yes", landsAsTrap: "no",  isIndirect: "no",  quality: "good" },
  { landsAsCapture: "no",  landsAsTrap: "yes", isIndirect: "yes", quality: "excellent" },
  { landsAsCapture: "yes", landsAsTrap: "no",  isIndirect: "yes", quality: "adequate" },
  { landsAsCapture: "no",  landsAsTrap: "yes", isIndirect: "yes", quality: "good" },
  { landsAsCapture: "no",  landsAsTrap: "yes", isIndirect: "no",  quality: "adequate" },
  { landsAsCapture: "no",  landsAsTrap: "yes", isIndirect: "yes", quality: "poor" },  // model wanted a trap; quality vetoes it
  { landsAsCapture: "yes", landsAsTrap: "no",  isIndirect: "no",  quality: "good" },
];

// ── Lenient parsing (see demo 03 for why) ────────────────────────────────

const yn = (v: unknown, fb = false): boolean => {
  if (typeof v === "boolean") return v;
  const s = String(v ?? "").toLowerCase().trim();
  if (s.startsWith("yes/no")) return fb;        // parroted placeholder
  if (s.startsWith("y")) return true;
  if (s.startsWith("n")) return false;
  return fb;
};

const QUALITIES = ["excellent", "good", "adequate", "poor"] as const;
const quality = (v: unknown): Quality => {
  const s = String(v ?? "").toLowerCase().trim();
  return (QUALITIES.find((q) => s.startsWith(q)) ?? "adequate") as Quality;
};

// ── The derivation the SERVER owns ───────────────────────────────────────

/** Three booleans in, one category out. The model never sees this table. */
function deriveMode(c: { landsAsCapture: boolean; landsAsTrap: boolean }): RewardMode {
  if (c.landsAsCapture) return "capture";  // both true → favour the rarer mode
  if (c.landsAsTrap) return "trap";
  return "place";
}

const deriveLane = (isIndirect: boolean): LaneId => (isIndirect ? "bLayer" : "aLayer");

// ── Reporting ────────────────────────────────────────────────────────────

function spread(label: string, values: string[], universe: readonly string[]): void {
  const counts = new Map<string, number>(universe.map((u) => [u, 0]));
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  console.log(`\n  ${label}`);
  for (const [k, n] of counts) {
    const pct = Math.round((n / values.length) * 100);
    const flag = n === 0 ? "  <- never chosen" : pct === 100 ? "  <- everything" : "";
    console.log(`    ${k.padEnd(12)} ${String(n).padStart(2)}/${values.length} ${String(pct).padStart(3)}%  ${bar(n, values.length, 18)}${flag}`);
  }
}

// ── Run ──────────────────────────────────────────────────────────────────

const useEnum = { current: true };
const client = getClient((_p, call) =>
  JSON.stringify(useEnum.current
    ? RECORDED_ENUM[call % RECORDED_ENUM.length]
    : RECORDED_BOOL[call % RECORDED_BOOL.length]));

runDemo(async () => {
  header("DEMO 02 — Stop asking small models to classify", client);

  // (a) enum
  section("Asking the model to pick one of N");
  const modesA: string[] = [];
  const lanesA: string[] = [];
  for (const plan of PLANS) {
    const raw = await client.complete(ENUM_PROMPT(plan));
    try {
      const j = extractJson(raw) as { mode?: string; lane?: string };
      modesA.push(String(j.mode ?? "").toLowerCase().trim() || "(blank)");
      lanesA.push(String(j.lane ?? "").trim() || "(blank)");
    } catch { modesA.push("(unparseable)"); lanesA.push("(unparseable)"); }
  }
  spread("mode — asked as a 3-way enum", modesA, ["place", "capture", "trap"]);
  spread("lane — asked as a 2-way enum", lanesA, ["aLayer", "bLayer"]);

  // (b) booleans
  useEnum.current = false;
  section("Asking independent yes/no questions instead");
  const modesB: string[] = [];
  const lanesB: string[] = [];
  const rows: string[] = [];
  for (const plan of PLANS) {
    const raw = await client.complete(BOOL_PROMPT(plan));
    let mode: RewardMode = "place";
    let lane: LaneId = "aLayer";
    let q: Quality = "adequate";
    try {
      const j = extractJson(raw) as Record<string, unknown>;
      const c = {
        landsAsCapture: yn(j.landsAsCapture),
        landsAsTrap: yn(j.landsAsTrap),
        isIndirect: yn(j.isIndirect),
      };
      q = quality(j.quality);
      mode = deriveMode(c);
      lane = deriveLane(c.isIndirect);
    } catch { /* fall through to safe defaults */ }

    // Quality can VETO the derived mode — a poor narrative doesn't get a trap.
    const finalMode = modeForQuality(mode, q);
    modesB.push(finalMode ?? "(suppressed)");
    lanesB.push(lane);

    const seed = hashString(plan);
    const val = finalMode ? valueFromQuality(q, finalMode) : undefined;
    const init = finalMode ? initFromQuality(q, finalMode, seed) : undefined;
    rows.push(
      `    ${plan.slice(0, 44).padEnd(46)} ${String(finalMode ?? "suppressed").padEnd(11)} ` +
      `${lane.padEnd(7)} ${q.padEnd(10)} VALUE=${val ?? "-"} INIT=${init ?? "-"}`,
    );
  }
  spread("mode — derived from 3 booleans", modesB, ["place", "capture", "trap", "(suppressed)"]);
  spread("lane — derived from isIndirect", lanesB, ["aLayer", "bLayer"]);

  section("What the engine produced (model never saw a number)");
  console.log(`    ${"plan".padEnd(46)} ${"mode".padEnd(11)} ${"lane".padEnd(7)} ${"quality".padEnd(10)} stats`);
  for (const r of rows) console.log(r);

  section("The three things the server kept for itself");
  console.log(`  1. THE TAXONOMY. deriveMode() is a server table. The model`);
  console.log(`     answers "does this feel like a capture?", never "which of`);
  console.log(`     these three is it?".`);
  console.log(`  2. THE VETO. A "poor" plan cannot be a trap however the model`);
  console.log(`     felt — modeForQuality() suppresses it outright.`);
  console.log(`  3. THE NUMBERS. VALUE is a pure function of the quality word;`);
  console.log(`     INIT is a seeded roll inside the band that word earned.`);
  console.log(`     Note how little "excellent" buys over "good" — a model that`);
  console.log(`     grades everything excellent gains +1 VALUE, not a runaway.\n`);
  if (!isLive) {
    console.log(`  ^ both halves replayed from recorded 8B output. --live to try`);
    console.log(`    your model; a frontier model may not collapse the enum at all.\n`);
  }
});
