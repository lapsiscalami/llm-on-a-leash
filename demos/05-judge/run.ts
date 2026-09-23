/**
 * DEMO 05 — The thing the leash buys you: a judge.
 *
 * The first four demos are defensive — how to stop a small model wrecking
 * your game. This one is why you would bother.
 *
 * Games have always been able to adjudicate the MEASURABLE: did the unit
 * reach the tile, was the card legal, is the number bigger. Anything fuzzy
 * had to be either pre-authored (a dialogue tree someone wrote by hand) or
 * thrown away. "Was that a clever plan?" was not a question a game could
 * ask, so games stopped asking it.
 *
 * An LLM can answer it. Not precisely — fuzzily, and with real failure
 * modes shown below. But fuzzily is enough, because the ENGINE still owns
 * the consequence. The judge only supplies a grade; the engine decides
 * what a grade is worth. That is the whole trade: you get open-ended player
 * expression, and you do not have to trust the model with your rules.
 *
 * Two modes, and they fail differently:
 *
 *   ISOLATED    grade one action against a rubric.  Stable, comparable
 *               across a whole game, but drifts toward the mean.
 *   HEAD-TO-HEAD grade two actions against each other. Much sharper
 *               discrimination, but order-sensitive and non-transitive.
 */
import type { Quality } from "../../src/world.js";
import { valueFromQuality, initFromQuality, hashString } from "../../src/world.js";
import { getClient, extractJson, isLive, header, section, bar } from "../../src/llm.js";

// ── Four plans of deliberately different quality ─────────────────────────

const PLANS = [
  { id: "A", text: "Attack them." },
  { id: "B", text: "Send the militia at dawn to take the granary before the caravan arrives." },
  { id: "C", text: "Buy the blackroot harvest early, then lend it back at interest when their stores run dry." },
  { id: "D", text: "Let the rival take the granary — then leak that its grain is blighted, and buy it back cheap." },
];

// ── (a) ISOLATED: grade against a rubric ─────────────────────────────────

const ISOLATED_PROMPT = (text: string) => `You are judging one player action in a strategy game.
ACTION: "${text}"
Answer each question.
Return RAW JSON only:
{"specific": "yes/no — does it name a concrete mechanism?",
 "exploitsPosition": "yes/no — does it use something the faction actually has?",
 "surprising": "yes/no — would an opponent fail to see it coming?",
 "quality": "one of: excellent, good, adequate, poor"}`;

/** Recorded, 8B. Note the compression: three of four land on "good". */
const RECORDED_ISOLATED: Record<string, unknown> = {
  A: { specific: "no",  exploitsPosition: "no",  surprising: "no",  quality: "poor" },
  B: { specific: "yes", exploitsPosition: "yes", surprising: "no",  quality: "good" },
  C: { specific: "yes", exploitsPosition: "yes", surprising: "no",  quality: "good" },
  D: { specific: "yes", exploitsPosition: "yes", surprising: "yes", quality: "good" },
};

// ── (b) HEAD-TO-HEAD: grade two against each other ───────────────────────

const PAIR_PROMPT = (a: string, b: string) => `Two players submitted plans for the same turn.
PLAN ONE: "${a}"
PLAN TWO: "${b}"
Which plan is the stronger play, and why?
Return RAW JSON only:
{"winner": "one of: one, two, tie",
 "margin": "one of: decisive, clear, narrow",
 "because": "at most 15 words"}`;

/** Recorded, 8B, every ordered pair. The asymmetry is REAL, not staged:
 *  C-vs-D and D-vs-C disagree, which is the failure mode this demo exists
 *  to show. */
const RECORDED_PAIRS: Record<string, { winner: string; margin: string; because: string }> = {
  "A|B": { winner: "two", margin: "decisive", because: "Names a target, a time, and a reason." },
  "B|A": { winner: "one", margin: "decisive", because: "One is concrete; two is not a plan." },
  "A|C": { winner: "two", margin: "decisive", because: "Turns supply into leverage rather than noise." },
  "C|A": { winner: "one", margin: "decisive", because: "Economic play beats a bare instruction." },
  "A|D": { winner: "two", margin: "decisive", because: "Trades a loss for a cheaper win." },
  "D|A": { winner: "one", margin: "decisive", because: "One is a feint; two is nothing." },
  "B|C": { winner: "two", margin: "narrow",   because: "Seizing grain is loud; owning it is durable." },
  "C|B": { winner: "one", margin: "narrow",   because: "Leverage outlasts a single raid." },
  "B|D": { winner: "two", margin: "clear",    because: "Winning by conceding is harder to counter." },
  "D|B": { winner: "one", margin: "clear",    because: "The feint costs nothing and gains position." },
  "C|D": { winner: "two", margin: "narrow",   because: "Deception compounds the same economic edge." },
  "D|C": { winner: "two", margin: "narrow",   because: "Direct control beats a plan needing a dupe." },
};

// ── Lenient parsing ──────────────────────────────────────────────────────

const yn = (v: unknown, fb = false): boolean => {
  const s = String(v ?? "").toLowerCase().trim();
  if (typeof v === "boolean") return v;
  if (s.startsWith("yes/no")) return fb;
  if (s.startsWith("y")) return true;
  if (s.startsWith("n")) return false;
  return fb;
};
const pick = <T extends string>(v: unknown, opts: readonly T[], fb: T): T => {
  const s = String(v ?? "").toLowerCase().trim();
  return opts.find((o) => s.startsWith(o)) ?? fb;
};

// ── Run ──────────────────────────────────────────────────────────────────

let mode: "isolated" | "pair" = "isolated";
let pairKey = "";
const client = getClient((prompt) => {
  if (mode === "isolated") {
    const hit = PLANS.find((p) => prompt.includes(p.text));
    return JSON.stringify(RECORDED_ISOLATED[hit?.id ?? "A"]);
  }
  return JSON.stringify(RECORDED_PAIRS[pairKey] ?? { winner: "tie", margin: "narrow", because: "n/a" });
});

(async () => {
  header("DEMO 05 — Fuzzy judging: what the leash buys you", client);

  // ── isolated ──
  section("ISOLATED — each action graded against a rubric");
  const grades = new Map<string, Quality>();
  console.log(`    ${"plan".padEnd(58)} ${"quality".padEnd(10)} engine stats`);
  for (const p of PLANS) {
    const raw = await client.complete(ISOLATED_PROMPT(p.text));
    let q: Quality = "adequate";
    try {
      const j = extractJson(raw) as Record<string, unknown>;
      q = pick(j.quality, ["excellent", "good", "adequate", "poor"] as const, "adequate");
      void yn(j.specific); // the criteria exist to make the grade legible, not to be summed here
    } catch { /* safe default */ }
    grades.set(p.id, q);
    const val = valueFromQuality(q, "place");
    const init = initFromQuality(q, "place", hashString(p.text));
    console.log(`    ${p.id}. ${p.text.slice(0, 54).padEnd(55)} ${q.padEnd(10)} VALUE=${val} INIT=${init}`);
  }

  const distinct = new Set(grades.values()).size;
  console.log(`\n    ${distinct} distinct grade(s) across ${PLANS.length} plans.`);
  console.log(`    Isolated grading COMPRESSES: a rubric has four rungs and`);
  console.log(`    most competent play lands on the same one. That is fine for`);
  console.log(`    "did this earn a reward?" and poor for "who played better?".`);

  // ── head to head ──
  mode = "pair";
  section("HEAD-TO-HEAD — each pair graded against the other");
  const wins = new Map(PLANS.map((p) => [p.id, 0]));
  const disagreements: string[] = [];

  console.log(`    ${"matchup".padEnd(12)} ${"winner".padEnd(8)} ${"margin".padEnd(10)} because`);
  for (let i = 0; i < PLANS.length; i++) {
    for (let j = i + 1; j < PLANS.length; j++) {
      const a = PLANS[i]!, b = PLANS[j]!;

      pairKey = `${a.id}|${b.id}`;
      const fwd = extractJson(await client.complete(PAIR_PROMPT(a.text, b.text))) as Record<string, unknown>;
      const fw = pick(fwd.winner, ["one", "two", "tie"] as const, "tie");

      // Ask again with the plans SWAPPED. A judge that means it will flip
      // its answer; a judge with position bias will not.
      pairKey = `${b.id}|${a.id}`;
      const rev = extractJson(await client.complete(PAIR_PROMPT(b.text, a.text))) as Record<string, unknown>;
      const rw = pick(rev.winner, ["one", "two", "tie"] as const, "tie");

      const fwdWinner = fw === "one" ? a.id : fw === "two" ? b.id : "tie";
      const revWinner = rw === "one" ? b.id : rw === "two" ? a.id : "tie";
      const agreed = fwdWinner === revWinner;

      if (agreed && fwdWinner !== "tie") wins.set(fwdWinner, (wins.get(fwdWinner) ?? 0) + 1);
      if (!agreed) disagreements.push(`${a.id} vs ${b.id}: forward says ${fwdWinner}, reversed says ${revWinner}`);

      console.log(
        `    ${`${a.id} vs ${b.id}`.padEnd(12)} ${String(fwdWinner).padEnd(8)} ` +
        `${pick(fwd.margin, ["decisive", "clear", "narrow"] as const, "narrow").padEnd(10)} ` +
        `${String(fwd.because ?? "").slice(0, 44)}${agreed ? "" : "   <- ORDER BIAS"}`,
      );
    }
  }

  section("Ranking from head-to-head wins");
  const ranked = [...wins.entries()].sort((x, y) => y[1] - x[1]);
  const maxW = Math.max(1, ...wins.values());
  for (const [id, w] of ranked) {
    const plan = PLANS.find((p) => p.id === id)!;
    console.log(`    ${id}  ${String(w).padStart(2)} win(s)  ${bar(w, maxW, 14).padEnd(15)} ${plan.text.slice(0, 44)}`);
  }
  console.log(`\n    Isolated gave ${distinct} distinct grade(s). Head-to-head separated`);
  console.log(`    ${new Set(wins.values()).size} tier(s) from the same four plans.`);

  section("The failure mode you must design around");
  if (disagreements.length === 0) {
    console.log(`    No order bias in this run — every pair agreed when swapped.`);
  } else {
    console.log(`    ${disagreements.length} of 6 pairs FLIPPED when the plans were swapped:`);
    for (const d of disagreements) console.log(`      ${d}`);
  }
  console.log(`\n    Pairwise judging is order-sensitive and not reliably`);
  console.log(`    transitive: a model can rate C>D, D>B and B>C. Mitigations,`);
  console.log(`    cheapest first:`);
  console.log(`      1. Ask both orders and discard disagreements as ties.`);
  console.log(`         (Done above. Costs 2x calls, removes most of the bias.)`);
  console.log(`      2. Use wins as a SEED for a deterministic ranking, never`);
  console.log(`         as the ranking itself.`);
  console.log(`      3. Reserve head-to-head for the few comparisons that`);
  console.log(`         matter — an endgame award, not every card.`);

  section("Why this is safe here but not in general");
  console.log(`  The judge never touches the board. It emits a WORD; the engine`);
  console.log(`  turns that word into VALUE and INIT (see the stats column`);
  console.log(`  above), and the engine decides what those are worth.`);
  console.log(`  So the blast radius of a bad grade is "one card was slightly`);
  console.log(`  too strong", not "the game state is now wrong".`);
  console.log(`\n  That is the bargain the first four demos pay for: BECAUSE the`);
  console.log(`  model cannot touch mechanical truth, you can afford to let it`);
  console.log(`  judge something genuinely fuzzy. Unleash it on the rules and`);
  console.log(`  every one of these failure modes becomes a corruption bug`);
  console.log(`  instead of a slightly odd grade.`);
  if (!isLive) {
    console.log(`\n  ^ replayed from recorded 8B output, including a real C/D`);
    console.log(`    order disagreement. Run --live to see your model's own.\n`);
  } else {
    console.log(`
  ^ your model, this run. Head-to-head results VARY between`);
    console.log(`    passes even at fixed temperature — which pairs flip, and the`);
    console.log(`    final ranking, both move. Treat one pairwise pass as a noisy`);
    console.log(`    sample, never a verdict. That instability is the strongest`);
    console.log(`    argument for mitigation 3: spend head-to-head calls only`);
    console.log(`    where a wrong answer is cheap.
`);
  }
})();
