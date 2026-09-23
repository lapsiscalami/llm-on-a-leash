# CLAUDE.md

Guidance for Claude Code (claude.ai/code) working in this repository.

## What this repo is

Companion code for a series of posts about running LLM games on **small
models**. Each demo is a self-contained, runnable argument: it prints a
before/after measurement, not a claim.

It is **not** a library. Nobody should `npm install` this. The code exists to
be read alongside a blog post and copied selectively.

## The thesis (do not dilute it)

A deterministic engine owns **all** mechanical truth — board, resolution,
score, who won. The LLM owns fiction and nothing else. Not by polite
instruction, but structurally: the prompt has no field in which a board
change could be expressed, and it never sees a number it could anchor on.

Every demo should visibly serve that thesis. If a change makes a demo more
impressive but less honest about the thesis, it is the wrong change.

## Hard rules

1. **Never assert a number the demo does not print.** If a demo claims
   "65% → 10%", running it must produce those figures. An earlier draft
   claimed the quality-veto fired when no recorded row triggered it — that
   is the failure mode to avoid.
2. **Every demo runs with no API key.** Mock is the default. `--live` is
   opt-in. A reader with nothing installed must still see the lesson.
3. **`--live` may disagree with the recorded run — say so, don't hide it.**
   Demo 02 already does this: on gemma4:e2b the 2-way lane enum collapses
   exactly as production did, the 3-way mode enum often does not. Demos
   should *measure* and report, not assert a fixed story.
4. **Scope claims to model tier.** These are small-model findings. Several
   effects weaken or vanish on frontier models. Never imply universality.
5. **Recorded data is labelled recorded.** If a sample is *chosen* to
   exercise a path rather than captured verbatim, say so in a comment.
6. **No dependencies beyond zod, tsx, typescript, @ast-grep/cli.** A reader
   should be able to audit the whole repo in one sitting.

## Layout

```
src/world.ts        shared toy engine — NOTABLE FOR CONTAINING NO LLM
src/llm.ts          mock (default) + Ollama/Google live clients
demos/0N-*/run.ts   one runnable argument each
demos/04-fences/    also holds real ast-grep rules + a guarded source file
sgconfig.yml        points ast-grep at demos/04-fences/rules
```

## Commands

```bash
npm run demo:all                       # all four, recorded output
npm run demo:classify -- --live        # against a real model
OLLAMA_MODEL=llama3.1:8b npm run demo:classify -- --live
npm run typecheck
npx ast-grep scan                      # demo 04's fences; 0 = clean
```

`npm run demo:fences` mutates `demos/04-fences/guarded/rounds.ts` and restores
it in a `finally`. If a run is killed mid-way, check that file against git.

## Writing style for demo output

Console output is the artifact people screenshot. Keep it scannable: aligned
columns, a bar chart where a distribution is the point, and a short prose
block at the end naming the lesson. Avoid emoji in demo output (they break
column alignment in terminals); the README may use them.

## Known-fragile

- `src/llm.ts` `extractJson` is deliberately crude — small models wrap JSON in
  prose and backticks. Do not "improve" it into a full parser; its crudeness
  is part of what demo 03 is about.
- Demo 04 shells out to `npx ast-grep`. On a cold cache the first scan is slow.
- Recorded distributions were captured on `llama3.1:8b` and `gemma4:e2b`. If
  you re-record, update the numbers in README **and** in the demo's own prose.

## Tone

The repo invites disagreement on purpose (see CONTRIBUTING.md). When editing
prose, preserve that: "this is how I handled it, show me better" rather than
"this is the way". Claims carry numbers or they get softened.
