# Learn You Typeclasses for Greater Good

This is an original, Haskell-inspired tutorial for this repository. It is not a
copy of any book text. The lessons follow the usual functional-programming arc,
but every example is written against the local TypeScript typeclass dictionaries
and data types.

Run the full course smoke test:

```sh
deno task learn
```

Or run the lessons directly:

```sh
deno run learn_you_a_typeclasses_for_greater_good/main.ts
```

## Lessons

1. `01_values_and_contexts.ts`: values wrapped in `Maybe`, `Either`, and `Show`.
2. `02_typeclasses.ts`: generic helpers over `Show`, `Eq`, and `Functor`.
3. `03_patterns_and_guards.ts`: tuple tags, `match`, guards, and narrowing.
4. `04_lists_and_laziness.ts`: `ArrayT`, `List`, and lazy `IterableT`.
5. `05_folds_and_monoids.ts`: `Foldable`, `Semigroup`, and `Monoid`.
6. `06_functors.ts`: mapping without leaving the original context.
7. `07_applicatives.ts`: independent combination and validation errors.
8. `08_monads_and_do.ts`: dependent computation with `Do`.
9. `09_custom_data_types.ts`: defining a local tree dictionary.
10. `10_reader_state_writer.ts`: environment, mutable state, and logs.
11. `11_tasks.ts`: deferred async work as a monad and applicative.
12. `12_effect_programs.ts`: composing capabilities with `Program`.
13. `13_alternative_and_traversable.ts`: choice and traversing structures.
14. `14_stm.ts`: small transactional updates with `Stm`.
15. `15_loop.ts`: stack-safe tail recursion with `loop`.

The lesson files intentionally contain small assertions. They double as
executable examples and as maintenance checks for the tutorial API.
