# Security policy

This is companion code for two blog posts, not a maintained product. Still, two parts of it run on your machine with real access, so please report security problems privately.

## What's in scope

- **The Claude Code skills** in `.claude/skills/`. Readers copy them into their own repos; `pin-the-fix` writes files and runs commands.
- **The scripts and demos**: `measure/`, `demos/`, and `src/` (including `ensureModel()`, which pulls models through Ollama).

Out of scope: the models themselves, Ollama, and the NextOath game.

## How to report

Use GitHub's private vulnerability reporting: [Report a vulnerability](https://github.com/lapsiscalami/llm-on-a-leash/security/advisories/new). Please don't open a public issue.

Include what's affected, how to reproduce it, and what an attacker could do with it.

## What to expect

I'll read every report, but I can't promise a response time or a fix date. Confirmed problems get fixed on `master` (there are no release branches), and I'll credit you unless you'd rather I didn't.
