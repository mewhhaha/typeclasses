# 07 — Round out typeclass instance coverage

**Impact: Medium · Effort: Medium (one instance per PR)**

## Current coverage gaps

From a survey of every `As*` interface and installer call in `src/`:

| Gap | Haskell precedent | Notes |
| --- | --- | --- |
| **Validation lacks `Bifunctor`** | `Bifunctor Validation` | Structurally identical to Either, which *has* the instance (`src/either.ts:236-255`, with `EitherBifunctorContext` and `withLeft` re-tagging). The same pattern transplants directly; `Validation.withError` already exists for the re-tagging half. |
| **Validation lacks `Ord`** | `Ord (Validation e a)` | Maybe and Either both have Ord; Validation has Eq only (`src/validation.ts`). Order `Invalid < Valid`, compare payloads with the existing `compare_unknown` (`src/typeclasses/ord.ts`). |
| **Task lacks `MonadError`** | `MonadError IOException IO` / fp-ts `TaskEither` | Promises reject, but a failed `Task` today has no `throw_error`/`catch_error`. Either is currently the *only* `MonadError` instance. This unlocks `try/catch` lowering (Task 05) for async code — the single most practical instance in this list. |
| **Fn lacks `Applicative`/`Monad`** | the `((->) r)` monad | `Fn<input, item>` is Reader-shaped; `map` exists but `pure = const` and `bind f g = λx → g (f x) x` are missing (`src/fn.ts` has only Functor + the arrow family). Adding them makes every Reader example expressible with plain functions, which is very Haskell. |
| **Maybe lacks `Semigroup`/`Monoid`** | `Monoid (Maybe a)` (First/Last via wrappers, lift via `Semigroup a`) | Haskell offers both; pick one deliberately. Simplest lawful choice without an item constraint: First-bias via `alt` (matching `Alternative`), i.e. Haskell's `First`. A payload-combining version needs a configured dictionary (`Maybe.withSemigroup(...)`) — the `Writer.with(ArrayT([]))` pattern (`src/writer.ts:74`) already establishes how. |
| **Tuple lacks `Monad`** | the writer monad `((,) w)` | Needs a Monoid for the left slot → same configured-dictionary route: `Tuple.withLeft` exists for Bifunctor; a `Tuple.withMonoid(ArrayT([]))` would give the classic writer tuple. Low priority since `Writer` exists, but it's the canonical Haskell teaching example. |
| **RecordT lacks `Ord`** | — | Minor asymmetry with List/ArrayT; skip unless free. |
| **Comonad only on Identity and Tuple** | `NonEmpty`, `Store`, `Env` | A `NonEmptyList` type would be the natural third comonad *and* would give `Foldable1`/`sconcat` a home. Bigger piece: new data type, not just an instance. |

(`Contravariant` is already covered by `Predicate` — `src/predicate.ts:45` —
so no gap there; `Fn` deliberately exposes only `Profunctor` for its input
slot.)

## Suggested order

1. **Task `MonadError`** — most practical, feeds Task 05's `try/catch`.
2. **Validation `Bifunctor` + `Ord`** — copy-paste-shaped from Either.
3. **Fn `Applicative`/`Monad`** — high Haskell-signal, small diff; add a
   README note relating it to `Reader`.
4. **Maybe `Monoid` (First-bias) + optional `Maybe.withSemigroup`**.
5. **Tuple writer-monad via configured Monoid** — only with an example that
   motivates it.
6. **NonEmptyList (new type: Semigroup, Comonad, Foldable, Traversable)** —
   separate, larger task; also the natural home for a `foldMap1`.

Each instance PR should follow the house pattern (AGENTS.md): instance blocks
in the data type's own file, `switch` on destructured tags, spelled-out export
types, tests in `src/typeclass_examples.test.ts` alongside the existing
instance tests, and — if Task 02 lands first — use the deriver where no
hand-optimized fast path is warranted.

## Acceptance criteria (per instance)

- Installer + interface `extends` updated in the data type file.
- Laws exercised in tests (identity/associativity/composition as applicable —
  see the law-checking stretch goal in Task 02).
- README coverage table (Typeclasses section) updated.
