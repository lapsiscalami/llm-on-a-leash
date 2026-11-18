/**
 * DEMO — Pin the fix.
 *
 * You find a subtle race. You fix it with one line. Six months later
 * someone refactors that function and the line quietly disappears,
 * because nothing about it looks important and no test names it.
 *
 * Tests prove a guard WORKS. Nothing proves a guard EXISTS.
 *
 * So assert the line is still there. These are ast-grep rules that fail
 * the build when a specific guard goes missing — plus the inverted form,
 * where the rule fires when a forbidden pattern APPEARS.
 *
 * This demo mutates a copy of the guarded file, runs the real scanner
 * against each mutation, and reports whether the fence caught it.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, copyFileSync, rmSync } from "node:fs";
import { header, section } from "../../src/llm.js";

const GUARDED = "demos/fences/guarded/rounds.ts";
const BACKUP = "demos/fences/guarded/.rounds.backup";

/**
 * Run the real ast-grep scanner. Exit 0 = clean. A nonzero exit counts as a
 * rule firing only if the output names a rule; otherwise the scanner itself
 * failed (bad config, missing binary), which must never pass for a catch.
 */
function scan(): { status: "clean" | "fired" | "error"; firedRules: string[]; detail: string } {
  try {
    execFileSync("npx", ["ast-grep", "scan"], { encoding: "utf8", stdio: "pipe", shell: true });
    return { status: "clean", firedRules: [], detail: "" };
  } catch (e) {
    const out = String((e as { stdout?: string; stderr?: string }).stdout ?? "") +
                String((e as { stderr?: string }).stderr ?? "");
    const fired = [...new Set([...out.matchAll(/error\[([a-z-]+)\]/g)].map((m) => m[1]!))];
    return fired.length
      ? { status: "fired", firedRules: fired, detail: "" }
      : { status: "error", firedRules: [], detail: out.trim().split("\n").slice(-1)[0] ?? "" };
  }
}

interface Mutation {
  label: string;
  apply: (src: string) => string;
  expect: "caught" | "clean";
  /** For "caught": the rule that must fire. Any other rule firing is a mismatch. */
  rule?: string;
  why: string;
}

const IDEMPOTENCY = "advance-round-idempotency-guard";
const NO_DEADLINE = "round-completion-no-deadline-guard";

const MUTATIONS: Mutation[] = [
  {
    label: "delete the idempotency guard",
    apply: (s) => s.replace(/\s*if \(game\.currentRound >= nextRoundNumber\) return;\n/, "\n"),
    expect: "caught",
    rule: IDEMPOTENCY,
    why: "the exact line a refactor drops",
  },
  {
    label: "weaken >= to >",
    apply: (s) => s.replace("game.currentRound >= nextRoundNumber", "game.currentRound > nextRoundNumber"),
    expect: "caught",
    rule: IDEMPOTENCY,
    why: "an off-by-one that still 'looks like' a guard",
  },
  {
    label: "rename the function away",
    apply: (s) => s.replace(/advanceToNextRound/g, "advanceRound"),
    expect: "caught",
    rule: IDEMPOTENCY,
    why: "the fence is pinned to a name; renaming needs a deliberate rule update",
  },
  {
    label: "move the guard to a sibling function",
    apply: (s) =>
      s
        .replace(/\s*if \(game\.currentRound >= nextRoundNumber\) return;\n/, "\n")
        .replace(
          "export function checkRoundCompletion",
          "export function skipIfAdvanced(game: Game, nextRoundNumber: number): void {\n" +
            "  if (game.currentRound >= nextRoundNumber) return;\n}\n\n" +
            "export function checkRoundCompletion",
        ),
    expect: "caught",
    rule: IDEMPOTENCY,
    why: "the line still exists in the file, just not where it matters; a file-level check would pass this",
  },
  {
    label: "add a deadline check",
    apply: (s) => s.replace(
      "return players.every((p) => p.submitted);",
      "if (Date.now() > 1) return true;\n  return players.every((p) => p.submitted);",
    ),
    expect: "caught",
    rule: NO_DEADLINE,
    why: "the INVERTED fence — fires when forbidden code appears",
  },
  {
    label: "a deadline check in a different function",
    apply: (s) => s.replace(
      "export function checkRoundCompletion",
      "export function isOverdue(deadline: number): boolean {\n  return Date.now() > deadline;\n}\n\n" +
        "export function checkRoundCompletion",
    ),
    expect: "clean",
    why: "the inverted fence is scoped to checkRoundCompletion; other functions may consult the clock",
  },
  {
    label: "harmless comment edit",
    apply: (s) => s.replace("// GUARD 1 — idempotency.", "// GUARD 1 - idempotency (see issue #412)."),
    expect: "clean",
    why: "structural matching ignores prose, so ordinary edits stay quiet",
  },
  {
    label: "reformat the guard onto two lines",
    apply: (s) => s.replace(
      "if (game.currentRound >= nextRoundNumber) return;",
      "if (game.currentRound >= nextRoundNumber)\n    return;",
    ),
    expect: "clean",
    why: "formatting is not deletion — the fence must not be brittle",
  },
];

header("DEMO — Pin the fix (regression fences)");

const original = readFileSync(GUARDED, "utf8");
copyFileSync(GUARDED, BACKUP);
let failures = 0;

try {
  section("Baseline: guards present");
  const base = scan();
  console.log(`    ast-grep scan -> ${base.status === "clean" ? "clean ✓" : base.status === "fired" ? `FIRED: ${base.firedRules.join(", ")}` : `SCANNER ERROR: ${base.detail}`}`);
  if (base.status !== "clean") {
    console.log(`    (baseline should be clean; skipping the mutations)`);
    failures++;
  } else {
    section("Mutating the file and re-scanning");
    console.log(`    ${"mutation".padEnd(41)} ${"fence".padEnd(9)} ${"expected".padEnd(9)} verdict`);
    for (const m of MUTATIONS) {
      const mutated = m.apply(original);
      // A mutation that changes nothing would "pass" as clean without testing anything.
      if (mutated === original) {
        failures++;
        console.log(`    ${m.label.padEnd(41)} ${"-".padEnd(9)} ${m.expect.padEnd(9)} MISMATCH\n      ${"".padEnd(41)} the mutation didn't change the file`);
        continue;
      }
      writeFileSync(GUARDED, mutated, "utf8");
      const r = scan();
      const got = r.status === "fired" ? "caught" : r.status === "clean" ? "clean" : "error";
      const good = m.expect === "clean"
        ? r.status === "clean"
        : r.status === "fired" && r.firedRules.length === 1 && r.firedRules[0] === m.rule;
      if (!good) failures++;
      console.log(
        `    ${m.label.padEnd(41)} ${got.padEnd(9)} ${m.expect.padEnd(9)} ${good ? "ok" : "MISMATCH"}` +
        (r.firedRules.length ? `\n      ${"".padEnd(41)} fired: ${r.firedRules.join(", ")}${m.rule && !good ? ` (expected ${m.rule})` : ""}` : "") +
        (r.status === "error" ? `\n      ${"".padEnd(41)} scanner error: ${r.detail}` : ""),
      );
      console.log(`      ${"".padEnd(41)} ${m.why}`);
    }
    console.log(`\n    ${MUTATIONS.length - failures}/${MUTATIONS.length} behaved as expected.`);
  }
} finally {
  copyFileSync(BACKUP, GUARDED);
  rmSync(BACKUP, { force: true });
}
// Restored first, then fail the run, so CI sees a broken fence.
if (failures) process.exitCode = 1;

section("Why not just write a test?");
console.log(`  A test proves the guard WORKS. Delete the guard and the test`);
console.log(`  fails — so far so good. But that only helps if a test covers`);
console.log(`  that exact race, and races are precisely what tests miss.`);
console.log(`  The fence is cheaper: it does not reproduce the bug, it just`);
console.log(`  asserts the fix is still in the file. Belt and braces.`);

section("Why not grep?");
console.log(`  An early draft of the deadline rule used a regex and fired on`);
console.log(`  the guard's own EXPLANATORY COMMENT, which mentions the very`);
console.log(`  code it forbids. Structural matching reads the syntax tree,`);
console.log(`  so prose is invisible to it. That false positive is preserved`);
console.log(`  in the rule's note as the argument for ast-grep over grep.`);

section("The habit worth stealing");
console.log(`  · When you fix something subtle, ask: "what stops this from`);
console.log(`    being deleted?" If the answer is "nothing", add a fence.`);
console.log(`  · The pin-the-fix skill in .claude/skills writes one, with the`);
console.log(`    rule test that proves it fires: say which line to pin.`);
console.log(`  · Put the INCIDENT in the rule's note — a date, a game id, a`);
console.log(`    symptom. A rule that explains itself survives; one that just`);
console.log(`    says "don't do this" gets deleted by the next person.`);
console.log(`  · Absence assertions (\`kind: program\` + \`not: has:\`) are the`);
console.log(`    unusual trick. Most linting asks "is this code bad?" — this`);
console.log(`    asks "is the good code still here?"`);
console.log("");
