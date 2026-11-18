# Got a better pattern?

Everything here was measured on one game and three small models. Several of these patterns probably have better versions.

## What is most likely wrong here

- **The numbers come from three small models and 20–40 items per test.** That's enough to see a clear gap, and too few to trust a one- or two-point difference. Another model may land somewhere quite different, and three models already disagreed on several patterns. That's a reason to run `npm run measure` against yours, not a reason to trust mine.
- **The deck trades variety for control.** Dealing topics means the model can't follow an interesting thread the players opened up. That's a real cost, and some games would be worse for it.
- **A forgiving parser can hide a broken prompt.** That's why every fallback should be logged. I still think forgiving is the right default. I'm less sure that "a human reads the logs" is the right way to notice when a field has become a constant.
- **I cut a pattern that may deserve a better test.** Yes/no questions instead of "pick one" helped one model, hurt another, and made a third collapse (the data is in [`PATTERNS.md`](PATTERNS.md), entry 8). It may matter with real game text or a different model. I couldn't show that, so it isn't in the post.
- **The whole thesis may be wrong for your game.** If your product *is* the storytelling, leashing the model this hard will make it worse. I built a strategy game where the rules have to be rules. Weigh accordingly.

## How to propose something

Open an issue or a PR. What helps most, in order:

1. **A measurement.** Even a rough one. "I ran 40 calls each on `<model>` and got X vs Y" beats any amount of argument, including mine. The easiest route is to add a test to `measure/faithful.ts` or `measure/faithful-post2.ts`, so it calls the model the way the others do and saves its raw replies.
2. **A counter-example.** If one of these patterns fails on a model I didn't test, that's as valuable as a new pattern. I'll add it to the caveats rather than quietly dropping it.
3. **A demo that runs.** It should replay *real* recorded replies (`--live --record`), not hand-written ones.

Alternatives get added alongside the original, not instead of it, with attribution and with whatever numbers we both measured.

## What won't get merged

- Claims with no numbers behind them.
- Hand-written "example" model replies presented as if a model produced them.
- "Just use a bigger model." Often true, and not what this repo is about.

## Running things

```bash
npm install
npm run report                         # the posts' numbers, from saved replies
npm run measure                        # re-run every test (Ollama; downloads the model if needed)
OLLAMA_MODEL=llama3.1:8b npm run measure
npm run demo:judge -- --live           # a demo against your model
```
