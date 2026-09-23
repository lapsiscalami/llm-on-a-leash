# Got a better pattern?

Everything in this repo is **one person's answer**, measured on one game and
mostly on 8B-class models. It is not a standard, and several of these
patterns almost certainly have better versions that I have not thought of.

If you have one, I genuinely want it.

## What is most likely wrong here

I will start the list, because it is cheap for me to be honest and expensive
for you to guess what I already know:

- **Demo 02's decomposition may be over-engineering.** Asking three booleans
  instead of one enum costs tokens and adds a server-side table. A
  well-constructed single enum with a good format example might get 80% of
  the benefit. I did not test that carefully — I found the collapse, tried
  decomposition, it worked, and I shipped it.
- **The deck (demo 01) trades variety for authorial control.** Dealing
  topics means the model cannot follow an interesting thread the players
  opened up. That is a real cost and some games would be worse for it.
- **"Coerce, never reject" (demo 03) can hide a broken prompt** — which is
  exactly why demo 03 also logs every fallback. I still think the default is
  right; I am less sure the threshold for "this field is now a constant"
  should be a human reading logs rather than an assertion.
- **The whole thesis may be wrong for your game.** If your product IS the
  storytelling, leashing the model this hard will make it worse. I built a
  strategy game where the rules have to be rules. Weigh accordingly.

## How to propose something

Open an issue or a PR. What helps most, in order:

1. **A measurement.** Even a crude one. "I ran 20 calls of each on
   `<model>` and got X vs Y" beats any amount of argument, including mine.
2. **A demo that runs.** If it slots into `demos/` and prints a before/after
   distribution like the others, I will take it seriously immediately.
3. **A counter-example.** If one of these patterns fails on a model I did
   not test, that is as valuable as a new pattern. I will add it to the
   caveats rather than quietly dropping it.

Alternatives get added alongside the original, not instead of it — with
attribution and with whatever numbers we both measured. A demo that shows
two approaches and an honest "these are close, pick by taste" is a better
artifact than one that pretends a winner exists.

## What I will push back on

- Claims with no numbers behind them, mine included.
- "Just use a bigger model" — true, often correct, and not what this repo
  is about.
- Patterns that make the demo longer without making the lesson clearer.

## Running the demos

```bash
npm install
npm run demo:all                      # recorded output, no API key
npm run demo:classify -- --live       # your own model
OLLAMA_MODEL=llama3.1:8b npm run demo:classify -- --live
```
