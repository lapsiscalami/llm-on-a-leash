/**
 * DEMO 01 — Deal from a deck, don't ask for variety.
 *
 * Ask a model for "a fresh world-building topic" twenty times and it
 * converges on a handful of favourites. That is mode collapse, and no
 * amount of "be creative!" fixes it, because the model has no memory of
 * what it already said and no incentive to spread out.
 *
 * So don't ask. Hash the game id, Fisher-Yates a deck of 20 domains, deal
 * card n for question n. Variety is guaranteed by construction.
 */
import { DOMAINS, hashString, seededRandom } from "../../src/world.js";
import { getClient, extractJson, isLive, header, section, bar, runDemo } from "../../src/llm.js";

// ── The naive approach ───────────────────────────────────────────────────

const NAIVE_PROMPT = `You are running a world-building game. Suggest ONE fresh
topic for the next question about this world. Be creative and vary your answer.
Return RAW JSON only: {"topic": "a single lowercase word"}`;

/** Recorded from a real run: 20 calls, llama3.1:8b-class, temperature 0.7.
 *  Governance and religion eat over half the draws. This is not a strawman;
 *  it is what the model actually does. */
const RECORDED_NAIVE = [
  "governance", "religion", "governance", "warfare", "religion",
  "economy", "governance", "religion", "warfare", "governance",
  "technology", "religion", "governance", "economy", "warfare",
  "governance", "religion", "governance", "religion", "economy",
];

// ── The deck ─────────────────────────────────────────────────────────────

function shuffled(gameId: string): string[] {
  const deck = [...DOMAINS];
  const rng = seededRandom(hashString(gameId));
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [deck[i], deck[j]] = [deck[j]!, deck[i]!];
  }
  return deck;
}

/** Card n of the shuffled deck. A game cannot repeat a topic until it has
 *  dealt all twenty, and the sequence is reproducible from the id alone. */
export function assignedDomain(gameId: string, questionIndex: number): string {
  const deck = shuffled(gameId);
  return deck[questionIndex % deck.length]!;
}

// ── Reporting ────────────────────────────────────────────────────────────

function distribution(label: string, picks: string[]): void {
  const counts = new Map<string, number>();
  for (const p of picks) counts.set(p, (counts.get(p) ?? 0) + 1);
  const rows = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const max = rows[0]?.[1] ?? 1;

  console.log(`\n  ${label}`);
  console.log(`  ${picks.length} draws, ${counts.size} distinct topics ` +
              `(of ${DOMAINS.length} possible)`);
  for (const [topic, n] of rows) {
    console.log(`    ${topic.padEnd(15)} ${String(n).padStart(2)}  ${bar(n, max, 24)}`);
  }
  const top = rows.slice(0, 2).reduce((s, [, n]) => s + n, 0);
  console.log(`    → top 2 topics are ${Math.round((top / picks.length) * 100)}% of all draws`);
}

// ── Run ──────────────────────────────────────────────────────────────────

const client = getClient((_p, call) =>
  JSON.stringify({ topic: RECORDED_NAIVE[call % RECORDED_NAIVE.length] }));

runDemo(async () => {
  header("DEMO 01 — Deal from a deck, don't ask for variety", client);

  section("Asking the model for variety (20 calls)");
  const naive: string[] = [];
  for (let i = 0; i < 20; i++) {
    const raw = await client.complete(NAIVE_PROMPT);
    try {
      const { topic } = extractJson(raw) as { topic: string };
      naive.push(String(topic).toLowerCase().trim());
    } catch {
      naive.push("(unparseable)");
    }
  }
  distribution("NAIVE — model picks the topic", naive);
  if (!isLive) {
    console.log(`
  ^ replayed from a recorded llama3.1:8b run. Pass --live to`);
    console.log(`    watch your own model do it — and expect DIFFERENT numbers.`);
  } else {
    console.log(`
  ^ your model's own collapse. The SHAPE matters more than the`);
    console.log(`    number: models collapse toward different attractors.`);
    console.log(`    llama3.1:8b favoured concrete domains (governance, religion);`);
    console.log(`    gemma4:e2b favoured abstract nouns (resonance, silence).`);
    console.log(`    Neither spreads across a 20-topic space on its own.`);
  }

  section("Dealing from a shuffled deck (no LLM involved)");
  const dealt = Array.from({ length: 20 }, (_, i) => assignedDomain("game_7fka2", i));
  distribution("DECK — server deals the topic", dealt);

  section("The deck is reproducible, and per-game");
  for (const id of ["game_7fka2", "game_q91xz", "game_m4top"]) {
    console.log(`  ${id}  →  ${Array.from({ length: 5 }, (_, i) => assignedDomain(id, i)).join(", ")}, …`);
  }
  const twice = assignedDomain("game_7fka2", 3) === assignedDomain("game_7fka2", 3);
  console.log(`\n  same (game, index) twice → same domain: ${twice ? "yes" : "NO — bug"}`);

  section("Why this matters beyond variety");
  console.log(`  · A game never repeats a topic until all 20 are dealt.`);
  console.log(`  · The whole question sequence is recoverable from the game id,`);
  console.log(`    so a replay or a bug report reproduces exactly.`);
  console.log(`  · Zero tokens spent deciding what to talk about.`);
  console.log(`  · The model still writes the QUESTION — it just doesn't get to`);
  console.log(`    choose the subject. That is the whole pattern in one line.\n`);
});
