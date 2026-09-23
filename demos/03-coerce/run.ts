/**
 * DEMO 03 — Coerce, never reject. (With one important exception.)
 *
 * A validator on an LLM output field that THROWS on a plausible near-miss
 * is a bug. It forces a retry, and on a small model the retry costs more
 * tokens than the leniency would have saved.
 *
 *     "equilibrium (1:1 — equal)"  should parse as  equilibrium
 *     "Yes"                        should parse as  true
 *     ""                           should become    the safe default
 *
 * THE EXCEPTION, which took an incident to learn: coercion that INVENTS
 * state is worse than rejection. One field in the real resolver
 * deliberately opts out of the lenient parser, because coercing an
 * unrecognised event kind would resurrect an event the model meant to
 * drop. Leniency is a per-field decision, not a policy.
 *
 * AND: if your coercer can never fail, LOG THE FALLBACK. A field that is
 * 100% fallback looks perfectly healthy from the outside. That blind spot
 * is how the demo-02 collapse went unnoticed for weeks.
 */
import { z } from "zod";
import { header, section } from "../../src/llm.js";

// ─── The lenient primitives ──────────────────────────────────────────────

let fallbackLog: { field: string; received: string; fellBackTo: string }[] = [];

/** Enum that cannot fail. Exact match -> prefix match -> fallback.
 *  Sorted longest-first so a table holding both "dominant" and
 *  "dominant_plus" resolves the MORE specific value (declaration order
 *  would make the longer one unreachable — a real bug I shipped). */
function llmEnum<T extends string>(values: readonly [T, ...T[]], fallback: T, field: string) {
  const valid = new Set<string>(values);
  const sorted = [...values].sort((a, b) => b.length - a.length);
  return z.string().transform((v): T => {
    const lower = v.toLowerCase().trim();
    if (valid.has(lower)) return lower as T;
    const hit = sorted.find((val) => lower.startsWith(val.toLowerCase()));
    if (hit) return hit;
    fallbackLog.push({ field, received: v, fellBackTo: fallback });
    return fallback;
  });
}

/** Boolean via yes/no strings. Small models parrot the value shown in a
 *  format example; if the example says `false`, you get `false` forever.
 *  Using "yes"/"no" makes it a semantic answer instead of a template. */
function llmBoolean(fallback = false) {
  return z.union([z.string(), z.boolean()]).transform((v): boolean => {
    if (typeof v === "boolean") return v;
    const s = v.toLowerCase().trim();
    if (s.startsWith("yes/no") || s.startsWith("yes or no")) return fallback; // parroted placeholder
    if (s.startsWith("y")) return true;
    if (s.startsWith("n")) return false;
    if (s === "true") return true;
    if (s === "false") return false;
    return fallback;
  });
}

// ─── (a) Strict vs lenient on real near-misses ───────────────────────────

const QUALITIES = ["excellent", "good", "adequate", "poor"] as const;

const StrictSchema = z.object({
  quality: z.enum(QUALITIES),
  worldConsistent: z.boolean(),
  reason: z.string().min(1),
});

const LenientSchema = z.object({
  quality: llmEnum(QUALITIES, "adequate", "quality"),
  worldConsistent: llmBoolean(true),
  reason: z.string().optional().transform((s) => (s ?? "").trim() || "(no reason given)"),
});

/** Every one of these is real output shape from an 8B model. None of them
 *  is malicious or absurd — they are all "obviously what was meant". */
const SAMPLES: { label: string; payload: unknown }[] = [
  { label: "clean",                   payload: { quality: "good", worldConsistent: true, reason: "Fits the world." } },
  { label: "hint glued to the value", payload: { quality: "good (solid, workable)", worldConsistent: "yes", reason: "Solid." } },
  { label: "uppercase + dash",        payload: { quality: "EXCELLENT - decisive", worldConsistent: "Yes", reason: "Bold." } },
  { label: "yes/no as strings",       payload: { quality: "poor", worldConsistent: "no", reason: "Contradicts the tides." } },
  { label: "parroted placeholder",    payload: { quality: "adequate", worldConsistent: "yes/no", reason: "Unclear." } },
  { label: "blank reason",            payload: { quality: "good", worldConsistent: "yes", reason: "   " } },
  { label: "missing reason",          payload: { quality: "adequate", worldConsistent: "yes" } },
  { label: "genuinely unknown value", payload: { quality: "spectacular", worldConsistent: "yes", reason: "Wow." } },
];

// ─── (b) The counter-case: when coercion INVENTS state ───────────────────

/** A world event the model may optionally emit. `kind` is a plain lenient
 *  string, deliberately NOT an llmEnum: falling back to a valid kind would
 *  manufacture an event the model did not ask for. Anything unrecognised
 *  drops the whole event — the safe no-op is "no event", not "some event". */
const WorldEventSchema = z
  .object({
    kind: z.string().optional().transform((s) => (s ?? "").toLowerCase().trim()),
    flavor: z.string().optional().transform((s) => (s ?? "").trim()),
  })
  .transform((evt) => {
    if (evt.kind !== "positive" && evt.kind !== "negative") return undefined;
    if (evt.flavor.length === 0) return undefined; // a textless event is not an event
    return { kind: evt.kind, flavor: evt.flavor };
  });

const EVENT_SAMPLES: { label: string; payload: unknown; want: string }[] = [
  { label: "valid event",            payload: { kind: "positive", flavor: "The tide turns early." }, want: "kept" },
  { label: "unknown kind",           payload: { kind: "chaotic", flavor: "Something happens." },     want: "DROPPED" },
  { label: "phantom (removed enum)", payload: { kind: "ontime", flavor: "Nothing much." },           want: "DROPPED" },
  { label: "event with no text",     payload: { kind: "negative", flavor: "" },                      want: "DROPPED" },
  { label: "empty object",           payload: {},                                                   want: "DROPPED" },
];

// ─── Run ─────────────────────────────────────────────────────────────────

header("DEMO 03 — Coerce, never reject (with one exception)");

section("Strict schema vs lenient schema, same 8 payloads");
console.log(`    ${"sample".padEnd(26)} ${"strict".padEnd(10)} lenient`);
let strictFails = 0;
for (const { label, payload } of SAMPLES) {
  const strict = StrictSchema.safeParse(payload);
  const lenient = LenientSchema.safeParse(payload);
  if (!strict.success) strictFails++;
  const strictTxt = strict.success ? "ok" : "THROWS";
  const lenientTxt = lenient.success
    ? `ok  quality=${lenient.data.quality} consistent=${lenient.data.worldConsistent}`
    : "THROWS";
  console.log(`    ${label.padEnd(26)} ${strictTxt.padEnd(10)} ${lenientTxt}`);
}

console.log(`\n    strict rejected ${strictFails}/${SAMPLES.length}; lenient rejected 0/${SAMPLES.length}`);
console.log(`    Each strict rejection is a RETRY: a second full call, on a`);
console.log(`    model that will probably make the same near-miss again.`);
console.log(`    That is why leniency is an economic argument, not a style one.`);

section("The fallback log — the part everyone forgets");
if (fallbackLog.length === 0) {
  console.log(`    (none)`);
} else {
  for (const f of fallbackLog) {
    console.log(`    [llm-enum-fallback] field=${f.field} received=${JSON.stringify(f.received)} fellBackTo=${f.fellBackTo}`);
  }
}
console.log(`\n    Only ${fallbackLog.length} of ${SAMPLES.length} samples actually fell back — the rest were`);
console.log(`    RECOVERED by prefix-matching, which is the point. But note that a`);
console.log(`    lenient parser SUCCEEDS on garbage. Without this log, a field that`);
console.log(`    is 100% fallback looks perfectly healthy: the parse never fails,`);
console.log(`    no error rate moves, and the value is silently a constant.`);
console.log(`    That is exactly how demo 02's collapse hid for weeks.`);

section("The exception: coercion that INVENTS state");
console.log(`    ${"sample".padEnd(26)} ${"result".padEnd(10)} expected`);
let ok = 0;
for (const { label, payload, want } of EVENT_SAMPLES) {
  const parsed = WorldEventSchema.parse(payload);
  const got = parsed ? "kept" : "DROPPED";
  if (got === want) ok++;
  console.log(`    ${label.padEnd(26)} ${got.padEnd(10)} ${want}${got === want ? "" : "   <- MISMATCH"}`);
}
console.log(`\n    ${ok}/${EVENT_SAMPLES.length} as expected.`);
console.log(`\n    This field deliberately does NOT use llmEnum. If "chaotic" fell`);
console.log(`    back to "positive", the game would fire a world event the model`);
console.log(`    never asked for — coercion would MANUFACTURE game state.`);
console.log(`    Ask of every field: "if the model sends garbage here, what is`);
console.log(`    the most neutral outcome?" Usually that is a safe default.`);
console.log(`    Sometimes — when the field's absence means "nothing happens" —`);
console.log(`    the neutral outcome is to drop it entirely.`);

section("The rule, stated once");
console.log(`  · Coerce a near-miss to what was obviously meant.`);
console.log(`  · Coerce junk to the safest value — never throw.`);
console.log(`  · EXCEPT where the safest value is "nothing happened": then drop.`);
console.log(`  · Log every fallback, or you are flying blind on a parser that`);
console.log(`    cannot fail.`);
console.log(`  · Coerce inside .transform() so consumers see an unchanged type.`);
console.log("");
