# 01 — Extend the prelude with the missing Haskell vocabulary

**Impact: High · Effort: Low · Prototype: [`experiments/prelude_extensions.ts`](./experiments/prelude_extensions.ts)**

## Current state

`src/prelude.ts` exports: `pure`, `empty`, `mempty`, `throwError`, `fmap`,
`ap`, `liftA`–`liftA5`, `bind`, `foldl`, `traverse`, `sequence`, `show`, `eq`,
`compare`, `lt/lte/gt/gte/min/max`, `append`, `concat`, `alt`.

The README explicitly punts on the rest ("Haskell helpers such as `sum`,
`length`, `foldMap`, and `mconcat` can be written on top of that operation
when an example needs them"). But a Haskell-flavored library is judged by its
prelude: `join`, `void`, `when`, `guard`, `foldMap`, `*>`/`<*`, `fromMaybe`,
`maybe`, and `either` are the functions people reach for in the first ten
minutes.

## What to add

All of these were typechecked and run against the current dictionary encoding
in the prototype — no changes to `src/typeclass.ts` are needed.

### Monad / Applicative combinators (`src/prelude.ts`)

- `join(value: Data<d, Data<d, item>>): Data<d, item>` — `bind` with identity.
- `voided(value): Data<d, undefined>` — Haskell `void` (name avoids the
  keyword; alternatively `discard`).
- `when(dictionary, condition, action)` / `unless(dictionary, condition, action)`.
- `guard(dictionary, condition)` — `pure(undefined)` or `Alternative.empty`.
- `apFirst(left, right)` / `apSecond(left, right)` — Haskell `<*` / `*>`,
  implemented with `Applicative.lift` (which already routes through each
  type's optimized `applicative_lift_method`).
- `then(left, right)` — Haskell `>>`: `bind(left, () => right)`.
- `replicateM(dictionary, count, action)`, `filterM(dictionary, fn, items)`,
  `zipWithM(dictionary, fn, left, right)` — stretch goals; each is a small
  fold over `bind`/`lift`.

### Foldable helpers (`src/prelude.ts`)

- `foldMap(monoid, fn, value)` — validated in the prototype, including the
  two-dictionary inference (`Foldable` container + `Monoid` result).
- `mconcat(monoid, values)` — `foldMap` with identity.
- `toArray`, `length`, `sum`, `product`, `elem(eqDictionary?, item, value)` —
  trivial folds; `toArray` is especially useful since `.value()` shapes differ
  per container.
- `traverse_(applicative, fn, value)` — effectful iteration discarding results
  (fold with `apSecond`).

### Eliminators, next to their data types

The prototype surfaced a real constraint: generic conditional aliases like
`EitherValue<left, right>` (`src/either.ts:54`) defeat `MatchCases` inference,
so generic helpers must destructure the raw tuple. Eliminators should
therefore live in the data-type modules where the concrete types are at hand,
and be re-exported from the prelude:

- `src/maybe.ts`: `from_maybe(fallback, value)` (Haskell `fromMaybe`),
  `maybe(fallback, fn, value)`, plus `to_either(error, value)`.
  (`from_nullable` already exists; add its inverse `to_nullable`.)
- `src/either.ts`: `either(onLeft, onRight, value)`, `from_left`,
  `from_right`, `hush` (Either → Maybe), `note` (Maybe → Either).

## Design constraints

- Follow the existing prelude pattern: `dictionary extends XDictionary<dictionary>`
  constraints with the `dictionary as dictionary` cast inside (see
  `pure`/`empty` in `src/prelude.ts:31-47` for the template).
- JSR "no slow types" applies: spell out parameter and return types on every
  export (see the repository convention note in `README.md`).
- Keep Haskell names where they don't collide with keywords (`void` → `voided`
  or `discard`; document the choice in the README's prelude section).

## Acceptance criteria

- New functions exported from `src/prelude.ts` with doc comments mirroring the
  Haskell type signature (the existing style).
- Tests in `src/prelude.test.ts` covering at least one linear monad (Maybe or
  Either) and one multi-shot container (ArrayT or List) per function.
- README prelude section table updated.
- `deno task check`, `deno lint`, `deno test`, and
  `deno task publish:dry-run` pass.
