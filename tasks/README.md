# Ergonomics & Haskell-likeness Improvement Tasks

A review of the library (core machinery in `src/typeclass.ts` / `src/data_value.ts`,
the typeclass definitions, the data types, the prelude, the runtime `Do`, the
`Effect`/`Program` system, and the source transformer in
`tools/transform_do_program.ts`) with concrete, independently-shippable tasks.

Three of the proposals were prototyped against the real machinery in
[`experiments/`](./experiments/) — each file typechecks and runs standalone:

| Experiment | Validates | Result |
| --- | --- | --- |
| `experiments/derive_monad.ts` | Task 02: deriving `map`/`ap` from `pure` + `bind` | Works: fluent `map`/`ap`/`bind`, `Applicative.lift`, and `Do` all function on a type that only defined `pure` + `bind`. Caveat: instance methods cannot call `this(...)` — `pure` must close over the constructor. |
| `experiments/fluent_match.ts` | Task 03: fluent exhaustive `.match()` on wrapped values | Works: dictionary-prototype installation dispatches at runtime; `MatchCases` typing is exhaustive (missing case = type error) with payload inference. |
| `experiments/prelude_extensions.ts` | Task 01: missing Haskell prelude functions | All infer cleanly with the dictionary encoding. Finding: `match` cannot be typed over generic `EitherValue<left, right>` because `EitherValue` is a conditional type — fluent `.match` must be typed off `WrappedData`'s raw value parameter. |

## Task index (ordered by impact / effort)

| # | Task | Impact | Effort | Theme |
| --- | --- | --- | --- | --- |
| 01 | [Extend the prelude with the missing Haskell vocabulary](./01_prelude_extensions.md) | High | Low | Haskell-likeness |
| 02 | [Default methods / minimal complete definitions](./02_default_method_derivation.md) | High | Medium | Haskell-likeness, less boilerplate |
| 03 | [Fluent exhaustive `.match()` on wrapped values](./03_fluent_match.md) | High | Medium | Ergonomics |
| 04 | [Transformer: support the explicit-dictionary `Do(dict, gen)` form](./04_transformer_two_arg_do.md) | High | Low | Transformer |
| 05 | [Transformer: widen control-flow coverage (`while`, `for-of`, `try/catch`)](./05_transformer_control_flow.md) | Medium | High | Transformer |
| 06 | [Transformer: safer detection, check mode, and bundler integration](./06_transformer_integration.md) | Medium | Medium | Transformer |
| 07 | [Round out typeclass instance coverage](./07_instance_coverage.md) | Medium | Medium | Haskell-likeness |
| 08 | [Portability: remove `Deno.*` from published library code](./08_show_portability.md) | Medium | Low | Ergonomics (non-Deno users) |
| 09 | [Deduplicate per-type runtime boilerplate](./09_internal_dedupe.md) | Low (internal) | Medium | Maintainability |

## Cross-cutting observations that shaped the tasks

- **The dictionary encoding is sound and pleasant at use sites.** The
  `Data<dictionary, item>` open-HKT encoding survives every generic signature
  the experiments threw at it (`join`, `foldMap` over two dictionaries,
  `apFirst`/`apSecond`) without a single cast at call sites. The improvement
  budget is better spent on vocabulary (Task 01), derivation (Task 02), and
  elimination forms (Task 03) than on re-architecting the encoding.
- **Conditional-type aliases fight inference.** `EitherValue<left, right>`
  (`src/either.ts:54`) is a conditional type; anything generic that wants to
  *destructure* it (like `match`) breaks. New sugar should be typed against
  `WrappedData`'s value parameter, and eliminators for concrete types
  (`fromMaybe`, `either`) should live next to the types themselves (Task 01).
- **The transformer is the library's answer to `do`-notation overhead, so its
  input language should match the documented idioms.** Today it silently skips
  the two-argument `Do` form the README itself requires for yield-free blocks
  (Task 04) and bails on `while`/`for-of`/`try` (Task 05).
- **The runtime `Do` replays generators for multi-shot monads** (List): the
  generator body re-runs from the top per branch, so side effects in a `Do`
  block execute more than once, and replay is O(n²) in yields. This is
  inherent to generator-based do-notation; it should be *documented* loudly
  and is another reason the transformer path deserves investment (Tasks 04–06).

## Suggested sequencing

1. **01 + 08** — pure additions, no breaking changes, immediately visible.
2. **04** — small transformer fix with outsized effect (the documented idiom
   currently doesn't lower).
3. **02 + 03** — the two headline ergonomics features; both prototyped.
4. **07** — instance gaps, one instance per PR.
5. **06, 05, 09** — longer-running infrastructure work.
