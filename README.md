# llm-on-a-leash

**Constraint-first patterns for LLM games — learned the hard way on 8B models.**

Most LLM games are a retrieval layer wrapped around a storytelling engine. The
model *is* the game: it narrates, it adjudicates, it decides what happened.
That works, and when it works it is magical. But it means hallucination is a
content problem you fight with better retrieval, and cost scales with ambition.

I took the other tack. In [NextOath](https://nextoath.com), a deterministic
engine owns **every** piece of mechanical truth — the board, the resolution,
the score, who won. The LLM owns the fiction and nothing else. Not by polite
instruction ("please don't change the score") but *structurally*: the
resolution prompt has no field in which a board change could be expressed, and
it never sees a number it could anchor on.

This repo is the patterns that fell out of that decision, each one a small
runnable demo.

**This may not be what players want.** A tightly-leashed model writes less
surprising stories than an unleashed one. That is a real cost and I am not
going to pretend otherwise. But it bought determinism, replayability, a
tutorial that can't go off the rails, and a cost profile that survives contact
with a hobby budget. If you're building something where the rules have to
actually be rules, the trade may be worth it for you too.

---

## Run it

```bash
npm install
npm run demo:deck        # or: demo:classify, demo:coerce, demo:fences
npm run demo:all
```

**Everything runs with no API key.** Each demo ships a mock client with real
small-model failures recorded from production — a parroted `"yes/no"`, an enum
value with the prompt hint glued to it, a classification collapsed to 0%. You
see the failure and the fix without spending a token.

Set a key and pass `--live` to run the same demo against a real model:

```bash
GOOGLE_GENERATIVE_AI_API_KEY=... npm run demo:classify -- --live
```

---

## The four patterns

### 1. [Deal from a deck, don't ask for variety](demos/01-deck) 🃏

Ask a model for "a creative question about this world" twenty times and you get
governance, religion, governance, warfare, religion. Mode collapse isn't a
prompting failure you can flatter your way out of.

So don't ask. Hash the game id, Fisher-Yates a deck of twenty domains, and deal
card *n* for question *n*. Variety is guaranteed by construction, the sequence
is reproducible from the seed, and a game can't repeat a topic until it has
used all twenty.

### 2. [Stop asking small models to classify](demos/02-classify) 🎯

A three-way `mode` enum in the judge collapsed to **0% capture**. A two-way
`lane` enum collapsed to **100% one side**. Prompt-tweaking didn't move it.

The fix was to stop asking the model to *classify* and ask it several
independent questions it is actually good at — "does this land as a capture?",
"is this indirect?" — then derive the category server-side from those booleans.
Models are bad at picking one of N. They are good at emotional plausibility.

### 3. [Coerce, never reject](demos/03-coerce) 🩹

A validator on an LLM output field that throws on a plausible near-miss is a
bug. It forces a retry, and the retry costs more tokens than the leniency saved.

`"equilibrium (1:1 — equal)"` should parse as `equilibrium`. A blank string
should become the safe default, not an exception.

**With one caveat that took an incident to learn:** coercion that *invents*
state is worse than rejection. One field in the resolver deliberately opts out
of the lenient parser, because coercing an unrecognized event kind would
resurrect an event the model meant to drop. Leniency is a per-field decision,
not a policy.

And if your coercer can never fail, **log the fallback** — otherwise a field
that is 100% fallback looks perfectly healthy. That blind spot is exactly how
the 0%-capture collapse went unnoticed.

### 5. [Fuzzy judging — what the leash buys you](demos/05-judge) ⚖️

The other four patterns are defensive. This is the payoff.

Games have always adjudicated the **measurable**: did the unit reach the
tile, was the card legal, is the number bigger. Anything fuzzy had to be
pre-authored or thrown away — so "was that a clever plan?" stopped being a
question games asked.

A model can answer it. Fuzzily, with real failure modes, but fuzzily is
enough **because the engine still owns the consequence**. The judge emits a
word; the engine decides what that word is worth.

Two modes that fail differently: **isolated** grading is stable and
comparable across a game but compresses toward the mean (2 distinct grades
across 4 plans); **head-to-head** discriminates much more sharply (3 tiers
from the same 4) but is order-sensitive and not reliably transitive. The
demo asks every pair in both orders and shows the flips.

### 4. [Pin the fix](demos/04-fences) 📌

You fix a subtle race. Six months later someone refactors and the guard clause
quietly disappears. Tests catch behavior; nothing catches *"someone deleted the
line."*

So assert the line still exists. These are `ast-grep` rules that fail the build
when a specific guard goes missing — including the inverted form, where the
rule matches a file that *doesn't* contain what it must.

---

## What the demos actually print

Measured, not asserted — these are the numbers `npm run demo:all` produces
on the recorded 8B output:

| Demo | Before | After |
|---|---|---|
| 01 deck | top 2 topics = **65%** of draws, 5 distinct | **10%**, 20 distinct |
| 02 classify | mode **100/0/0**, lane **100/0** | mode 13/38/38, lane 38/63 |
| 03 coerce | strict schema rejects **7 of 8** near-misses | lenient rejects **0 of 8** |
| 04 fences | — | **6/6** mutations classified correctly |
| 05 judge | isolated: **2** distinct grades / 4 plans | head-to-head: **3** tiers, with order-bias flips surfaced |

Demo 02 is the one to be careful with. Run it `--live` on gemma4:e2b and the
*lane* enum still collapses to a perfect 100%/0%, exactly as production did —
but the *mode* enum often spreads on its own and does **not** reproduce the
0%-capture result. The demo measures this per run and says so.

That is the honest lesson, and it is narrower than "enums collapse":
**collapse is per-model and per-field, and you cannot predict which fields
will go.** Deriving the taxonomy server-side removes the question instead of
answering it.

---

## About the numbers

Every measurement here was taken against **8B-class and smaller models**.
The production tuning target was `gemma4:e4b` (via a self-hosted OpenWebUI
endpoint); the recorded demo output and the `--live` checks come from a local
Ollama box.

Models this work was developed and sanity-checked against, at various points:

| Model | Role in this work |
|---|---|
| `gemma4:e4b` | the production tuning target — the narrative-length and anti-parroting rules are tuned to it |
| `gemma4:e2b` | local stand-in; the `--live` numbers in demo 01/02 are from this |
| `llama3.1:8b` | the recorded distributions in demo 01 and 02 |
| `llama3.2` | earlier dev passes |
| `dolphin3:8b` | uncensored-ish cross-check — useful for seeing whether a refusal was safety or confusion |
| `nous-hermes2` | instruction-following cross-check on JSON adherence |
| `qwen3:8b` | the reason `promptBlocks` exists — bilingual models need an explicit "Respond in English." line injected above the JSON rule |
| `deepseek-r1:8b` | reasoning-model cross-check; thinking output competes with the visible-token budget |

They do **not** all fail the same way, which is the most useful thing I can
tell you. `qwen3` drifts language. `deepseek-r1` spends its output budget
thinking. `gemma4` parrots format examples. `llama3.1` collapses toward a few
favourite answers. A pattern that fixes one may be irrelevant to another —
which is the argument for structural constraints over per-model prompt tuning.

Other caveats that matter:

- Several of these failure modes are **much weaker on frontier models**.
  Boolean parroting in particular mostly disappears on Gemini 2.5-flash and
  above.
- A few are **provider-side and stochastic** — Gemini's constrained decoding
  running away to `MAX_TOKENS` hit ~21% of calls on one prompt and 0% on the
  next, with no code change.
- "Small model" is a moving target. What needed this scaffolding in 2026 may
  not in 2027.

Constraint-first design is itself partly a small-model adaptation: when the
model is cheap and unreliable, you give it less to be wrong about. Read these
as *engineering for the cheap tier*, not as universal law.

The production numbers cited in the demos (`0%` capture, `94% → 0%`
over-long list items, `33% → 0%` filler openings, `3.5–6×` cost regression from
a *cheaper* model) come from A/B harnesses run against real game fixtures.
Where a demo can't honestly reproduce a production figure with a toy prompt, it
says so and replays the recorded result instead of faking one.

---

## This is one person's answer, not a standard

Everything here is **how I handled it**, measured on one game and mostly on
8B-class models. Some of it is probably not the best available approach —
it is the best I found, which is a different claim.

**If you have a pattern you like better, tell me.** Open an issue or a PR.
A crude measurement ("I ran 20 calls each on `<model>` and got X vs Y")
beats any amount of argument, including mine. Alternatives get added
*alongside* the original with attribution and both sets of numbers, not
swapped in silently — a demo showing two approaches and an honest "these
are close, pick by taste" is a better artifact than one that pretends a
winner exists.

[CONTRIBUTING.md](CONTRIBUTING.md) has my own list of what is most likely
wrong in here, which is a cheaper starting point than guessing.

## License

MIT — see [LICENSE](LICENSE).
