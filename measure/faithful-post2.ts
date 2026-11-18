/**
 * Post 2's measurements, re-run the way the game actually calls models:
 *
 *   - system + user messages, JSON mode on
 *   - temperature PER MODEL and PER PROMPT, from the game's table:
 *       gemma4:e4b  every level 1.0   (Google's recommendation)
 *       default     logic 0.1, balanced 0.6, creative 0.8
 *     Question writing and amount-picking are "creative" prompts.
 *   - the real before/after prompt text (world swapped for generic ones)
 *
 * DECK   before = the pre-deck production prompt (it never names a topic,
 *                 and its format example shows a concrete question);
 *        after  = the current production prompt, with a dealt topic.
 *        Topics are labelled afterwards by ONE fixed classifier for every
 *        run (measure/classify-topics.ts), so both arms are counted alike.
 * WORDS  a number from 0 to 1 vs. one of four words, for 20 things with an
 *        obvious level.
 *
 *   OLLAMA_MODEL=llama3.1:8b npx tsx measure/faithful-post2.ts
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { ensureModel } from "../src/ollama.js";

const BACKEND = process.env.BACKEND ?? "ollama";
const MODEL = BACKEND === "falcon" ? (process.env.FALCON_MODEL ?? "gemma4:e4b") : (process.env.OLLAMA_MODEL ?? "gemma4:e4b");
const URL = process.env.OLLAMA_URL ?? "http://127.0.0.1:11434";

// The game's per-model temperature table (convex/llmClients/ModelConfig.ts).
type Level = "logic" | "balanced" | "creative";
const TEMPS: Record<string, Record<Level, number>> = {
  "gemma4:e4b": { logic: 1.0, balanced: 1.0, creative: 1.0 },
  default: { logic: 0.1, balanced: 0.6, creative: 0.8 },
};
const temp = (level: Level) => (TEMPS[MODEL] ?? TEMPS.default!)[level];

interface Reply { raw: string; promptTokens: number; outputTokens: number; ms: number }

async function chat(system: string, user: string, level: Level): Promise<Reply> {
  const t0 = Date.now();
  if (BACKEND === "falcon") {
    const base = (process.env.FALCON_LLM_URL ?? "").replace(/\/+$/, "");
    const res = await fetch(`${base}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "CF-Access-Client-Id": process.env.CF_ACCESS_CLIENT_ID ?? "",
        "CF-Access-Client-Secret": process.env.CF_ACCESS_CLIENT_SECRET ?? "",
        "X-Adapter-Secret": process.env.ADAPTER_SHARED_SECRET ?? "",
        Authorization: `Bearer ${process.env.FALCON_API_KEY ?? ""}`,
      },
      body: JSON.stringify({
        model: MODEL, temperature: temp(level), max_tokens: 2048,
        response_format: { type: "json_object" }, keep_alive: "30m",
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
      }),
    });
    if (!res.ok) throw new Error(`falcon ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const j = (await res.json()) as { choices?: { message?: { content?: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
    return { raw: j.choices?.[0]?.message?.content ?? "", promptTokens: j.usage?.prompt_tokens ?? 0,
             outputTokens: j.usage?.completion_tokens ?? 0, ms: Date.now() - t0 };
  }
  await ensureModel(MODEL, URL);
  const res = await fetch(`${URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL, stream: false, format: "json", options: { temperature: temp(level) },
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
    }),
  });
  if (!res.ok) throw new Error(`ollama ${res.status}: ${await res.text()}`);
  const j = (await res.json()) as { message: { content: string }; prompt_eval_count?: number; eval_count?: number };
  return { raw: j.message.content, promptTokens: j.prompt_eval_count ?? 0, outputTokens: j.eval_count ?? 0, ms: Date.now() - t0 };
}

function extractJson(raw: string): Record<string, unknown> | null {
  try { return JSON.parse(raw); } catch { /* fall through */ }
  const s = raw.indexOf("{"), e = raw.lastIndexOf("}");
  if (s < 0 || e <= s) return null;
  try { return JSON.parse(raw.slice(s, e + 1)); } catch { return null; }
}

const JSON_ONLY_RULE = "Return RAW JSON only. No talk. No backticks:";
const results: Record<string, unknown> = {
  backend: BACKEND, model: MODEL, temperatures: TEMPS[MODEL] ?? TEMPS.default, jsonMode: true, date: new Date().toISOString(),
};

// ═══ DECK ═════════════════════════════════════════════════════════════════

export const TOPICS = [
  "governance", "economy", "law", "religion", "family", "labor", "class", "warfare", "travel", "ecology",
  "food", "education", "art", "communication", "medicine", "taboo", "diplomacy", "technology", "fashion", "spectacle",
] as const;

const WORLDS = [
  { genre: "post-apocalyptic survival", era: "decades after the collapse", tone: "grim", history: "Scavenger clans trade salvaged batteries along the dead highway." },
  { genre: "whaling fantasy", era: "age of sail", tone: "salt-stained and eerie", history: "The tide-wardens ring bronze bells to mark the turning of the sea." },
  { genre: "space opera", era: "the second expansion", tone: "grand and political", history: "Three orbital houses share one failing jump gate." },
];

// BEFORE: the pre-deck production prompt, verbatim (generic world values).
function beforePrompt(w: typeof WORLDS[number], answers: string[]) {
  const previousAnswersText = answers.map((a, i) => `A${i + 1}. ${a}`).join("\n");
  const example = {
    question: "How do the major factions in this world handle resource scarcity?",
    seedAnswers: [
      { title: "Trade Networks", description: "The factions have developed extensive trade networks, with specialized regions producing different resources and complex barter systems emerging." },
      { title: "Military Conquest", description: "Stronger factions raid and conquer resource-rich territories, leading to constant border conflicts and shifting alliances." },
    ],
    quip: "Remember, scarcity breeds innovation... or conflict. Choose wisely!",
  };
  const system = `You are a panel of historical experts (Marisol and Fen) creating world-building questions and example answers.

CURRENT WORLD CONTEXT:
- Genre: ${w.genre}
- Narrative Tone: ${w.tone}
- Era: ${w.era}

Your role is to:
${answers.length > 0 ? "0. Review previous answers." : ""}
1. Create thought-provoking questions about world development
2. Generate distinct and creative example answers
3. Avoid time travel references
4. Provide a quip to encourage creative thinking

${JSON_ONLY_RULE}
${JSON.stringify(example, null, 2)}`;
  const user = `Create a world-building question and example answers for this ${w.genre} world in the ${w.era} era.
Narrative tone: ${w.tone}
${previousAnswersText ? `\nPrevious answers for context:\n${previousAnswersText}\n` : ""}
Generate:
1. Generate exactly one thought-provoking question about the world’s development.
2. Generate exactly two distinct example answers. Each must be 2-3 sentences and no more than 80 words. Use different mechanisms to answer the question.
3. Generate one brief quip to encourage the player to think creatively.

The example answers should showcase different possible approaches, each being unique and well-developed.`;
  return { system, user };
}

// AFTER: the current production prompt, verbatim (generic world values).
function afterPrompt(w: typeof WORLDS[number], answers: string[], domain: string) {
  const FORMAT_EXAMPLE = `{
  "question": "A creative question about how this world",
  "seedAnswers": [
    {"title": "2-4 word title for approach A", "description": "2-3 sentence answer using a specific mechanism, referencing established world elements"},
    {"title": "2-4 word title for approach B", "description": "2-3 sentence answer using a different mechanism, also grounded in established lore"}
  ],
  "quip": "A short, witty remark to inspire creative thinking",
  "context": "One short sentence (~20 words) framing the question's situation concisely"
}`;
  const system = `You are a drama TV showrunner.

Generate one creative world-building question about ${domain} for a narrative strategy game.

Rules:
- Question must show how ${domain} works in this world.
- Two seed answers: each 2-3 sentences, under 70 words, different mechanisms.
- Seed answers MUST incorporate specific elements from the established world history below (species, locations, customs, factions). Do not introduce elements that contradict or ignore what has been established.
- One short quip. No time travel. No duplicate topics.
- One short context sentence (~20 words max) framing the question concisely.

${JSON_ONLY_RULE}
${FORMAT_EXAMPLE}`;
  const established = answers.length ? `\nEstablished world history:\n${answers.map((a, i) => `${i + 1}. ${a}`).join("\n")}\n` : "";
  const user = `Genre: ${w.genre} | Era: ${w.era} | Tone: ${w.tone}
${established}
Topic: ${domain}. Output: 1 question, 2 seed answers, 1 quip.`;
  return { system, user };
}

function lcg(seed: number) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
function hash(str: string) { let h = 5381; for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0; return Math.abs(h); }
function shuffle<T>(xs: readonly T[], seed: number): T[] {
  const a = [...xs], r = lcg(seed);
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j]!, a[i]!]; }
  return a;
}

async function testDeck() {
  const GAMES = 20, PER_GAME = 2;
  const out: ({ variant: string; game: number; q: number; dealt: string | null; question: string } & Reply)[] = [];
  for (let g = 0; g < GAMES; g++) {
    for (const variant of (g % 2 === 0 ? ["before", "after"] : ["after", "before"]) as ("before" | "after")[]) {
      const w = WORLDS[g % WORLDS.length]!;
      const deck = shuffle(TOPICS, hash(`game-${g}`));
      const answers = [w.history];
      for (let q = 0; q < PER_GAME; q++) {
        const dealt = variant === "after" ? deck[q]! : null;
        const { system, user } = variant === "before" ? beforePrompt(w, answers) : afterPrompt(w, answers, dealt!);
        const r = await chat(system, user, "creative");
        const j = extractJson(r.raw);
        const question = String(j?.question ?? "");
        const seed = (Array.isArray(j?.seedAnswers) ? (j!.seedAnswers[0] as { description?: string }) : undefined)?.description ?? "";
        out.push({ variant, game: g, q, dealt, question, ...r });
        answers.push(String(seed).slice(0, 240)); // the player "answers" with the first seed, as a real game records it
        process.stdout.write(`deck ${variant.padEnd(6)} g${g} q${q} ${dealt ? `[${dealt}] ` : ""}${question.slice(0, 70)}\n`);
      }
    }
  }
  results.deck = { rows: out, note: "topics are labelled by measure/classify-topics.ts" };
}

// ═══ WORDS ════════════════════════════════════════════════════════════════

const LEVELS = ["rare", "uncommon", "common", "everywhere"] as const;
const THINGS: { text: string; level: typeof LEVELS[number] }[] = [
  ...["a dragon in a quiet farming village", "a working time machine in a medieval town", "snow at a desert oasis",
      "a talking cat in a modern office", "a lost royal crown found at a village market"].map((text) => ({ text, level: "rare" as const })),
  ...["a doctor in a small fishing village", "a horse in a large modern city", "a thunderstorm during a dry summer",
      "a library in a mining camp", "a foreign trader in a remote mountain town"].map((text) => ({ text, level: "uncommon" as const })),
  ...["bread in a farming village", "a dog in a small town", "a sailor in a port city",
      "a candle in a medieval home", "a soldier in a frontier fort"].map((text) => ({ text, level: "common" as const })),
  ...["rain in a rainforest", "sand in a desert", "trees in a forest",
      "salt water in the ocean", "stars in a clear night sky"].map((text) => ({ text, level: "everywhere" as const })),
];

const WORDS_SYSTEM = (variant: "number" | "word") => `You are estimating how common things are in a world.
${variant === "number"
  ? "Give the amount as a number from 0 to 1, where 0 means it never happens and 1 means it is everywhere."
  : "Give the amount as one of: rare, uncommon, common, everywhere."}

${JSON_ONLY_RULE}
NOTE: Format example only — all values are descriptions, not data. Generate original content.
${JSON.stringify({ amount: variant === "number" ? "a number from 0 to 1" : "One of: rare, uncommon, common, everywhere" }, null, 2)}`;

async function testWords() {
  const out: ({ thing: string; intended: string; variant: string } & Reply)[] = [];
  for (const t of THINGS) {
    for (const variant of ["number", "word"] as const) {
      const r = await chat(WORDS_SYSTEM(variant), `How common is ${t.text}?`, "creative");
      out.push({ thing: t.text, intended: t.level, variant, ...r });
      process.stdout.write(`words ${variant.padEnd(6)} ${t.level.padEnd(10)} -> ${(extractJson(r.raw)?.amount as string) ?? r.raw.slice(0, 40)}\n`);
    }
  }
  results.words = { rows: out };
}

(async () => {
  const t0 = Date.now();
  await chat("Reply with JSON.", `{"ready": true}`, "logic"); // warm-up
  if (process.env.ONLY !== "words") await testDeck();
  if (process.env.ONLY !== "deck") await testWords();
  results.minutes = +((Date.now() - t0) / 60000).toFixed(1);
  mkdirSync("measure/results/faithful", { recursive: true });
  const safe = `${BACKEND === "falcon" ? "falcon-" : ""}${MODEL}`.replace(/[^a-z0-9.]+/gi, "-");
  const file = `measure/results/faithful/post2-${safe}.json`;
  writeFileSync(file, JSON.stringify(results, null, 2));
  console.log(`wrote ${file} (${results.minutes} min)`);
})().catch((e) => { console.error("FAILED:", e); process.exit(1); });
