/**
 * DEMO — The thing the leash buys you: a judge.
 *
 * The other demos are defensive — how to stop a small model wrecking
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
 *
 * A THIRD MODE, which is the one actually shipping in NextOath and is
 * worth separating from head-to-head because it is much safer:
 *
 *   COMPARATIVE NARRATION — the model receives EVERY player's action for
 *   the round in one call, already resolved by the engine (outcome +
 *   magnitude word per card), and explains what happened between them.
 *   It reasons across all players' choices at once, but downstream of the
 *   verdict. Its prompt opens: "The outcome of every action this round is
 *   ALREADY DECIDED - you only narrate it."
 *
 * The difference is not how much the model sees. It is whether its answer
 * DECIDES anything:
 *
 *   judge-in-isolation      model grades one action      -> engine converts
 *   comparative narration   model sees all, decides none -> SHIPPING
 *   head-to-head            model's answer IS the result -> this demo
 *
 * The failure modes below (order bias, non-transitivity) are exactly why
 * the third row ships and the fourth does not.
 */
import type { Quality } from "../../src/world.js";
import { valueFromQuality, initFromQuality, hashString } from "../../src/world.js";
import { getClient, extractJson, isLive, header, section, bar, runDemo } from "../../src/llm.js";

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

// ── (b) HEAD-TO-HEAD: grade two against each other ───────────────────────

const PAIR_PROMPT = (a: string, b: string) => `Two players submitted plans for the same turn.
PLAN ONE: "${a}"
PLAN TWO: "${b}"
Which plan is the stronger play, and why?
Return RAW JSON only:
{"winner": "one of: one, two, tie",
 "margin": "one of: decisive, clear, narrow",
 "because": "at most 15 words"}`;


// ── Lenient parsing ──────────────────────────────────────────────────────

const yn = (v: unknown, fb = false): boolean => {
  const s = String(v ?? "").toLowerCase().trim();
  if (typeof v === "boolean") return v;
  if (s.startsWith("yes/no")) return fb;
  if (s.startsWith("y")) return true;
  if (s.startsWith("n")) return false;
  return fb;
};
// Whole first word, not "starts with": "good (solid)" -> good, "goodness" -> fallback.
const pick = <T extends string>(v: unknown, opts: readonly T[], fb: T): T => {
  const w = String(v ?? "").toLowerCase().trim().match(/^[a-z]+/)?.[0];
  return opts.find((o) => o === w) ?? fb;
};

// ── Run ──────────────────────────────────────────────────────────────────

const client = getClient("judge");
// Both prompts here are judging prompts, so they run cool (pattern 6).
const JUDGE = { temperature: 0.1 };

runDemo(async () => {
  header("DEMO — Fuzzy judging: what the leash buys you", client);

  // ── isolated ──
  section("ISOLATED — each action graded against a rubric");
  const grades = new Map<string, Quality>();
  console.log(`    ${"plan".padEnd(58)} ${"quality".padEnd(10)} engine stats`);
  for (const p of PLANS) {
    const raw = await client.complete(ISOLATED_PROMPT(p.text), JUDGE);
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
  const byGrade = new Map<string, string[]>();
  for (const [id, q] of grades) byGrade.set(q, [...(byGrade.get(q) ?? []), id]);
  const ties = [...byGrade].filter(([, ids]) => ids.length > 1);
  if (ties.length > 0) {
    for (const [q, ids] of ties) console.log(`    Plans ${ids.join(" and ")} both got "${q}", so the grade alone can't rank them.`);
    console.log(`    A four-word scale is fine for "did this earn a reward?" and`);
    console.log(`    weak for "who played better?".`);
  } else {
    console.log(`    Every plan got its own grade this run.`);
  }

  // ── head to head ──
  section("HEAD-TO-HEAD — each pair graded against the other");
  const wins = new Map(PLANS.map((p) => [p.id, 0]));
  const disagreements: string[] = [];
  let pickedSecondBothTimes = 0;

  console.log(`    ${"matchup".padEnd(12)} ${"winner".padEnd(8)} ${"margin".padEnd(10)} because`);
  for (let i = 0; i < PLANS.length; i++) {
    for (let j = i + 1; j < PLANS.length; j++) {
      const a = PLANS[i]!, b = PLANS[j]!;
      const fwd = extractJson(await client.complete(PAIR_PROMPT(a.text, b.text), JUDGE)) as Record<string, unknown>;
      const fw = pick(fwd.winner, ["one", "two", "tie"] as const, "tie");

      // Ask again with the plans SWAPPED. A judge that means it will flip
      // its answer; a judge with position bias will not.
      const rev = extractJson(await client.complete(PAIR_PROMPT(b.text, a.text), JUDGE)) as Record<string, unknown>;
      const rw = pick(rev.winner, ["one", "two", "tie"] as const, "tie");

      const fwdWinner = fw === "one" ? a.id : fw === "two" ? b.id : "tie";
      const revWinner = rw === "one" ? b.id : rw === "two" ? a.id : "tie";
      const agreed = fwdWinner === revWinner;

      if (agreed && fwdWinner !== "tie") wins.set(fwdWinner, (wins.get(fwdWinner) ?? 0) + 1);
      if (!agreed) disagreements.push(`${a.id} vs ${b.id}: forward says ${fwdWinner}, reversed says ${revWinner}`);
      if (fw === "two" && rw === "two") pickedSecondBothTimes++;

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
    if (pickedSecondBothTimes > 0) {
      console.log(`    In ${pickedSecondBothTimes} of those, the model simply picked whichever plan it`);
      console.log(`    read SECOND — both times. That's position, not judgment.`);
    }
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

  section("The third mode — comparative NARRATION (what actually ships)");
  console.log(`    The engine resolves every card first: who moved first, who`);
  console.log(`    collided, whose trap caught whom. THEN one call hands the`);
  console.log(`    model all of it at once:`);
  console.log(``);
  for (const p of PLANS) {
    const q = grades.get(p.id)!;
    const outcome = q === "poor" ? "failed" : "succeeded";
    const scale = q === "poor" ? "none" : q === "good" ? "solid" : "minor";
    console.log(`      { player: "${p.id}", outcome: "${outcome}", scale: "${scale}" }`);
  }
  console.log(``);
  console.log(`    The model sees all four players' actions and writes what`);
  console.log(`    happened BETWEEN them — who blocked whom, whose trap caught`);
  console.log(`    whose push. It reasons comparatively across everyone.`);
  console.log(`    It just does not get to decide any of it. The real prompt`);
  console.log(`    opens: "The outcome of every action this round is ALREADY`);
  console.log(`    DECIDED — you only narrate it."`);
  console.log(``);
  console.log(`    This is the mode to reach for first. It buys you the thing`);
  console.log(`    people actually want from an LLM in a game — a world that`);
  console.log(`    reacts to everyone's choices together — at none of the risk`);
  console.log(`    head-to-head carries, because a wrong answer is a clumsy`);
  console.log(`    sentence rather than a wrong winner.`);

  section("Why this is safe here but not in general");
  console.log(`  The judge never touches the board. It emits a WORD; the engine`);
  console.log(`  turns that word into VALUE and INIT (see the stats column`);
  console.log(`  above), and the engine decides what those are worth.`);
  console.log(`  So the blast radius of a bad grade is "one card was slightly`);
  console.log(`  too strong", not "the game state is now wrong".`);
  console.log(`\n  That is the bargain the leash pays for: BECAUSE the`);
  console.log(`  model cannot touch mechanical truth, you can afford to let it`);
  console.log(`  judge something genuinely fuzzy. Unleash it on the rules and`);
  console.log(`  every one of these failure modes becomes a corruption bug`);
  console.log(`  instead of a slightly odd grade.`);
  console.log(`\n  ^ ${isLive ? "your model, this run" : "real replies, replayed"}. Head-to-head results`);
  console.log(`    VARY between passes even at a fixed temperature: which pairs flip,`);
  console.log(`    and the final ranking, both move. Treat one pairwise pass as a noisy`);
  console.log(`    sample, never a verdict.\n`);
});
