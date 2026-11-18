# CLAUDE.md

Guidance for Claude Code (claude.ai/code) working in this repository.

## What this repo is

Companion code for two blog posts about running LLM games on **small models**: "Keeping the LLM on a Leash" and "Small Tricks for Small Models". The posts live in the NextOath site repo; `drafts/` here is a gitignored local folder for writing them. It exists to be read alongside the posts and to let readers reproduce every number in them.

It is **not** a library.

## The thesis (do not dilute it)

A deterministic engine owns **all** mechanical truth: board, resolution, score, who won. The model may *grade* a player's plan (a bounded word) and *narrate* results. Code decides what each grade is worth and bounds how far one grade can move a card (`valueFromQuality` / `initFromQuality` in `src/world.ts`). The model has no field that sets a score, a board state, or a winner, and it cannot change a result once resolved. Model judgment is not eliminated; it is constrained to where it enters the system.

## Hard rules

1. **No hand-written model replies, ever.** Every model reply in this repo was produced by a model and saved. Demos replay recordings from `fixtures/` (each stamped with model and date). Measurements live in `measure/results/faithful/`. An earlier version shipped hand-written "recorded" replies; they were removed. Don't bring that back, not even as an "illustrative example" in a post.
2. **Three tiers of evidence, always labelled.** *Reproduced here*: every such number in post 2, the README and PATTERNS.md comes from `npm run report` (`measure/faithful-report.ts`), computed from saved replies; if a doc and the report disagree, the doc is wrong. *Measured in NextOath, not reproduced here*: real numbers from the game's own harness that nothing in this repo regenerates; say so wherever they appear. *Experience*: unmeasured. Don't let a tier drift upward in a rewrite.
3. **Tests call the model the way the real app does.** That means system + user messages, JSON mode, a temperature per prompt *and* per model from the production table, and the real before/after prompt text with a generic world. An earlier round of tests skipped this and gave misleading results; it was thrown out and nothing cites it. Don't add a test that skips it.
4. **One run per result.** Don't mix numbers from different runs in a post. When re-measuring, replace the old numbers wholesale.
5. **Say what's measured and what's a target.** Targets are probability ("picking at random, you'd expect ~17 of 20"). Say which is which.
6. **Report results that don't flatter.** If a pattern doesn't show a gain, cut it or say so plainly. See `PATTERNS.md` entry 8. Several patterns help one model and not another; say which.
7. **Scope claims to model tier.** These are small-model findings on Gemma 4 E4B, Gemma 4 E2B and Llama 3.1 8B.
8. **No dependencies beyond tsx, typescript, @ast-grep/cli.**

## Layout

```
measure/faithful-post2.ts    deck test + words-vs-numbers test
measure/faithful.ts          copied-example (+ weak/borderline countercheck), pick-one collapse; --chain = one model's guess into another; --parrot = the copied-example test alone
measure/classify-topics.ts   labels deck questions with one fixed classifier (run after generation)
measure/faithful-report.ts   npm run report: every table, from saved replies; sections are numbered like PATTERNS.md entries
measure/results/faithful/    saved replies (canonical data); temperature/ holds the T=0.1 check
fixtures/                    real replies that demos replay without --live
src/llm.ts                   replay (default) / live / --live --record clients for demos
src/ollama.ts                ensureModel(): pulls the Ollama model if missing (play in place)
src/world.ts                 shared toy engine: notable for containing no LLM
demos/deck, fences, judge    three demos; deck and judge replay fixtures/<name>.json unless --live
drafts/                      gitignored, local only: where the post drafts are written
PATTERNS.md                  reader's field guide, evidence-labelled
.claude/skills/small-model-prompt-review/   reader-facing review skill; test/ runs it headlessly against planted fixtures
.claude/skills/pin-the-fix/                 writes an ast-grep fence + rule test for a guard line (PATTERNS entry 9); test/ runs it and mutates the fixture
```

## Commands

```bash
npm run report                              # no model needed
npm run measure                             # every test; OLLAMA_MODEL=... for another model
npx tsx measure/faithful.ts --parrot        # re-run only the copied-example test (writes parrot-<model>.json, which the report prefers)
npm run demo:judge -- --live --record       # refresh a demo's recording
npm run typecheck
npx ast-grep scan                           # the fences demo's rules; 0 = clean
npm run test:skill                          # the review skill vs planted fixtures (needs the Claude Code CLI; a few model calls)
npm run test:pin                            # the pin-the-fix skill: writes a fence in a scratch copy, then mutates the file to check it
```

When editing the review skill's `SKILL.md`, keep the `No findings.` first-line contract and re-run `npm run test:skill`. If you add a check to the skill, plant an instance of it in `test/fixtures/judge-prompt.ts` and an entry in `test/expected.json`. When editing the pin-the-fix skill, keep the `Pinned: <id>` first-line contract and re-run `npm run test:pin`; a new kind of fence gets a case in its `test/expected.json` with mutations that must fire and ones that must stay quiet.

Result files are named by model. The saved Gemma 4 E4B runs record `backend: falcon` inside the JSON (a hosted copy of the same model); the documented way to reproduce them is `gemma4:e4b` through Ollama, and reader-facing docs don't mention any other route. The temperature check (`TEMPERATURE=0.1 npx tsx measure/faithful.ts`) writes to `measure/results/faithful/temperature/` so it doesn't show up as a fourth model in the report.

Don't call Gemma 4 E4B "the production model". The prompts were built and tested on small local models, ending on E4B; production runs on hosted services (which one is not disclosed in the posts).

`npm run demo:fences` mutates `demos/fences/guarded/rounds.ts` and restores it in a `finally`. If a run is killed mid-way, check that file against git.

Don't run two model jobs at once against the same Ollama box. It serves one request at a time, and a second job skews the first one's timings.

## Blog writing (the posts, drafted locally in drafts/, not in the repo)

- Readers have no NextOath context. Use no internal names (lanes, `aLayer`, etc.), one board, and plain examples.
- Every pattern follows the same arc: the problem, the target (in plain probability), where it landed, what changed, how close it got. Use an ASCII chart when it makes the gap visible.
- Useful patterns, not stories about bugs.
- Voice: the author's, first person, short paragraphs, honest about trade-offs. It ends with the changelog/support footer.
- Quote model output only verbatim, from the saved replies.
