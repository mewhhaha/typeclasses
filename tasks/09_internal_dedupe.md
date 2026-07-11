# 09 — Deduplicate per-type runtime boilerplate

**Impact: Low (internal quality) · Effort: Medium**

Not user-facing, but every pattern below is copy-pasted enough times that the
next data type (or the next contributor) will copy it again. Consolidating
them also shrinks the surface Task 02's derivers have to compete with.

## Duplications found

| Pattern | Copies | Locations |
| --- | --- | --- |
| `same_context<out>(value: unknown): out` cast helper | 3 | `src/maybe.ts:313`, `src/either.ts:399`, `src/validation.ts:417` |
| `append_item(values, item)` array-copy helper | 3 | `src/typeclasses/applicative.ts:226`, `src/list.ts:435`, `src/array.ts:311` |
| hand-unrolled `lift_*` arity ladders (0/1/2/3/many) for `applicative_lift_method` | 5 | `lift_just` (maybe), `lift_right` (either), `lift_validation_*` (validation), `lift_list_*` (list), `lift_array_*` (array) |
| `is_X_value` kind guards (`typeof`+null+`[kind]===`) | 4–5 | `reader.ts:109`, `state.ts:112`, `writer.ts:149`, `task.ts:77` (+ Maybe's singleton variant) |
| `run_*` effect-interpreter loop (`switch current[0]; case "impure": if lift-of-mine … else re-suspend`) | 4 | `run_reader` (`reader.ts:71-107`), `run_state` (`state.ts:70-110`), `run_writer` (`writer.ts:99-147`), `run_task` (`task.ts:47-75`) |
| `withX` configured-dictionary re-tagging (`data<…>()` + `Object.defineProperty` + cast) | 5 | `Either.withLeft`, `Validation.withError`, `Tuple.withLeft`, `Fn.withInput`, `Writer.with` |

## Proposals

1. **`same_context` / `append_item`** → move to a small internal
   `src/internal.ts` (not exported from `mod.ts`). Mechanical.
2. **The interpreter loop**: `src/effects.ts` already exports `handle_lift`
   (`effects.ts:566-609`) which is exactly this loop parameterized by a
   `LiftHandler`. `run_reader`/`run_state`/`run_writer` look like they predate
   it. Port them onto `handle_lift` (state = environment/state/output
   respectively; `run_task`'s async loop stays bespoke). Should delete
   ~120 lines and one class of subtle drift.
3. **Kind guards**: export an internal
   `is_kind_of<dictionary>(value, dictionary): value is Data<dictionary, unknown>`
   built on the existing `kind` symbol; each module keeps a one-line alias if
   the local name aids readability.
4. **`lift_*` ladders**: keep them — they are deliberate per-type
   optimizations (the whole point of `applicative_lift_method`). But extract
   the *shape* into a shared skeleton if two more types grow one, and add a
   comment in each pointing at `applicative_lift` fallback so readers know
   they can delete the ladder without losing correctness.
5. **`withX` re-tagging**: extract a helper
   `configured_dictionary<base, configured>(base, extension)` capturing the
   `Object.defineProperty` + cast dance, since Task 07 proposes two more of
   these (`Maybe.withSemigroup`, `Tuple.withMonoid`).

## Constraints

- No public API change; `deno task publish:dry-run` must stay clean (internal
  module must not need export-safe annotations if it isn't exported).
- Benchmarks in `bench/performance_breakdown.bench.ts` and
  `bench/effect_program_vs_bind.bench.ts` before/after — the interpreter-loop
  port (item 2) is the only one with plausible perf impact; verify
  `handle_lift` doesn't regress vs the hand-rolled loops before deleting them.

## Acceptance criteria

- `grep -rn "function same_context" src/ | wc -l` → 1.
- reader/state/writer interpreters implemented via `handle_lift` with
  unchanged test results.
- Bench deltas within noise, recorded in the PR description.
