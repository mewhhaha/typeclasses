# 02 — Default methods / minimal complete definitions

**Impact: High · Effort: Medium · Prototype: [`experiments/derive_monad.ts`](./experiments/derive_monad.ts)**

## Current state

Haskell typeclasses ship default method implementations: instantiate `Monad`
with just `return` + `>>=` and `fmap`/`<*>` come for free. Here, every data
type hand-installs every class. `src/maybe.ts` runs five installer blocks
(`Functor.instance`, `Applicative.instance` with `pure`/`ap`/lift override,
`Alternative.instance`, `Monad.instance`, `Traversable.instance`), and each
one re-implements the same `Nothing`-short-circuit switch. A user defining
their own monad must write `map`, `pure`, `ap`, *and* `bind` even though three
of them are determined by the other two.

The only default that exists today is `Applicative.lift`'s fallback chain in
`src/typeclasses/applicative.ts:91-224`, which synthesizes n-ary lifting from
`map` + `ap` when no `applicative_lift_method` override is present. That is
the right pattern — this task generalizes it.

## Proposal

Add derivation installers next to each typeclass definition:

```ts
// src/typeclasses/monad.ts
Monad.derive(MyType)({
  pure(value) { return MyType([...]) },
  bind(fn) { ... },
});
```

which installs, in one call:

- `Monad.instance` with the given `bind`;
- `Functor.instance` with `map f = bind (pure ∘ f)`;
- `Applicative.instance` with the given `pure` and
  `ap mv = bind (λf → mv.bind(pure ∘ f))`.

Analogous derivers worth shipping:

- `Applicative.derive({pure, ap})` → derives `map f = pure(f).ap(·)`
  (for applicative-only types like Validation).
- `Ord.derive({compare})` → derives `Eq.eq` (`compare === "eq"`), and the
  `lt/lte/gt/gte/min/max` family already lives on the `Ord` typeclass value.
- `Traversable.derive({traverse})` → derives `map` (traverse via the Identity
  applicative) and `fold` (traverse via a Const-style accumulator). This one
  needs `src/identity.ts` at runtime; check for import cycles before
  committing to it — it can ship later than the Monad/Applicative pair.

Types can still override any derived method afterwards for speed (the
installers use `Object.assign` through `install_instance` in
`src/typeclass.ts:793-802`, so a later `Functor.instance(MyType)({map})` with
a hand-optimized fast path simply replaces the derived one). The convention
"derive first, specialize hot methods after" should be documented.

## What the prototype proved

`experiments/derive_monad.ts` defines a fresh `Box` type with **only**
`pure` + `bind`, derives the rest, and exercises fluent `map`/`ap`/`bind`,
`Applicative.lift`, and `Do` — all typecheck and run.

Two findings to fold into the design:

1. **`this` is not callable inside instance methods.** The receiver of an
   instance method is the wrapped value (whose prototype chain includes the
   dictionary object), not the callable dictionary function, so `pure` cannot
   `return this([...])`. The deriver's signature should make this a non-issue:
   accept the dictionary as the first argument (as `Typeclass.instance`
   already does) and let implementors close over their constructors, or pass
   a `DataConstructorContext`-style `{ data }` helper (the pattern already
   used by `data(construct)` in `src/typeclass.ts:90-97`).
2. **The typing is already expressible.** The `MinimalMonad<dictionary>`
   object type in the prototype compiled without touching core types; the
   deriver only needs the same `dictionary extends Monad<dictionary>`
   constraint the interfaces already declare.

## Implementation steps

1. Add `derive` to the `TypeclassDefinition` prototype pattern in
   `src/typeclass.ts` (or as standalone `derive_monad`/`derive_applicative`
   functions in each typeclass module — simpler for JSR type output; decide by
   which produces cleaner declaration files under `--no-slow-types`).
2. Wire the derived `map`/`ap` to also respect `applicative_lift_method`
   fallback (nothing to do — the fallback keys off instance presence).
3. Convert one internal type (e.g. `src/stm.ts` or `src/reader.ts`, which have
   no hand-optimized fast paths worth keeping) to the deriver as an in-repo
   proof, leaving Maybe/Either/List on their optimized manual instances.
4. Document in README ("Defining your own data type" section): the minimal
   definition table per class, mirroring Haskell's "Minimal complete
   definition" doc blocks.

## Law checking (stretch)

With derivation in place, a tiny `laws.ts` test helper becomes cheap:
`assert_monad_laws(dictionary, arbitrary)` checking left/right identity and
associativity on sample values, mirroring how Haskell folks use QuickCheck.
Even a non-property-based version (fixed samples) would catch the common
"bind builds the wrong context" mistakes and make the test suite read like a
Haskell laws suite.

## Acceptance criteria

- `Monad.derive`/`Applicative.derive` (or standalone equivalents) exported
  from the library root.
- A test defining a new data type with only `pure` + `bind` and exercising
  every derived method, fluent and dictionary-passing style (port the
  experiment).
- README section with the minimal-definition table.
- No behavior change for existing types; benchmarks in
  `bench/algorithm_contexts.bench.ts` unaffected.
