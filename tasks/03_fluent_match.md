# 03 — Fluent exhaustive `.match()` on wrapped values

**Impact: High · Effort: Medium · Prototype: [`experiments/fluent_match.ts`](./experiments/fluent_match.ts)**

## Current state

Eliminating a tagged value takes one of two forms today:

```ts
// 1. the standalone helper (src/tagged.ts)
match(value, { Just: (n) => n + 1, Nothing: () => 0 });

// 2. manual unwrap + switch (the idiom used in every instance method)
const [tag, payload] = value.value();
switch (tag) { ... }
```

Both work, but the natural fluent spelling — the one that reads like the rest
of the library (`.map(...).bind(...).match({...})`) — doesn't exist. Chains
must break out of fluent style at the very end:

```ts
match(parse(input).map(normalize), { ... })   // today
parse(input).map(normalize).match({ ... })    // this task
```

## What the prototype proved

`experiments/fluent_match.ts` shows both halves are already within reach:

- **Runtime:** installing `match` once on a dictionary object (the same
  prototype-inheritance trick `install_instance` uses) makes it available on
  every wrapped value, including the per-variant prototypes created by
  `tagged_data_prototype` (`src/typeclass.ts:727-750`), since those are
  `Object.create(dictionary)`.
- **Typing:** `MatchCases<value, out>` from `src/tagged.ts` is exhaustive
  (omitting a case fails with `@ts-expect-error` verified) and infers payload
  types per tag, when instantiated with the *raw tuple type*.
- **Constraint:** the method must be typed off `WrappedData`'s `value`
  parameter. Conditional aliases like `EitherValue<left, right>`
  (`src/either.ts:54`) stay deferred under generic type parameters and break
  `MatchCases` — see the finding note in
  [`experiments/prelude_extensions.ts`](./experiments/prelude_extensions.ts).

## Proposed implementation

1. **Type:** extend `WrappedDataBase` in `src/data_value.ts` with a
   conditionally-present method:

   ```ts
   type WrappedDataBase<dictionary, value, item> = {
     ...
     match: [value] extends [TaggedValue]
       ? <out>(cases: MatchCases<value, out>) => out
       : never;
   };
   ```

   `src/tagged.ts` already imports from `./typeclass.ts`; moving
   `TaggedValue`/`MatchCases` into a leaf module (or importing them type-only
   into `data_value.ts`) avoids the cycle — type-only cycles are legal but
   keeping the graph acyclic is cleaner. Use the non-distributive
   `[value] extends [TaggedValue]` form so unions of variants behave.

2. **Runtime:** add a `match` implementation alongside `value`/`run`/
   `[Symbol.iterator]` in both prototype factories:
   - `data_prototype` in `src/data_value.ts:165-192`
   - `tagged_data_prototype` in `src/typeclass.ts:727-750`

   Body is three lines (unwrap, index `cases` by tag, spread payload) —
   reuse/share the logic in `src/tagged.ts`'s `match`.

3. **Non-tagged types:** for `Fn`, `Task`, `Reader`, etc. the raw value is not
   a tagged tuple; the conditional type makes `.match` unusable (`never`) at
   compile time. At runtime the method would exist but throw; that matches
   how `.run` already behaves for non-callable values
   (`src/data_value.ts:200-211`).

4. **Guards stay.** `Just.is(...)` / `Left.is(...)` remain the narrowing tools
   for statement-style code; `.match` is the expression-style eliminator.

## Naming / collision check

No dictionary or typeclass currently defines a `match` member (`grep` over
`src/` — the only other `.match` is the http_router case study's own router
method on its own object, unaffected). Since typeclass instance methods are
`Object.assign`ed onto dictionaries (`install_instance`), a future typeclass
with a `match` method would collide; the canonical-slot design
(`src/typeclass.ts:773-802`) already accepts that risk for every method name,
so this adds nothing new — but reserve the name in the README's method table.

## Acceptance criteria

- `Just(41).map(n => n + 1).match({ Just: ..., Nothing: ... })` compiles, is
  exhaustive (missing case = type error), and runs for Maybe, Either,
  Validation, and List.
- Existing standalone `match` keeps working; its implementation is shared,
  not duplicated.
- Type-only test in `src/fixed_parameter_types.test.ts` (or a new
  `match.test.ts`) with `@ts-expect-error` exhaustiveness cases.
- `deno task publish:dry-run` passes (the conditional method type must not
  trip the slow-types rules).
