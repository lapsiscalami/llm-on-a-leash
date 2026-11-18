/**
 * A FAITHFUL re-creation of two of the game's prompt fixes, built the way
 * the game builds its prompts:
 *
 *   - system + user messages (Ollama /api/chat), not one blob
 *   - JSON mode on (Ollama format "json" = the json_object mode the
 *     game's small-model client uses)
 *   - the game's temperature for this model at the "logic" level
 *     (per-model: 0.1 for most small models, 1.0 for gemma4:e4b)
 *   - the game's prompt TEXT, word for word, with the game world
 *     swapped for a generic one so a reader needs no context
 *
 * Test A — COLLAPSE. The pre-fix judge asked for `mode` as a "One of:"
 * field among a heavy prompt (world, factions, anchors, board, problem,
 * three other "One of:" fields, a quality table, a rewards array, anchor
 * updates). In a live game it produced 0 captures in 7 cards. The fix
 * changed exactly two things: the example line and the rules line, to two
 * yes/no questions. Everything else is identical here too.
 *
 * Test B — PARROTING. The pre-fix referee showed all five criteria as
 * `false` in the example and said "check true or false". The fix put
 * "yes/no — hint" in every slot and said answer "yes" or "no".
 *
 * Success measures (fixed before running):
 *   A: captures caught out of 10 (the historical failure), and overall
 *      correct out of 30.
 *   B: on 10 strong answers that clearly pass all five criteria, the
 *      average number of criteria passed (target 5) — parroting "false"
 *      drags it down. The countercheck: 10 weak answers (on topic, nothing
 *      else) and 10 borderline ones (specific and grounded, not imaginative)
 *      must NOT be waved through — target 0 of 10 weak answers scoring 4+,
 *      and borderline below strong. 5 junk answers are a sanity check
 *      (target 0).
 *
 *   npx tsx measure/faithful.ts                        # gemma4:e4b, pulled if missing
 *   OLLAMA_MODEL=llama3.1:8b npx tsx measure/faithful.ts
 *   npx tsx measure/faithful.ts --chain                # test C (chain), to chain-<model>.json
 *   npx tsx measure/faithful.ts --parrot               # test B alone, to parrot-<model>.json
 *   TEMPERATURE=0.1 npx tsx measure/faithful.ts
 *       the temperature check: same call path, one number changed. It writes
 *       to measure/results/faithful/temperature/ so the report's per-model
 *       tables don't pick it up as a fourth model.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { ensureModel } from "../src/ollama.js";

const MODEL = process.env.OLLAMA_MODEL ?? "gemma4:e4b";
const URL = process.env.OLLAMA_URL ?? "http://127.0.0.1:11434";
// BACKEND=falcon sends the same prompts to an OpenAI-compatible endpoint
// instead of Ollama (plain JSON mode, no extra suffix line). It is how the
// saved gemma4:e4b runs were made, on a hosted copy of the same model; the
// file's `backend` field records that. Readers use Ollama. Needs
// FALCON_LLM_URL, CF_ACCESS_CLIENT_ID/SECRET, ADAPTER_SHARED_SECRET,
// FALCON_API_KEY.
const BACKEND = process.env.BACKEND ?? "ollama";
const FALCON_MODEL = process.env.FALCON_MODEL ?? "gemma4:e4b";

// All three tests here are "logic" prompts. The game maps that PER MODEL
// (convex/llmClients/ModelConfig.ts): gemma4:e4b runs every level at 1.0
// (Google's recommendation); unlisted models use the default, logic = 0.1.
// TEMPERATURE=<n> overrides it for the temperature check (results go to a
// separate folder, see the header).
const EFFECTIVE_MODEL = BACKEND === "falcon" ? FALCON_MODEL : MODEL;
const TEMPERATURE_OVERRIDE = process.env.TEMPERATURE ? parseFloat(process.env.TEMPERATURE) : undefined;
if (TEMPERATURE_OVERRIDE !== undefined && !Number.isFinite(TEMPERATURE_OVERRIDE)) throw new Error(`TEMPERATURE must be a number, got "${process.env.TEMPERATURE}"`);
const TEMPERATURE = TEMPERATURE_OVERRIDE ?? (EFFECTIVE_MODEL === "gemma4:e4b" ? 1.0 : 0.1);

async function chatFalcon(system: string, user: string): Promise<string> {
  const base = (process.env.FALCON_LLM_URL ?? "").replace(/\/+$/, "");
  if (!base) throw new Error("FALCON_LLM_URL not set");
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
      model: FALCON_MODEL,
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
      temperature: TEMPERATURE,
      max_tokens: 4096,
      response_format: { type: "json_object" },
      keep_alive: "30m",
    }),
  });
  if (!res.ok) throw new Error(`falcon ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return j.choices?.[0]?.message?.content ?? "";
}

async function chat(system: string, user: string): Promise<string> {
  if (BACKEND === "falcon") return chatFalcon(system, user);
  await ensureModel(MODEL, URL); // pulls it if missing
  const res = await fetch(`${URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL, stream: false, format: "json",
      options: { temperature: TEMPERATURE },
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
    }),
  });
  if (!res.ok) throw new Error(`ollama ${res.status}: ${await res.text()}`);
  return ((await res.json()) as { message: { content: string } }).message.content;
}

function extractJson(raw: string): Record<string, unknown> | null {
  try { return JSON.parse(raw); } catch { /* fall through */ }
  const start = raw.indexOf("{"); const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(raw.slice(start, end + 1)); } catch { return null; }
}

// Production-equivalent readers: llmEnum (prefix match) and llmBoolean
// (yes/no/true/false, with the parroted "yes/no" guard).
const llmEnum = <T extends string>(v: unknown, opts: readonly T[], fb: T): T => {
  const s = String(v ?? "").toLowerCase().trim();
  return (opts.find((o) => s === o) ?? opts.find((o) => s.startsWith(o)) ?? fb);
};
const llmBoolean = (v: unknown, fb: boolean): boolean => {
  if (typeof v === "boolean") return v;
  const s = String(v ?? "").toLowerCase().trim();
  if (s.startsWith("yes/no") || s.startsWith("yes or no")) return fb;
  if (s.startsWith("y")) return true;
  if (s.startsWith("n")) return false;
  if (s === "true") return true;
  if (s === "false") return false;
  return fb;
};

const results: Record<string, unknown> = {
  model: EFFECTIVE_MODEL, backend: BACKEND,
  temperature: TEMPERATURE, jsonMode: true, date: new Date().toISOString(),
};

// ═══ Test A: collapse ═════════════════════════════════════════════════════

const JSON_ONLY_RULE_ANCHORS_NETWORKS =
  "Do NOT confuse RESOURCES, ANCHORS, NETWORKS. Return RAW JSON only, no backticks.";

function judgeSystem(variant: "before" | "after", intentHint?: string): string {
  const modeRules = variant === "before"
    ? `  mode = place   → claim / secure / plant a presence
  mode = capture → seize / attack / take from an enemy
  mode = trap    → ambush / deny / counter (planted before Place/Capture; springs on enemy)`
    : `  landsAsCapture → yes if the story lands with a moment of taking from an enemy.
  landsAsTrap    → yes if the story lands with a sprung consequence on an enemy.
  Both no → the card is a Place (calm forward motion, claim / secure).`;

  const modeExample = variant === "before"
    ? { mode: "One of: place, capture, trap — pick the engine action that matches the narrative" }
    : {
        landsAsCapture: "yes/no — does the story land with a moment of taking from an enemy?",
        landsAsTrap: "yes/no — does the story land with a sprung consequence on an enemy?",
      };

  const rewardExample = {
    ...modeExample,
    stance: "One of: open, covert — how visible the act is",
    valueIntent: "One of: modest, momentum, watershed — size of the play",
    initiativeIntent: "One of: slow, steady, decisive — timing. Ignored for traps (always 0).",
    title: "A short evocative card title. Original; not the problem title.",
    narrativeSummary: "1-2 sentences on what this card depicts. ≤40 words.",
  };
  const example = {
    quality: "One of: excellent, good, adequate, poor",
    reasoning: "2-3 sentences (≤60 words) on creativity, strategic merit, narrative fit.",
    rewards: [rewardExample, "(optional) a second reward card of the same shape, for a particularly inventive response"],
    narrativeSummary: "1-2 sentences (≤40 words) summarizing the round outcome for the player.",
    anchorMutations: [{
      anchorId: "ID from the Anchors at stake list",
      newStatus: "active | contested | inactive",
      reason: "≤15 words, genre-appropriate",
      changeFaction: "ONLY when controlling faction changes. Omit otherwise.",
    }],
  };

  return `You are the game master judging a faction's narrative response to a problem. Output JSON only.

WORLD: river-kingdom intrigue / tense and political / the late salt age
Varn is a long valley kingdom split by the river Ose. Three houses hold power: Merrow (docks, salt, barges), Callan (hills, silver mines, cavalry) and Dunmore (market towns, grain, lawyers). Winter is two months away and grain prices have doubled since the spring floods.

CURRENT WORLD STATE:
A barge of Callan silver sank at the Ose bend and each house blames another. Merrow has hired foreign sellswords, officially to guard the docks. Dunmore's chief magistrate died and the succession is contested.

FACTION: House Dunmore — a line of market towns along the old road, rich in grain and famous for its lawyers.
ALL FACTIONS: House Merrow, House Callan, House Dunmore

ANCHORS:
- a1: Tarn Ford bridge (place) — the only crossing free of Merrow's river tax; in poor repair. Status: contested.
- a2: The Dunmore granaries (asset) — the valley's winter grain. Status: active. Held by House Dunmore.
- a3: Captain Oriel Vask (actor) — commander of Merrow's sellswords. Status: active. Serves House Merrow.

BOARD STATE:
House Merrow holds the most ground along the river. House Dunmore trails and holds little beyond its market towns.

PROBLEM: The Sellswords at the Granary Road [dire]
  Situation: Merrow's hired sellswords have camped on the road to the Dunmore granaries. Merchants are turning back, and the towns fear the grain will be seized before winter.
  Constraints: Respond to the threat to the granaries. Any house may be targeted.
  Anchors at stake: a1, a2, a3
${intentHint ? `  Validator-inferred intent: ${intentHint} (use unless the narrative clearly matches a different mode)\n` : ""}
REWARD CARDS — you output 1 guaranteed card (and, only for excellent / good responses, optionally a second).

${modeRules}

  valueIntent → modest (small footprint) | momentum (mid) | watershed (big)
  initiativeIntent → slow | steady | decisive (timing; ignored for traps)

  Do NOT pick a target. The player targets their cards during planning.

QUALITY SCALING
  excellent → watershed/decisive (optional 2nd card permitted)
  good      → momentum/steady (optional 2nd card permitted)
  adequate  → modest/steady or modest/slow (single card)
  poor      → modest/slow (single card, failure-leaning narrative)

ANCHOR RULES
  Only mutate anchors listed in "Anchors at stake". Most responses touch 0-1 anchors.

${JSON_ONLY_RULE_ANCHORS_NETWORKS}

Format (values are placeholders — generate original content):
${JSON.stringify(example, null, 2)}`;
}

const KINDS = ["place", "capture", "trap"] as const;
type Kind = typeof KINDS[number];
const PLANS: { text: string; kind: Kind }[] = [
  ...["We raid Merrow's salt warehouse at night and carry off everything we can.",
      "We pay the sellswords' paymaster to hand over their war chest to us.",
      "We seize Merrow's barges at the docks while their crews are ashore.",
      "Our militia takes Merrow's watchtower by force and holds it.",
      "We bribe Callan's quartermaster to send their silver shipment to our towns instead.",
      "We capture Merrow's best horses from their stables before dawn.",
      "We storm Merrow's counting-house and take their gold.",
      "We convince Callan's miners to come and work for us instead.",
      "We take over Merrow's market stalls while their traders are away.",
      "We hire away Merrow's chief engineer with a better offer."].map((text) => ({ text, kind: "capture" as const })),
  ...["We leave the Tarn Ford bridge looking safe, but cut the ropes so it collapses when the sellswords cross.",
      "We hide archers on the ridge above the granary road and wait for the sellswords to pass below.",
      "We pretend to retreat, then surround them when they chase us into the valley.",
      "We set up a fake peace meeting and ambush whoever Merrow sends.",
      "We dig pits along the granary road and cover them with branches.",
      "We let a false plan fall into Merrow's hands so they attack an empty granary.",
      "We wait until the sellswords camp in the lowland, then break the dam.",
      "We leave the granary gate unbarred and wait inside with every guard we have.",
      "We plant a spy who will lead their scouts into the marsh.",
      "We put out a rich-looking grain cart as bait and watch who comes for it."].map((text) => ({ text, kind: "trap" as const })),
  ...["We build new grain stores on the empty plains to the north.",
      "We settle the unclaimed river island with fishing families.",
      "We clear the wild forest nobody owns and build a sawmill.",
      "We found a new trading post at the empty river crossing.",
      "We map the mountain passes and build a waystation there.",
      "We plant orchards on the hillsides nobody uses.",
      "We open a new mine in the untouched eastern hills.",
      "We build a lighthouse on the empty cape.",
      "We send settlers to rebuild the abandoned village in the valley.",
      "We dig canals so we can farm the dry flats."].map((text) => ({ text, kind: "place" as const })),
];

async function testCollapse() {
  const rows: { plan: string; intended: Kind; variant: string; raw: string; read: Kind }[] = [];
  for (const p of PLANS) {
    for (const variant of ["before", "after"] as const) {
      const user = `Response from House Dunmore:\n"${p.text}"\n\nJudge it.`;
      const raw = await chat(judgeSystem(variant), user);
      const j = extractJson(raw);
      const card = (Array.isArray(j?.rewards) ? j!.rewards[0] : null) as Record<string, unknown> | null;
      let read: Kind;
      if (variant === "before") read = llmEnum(card?.mode, KINDS, "place");
      else {
        const cap = llmBoolean(card?.landsAsCapture, false), trap = llmBoolean(card?.landsAsTrap, false);
        read = cap ? "capture" : trap ? "trap" : "place";
      }
      rows.push({ plan: p.text, intended: p.kind, variant, raw, read });
      process.stdout.write(`A ${variant.padEnd(6)} ${p.kind.padEnd(7)} -> ${read}\n`);
    }
  }
  const summary: Record<string, unknown> = {};
  for (const v of ["before", "after"]) {
    const r = rows.filter((x) => x.variant === v);
    const caught: Record<string, string> = {};
    for (const k of KINDS) { const m = r.filter((x) => x.intended === k); caught[k] = `${m.filter((x) => x.read === k).length}/${m.length}`; }
    const labelled: Record<string, number> = {};
    for (const x of r) labelled[x.read] = (labelled[x.read] ?? 0) + 1;
    summary[v] = { correct: `${r.filter((x) => x.read === x.intended).length}/${r.length}`, caught, labelled };
  }
  results.collapse = { summary, rows };
}

// ═══ Test B: parroting ════════════════════════════════════════════════════

function refereeSystem(variant: "before" | "after"): string {
  const ask = variant === "before" ? "check true or false on each" : `answer "yes" or "no" for each`;
  const example = variant === "before"
    ? `{
  "ontopic": false,
  "specific": false,
  "imaginative": false,
  "grounded": false,
  "memorable": false,
  "conversation": "Brief in-character dialog: referee says and other referee responds"
}`
    : `{
  "ontopic": "yes/no — does it try to answer?",
  "specific": "yes/no — names a person, place, or event?",
  "imaginative": "yes/no — goes beyond the obvious?",
  "grounded": "yes/no — fits the world naturally?",
  "memorable": "yes/no — vivid enough to quote?",
  "conversation": "Brief in-character dialog: referee says and other referee responds"
}`;
  return `You are Marisol and Fen, judging answers in a world-building game.

For the answer, ${ask}:
1. ontopic — tries to answer the question? (false if gibberish or off-topic)
2. specific — names a person, place, tool, or event?
3. imaginative — goes beyond the obvious, adds original flavor?
4. grounded — fits the world naturally, no contradictions?
5. memorable — vivid, funny, or dramatic enough to quote?

Include a 1-2 sentence in-character reaction.

Return RAW JSON only. No talk. No backticks:
${example}`;
}

const QUESTION = "How does Varn decide who may speak at the river council?";
const STORY = `1. Varn is a valley kingdom split by the river Ose, ruled by three houses: Merrow (docks and salt), Callan (silver hills) and Dunmore (market towns and lawyers).
2. The tide-wardens ring bronze bells at dawn and dusk to mark the river's turning.`;

// Four kinds of answer. `strong` is kept as a boolean alongside `kind` so
// the report reads older result files the same way.
//   strong:     clearly passes all five criteria (target 5 of 5)
//   borderline: specific and grounded, but plain: no invention, nothing to
//               quote (should land in the middle, and below strong)
//   weak:       on topic and nothing else: no names, no invention (should
//               score about 1 of 5; a 4+ here is the prompt waving weak
//               answers through)
//   junk:       off topic or gibberish (target 0)
type AnswerKind = "strong" | "borderline" | "weak" | "junk";
const ANSWERS: { text: string; strong: boolean; kind: AnswerKind }[] = [
  ...["Only someone who has crossed Tarn Ford on foot during the spring flood may speak. They wear a strip of river-reed on their wrist, and when the tide-wardens ring the bronze bell, the reed-wearers speak in the order they crossed.",
      "Each house brings a sealed jar of Ose water to the council. The warden of the bells pours them into one bronze basin, and whoever's jar held the most silt — proof they live closest to the river — speaks first.",
      "Dunmore's lawyers won the right, centuries ago, to sell speaking tokens stamped with a salt crystal. Merrow buys most of them every season, which is exactly why Callan keeps smuggling fake ones through the silver mines.",
      "A speaker must hold the Bell-Tongue, a clapper taken from the oldest bell on the Ose. If it slips from your hand while you talk, the tide-wardens say the river has silenced you, and you sit down.",
      "Anyone may speak, but only while standing in the river up to their knees. In winter the debates at the Ose bend are famously short, and Callan's hill lords always propose the council meets in January.",
      "The three houses each name a 'river-mouth' — usually a widow of a drowned bargeman — because the Ose has already taken their husband and so is thought to speak through them. Merrow's current river-mouth is feared by all.",
      "Speakers are chosen by the bronze bells themselves: a warden strikes all three, and the house whose bell rings longest may speak. Dunmore's lawyers have spent generations arguing about how to measure 'longest'.",
      "No one speaks with their voice. Each house floats a written plea on a reed raft down the Ose, and the tide-wardens read aloud whichever rafts reach the council steps before the dusk bell.",
      "The right to speak belongs to whoever last pulled a drowning person out of the Ose. Callan once pushed a Merrow clerk into the river just so their envoy could rescue him and claim the floor.",
      "A seat at the council is inherited through salt: each speaker's family must have paid Merrow's river tax for seven straight years, and the receipts are kept, damp and curling, in the bell tower."]
    .map((text) => ({ text, strong: true, kind: "strong" as AnswerKind })),
  ...["Each house sends one speaker, chosen by the head of the house. Merrow usually sends its harbourmaster.",
      "The tide-wardens keep a list of who asked to speak and call the names in the order they were written down.",
      "The three house heads speak, and a Dunmore lawyer keeps the minutes.",
      "A bell is rung and the house whose turn it is speaks first. The order rotates each season.",
      "Callan's silver pays for the council hall, so Callan's envoy opens the session.",
      "Only house members over forty may speak, a rule the lawyers of Dunmore wrote down long ago.",
      "The warden on duty at dawn names the first speaker, and after that it goes around the table.",
      "Speakers draw lots from a bowl before the dusk bell, one lot per house.",
      "The house hosting the council that year decides who speaks and in what order.",
      "Each house may speak once between the dawn bell and the dusk bell. When the dusk bell rings, the council ends."]
    .map((text) => ({ text, strong: false, kind: "borderline" as AnswerKind })),
  ...["The council leaders decide who speaks.",
      "The most important people speak first.",
      "They take turns.",
      "Whoever is oldest speaks first.",
      "The king decides.",
      "Everyone gets a chance to talk if they raise their hand.",
      "The richest house decides.",
      "There is a vote before the council starts.",
      "The leaders of each house talk and everyone else listens.",
      "People who are respected get to speak."]
    .map((text) => ({ text, strong: false, kind: "weak" as AnswerKind })),
  ...["I like pizza.", "asdf jkl", "The weather was nice today.", "idk", "Cats are better than dogs."]
    .map((text) => ({ text, strong: false, kind: "junk" as AnswerKind })),
];
const CRITERIA = ["ontopic", "specific", "imaginative", "grounded", "memorable"] as const;

async function testParrot() {
  const rows: { answer: string; strong: boolean; kind: AnswerKind; variant: string; raw: string; passed: number; criteria: Record<string, boolean> }[] = [];
  for (const a of ANSWERS) {
    for (const variant of ["before", "after"] as const) {
      const user = `QUESTION: "${QUESTION}"\n\nANSWER: "${a.text}"\n\nCONTEXT:\n${STORY}\n`;
      const raw = await chat(refereeSystem(variant), user);
      const j = extractJson(raw);
      const criteria = Object.fromEntries(CRITERIA.map((c) => [c, llmBoolean(j?.[c], true)])) as Record<string, boolean>;
      const passed = Object.values(criteria).filter(Boolean).length;
      rows.push({ answer: a.text, strong: a.strong, kind: a.kind, variant, raw, passed, criteria });
      process.stdout.write(`B ${variant.padEnd(6)} ${a.kind.padEnd(10)} -> ${passed}/5\n`);
    }
  }
  const summary: Record<string, unknown> = {};
  for (const v of ["before", "after"]) {
    const of = (k: AnswerKind) => rows.filter((x) => x.variant === v && x.kind === k);
    const avg = (xs: typeof rows) => +(xs.reduce((s, x) => s + x.passed, 0) / xs.length).toFixed(1);
    const atLeast4 = (xs: typeof rows) => `${xs.filter((x) => x.passed >= 4).length}/${xs.length}`;
    summary[v] = {
      strongAvgPassed: avg(of("strong")), strongScoredAtLeast4: atLeast4(of("strong")),
      borderlineAvgPassed: avg(of("borderline")), borderlineScoredAtLeast4: atLeast4(of("borderline")),
      weakAvgPassed: avg(of("weak")), weakScoredAtLeast4: atLeast4(of("weak")),
      junkAvgPassed: avg(of("junk")),
    };
  }
  results.parrot = { summary, rows };
}

// ═══ Test C: the chain ════════════════════════════════════════════════════
//
// Production's collapse fix ALSO stopped feeding a separate validator's
// guess into the judge. Stage 1 is the pre-fix validator prompt (word for
// word, generic world): a generous feasibility check that also picks an
// `intent` from place / capture / trap. Stage 2 is the pre-fix judge,
// with the validator's guess injected exactly as production did:
//   "Validator-inferred intent: X (use unless the narrative clearly
//    matches a different mode)"
// Compare with Test A's "before" arm, which is the same judge WITHOUT it.

const VALIDATOR_SYSTEM = `You are evaluating whether a player's proposed action is FEASIBLE within this world.
Your job is NOT to judge quality or grade the response — only to determine if the action can be attempted and what the likely risks are.

VOICE RULES — follow exactly:
- If ALL 4 criteria pass: Respond as Warden Ilsa, House Dunmore's steward. Give a confident, encouraging assessment in character — predictions, recommendations, and excitement about the plan.
- If withinCapabilities or addressesProblem fail but logicallyCoherent AND worldConsistent both pass: Respond as Warden Ilsa, House Dunmore's steward. Warn about the risks IN CHARACTER — a concerned but supportive counselor who sees danger ahead. Do NOT switch voice.
- If logicallyCoherent OR worldConsistent fail: Respond as the referees Marisol and Fen. Explain in character why this action cannot proceed — what rules or constraints it violates.

WORLD CONTEXT:
- Genre: river-kingdom intrigue
- Tone: tense and political
- Era: the late salt age

WORLD SCENARIO:
Varn is a long valley kingdom split by the river Ose. Three houses hold power: Merrow (docks, salt, barges), Callan (hills, silver mines, cavalry) and Dunmore (market towns, grain, lawyers). Winter is two months away and grain prices have doubled since the spring floods.

CURRENT WORLD STATE:
A barge of Callan silver sank at the Ose bend and each house blames another. Merrow has hired foreign sellswords, officially to guard the docks. Dunmore's chief magistrate died and the succession is contested.

FACTION: House Dunmore
- Description: a line of market towns along the old road, rich in grain and famous for its lawyers.

ALL FACTIONS:
- House Merrow
- House Callan
- House Dunmore

AVAILABLE RESOURCES:
- Grain
- Coin
- Militia

WORLD ANCHORS:
- a1: Tarn Ford bridge (place) — the only crossing free of Merrow's river tax; in poor repair. Status: contested.
- a2: The Dunmore granaries (asset) — the valley's winter grain. Status: active. Held by House Dunmore.
- a3: Captain Oriel Vask (actor) — commander of Merrow's sellswords. Status: active. Serves House Merrow.

THE PROBLEM:
Title: The Sellswords at the Granary Road
Situation: Merrow's hired sellswords have camped on the road to the Dunmore granaries. Merchants are turning back, and the towns fear the grain will be seized before winter.
Constraints: Respond to the threat to the granaries. Any house may be targeted.
Intensity: dire
Anchors at stake: a1, a2, a3

RISK CRITERIA — answer "yes" or "no" for each:
1. withinCapabilities — the faction can plausibly attempt this given their description and known assets?
2. addressesProblem — the response actually addresses the stated problem, not something else entirely?
3. logicallyCoherent — the plan makes internal sense, no contradictions or nonsense?
4. worldConsistent — fits established world rules, physics, and tone without breaking immersion?
   YES if the plan uses existing faction assets, known world locations, or established capabilities in creative ways.
   NO only if the plan introduces technology, magic, powers, or entities that DO NOT EXIST in this world (e.g., time machines in a medieval setting, divine intervention in a non-religious world).

REMEMBER: Everything listed under FACTION, WORLD ANCHORS, WORLD SCENARIO, and AVAILABLE RESOURCES is an ESTABLISHED part of this world. Plans that reference these elements are world-consistent by definition.
IMPORTANT: Default to "yes" for all criteria. Be generous — most creative or ambitious actions should pass.
Only answer "no" when there is a CLEAR, SPECIFIC violation you can name.
worldConsistent should almost always be "yes" — creative use of existing world elements is world-consistent. Only answer "no" if the plan introduces something that flatly does not exist in this world (e.g., technology from another era, supernatural powers not established in the setting).

Also provide:
- feedback: Your assessment — 2–3 sentences, up to ~60 words. Advisor voice if world's rules hold, referee voice if logicallyCoherent or worldConsistent fail.
- predictedOutcomes: bestCase and worstCase, each 1–2 sentences, ≤35 words.
- suggestedModification: If any criteria fail, 1 sentence, ≤25 words.

Return RAW JSON only. No talk. No backticks:
NOTE: Format example only. Generate original content.
${JSON.stringify({
  withinCapabilities: "yes/no — can this faction plausibly attempt this?",
  addressesProblem: "yes/no — does it address the stated problem?",
  logicallyCoherent: "yes/no — does the plan make internal sense?",
  worldConsistent: "yes/no — fits established world rules?",
  intent: "One of: place (claim / secure / plant a presence) | capture (seize / attack / take) | trap (ambush / deny / counter). Pick the best fit.",
  feedback: "Assessment of proposed action — 2–3 sentences, up to ~60 words. In-character.",
  predictedOutcomes: {
    bestCase: "What could go right — 1–2 sentences, ≤35 words.",
    worstCase: "What could go wrong — 1–2 sentences, ≤35 words.",
  },
  suggestedModification: "If any criteria fail, a suggestion to adjust the action — 1 sentence, ≤25 words.",
}, null, 2)}`;

const validatorUser = (plan: string) => `THE PLAYER'S PROPOSED ACTION:
"${plan}"

Evaluate this action from House Dunmore:
1. Check each risk criterion ("yes" or "no")
2. Provide feedback — as the advisor (in character) if the world's rules hold, as the referee if logicallyCoherent or worldConsistent fail
3. Predict best-case and worst-case outcomes
4. If any criteria fail, suggest how to modify the action`;

async function testChain() {
  const rows: { plan: string; intended: Kind; validatorGuess: Kind; judgeRead: Kind; validatorRaw: string; judgeRaw: string }[] = [];
  for (const p of PLANS) {
    const vRaw = await chat(VALIDATOR_SYSTEM, validatorUser(p.text));
    const guess = llmEnum(extractJson(vRaw)?.intent, KINDS, "place");
    const jRaw = await chat(judgeSystem("before", guess), `Response from House Dunmore:\n"${p.text}"\n\nJudge it.`);
    const card = (() => { const j = extractJson(jRaw); return Array.isArray(j?.rewards) ? (j!.rewards[0] as Record<string, unknown>) : null; })();
    const read = llmEnum(card?.mode, KINDS, "place");
    rows.push({ plan: p.text, intended: p.kind, validatorGuess: guess, judgeRead: read, validatorRaw: vRaw, judgeRaw: jRaw });
    process.stdout.write(`C ${p.kind.padEnd(7)} validator=${guess.padEnd(7)} judge=${read}\n`);
  }
  const tally = (pick: (r: (typeof rows)[number]) => Kind) => {
    const caught: Record<string, string> = {};
    for (const k of KINDS) { const m = rows.filter((x) => x.intended === k); caught[k] = `${m.filter((x) => pick(x) === k).length}/${m.length}`; }
    const labelled: Record<string, number> = {};
    for (const x of rows) labelled[pick(x)] = (labelled[pick(x)] ?? 0) + 1;
    return { correct: `${rows.filter((x) => pick(x) === x.intended).length}/${rows.length}`, caught, labelled };
  };
  const followedHint = rows.filter((x) => x.judgeRead === x.validatorGuess).length;
  results.chain = {
    summary: { validator: tally((r) => r.validatorGuess), judgeWithHint: tally((r) => r.judgeRead),
               judgeAgreedWithHint: `${followedHint}/${rows.length}` },
    rows,
  };
}

(async () => {
  const t0 = Date.now();
  await chat("Reply with JSON.", `{"ready": true}`); // warm-up
  const only = process.env.TEST === "chain" || process.argv.includes("--chain") ? "chain"
    : process.env.TEST === "parrot" || process.argv.includes("--parrot") ? "parrot" : "";
  if (only === "chain") await testChain();
  else if (only === "parrot") await testParrot();
  else { await testCollapse(); await testParrot(); }
  results.minutes = +((Date.now() - t0) / 60000).toFixed(1);
  const dir = TEMPERATURE_OVERRIDE !== undefined ? "measure/results/faithful/temperature" : "measure/results/faithful";
  mkdirSync(dir, { recursive: true });
  // Files are named by model, whichever backend served it; the JSON's
  // `backend` field records which.
  const safe = EFFECTIVE_MODEL.replace(/[^a-z0-9.]+/gi, "-");
  const suffix = TEMPERATURE_OVERRIDE !== undefined ? `-t${TEMPERATURE_OVERRIDE}` : "";
  const file = `${dir}/${only ? `${only}-` : ""}${safe}${suffix}.json`;
  writeFileSync(file, JSON.stringify(results, null, 2));
  console.log("===== SUMMARY =====");
  for (const k of ["collapse", "parrot", "chain"]) if (results[k]) console.log(k, JSON.stringify((results[k] as { summary: unknown }).summary, null, 1));
  console.log(`wrote ${file} (${results.minutes} min)`);
})().catch((e) => { console.error("FAILED:", e); process.exit(1); });
