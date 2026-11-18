/**
 * Test for the pin-the-fix skill.
 *
 * The skill is a prompt that Claude Code runs, so the test runs it for real.
 * For each case in ./expected.json it builds a scratch project in
 * <repo>/tmp/pin-the-fix (the fixture file, an sgconfig.yml with no
 * testConfigs, and a copy of the skill), invokes the skill headlessly with
 * the case's argument, saves the transcript, and then checks the result
 * without trusting the skill's own test file:
 *
 *   - a rule file and a rule-tests file appeared, with the same id
 *   - sgconfig.yml gained a testConfigs entry
 *   - `ast-grep test --skip-snapshot-tests` passes
 *   - `ast-grep scan` is clean on the untouched fixture
 *   - each listed mutation of src/game.ts fires, or stays quiet, as expected
 *
 * Needs the Claude Code CLI on PATH and an account; each case is one skill
 * run (a handful of model calls). Run from the repo root:
 *
 *   npm run test:pin                             # runs with the "opus" alias
 *   SKILL_TEST_MODEL=sonnet npm run test:pin     # a cheaper model
 *
 * Transcripts land in test/reports/ and the scratch project stays in
 * tmp/pin-the-fix/ (both gitignored) so a failure can be read.
 *
 * Why the scratch project is not under .claude/: a headless Claude Code
 * child refuses to write anywhere under .claude/ (it treats the path as
 * protected), so a scratch project there fails before the skill starts.
 * It has to stay inside the repo, though, so `npx ast-grep` resolves from
 * this repo's node_modules.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const SKILL = "pin-the-fix";
const DIR = `.claude/skills/${SKILL}/test`;
const REPORTS = join(DIR, "reports");
const WORK = resolve("tmp", SKILL);

interface Mutation { label: string; find: string; with: string; expect: "caught" | "clean" }
interface Case { args: string; mutations: Mutation[] }
interface Expected { cases: Record<string, Case> }

if (!existsSync(`.claude/skills/${SKILL}/SKILL.md`)) {
  console.error(`run this from the repo root (no .claude/skills/${SKILL}/SKILL.md here)`);
  process.exit(2);
}
const expected = JSON.parse(readFileSync(join(DIR, "expected.json"), "utf8")) as Expected;
mkdirSync(REPORTS, { recursive: true });

/** A fresh scratch project: the fixture, a bare sgconfig, and the skill. */
function buildWork(): void {
  rmSync(WORK, { recursive: true, force: true });
  mkdirSync(join(WORK, "src"), { recursive: true });
  cpSync(join(DIR, "fixtures", "game.ts"), join(WORK, "src", "game.ts"));
  cpSync(join(DIR, "fixtures", "sgconfig.yml"), join(WORK, "sgconfig.yml"));
  mkdirSync(join(WORK, ".claude", "skills", SKILL), { recursive: true });
  cpSync(`.claude/skills/${SKILL}/SKILL.md`, join(WORK, ".claude", "skills", SKILL, "SKILL.md"));
}

/** Run the skill headlessly inside the scratch project. Returns the transcript. */
function runSkill(name: string, args: string): string {
  const prompt =
    `Use the "${SKILL}" skill (its instructions are in .claude/skills/${SKILL}/SKILL.md; read them and follow them) ` +
    `with this argument: ${args}\n` +
    `Work only inside the current directory. Write the rule and its test, run both ast-grep commands, then print the report. ` +
    `The first line of your reply must be the report's first line ("Pinned: <id>"); print nothing before it.`;
  const cli = [
    "-p",
    "--output-format", "text",
    // Quoted by hand: with `shell: true` node joins argv with spaces and no
    // quoting, so the space inside "Bash(npx ast-grep:*)" would split the
    // list and the child would be refused every ast-grep run.
    "--allowedTools", "\"Read,Grep,Glob,Write,Edit,Skill,Bash(npx ast-grep:*),Bash(git diff:*)\"",
    "--max-turns", "30",
    "--model", process.env.SKILL_TEST_MODEL ?? "opus",
  ];
  // Drop the nesting guard and the parent session's model choice, as the
  // review skill's test does; see its run.ts for why.
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k === "CLAUDECODE" || /^(ANTHROPIC_MODEL|ANTHROPIC_DEFAULT_.*_MODEL|CLAUDE_CODE_.*MODEL.*)$/.test(k)) delete env[k];
  const t0 = Date.now();
  const r = spawnSync("claude", cli, { cwd: WORK, input: prompt, encoding: "utf8", shell: true, env, timeout: 15 * 60_000, maxBuffer: 16 * 1024 * 1024 });
  const secs = ((Date.now() - t0) / 1000).toFixed(0);
  if (r.error) throw new Error(`could not run claude: ${r.error.message}\n      Is the Claude Code CLI installed and on PATH?`);
  if (r.status !== 0) throw new Error(`claude exited ${r.status} after ${secs}s\n${(r.stderr || r.stdout).slice(0, 800)}`);
  const report = r.stdout.trim();
  writeFileSync(join(REPORTS, `${name}.md`), report + "\n");
  console.log(`  ran in ${secs}s, ${report.split("\n").length} lines`);
  return report;
}

/** Run ast-grep in the scratch project. Exit 0 = clean / all tests pass. */
function sg(...args: string[]): { ok: boolean; out: string } {
  try {
    const out = execFileSync("npx", ["ast-grep", ...args], { cwd: WORK, encoding: "utf8", stdio: "pipe", shell: true });
    return { ok: true, out };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string };
    return { ok: false, out: String(err.stdout ?? "") + String(err.stderr ?? "") };
  }
}

const ymlIds = (dir: string): string[] =>
  existsSync(dir)
    ? readdirSync(dir).filter((f) => /\.ya?ml$/.test(f)).map((f) => (readFileSync(join(dir, f), "utf8").match(/^id:\s*(\S+)/m) ?? [])[1] ?? "")
    : [];

let failures = 0;
const check = (ok: boolean, what: string, detail = ""): void => {
  if (!ok) failures++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${what}${!ok && detail ? `\n       ${detail.trim().split("\n").slice(0, 6).join("\n       ")}` : ""}`);
};

for (const [name, c] of Object.entries(expected.cases)) {
  console.log(`\n== ${name} ==`);
  buildWork();
  let report: string;
  try { report = runSkill(name, c.args); } catch (e) { console.error(`  x ${(e as Error).message}`); failures++; continue; }

  const firstLine = report.split("\n").map((l) => l.trim()).find((l) => l.length > 0) ?? "";
  check(/^pinned:/i.test(firstLine.replace(/^[#*\s]+/, "")), `first line is "Pinned: <id>"`, `got: ${JSON.stringify(firstLine.slice(0, 80))}`);

  const ruleIds = ymlIds(join(WORK, "rules"));
  const testIds = ymlIds(join(WORK, "rule-tests"));
  check(ruleIds.length >= 1, `a rule was written (${ruleIds.join(", ") || "none"})`);
  check(testIds.length >= 1 && testIds.every((id) => ruleIds.includes(id)), `a rule test was written with a matching id (${testIds.join(", ") || "none"})`);
  check(/testConfigs/.test(readFileSync(join(WORK, "sgconfig.yml"), "utf8")), "sgconfig.yml gained testConfigs");

  const t = sg("test", "--skip-snapshot-tests");
  check(t.ok, "ast-grep test passes", t.out);
  const base = sg("scan");
  check(base.ok, "ast-grep scan is clean on the untouched fixture", base.out);

  const src = join(WORK, "src", "game.ts");
  const original = readFileSync(src, "utf8");
  for (const m of c.mutations) {
    if (!original.includes(m.find)) { check(false, `${m.label}: mutation text not found in fixture`); continue; }
    writeFileSync(src, original.split(m.find).join(m.with), "utf8");
    const r = sg("scan");
    const got: "caught" | "clean" = r.ok ? "clean" : "caught";
    check(got === m.expect, `${m.label.padEnd(36)} expected ${m.expect}, got ${got}`);
    writeFileSync(src, original, "utf8");
  }
}

console.log(`\n${failures === 0 ? "PASS" : `FAIL: ${failures} problem(s)`}. Transcripts in ${REPORTS}/, last scratch project in tmp/${SKILL}/`);
process.exit(failures === 0 ? 0 : 1);
