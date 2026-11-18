/**
 * The cross-model report for the faithful runs (measure/results/faithful/).
 * Every number is computed from saved replies — nothing typed in by hand.
 *
 *   npx tsx measure/faithful-report.ts
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";

const DIR = "measure/results/faithful";
const load = (f: string) => JSON.parse(readFileSync(`${DIR}/${f}`, "utf8"));
const files = readdirSync(DIR).filter((f) => f.endsWith(".json"));
// Every model with results in the folder, so a reader's own run appears too.
const KNOWN: Record<string, string> = {
  "gemma4-e4b": "gemma4:e4b (T=1.0 everywhere)",
  "gemma4-e2b-it-q4-K-M": "gemma4:e2b (T=0.1 / 0.8)",
  "llama3.1-8b": "llama3.1:8b (T=0.1 / 0.8)",
};
const MODELS = [...new Set(files.map((f) => f.replace(/\.json$/, "").replace(/^(post2|chain|parrot)-/, "")))]
  .sort((a, b) => (a in KNOWN ? 0 : 1) - (b in KNOWN ? 0 : 1) || a.localeCompare(b))
  .map((key) => ({ key, label: KNOWN[key] ?? key }));
// Test B (parroting) can be re-run on its own (`--parrot`), which writes
// parrot-<model>.json. That file wins over the parrot section of the
// combined <model>.json, so a re-measured countercheck replaces the old
// numbers wholesale.
const parrotFile = (key: string): string | null =>
  files.includes(`parrot-${key}.json`) ? `parrot-${key}.json` : files.includes(`${key}.json`) ? `${key}.json` : null;
const TOPICS = 20, GAMES = 20, QUESTIONS = 40;
const RANDOM_DISTINCT = +(TOPICS * (1 - (1 - 1 / TOPICS) ** QUESTIONS)).toFixed(1);

function extractJson(raw: string): Record<string, unknown> | null {
  try { return JSON.parse(raw); } catch { /* fall through */ }
  const s = raw.indexOf("{"), e = raw.lastIndexOf("}");
  if (s < 0 || e <= s) return null;
  try { return JSON.parse(raw.slice(s, e + 1)); } catch { return null; }
}
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2; };
const h = (t: string) => console.log(`\n${"═".repeat(72)}\n  ${t}\n${"═".repeat(72)}`);

// ─── Luck probabilities ───────────────────────────────────────────────────
// p = the chance of a gap at least this big, in this direction, if the change
// did nothing (one-sided). Exact where the counts allow it; the deck's topic
// count uses a shuffle test with a fixed seed so every run prints the same p.
const choose = (n: number, k: number) => { let r = 1; for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i; return r; };
/** Separate samples (Fisher's exact): chance arm x gets `x` or more of the pooled hits. */
const fisher = (x: number, nx: number, y: number, ny: number) => { const k = x + y; let p = 0; for (let i = x; i <= Math.min(k, nx); i++) p += (choose(nx, i) * choose(ny, k - i)) / choose(nx + ny, k); return p; };
/** Same items both ways (exact sign test on the items that changed): chance `up` or more of them moved up. */
const signTest = (up: number, down: number) => { let p = 0; for (let i = up; i <= up + down; i++) p += choose(up + down, i) / 2 ** (up + down); return p; };
function shuffleTest<T>(before: T[], after: T[], stat: (xs: T[]) => number, runs = 10_000): number {
  let s = 20260924; const rand = () => (s = (s * 48271) % 2147483647) / 2147483647;
  const pool = [...before, ...after], gap = stat(after) - stat(before);
  let hits = 0;
  for (let r = 0; r < runs; r++) {
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [pool[i], pool[j]] = [pool[j]!, pool[i]!]; }
    if (stat(pool.slice(before.length)) - stat(pool.slice(0, before.length)) >= gap) hits++;
  }
  return (hits + 1) / (runs + 1);
}
const fmtP = (p: number) => (p < 0.001 ? "<0.001" : p.toFixed(3));
// Sections are numbered to match the entries in PATTERNS.md (there is no
// entry 7 here: that one is measured in NextOath, not reproduced).
console.log("p = chance of a gap at least this big if the change did nothing (one-sided)");

// ─── 1. Deck ──────────────────────────────────────────────────────────────
h(`1. DECK — topics across ${QUESTIONS} questions (target ~${RANDOM_DISTINCT} of ${TOPICS}); games repeating a topic (target ~1 of ${GAMES})`);
console.log(`${"model".padEnd(34)} ${"topics b→a (p)".padEnd(20)} ${"repeat games b→a (p)".padEnd(22)} ${"stayed on dealt".padEnd(16)} prompt tok / reply tok / time (median, b→a)`);
for (const m of MODELS) {
  const f = `post2-${m.key}.json`; if (!files.includes(f)) continue;
  const rows = load(f).deck.rows as { variant: string; game: number; q: number; dealt: string | null; topic: string | null; promptTokens: number; outputTokens: number; ms: number }[];
  const stat = (v: string) => {
    const r = rows.filter((x) => x.variant === v);
    const distinct = new Set(r.map((x) => x.topic).filter(Boolean)).size;
    let rep = 0;
    for (let g = 0; g < GAMES; g++) { const t = r.filter((x) => x.game === g).map((x) => x.topic); if (t[0] && t[0] === t[1]) rep++; }
    return { distinct, rep, pt: median(r.map((x) => x.promptTokens)), ot: median(r.map((x) => x.outputTokens)), ms: median(r.map((x) => x.ms)), r };
  };
  const b = stat("before"), a = stat("after");
  const stayed = a.r.filter((x) => x.topic === x.dealt).length;
  const distinct = (xs: (string | null)[]) => new Set(xs.filter(Boolean)).size;
  const pTopics = shuffleTest(b.r.map((x) => x.topic), a.r.map((x) => x.topic), distinct);
  const pRep = fisher(b.rep, GAMES, a.rep, GAMES); // fewer repeats after = more of them landed before
  console.log(`${m.label.padEnd(34)} ${`${b.distinct} → ${a.distinct} (${fmtP(pTopics)})`.padEnd(20)} ${`${b.rep} → ${a.rep} (${fmtP(pRep)})`.padEnd(22)} ${`${stayed}/${a.r.length}`.padEnd(16)} ${b.pt}→${a.pt} / ${b.ot}→${a.ot} / ${(b.ms / 1000).toFixed(1)}s→${(a.ms / 1000).toFixed(1)}s`);
}

// ─── 2. Parroting ────────────────────────────────────────────────────────
h("2. PARROTING — average criteria passed of 5, and share scoring >=4, before → after (before = example shows false)");
console.log(`${"model".padEnd(34)} ${"strong (target 5, 10/10)".padEnd(28)} ${"borderline (below strong)".padEnd(28)} ${"weak (target ~1, 0/10 at 4+)".padEnd(30)} junk`);
for (const m of MODELS) {
  const f = parrotFile(m.key); if (!f) continue;
  const d = load(f), s = d.parrot.summary;
  const cell = (v: Record<string, unknown>, k: string) => v[`${k}AvgPassed`] === undefined ? "-" : `${v[`${k}AvgPassed`]} (${v[`${k}ScoredAtLeast4`]})`;
  const ba = (k: string) => `${cell(s.before, k)} → ${cell(s.after, k)}`;
  console.log(`${m.label.padEnd(34)} ${ba("strong").padEnd(28)} ${ba("borderline").padEnd(28)} ${ba("weak").padEnd(30)} ${s.before.junkAvgPassed}→${s.after.junkAvgPassed}`);
  if (f.startsWith("parrot-")) console.log(`${"".padEnd(34)} (from ${f}, ${String(d.date).slice(0, 10)}; the older combined run's parrot section is superseded)`);
  // Which criteria the strong answers failed, before → after. This is where
  // the parroted "false" shows up: the subjective ones get marked down.
  const CRITERIA = ["ontopic", "specific", "imaginative", "grounded", "memorable"];
  const rows = d.parrot.rows as { answer: string; strong: boolean; variant: string; passed: number; criteria: Record<string, boolean> }[];
  const failed = (v: string, k: string) => rows.filter((r) => r.strong && r.variant === v && r.criteria?.[k] !== true).length;
  const parts = CRITERIA.map((k) => [k, failed("before", k), failed("after", k)] as const).filter(([, b, a]) => b + a > 0).map(([k, b, a]) => `${k} ${b}→${a}`);
  console.log(`${"".padEnd(34)} strong answers marked down per criterion b→a: ${parts.join(", ") || "none"}`);
  // The same strong answers were judged both ways, so pair them by answer.
  const passed = (v: string) => new Map(rows.filter((r) => r.strong && r.variant === v).map((r) => [r.answer, r.passed]));
  const sb = passed("before"), sa = passed("after");
  const diffs = [...sa].map(([k, p]) => p - (sb.get(k) ?? p));
  const up = diffs.filter((d) => d > 0).length, down = diffs.filter((d) => d < 0).length, net = diffs.reduce((a, b) => a + b, 0);
  console.log(`${"".padEnd(34)} strong answers, criteria passed of 5, paired: ${up} rose, ${down} fell, net ${net >= 0 ? "+" : ""}${net} (p ${fmtP(signTest(up, down))})`);
}
// ─── 3. Words ─────────────────────────────────────────────────────────────
h("3. WORDS vs NUMBERS — things placed at the right level (target 20/20, 5 per level)");
const LEVELS = ["rare", "uncommon", "common", "everywhere"];
const levelOf = (n: number) => (n < 0.25 ? "rare" : n < 0.5 ? "uncommon" : n < 0.75 ? "common" : "everywhere");
for (const m of MODELS) {
  const f = `post2-${m.key}.json`; if (!files.includes(f)) continue;
  const rows = load(f).words.rows as { intended: string; variant: string; raw: string }[];
  const read = (r: (typeof rows)[number]) => {
    const v = extractJson(r.raw)?.amount;
    if (r.variant === "number") { const n = typeof v === "number" ? v : parseFloat(String(v)); return Number.isFinite(n) && n >= 0 && n <= 1 ? levelOf(n) : null; }
    const w = String(v ?? "").trim().toLowerCase().match(/^[a-z]+/)?.[0]; return w && LEVELS.includes(w) ? w : null;
  };
  const line = (v: string) => {
    const r = rows.filter((x) => x.variant === v);
    const by = Object.fromEntries(LEVELS.map((l) => [l, r.filter((x) => read(x) === l).length]));
    return `${r.filter((x) => read(x) === x.intended).length}/20  [${LEVELS.map((l) => by[l]).join(" / ")}]`;
  };
  const right = (v: string) => rows.filter((x) => x.variant === v && read(x) === x.intended).length;
  console.log(`${m.label.padEnd(34)} numbers ${line("number").padEnd(24)} words ${line("word")}  (p ${fmtP(fisher(right("word"), 20, right("number"), 20))})`);
}
console.log(`${"".padEnd(34)} (bracket = answers per level: rare / uncommon / common / everywhere)`);

// ─── 4. Forgiving parser ──────────────────────────────────────────────────
h("4. FORGIVING PARSER — answers a strict check keeps vs a forgiving one (words, pick-one, yes/no)");
console.log("   (the \"numbers\" arm of test 3 is left out: the game never asks for a number)");
for (const m of MODELS) {
  let n = 0, strict = 0, forgiving = 0; const thrown = new Map<string, number>();
  const note = (s: boolean, f: boolean, sample: unknown) => { n++; if (s) strict++; if (f) forgiving++; if (!s && f) { const k = JSON.stringify(sample).slice(0, 24); thrown.set(k, (thrown.get(k) ?? 0) + 1); } };
  const firstWord = (v: unknown) => String(v ?? "").trim().toLowerCase().match(/^[a-z]+/)?.[0];
  const p2 = `post2-${m.key}.json`;
  if (files.includes(p2)) for (const r of load(p2).words.rows as { variant: string; raw: string }[]) {
    if (r.variant === "number") continue;
    const v = extractJson(r.raw)?.amount;
    note(typeof v === "string" && LEVELS.includes(v), LEVELS.includes(firstWord(v) ?? ""), v);
  }
  const jf = `${m.key}.json`;
  if (files.includes(jf)) {
    const d = load(jf);
    for (const r of d.collapse.rows as { variant: string; raw: string }[]) {
      const card = (() => { const j = extractJson(r.raw); return Array.isArray(j?.rewards) ? (j!.rewards[0] as Record<string, unknown>) : null; })();
      if (r.variant === "before") { const v = card?.mode; note(typeof v === "string" && ["place", "capture", "trap"].includes(v), ["place", "capture", "trap"].includes(firstWord(v) ?? ""), v); }
      else for (const k of ["landsAsCapture", "landsAsTrap"]) { const v = card?.[k]; note(v === "yes" || v === "no", ["yes", "no", "true", "false"].includes(firstWord(v) ?? "") || typeof v === "boolean", v); }
    }
    // The parrot replies of the same (original) run, so this line is one run.
    for (const r of d.parrot.rows as { raw: string }[]) {
      const j = extractJson(r.raw);
      for (const k of ["ontopic", "specific", "imaginative", "grounded", "memorable"]) {
        const v = j?.[k]; note(v === "yes" || v === "no" || typeof v === "boolean", ["yes", "no", "true", "false"].includes(firstWord(v) ?? "") || typeof v === "boolean", v);
      }
    }
  }
  const top = [...thrown].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, c]) => `${k} x${c}`).join(", ");
  console.log(`${m.label.padEnd(34)} strict ${strict}/${n}  forgiving ${forgiving}/${n}   rescued: ${top || "none"}`);
  // A later stand-alone parrot run (the countercheck) is a separate run, so
  // it gets its own line rather than being pooled with the one above.
  if (files.includes(`parrot-${m.key}.json`)) {
    let n2 = 0, strict2 = 0, forgiving2 = 0; const thrown2 = new Map<string, number>();
    for (const r of load(`parrot-${m.key}.json`).parrot.rows as { raw: string }[]) {
      const j = extractJson(r.raw);
      for (const k of ["ontopic", "specific", "imaginative", "grounded", "memorable"]) {
        const v = j?.[k]; const s = v === "yes" || v === "no" || typeof v === "boolean"; const f = ["yes", "no", "true", "false"].includes(firstWord(v) ?? "") || typeof v === "boolean";
        n2++; if (s) strict2++; if (f) forgiving2++; if (!s && f) { const kk = JSON.stringify(v).slice(0, 24); thrown2.set(kk, (thrown2.get(kk) ?? 0) + 1); }
      }
    }
    const top2 = [...thrown2].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, c]) => `${k} x${c}`).join(", ");
    console.log(`${"  countercheck run, yes/no only".padEnd(34)} strict ${strict2}/${n2}  forgiving ${forgiving2}/${n2}   rescued: ${top2 || "none"}`);
  }
}

// ─── 5. Chain ────────────────────────────────────────────────────────────
h("5. CHAIN — pre-fix validator's guess fed into the pre-fix judge");
for (const m of MODELS) {
  const f = `chain-${m.key}.json`; if (!files.includes(f)) continue;
  const d = load(f), s = d.chain.summary;
  const rows = d.chain.rows as { plan: string; intended: string; validatorGuess: string; judgeRead: string }[];
  const wrong = rows.filter((r) => r.validatorGuess !== r.intended);
  const followedWrong = wrong.filter((r) => r.judgeRead === r.validatorGuess).length;
  const fixedWrong = wrong.filter((r) => r.judgeRead === r.intended).length;
  const without = files.includes(`${m.key}.json`) ? load(`${m.key}.json`).collapse.summary.before : null;
  console.log(`${m.label.padEnd(34)} judge alone ${without ? `${without.correct} (capture ${without.caught.capture})` : "-"}   with guess ${s.judgeWithHint.correct} (capture ${s.judgeWithHint.caught.capture})   followed guess ${s.judgeAgreedWithHint}   when the guess was wrong: followed ${followedWrong} of ${wrong.length}, fixed ${fixedWrong}`);
  // Did showing the guess pull the judge toward it? Same 30 plans judged with
  // and without the guess, so pair them: on how many did the judge move to
  // agree with the validator, and on how many did it move away. The wrong-
  // guess plans alone can't answer this: they're the ambiguous ones both
  // prompts tend to misread the same way.
  if (files.includes(`${m.key}.json`)) {
    const alone = new Map((load(`${m.key}.json`).collapse.rows as { plan: string; variant: string; read: string }[]).filter((r) => r.variant === "before").map((r) => [r.plan, r.read]));
    const agreeAlone = rows.filter((r) => alone.get(r.plan) === r.validatorGuess).length;
    const toward = rows.filter((r) => r.judgeRead === r.validatorGuess && alone.get(r.plan) !== r.validatorGuess).length;
    const away = rows.filter((r) => r.judgeRead !== r.validatorGuess && alone.get(r.plan) === r.validatorGuess).length;
    console.log(`${"".padEnd(34)} all ${rows.length} plans: judge agreed with the validator ${agreeAlone}/${rows.length} alone, ${s.judgeAgreedWithHint} shown the guess; moved toward it ${toward}, away ${away} (p ${fmtP(signTest(toward, away))})`);
  }
}

// ─── 6. Temperature (e4b 0.1 vs 1.0) ──────────────────────────────────────
// The T=0.1 run is the same script, same call path, one number changed:
//   TEMPERATURE=0.1 npx tsx measure/faithful.ts
const cold = `${DIR}/temperature/gemma4-e4b-t0.1.json`;
if (existsSync(cold) && files.includes("gemma4-e4b.json")) {
  h("6. TEMPERATURE — gemma4:e4b, same tests, 0.1 vs the 1.0 Google recommends");
  const a = JSON.parse(readFileSync(cold, "utf8")).collapse.summary, b = load("gemma4-e4b.json").collapse.summary;
  console.log(`before-fix judge:  T=0.1 ${a.before.correct} (capture ${a.before.caught.capture})   T=1.0 ${b.before.correct} (capture ${b.before.caught.capture})`);
  console.log(`after-fix judge:   T=0.1 ${a.after.correct} (capture ${a.after.caught.capture}, trap ${a.after.caught.trap})   T=1.0 ${b.after.correct} (capture ${b.after.caught.capture}, trap ${b.after.caught.trap})`);
} else if (files.includes("gemma4-e4b.json")) {
  h("6. TEMPERATURE — not run yet");
  console.log(`  TEMPERATURE=0.1 npx tsx measure/faithful.ts   # writes ${cold}`);
}
// ─── 8. Collapse (PATTERNS entry 8: the pattern that didn't hold) ───────
h("8. COLLAPSE — kinds caught out of 10 each (before = pick-one enum, after = yes/no)");
for (const m of MODELS) {
  const f = `${m.key}.json`; if (!files.includes(f)) continue;
  const s = load(f).collapse.summary;
  const fmt = (x: { correct: string; caught: Record<string, string> }) => `${x.correct} (place ${x.caught.place}, capture ${x.caught.capture}, trap ${x.caught.trap})`;
  console.log(`${m.label.padEnd(34)} before ${fmt(s.before).padEnd(42)} after ${fmt(s.after)}`);
}
console.log("");
