# AGENTS.md

## Goal

Keep this repository as a small, inspectable library for Haskell-style
typeclasses in TypeScript/Deno.

The core pattern is:

- Define a data type and an `As...` dictionary interface with the same raw value
  shape expressed through `type_item` and `type_data`.
- Export a same-named callable dictionary with `data<As...>()`.
- Attach typeclass methods directly to the callable dictionary.
- Use tests and examples to make the typeclass behavior obvious.

## Scope

This repo provides functional programming typeclasses:

- `Functor`: map values inside a context.
- `Applicative`: lift values and apply contextual functions.
- `Monad`: chain context-dependent computations.
- `Foldable`: reduce contextual values into a summary.
- `Show` and `Eq`: small utility typeclasses used by examples and tests.

Prefer simple, inspectable library code. If a change needs advanced type
machinery, add it only when it improves the public API or examples.

## Style

- Keep core typeclass machinery in `src/typeclass.ts`.
- Keep application/sublibrary typeclass definitions in `src/typeclasses.ts`.
- Keep each data type and its typeclass instances in one file.
- Keep the `As...` dictionary interface next to the data type and its
  `data<As...>()` export.
- Prefer `switch` statements, then the tagged `match` helper, then explicit `if`
  statements for branching. For tuple-tagged values, typically deconstruct the
  value with `const [tag, payload] = value` and switch on `tag`.
- Do not add external dependencies unless a feature, benchmark, or case study
  needs them.

## Verification

Run:

```sh
deno task check
deno lint
deno test
```
