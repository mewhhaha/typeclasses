# AGENTS.md

## Goal

Keep this repository as a small, inspectable playground for pseudo traits in
TypeScript/Deno.

The examples mirror the pattern described in `../binned/AGENTS.md`:

- Define a data type and an empty function with the same exported name.
- Attach trait methods directly to the function.
- Place `satisfies` checks next to the implementation.
- Use tests and examples to make the trait behavior obvious.

## Scope

This repo is for experimenting with functional programming traits:

- `Functor`: map values inside a context.
- `Applicative`: lift values and apply contextual functions.
- `Monad`: chain context-dependent computations.
- `Foldable`: reduce contextual values into a summary.
- `Format` and `Equal`: small utility traits used by examples and tests.

Prefer simple examples over a full library. If a change needs advanced type
machinery, add it only when it improves the examples.

## Style

- Keep trait definitions in `src/trait.ts`.
- Keep each data type and its trait implementations in one file.
- Keep `satisfies` checks in the implementation file, not in tests.
- Prefer explicit `if` blocks when a branch matters.
- Do not add external dependencies unless an experiment needs them.

## Verification

Run:

```sh
deno test
deno check src/mod.ts src/*.test.ts examples/main.ts
```
