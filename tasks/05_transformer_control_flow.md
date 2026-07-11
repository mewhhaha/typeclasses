# 05 — Transformer: widen control-flow coverage

**Impact: Medium · Effort: High**

## Current state

`transform_statements` (`tools/transform_do_program.ts:265-397`) lowers, at
the top level of the generator body:

- `const x = yield* e` / bare `yield* e` / `return yield* e`
- `return e`
- `if`/`else` (recursively, duplicating the continuation into both arms)
- `switch` with `break`/`return`/`throw`/`continue` terminated cases
  (no fallthrough)
- classic `for (let i = 0; cond; i++/--/+=/=...)` loops → recursive `loop(i)`
  functions, with `continue` support
- statements *containing* yields anywhere else → diagnostic + skip the whole
  block (`UnsupportedGenerator`)

Missing shapes users will write on day one:

| Shape | Today | Lowering strategy |
| --- | --- | --- |
| `while (cond) { ... yield* ... }` | skipped | same recursive-function scheme as `for`: `function loop() { if (cond) { body...; return loop(); } return <continuation>; }` — the existing `transform_for` already builds exactly this with an added parameter; `while` is the degenerate case with no loop variable. `do/while` is the same with the condition check moved after the first body pass. |
| `for (const item of items) { ... yield* ... }` | skipped | lower to an index-carrying recursive function over a hoisted `const items_n = [...items]` (or `Array.isArray` fast path); this is the most common loop shape in the case studies. |
| `for … of` + `traverse`-shaped bodies | n/a | stretch: when the body is a single `yield*` of `fn(item)`, emit `Traversable.traverse`/`Effect` folds instead of a recursive chain — smaller output, and it matches what a Haskeller means by `mapM_`. |
| `try { ... } catch (e) { ... }` around yields | skipped | for `do` kind: only meaningful when the dictionary has `MonadError`; lower `try/catch` to `.catch_error((e) => <catch-block>)` around the lowered try-body (requires Task 04's explicit dictionary to know `catch_error` exists — gate on the two-arg form and emit a diagnostic for the one-arg form). For `program` kind: same idea against `Effect`-level error handling if/when it exists. |
| `break` inside transformed loops | unsupported (only `continue`) | pass a `break_expression` alongside `continue_expression` in `TransformOptions` (`tools/transform_do_program.ts:34-36`) pointing at the exit continuation. |
| labeled `continue`/`break` | diagnostic | leave unsupported; keep the diagnostic. |

## Why this matters

The transformer is the library's answer to the runtime `Do`'s generator-replay
cost (and the replay's re-execution of side effects for multi-shot monads).
Every unsupported shape silently keeps users on the slow path — the
diagnostics are good (better than most tools), but each one is a paper cut
that erodes trust in "write straight-line TypeScript, get monadic chains".

## Suggested order

1. `while` / `do-while` — smallest delta, reuses `transform_for`'s machinery
   (extract the shared "recursive loop function" builder first).
2. `break` support in all transformed loops.
3. `for-of` over arrays/iterables.
4. `try/catch` → `MonadError.catch_error` (after Task 04 lands).

Each step is independently shippable and should come with:

- lowering tests in `tools/transform_do_program_checks.ts` (input → expected
  output snapshots, plus "diagnostic emitted and source unchanged" cases for
  the still-unsupported variants);
- a semantics test that runs both the untransformed (runtime `Do`) and
  transformed forms and asserts identical results — the checks file already
  has the infrastructure for this pattern;
- a case in `bench/case_studies_transformer.bench.ts` if a case study can be
  simplified to use the new shape.

## Risks

- **Continuation duplication.** `if`/`switch` lowering already duplicates the
  rest-of-body into each branch; nested conditionals grow output
  combinatorially. Loops avoid this via the named recursive function. When
  adding new shapes, prefer the named-function scheme, and consider a
  follow-up that hoists shared continuations (`function after_n(x) {...}`)
  once per branch point instead of inlining them.
- **`var`/closure capture semantics.** The recursive-function lowering changes
  `let` capture semantics per iteration; the classic `for` transform already
  accepts this (each recursion gets a fresh parameter binding, which matches
  `let` semantics). Document it.
- **Stack depth.** Recursive loop functions recurse per iteration through
  `bind`; for strict monads like Maybe/Either each recursion returns before
  descending further only if the monad short-circuits. Long loops can
  overflow. The library already ships `loop`/`done`/`rec`
  (`src/loop.ts`) for stack-safe recursion — the transformer's loop scheme
  should either reuse it or the docs should state the iteration-count limits.
