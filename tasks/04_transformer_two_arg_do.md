# 04 — Transformer: support the explicit-dictionary `Do(dict, gen)` form

**Impact: High · Effort: Low · Verified gap**

## Current state

The runtime `Do` has two documented call shapes (`src/typeclasses/monad.ts:61-67`):

```ts
Do(function* () { ... });        // dictionary inferred from first yield
Do(Maybe, function* () { ... }); // explicit dictionary — REQUIRED for
                                 // yield-free blocks (README, ergonomics.test.ts)
```

The transformer only handles the first. `transform_call` in
`tools/transform_do_program.ts:214-227` reads `node.arguments[0]` and requires
it to be a `function*`; the two-argument form hits the "expected a function*
argument" diagnostic and is left as a runtime generator. Verified against the
current CLI:

```
$ deno run --allow-env --allow-read tools/transform_do_program.ts input.ts
input.ts:6:13: Skipped do: expected a function* argument.
const one = Just(1).map(a => { return a + 1; });   // 1-arg form: lowered ✓
const two = Do(Maybe, function* () { ... });       // 2-arg form: skipped ✗
```

So the *more explicit, more Haskell-like* spelling (name the monad up front,
like a type annotation on a `do` block) is punished with the slower runtime
path — users get the opposite of the intended incentive.

## Proposed fix

In `transform_call`:

1. Accept `Do(<expr>, <function*>)`: when `node.arguments.length === 2` and
   the callee is the `do` kind, treat `arguments[1]` as the generator and keep
   `arguments[0]` as the **dictionary expression**.
2. Thread the dictionary expression through `TransformState` (e.g. an optional
   `dictionary: ts.Expression` field).
3. Use it where the transform currently has to guess a pure-context:
   - `create_pure` (`tools/transform_do_program.ts:1215-1244`) currently
     *fails* ("Do requires a yielded value before returning") when a `return`
     appears before any yield. With a dictionary expression available, emit
     `dictionary.pure(expr)` instead — which also makes **yield-free `Do`
     blocks lowerable**, matching the runtime semantics tested in
     `src/ergonomics.test.ts:31-43`.
   - Everywhere else the generated code calls `<context>.pure(...)` on the
     yielded value's identifier; with an explicit dictionary both spellings
     are valid — prefer the dictionary for clarity.
4. Evaluation-order note: the dictionary argument is evaluated before the
   generator runs today; hoist it into a temp (`const context_n = <expr>`)
   only when the expression is not a plain identifier, mirroring the existing
   `create_direct_do_bind` context-hoisting logic
   (`tools/transform_do_program.ts:980-1004`).

## Tests

Extend `tools/transform_do_program_checks.ts` with:

- two-arg form with yields → lowered to the same chain as the one-arg form;
- two-arg form with **no yields** → `Maybe.pure(42)` (currently a runtime-only
  behavior);
- two-arg form where the dictionary is a non-identifier expression
  (`Writer.with(ArrayT([]))`) → hoisted once, evaluated once;
- one-arg form unchanged (regression);
- diagnostics: `Do()` with zero args still reports.

Also add the two-arg form to `bench/do_vs_program.bench.ts` so the
"transformed vs runtime" comparison covers it.

## Acceptance criteria

- The README's Build-Time Transform section documents both forms as supported.
- `deno task test:transformer` covers the new cases.
- Case studies/examples that use the explicit form get smaller output in
  `bench/case_studies_transformer.bench.ts` (rewrite count increases).
