---
name: pin-the-fix
description: Pin a bug fix so a later refactor can't silently delete it. Writes an ast-grep rule that fails the build when a specific guard line goes missing (or a forbidden line appears), writes the rule test that proves the fence fires, and runs both. Use right after fixing a subtle bug with one or two lines (a race guard, an idempotency check, a deliberate absence), or when asked to "pin", "fence" or "protect" a line.
allowed-tools: Read, Grep, Glob, Write, Edit, Bash(npx ast-grep:*), Bash(git diff:*)
---

# Pin the fix

A test proves a guard **works**. Nothing proves it **exists**. Six months on, someone tidies the function and the one line that mattered goes with it, because nothing about it looks important. A fence is an [ast-grep](https://ast-grep.github.io/) rule that fails the build when that line is missing. It doesn't reproduce the bug; it asserts the fix is still in the file.

You write two files and run two commands. The fence is not done until both commands pass.

## 1. Find the line

`$ARGUMENTS` names it: a `path:line`, a `path` plus a function name, or a sentence ("resolveCombat must never call Math.random()"). With no argument, run `git diff` and look for a newly added guard. If it's still unclear, ask.

Decide which kind of fence it is:

- **Must stay** (presence). A line that has to be there: an early return, an idempotency check, a lookup before an insert.
- **Must never appear** (absence). A line that must not land in a function: a deadline check in a function that resolves rounds, randomness in a resolver that must replay.

Pin one or two lines, not a whole function. If the "guard" is bigger than that, say so and stop; that's a test's job.

Never edit the guarded file. If the line isn't there yet, the fix hasn't been made.

## 2. Find where rules live

Read `sgconfig.yml` in the project root.

- Rules go in the first entry of `ruleDirs`. If there is no `sgconfig.yml`, create one with `ruleDirs: [rules]`.
- Tests go in a `testConfigs` entry. If it's missing, add it. The file ends up looking like:

```yaml
ruleDirs:
  - rules
testConfigs:
  - testDir: rule-tests
```

If `npx ast-grep --version` fails, tell the user to `npm i -D @ast-grep/cli` and stop.

## 3. Write the rule

One file, `<ruleDir>/<id>.yml`. The id names the function and the guard: `consume-item-destroyed-guard`, `resolve-combat-no-random`.

**Presence** (the line must stay). Find the function by name, require the guard *inside it*, and match the whole file when no such function exists. Don't check the name and the guard as two separate facts about the file: that passes when the guard has migrated to another function.

```yaml
id: consume-item-destroyed-guard
language: TypeScript
severity: error
message: "consumeItem has lost its destroyed-item guard. Restore `if (inv.destroyed.has(id)) return false;` before the count is read."
note: |
  Both the "use item" click and the end-of-turn sweep call consumeItem.
  Without this line a destroyed item is consumed twice and its count goes
  negative (bug #88, 2026-09-01). A unit test proves the guard works;
  only this rule proves it is still in the file.
rule:
  kind: program
  not:
    has:
      stopBy: end
      kind: function_declaration
      all:
        - has:
            field: name
            regex: "^consumeItem$"
        - has:
            stopBy: end
            pattern: if ($INV.destroyed.has($ID)) return false;
files:
  - "src/game.ts"
```

**Absence** (the line must never appear). Match the forbidden code only inside the named function:

```yaml
id: resolve-combat-no-random
language: TypeScript
severity: error
message: "resolveCombat must stay deterministic. Remove the Math.random() call."
note: |
  The outcome must be reproducible from the board so replays and disputes
  agree. Randomness here makes two replays of the same game disagree.
rule:
  pattern: Math.random()
  inside:
    stopBy: end
    kind: function_declaration
    has:
      field: name
      regex: "^resolveCombat$"
files:
  - "src/game.ts"
```

Rules for the rule:

- **`pattern` for the guard, never `regex`.** A pattern reads the syntax tree, so a comment that quotes the guard can't satisfy a presence rule, and a comment that mentions the forbidden call can't trip an absence rule. Use `regex` only for the function name. Metavariables: `$X` matches one node, `$$$` matches many.
- **Pin the semantics, not the spelling.** `if ($INV.destroyed.has($ID)) return false;` still matches after a rename of `inv`, but not after `return false` becomes `return true`. That's the point.
- **`kind` names how the function is declared.** `function_declaration` for `function f() {}`, `method_definition` for a class method, `variable_declarator` for `const f = () => {}`. Both examples assume the first; check the real line.
- **`files:` names the one file.** A fence is local. Widen it only if the user asks.
- **`language`** is `TypeScript` for `.ts` and `Tsx` for `.tsx`; they use different parsers, so a `.tsx` file needs its own rule.
- **`severity: error`** so `ast-grep scan` exits non-zero.
- **`message`** says what to restore or remove, with the exact line. **`note`** says which bug this prevents, when it bit, and why a test alone isn't enough. Ask the user for the bug if you don't know it; don't invent one.

## 4. Write the test

One file, `rule-tests/<id>-test.yml`, with the same `id`. Each case is a whole snippet of code. `valid` cases must not fire; `invalid` cases must.

For a **presence** rule:

```yaml
id: consume-item-destroyed-guard
valid:
  - |                                  # the function as it is today
    export function consumeItem(inv: Inventory, id: string): boolean {
      if (inv.destroyed.has(id)) return false;
      return true;
    }
  - |                                  # comment edited, guard reformatted
    export function consumeItem(inv: Inventory, id: string): boolean {
      // GUARD (see issue #88)
      if (inv.destroyed.has(id))
        return false;
      return true;
    }
invalid:
  - |                                  # guard deleted
    export function consumeItem(inv: Inventory, id: string): boolean {
      return true;
    }
  - |                                  # guard weakened
    export function consumeItem(inv: Inventory, id: string): boolean {
      if (inv.destroyed.has(id)) return true;
      return true;
    }
  - |                                  # guard only in a comment
    // was: if (inv.destroyed.has(id)) return false;
    export function consumeItem(inv: Inventory, id: string): boolean {
      return true;
    }
  - |                                  # function renamed away
    export function useItem(inv: Inventory, id: string): boolean {
      if (inv.destroyed.has(id)) return false;
      return true;
    }
  - |                                  # guard moved to another function
    export function consumeItem(inv: Inventory, id: string): boolean {
      return true;
    }
    export function canConsume(inv: Inventory, id: string): boolean {
      if (inv.destroyed.has(id)) return false;
      return true;
    }
```

For an **absence** rule: `valid` has the function as it is, a comment that names the forbidden call, and the forbidden call in a *different* function. `invalid` has the call inside the function.

Copy the real function into the "as it is today" case. Don't shorten it into something the rule matches more easily.

## 5. Run both

```bash
npx ast-grep test --skip-snapshot-tests    # every valid case quiet, every invalid case fires
npx ast-grep scan                          # the real file, as it is now, is clean
```

`--skip-snapshot-tests` matters: without it ast-grep wants a snapshot file per invalid case, which is noise here.

If the test fails, fix the rule. Never delete or weaken a case to make it pass. If `scan` fires on the current file, your pattern doesn't match the real line; re-read the line and fix the pattern.

When both pass, write nothing about it: no "Both pass.", no "both green", no "5 cases pass, scan clean", not even one word. The report below is the only output after the commands, and its first line is what says they passed.

## 6. Report

The very first line of your reply is `Pinned: <id>`, with nothing before it: no "Both pass.", no "Done.", no "report follows", no heading. That line *is* the statement that both commands passed; anything written above it breaks the tools that read the first line, including this skill's own test harness. Then, briefly:

- the two file paths
- what the fence catches (deletion, weakening, the guard moving to another function) and what it stays quiet on (comments, formatting)
- that renaming the function also trips it, on purpose: the rule is keyed to the name, so a rename means updating the rule deliberately rather than the fence going silent
- if `npx ast-grep scan` isn't already in the project's pre-commit or CI, one line saying to add it

Don't paste the files back; the user has them. If you stopped at step 1 because the guard is too big to pin, the first line is `Not pinned.` and one sentence says why.

## Testing this skill

`npm run test:pin` (from the repo root) runs the skill for real against `test/fixtures/game.ts` in a scratch project under `tmp/`: once to pin a guard that must stay, once to pin a call that must never appear. It then checks, independently of the test file the skill wrote, that `ast-grep test` passes, that `scan` is clean, and that each mutation from `test/expected.json` fires or stays quiet as expected. See `test/run.ts`.
