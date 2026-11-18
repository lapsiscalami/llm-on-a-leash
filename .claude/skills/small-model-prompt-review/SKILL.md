---
name: small-model-prompt-review
description: Review an LLM prompt and the code that parses its reply for the failure modes of small models (parroted format examples, collapsed choices, clustered numbers, brittle parsing, runaway length, the model deciding things code should decide). Use when writing or editing a prompt meant to run on a small or cheap model, when a prompt's output looks samey or keeps failing validation, or before switching a prompt to a smaller model.
allowed-tools: Read, Grep, Glob
---

# Small-model prompt review

Review the prompt named in `$ARGUMENTS`, or ask which one. Read three things together: the **prompt text**, the **format example** it shows the model, and the **code that parses the reply**. Most small-model bugs live in the gap between those three.

The patterns come from `PATTERNS.md` in the llm-on-a-leash repo. Each finding below says how much evidence backs it, so the user can weigh it.

## What to check

### 1. Authority: is the model deciding something code should?
- Does any output field directly set state that must be consistent: a score, a winner, an inventory, a database value?
- If yes, recommend the model return a bounded **word** that code maps to the outcome, or have code decide and the model only narrate.
- *Design principle. Flag it clearly; it's the most expensive thing to get wrong.*

### 2. Format example: does it show values or describe them? *(most common bug)*
Flag each of these in the example the model sees:
- **Concrete values in slots:** `"sentiment": "positive"`, `"ontopic": false`, `"score": 7`. Flag them as a *possible* source of copying, not a certain one. Suggest descriptions in their place (`"One of: positive, negative"`, `"yes/no — does it try to answer?"`) and say to test the change on the model in use, with weak inputs as well as strong ones. *Reproduced here, and mixed: with every criterion shown as `false`, Gemma 4 E2B scored 7 of 10 strong answers ≥4/5; described, 9 of 10. Gemma 4 E4B didn't copy (10 → 10); Llama 3.1 didn't change (7 → 7). Describing didn't loosen the judge: no weak answer scored ≥4 on any model, before or after.*
- **Any instruction to answer "true or false"**, in the system or user text, whatever the slots show. Quote the line. Ask for "yes" or "no" instead; small models parrot `false` from an example and a "true/false" instruction reinforces it.
- **Choices without the `One of:` prefix.**
- **Real input data pasted into the example** (names, items, numbers from this request).
- **Structural punctuation inside description strings** (`+`, `/`, `|`, `→`). The model copies it.
- **Array length:** count the example's array entries. The model will return about that many. Does it match what's wanted?
- **A copied real answer.** A format example that contains a real question or answer ("How do the factions handle resource scarcity?") gets echoed. Replace it with a description of what to write.

### 3. Choices: will the model spread out, or collapse?
- **"Pick something new / be creative / vary":** the model will collapse onto a few favourites. Recommend dealing from a seeded shuffled list in code. *Reproduced here on three models: topics used across 40 questions went 9 → 14, 8 → 13, 8 → 16 (target ~17 of 20); games repeating a topic 5 → 1, 11 → 2, 6 → 0.*
- **"Pick one of N" classifications:** these can collapse onto one option on some models. Suggest the user **measure** the spread on their model before changing anything. Yes/no decomposition is *not* a proven fix: it lifted one model, hurt another, and made a third collapse outright.

### 4. Numbers: is the model asked for a float or a score?
- Flag numeric output fields where the model is being *creative* (amounts, weights, intensities). Recommend a few words mapped to ranges in code. *Reproduced here: right level, numbers → words, 10 → 17 (Gemma 4 E2B), 10 → 15 (Llama 3.1), 13 → 13 (Gemma 4 E4B): a clear gain on smaller models, insurance on larger ones.*
- Leave alone numbers the model only echoes (ids, counts it was given).
- Also flag numbers *given to* the model as scores ("intensity 4/5"). Suggest a word ("dire").

### 5. Parsing: will an almost-right answer be thrown away?
Read the parser:
- **Exact-match enums or strict booleans** reject `"yes — because…"`, `"Good."`, `"good (solid)"`. Recommend case-insensitive whole-first-word matching, not "starts with" (which turns `"goodness"` into `"good"`).
- **Strict number types** reject `"0.3"`. Recommend reading the number out of the text.
- **Required fields that are really optional:** small models omit them. Default them or derive them.
- **Silent fallback:** if the parser can never fail, is every fallback **logged**? If not, flag it. A field that always falls back looks healthy.
- **Optional events or actions:** does an unrecognised value get rounded to a real one? If absence means "nothing happens", it should drop instead.
- *Reproduced here: on Gemma 4 E4B, a strict check kept 220 of 260 yes/no and pick-one answers; forgiving kept 260. All 40 rescued answers were "yes — <reason>" or "no — <reason>". The smaller models didn't do this, and a later E4B run didn't either: the habit comes and goes, which is why the parser should be forgiving by default.*

### 6. Chaining: is one call's output handed to another as a default?
- Flag prompts that inject a previous model call's guess ("the validator thinks X — use it unless clearly wrong"). Recommend each call work from the original input instead.
- *Reproduced here, and small: the same 30 plans judged with and without an upstream guess moved toward the guess vs away 1 vs 0 (Gemma 4 E2B), 3 vs 0 (Gemma 4 E4B), 1 vs 1 (Llama 3.1). One direction on both Gemmas, not firm at 30 plans. When the guess was wrong the judge went with it 5 of 5, 3 of 4 and 3 of 8 times, but the judge alone misread most of those plans the same way. Recommend the fix as design hygiene: the measured pull is real in direction but modest.*

### 7. Temperature: is it set per prompt and per model?
- Flag one global temperature across prompts, or one value copied across models. Recommend a level per prompt (logic / balanced / creative) mapped to a number per model, and check the model maker's recommendation (Google recommends 1.0 for Gemma 4). Present this as configuration hygiene, not a measured gain.
- *Reproduced here on Gemma 4 E4B, no clear gap: the pre-fix judge caught 6 of 10 "take from an enemy" plans at 0.1 and 5 of 10 at 1.0, and the fixed judge went 21 vs 23 of 30 the other way. Recommend the per-model table because makers' recommendations differ, not because cooler measured better.*

### 8. Length: is prose capped from above?
- Prose fields with no cap: recommend "up to ~N words". Flag ranges ("150–300 words"); small models ignore floors.
- List-of-prose fields with no per-item cap: recommend "each ≤N words".
- Narratives with no opening instruction: suggest "Open with a zinger of what happened."
- Length limits stated in several places: recommend one place.
- *Measured in NextOath, not reproduced here: over-long list items 94% → 0%, filler openings 33% → 0%.*

## Output

A short report with:

1. **Findings, most expensive first.** For each: the line or field (name the field exactly as it appears), what will go wrong, the fix, and the evidence level (reproduced here / measured in NextOath, not reproduced here / experience).
2. **What to measure.** The one or two numbers that would show whether the fixes worked on *their* model (for example "distinct choices across 40 calls", "replies a strict parser rejects").
3. Nothing else. Don't rewrite the whole prompt unless asked. Suggest the smallest change that fixes each finding. When a fix is a one- or two-line guard in the parser, add that it can be pinned with the `pin-the-fix` skill (guide entry 9) so a refactor can't delete it.

If nothing needs fixing, the first line of the report is exactly `No findings.` and the rest says, briefly, what the prompt already does right.

Be explicit that small models differ. A fix proven on one model is a hypothesis on another.

## Testing this skill

`npm run test:skill` (from the repo root) runs the skill for real against `test/fixtures/`: one prompt with every failure mode planted, one that follows every pattern. It checks the report names each planted line and that the clean prompt gets `No findings.` See `test/run.ts`.
