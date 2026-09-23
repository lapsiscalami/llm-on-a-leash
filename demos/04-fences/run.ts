/**
 * DEMO 04 — Pin the fix.
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

const GUARDED = "demos/04-fences/guarded/rounds.ts";
const BACKUP = "demos/04-fences/guarded/.rounds.backup";

/** Run the real ast-grep scanner. Exit code 0 = clean, 1 = rule fired. */
function scan(): { clean: boolean; firedRules: string[] } {
  try {
    execFileSync("npx", ["ast-grep", "scan"], { encoding: "utf8", stdio: "pipe", shell: true });
    return { clean: true, firedRules: [] };
  } catch (e) {
    const out = String((e as { stdout?: string; stderr?: string }).stdout ?? "") +
                String((e as { stderr?: string }).stderr ?? "");
    const fired = [...out.matchAll(/error\[([a-z-]+)\]/g)].map((m) => m[1]!);
    return { clean: false, firedRules: [...new Set(fired)] };
  }
}

interface Mutation {
  label: string;
  apply: (src: string) => string;
  expect: "caught" | "clean";
  why: string;
}

const MUTATIONS: Mutation[] = [
  {
    label: "delete the idempotency guard",
    apply: (s) => s.replace(/\s*if \(game\.currentRound >= nextRoundNumber\) return;\n/, "\n"),
    expect: "caught",
    why: "the exact line a refactor drops",
  },
  {
    label: "weaken >= to >",
    apply: (s) => s.replace("game.currentRound >= nextRoundNumber", "game.currentRound > nextRoundNumber"),
    expect: "caught",
    why: "an off-by-one that still 'looks like' a guard",
  },
  {
    label: "rename the function away",
    apply: (s) => s.replace(/advanceToNextRound/g, "advanceRound"),
    expect: "caught",
    why: "the fence is pinned to a name; renaming needs a deliberate rule update",
  },
  {
    label: "add a deadline check",
    apply: (s) => s.replace(
      "return players.every((p) => p.submitted);",
      "if (Date.now() > 1) return true;\n  return players.every((p) => p.submitted);",
    ),
    expect: "caught",
    why: "the INVERTED fence — fires when forbidden code appears",
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

header("DEMO 04 — Pin the fix (regression fences)");

const original = readFileSync(GUARDED, "utf8");
copyFileSync(GUARDED, BACKUP);

try {
  section("Baseline: guards present");
  const base = scan();
  console.log(`    ast-grep scan -> ${base.clean ? "clean ✓" : `FIRED: ${base.firedRules.join(", ")}`}`);
  if (!base.clean) {
    console.log(`    (baseline should be clean; aborting)`);
    process.exit(1);
  }

  section("Mutating the file and re-scanning");
  console.log(`    ${"mutation".padEnd(34)} ${"fence".padEnd(9)} ${"expected".padEnd(9)} verdict`);
  let pass = 0;
  for (const m of MUTATIONS) {
    writeFileSync(GUARDED, m.apply(original), "utf8");
    const r = scan();
    const got: "caught" | "clean" = r.clean ? "clean" : "caught";
    const good = got === m.expect;
    if (good) pass++;
    console.log(
      `    ${m.label.padEnd(34)} ${got.padEnd(9)} ${m.expect.padEnd(9)} ${good ? "ok" : "MISMATCH"}` +
      (r.firedRules.length ? `\n      ${"".padEnd(34)} fired: ${r.firedRules.join(", ")}` : ""),
    );
    console.log(`      ${"".padEnd(34)} ${m.why}`);
  }
  console.log(`\n    ${pass}/${MUTATIONS.length} behaved as expected.`);
} finally {
  copyFileSync(BACKUP, GUARDED);
  rmSync(BACKUP, { force: true });
}

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
console.log(`  · Put the INCIDENT in the rule's note — a date, a game id, a`);
console.log(`    symptom. A rule that explains itself survives; one that just`);
console.log(`    says "don't do this" gets deleted by the next person.`);
console.log(`  · Absence assertions (\`kind: program\` + \`not: has:\`) are the`);
console.log(`    unusual trick. Most linting asks "is this code bad?" — this`);
console.log(`    asks "is the good code still here?"`);
console.log("");
