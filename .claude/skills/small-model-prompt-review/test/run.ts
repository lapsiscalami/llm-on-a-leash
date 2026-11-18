/**
 * Test for the small-model-prompt-review skill.
 *
 * The skill is a prompt that Claude Code runs, so the test runs it for real:
 * for each fixture in ./fixtures it invokes the skill headlessly
 * (`claude -p "/small-model-prompt-review <file>"`), saves the report, and
 * checks it against ./expected.json:
 *
 *   - judge-prompt.ts plants one instance of every check in the skill. The
 *     report must mention each planted line (by field name or phrase).
 *   - question-prompt.ts follows every pattern. The report's first line
 *     must be "No findings." (the skill promises that).
 *
 * Needs the Claude Code CLI on PATH and an account; each fixture is one
 * review (a handful of model calls). Run from the repo root:
 *
 *   npm run test:skill                             # reviews with the "opus" alias
 *   SKILL_TEST_MODEL=sonnet npm run test:skill     # a cheaper model
 *
 * Reports land in test/reports/ (gitignored) so a failure can be read.
 *
 * A review is a model run, so it is not perfectly repeatable. One MISS on
 * an otherwise green run means: read the saved report. If the skill really
 * did skip the line, sharpen the check in SKILL.md; if it named the line in
 * words expected.json doesn't list, add the words. Don't loosen a check to
 * make a flaky run pass.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const SKILL = "small-model-prompt-review";
const DIR = `.claude/skills/${SKILL}/test`;
const REPORTS = join(DIR, "reports");

interface Planted { check: string; what: string; anyOf: string[] }
interface Expected { fixtures: Record<string, { expectClean?: boolean; planted?: Planted[] }> }

if (!existsSync(`.claude/skills/${SKILL}/SKILL.md`)) {
  console.error(`run this from the repo root (no .claude/skills/${SKILL}/SKILL.md here)`);
  process.exit(2);
}
const expected = JSON.parse(readFileSync(join(DIR, "expected.json"), "utf8")) as Expected;
mkdirSync(REPORTS, { recursive: true });

function review(fixture: string): string {
  const target = `${DIR}/fixtures/${fixture}`;
  // Spell the skill and the file out rather than relying on "/skill <path>"
  // expansion: in headless mode the argument was dropped and the review
  // wandered off to another file in the repo.
  const prompt =
    `Use the "${SKILL}" skill (its instructions are in .claude/skills/${SKILL}/SKILL.md; read them and follow them) ` +
    `to review exactly one file: ${target}. Review only that file and nothing else in the repo. ` +
    `Print the review report and nothing before it.`;
  // The prompt goes in on stdin. With `shell: true` (needed on Windows to
  // find claude.cmd) node joins argv with spaces and no quoting, so a prompt
  // passed as an argument arrives as its first word only.
  const args = [
    "-p",
    "--output-format", "text",
    "--allowedTools", "Read,Grep,Glob,Skill",
    "--max-turns", "15",
  ];
  // Always name a model: the user's settings.json default may be one the
  // installed CLI can't run (e.g. a newer model than that CLI supports).
  args.push("--model", process.env.SKILL_TEST_MODEL ?? "opus");
  // When this runs from inside a Claude Code session the child inherits that
  // session's variables. Drop the nesting guard (a headless -p run is fine)
  // and the parent's model choice, which the installed CLI may not support;
  // the child then uses the user's own default, or SKILL_TEST_MODEL.
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k === "CLAUDECODE" || /^(ANTHROPIC_MODEL|ANTHROPIC_DEFAULT_.*_MODEL|CLAUDE_CODE_.*MODEL.*)$/.test(k)) delete env[k];
  const t0 = Date.now();
  const r = spawnSync("claude", args, { input: prompt, encoding: "utf8", shell: true, env, timeout: 10 * 60_000, maxBuffer: 16 * 1024 * 1024 });
  const secs = ((Date.now() - t0) / 1000).toFixed(0);
  if (r.error) throw new Error(`could not run claude: ${r.error.message}\n      Is the Claude Code CLI installed and on PATH?`);
  if (r.status !== 0) throw new Error(`claude exited ${r.status} after ${secs}s\n${(r.stderr || r.stdout).slice(0, 800)}`);
  const report = r.stdout.trim();
  writeFileSync(join(REPORTS, fixture.replace(/\.ts$/, ".md")), report + "\n");
  console.log(`  reviewed in ${secs}s, ${report.split("\n").length} lines`);
  return report;
}

let failures = 0;
for (const [fixture, spec] of Object.entries(expected.fixtures)) {
  console.log(`\n== ${fixture} ==`);
  let report: string;
  try { report = review(fixture); } catch (e) { console.error(`  x ${(e as Error).message}`); failures++; continue; }
  const lower = report.toLowerCase();

  if (spec.expectClean) {
    const firstLine = report.split("\n").map((l) => l.trim()).find((l) => l.length > 0) ?? "";
    const ok = /^no findings\.?$/i.test(firstLine.replace(/^[#*\s]+|[*\s]+$/g, ""));
    console.log(`  ${ok ? "ok  " : "FAIL"} clean prompt -> first line is "No findings."${ok ? "" : ` (got: ${JSON.stringify(firstLine.slice(0, 80))})`}`);
    if (!ok) failures++;
    continue;
  }

  for (const p of spec.planted ?? []) {
    const hit = p.anyOf.find((s) => lower.includes(s.toLowerCase()));
    const ok = hit !== undefined;
    if (!ok) failures++;
    console.log(`  ${ok ? "ok  " : "MISS"} ${p.check.padEnd(36)} ${p.what}${ok ? `  (matched "${hit}")` : ""}`);
  }
}

console.log(`\n${failures === 0 ? "PASS" : `FAIL: ${failures} problem(s)`}. Reports in ${REPORTS}/`);
process.exit(failures === 0 ? 0 : 1);
