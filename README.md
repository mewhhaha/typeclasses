# Traits Examples

Small Deno examples for pseudo traits using the same type-plus-empty-function
pattern from `../binned/AGENTS.md`.

The repository demonstrates common functional paradigms without trying to be a
complete functional programming library:

- `Functor` for `map`
- `Applicative` for `pure` and `ap`
- `Monad` for `bind` and `perform`
- `Foldable` for `fold`
- `Traversable` for flipping structures through an applicative
- `Semigroup` and `Monoid` for appendable/empty structures
- `Alternative` for empty/fallback list-like contexts
- `Format` and `Equal` as small utility traits

## Run

```sh
deno task test
deno task check
deno task example
deno task bench
```

The comparison benchmarks use pinned npm packages through `deno.json` imports,
so the first run may download `fp-ts`, `effect`, `purify-ts`, and `true-myth`.

## Shape

The core wrapper and trait-definition machinery lives in `src/trait.ts` and
`src/trait_value.ts`. Application-level trait definitions live in
`src/traits.ts`.

Each data type exports a type and a same-named function. The function wraps an
existing contextual value as a fluent `Trait<dictionary, value, item>` and also
acts as the trait dictionary. Constructors and other helpers are normal exported
functions that return wrapped values.

Each data type registers its raw value shape in `TraitTypes<item>`. That maps a
dictionary kind to the value it wraps, so `Value<typeof Option, item>` can
recover that `Option` stores `Option<item>` without putting a phantom value
member on every dictionary.

Trait implementation functions receive the wrapped value as `this`. The
installer stores that this-based implementation in the canonical symbol slot and
exposes direct fluent aliases like `.fmt()` and `.map()`. The canonical trait
slot is a unique symbol, so two traits can both have a method named `fmt`
without sharing a runtime property.

```ts
import { type As, define } from "./trait.ts";
import { Format, Monad } from "./traits.ts";

export type Option<item> =
  | { tag: "some"; value: item }
  | { tag: "none" };

export const option_kind = Symbol("Option");

declare module "./trait.ts" {
  interface TraitTypes<item> {
    [option_kind]: Option<item>;
  }
}

export interface AsOption extends As<typeof option_kind> {}

export const Option = define<AsOption>(
  option_kind,
);

export function some<item>(
  value: item,
) {
  return Option({ tag: "some", value });
}

export function none<item = never>() {
  return Option({ tag: "none" });
}

Format.implement(Option)({
  fmt(value) {
    const option = value.value();
    return option.tag === "none" ? "None" : "Some(" + option.value + ")";
  },
});

export interface AsOption extends Format<AsOption> {}

Monad.implement(Option)({
  bind(value, fn) {
    const option = value.value();

    if (option.tag === "none") {
      return none();
    }

    return fn(option.value);
  },
});

export interface AsOption extends Monad<AsOption> {}
```

See `src/option.ts`, `src/result.ts`, `src/list.ts`, `src/task.ts`,
`src/array.ts`, `src/map.ts`, and `src/record.ts` for complete examples.

## Fluent Experiment

Wrapped values chain directly through the implemented traits:

```ts
const sum = some((left: number) => {
  return (right: number) => left + right;
})
  .ap(some(20))
  .ap(some(22));

sum.value(); // { tag: "some", value: 42 }
sum.eq(some(42)); // true
```

The same-named function wraps an existing raw context when you already have one:

```ts
const doubled = Option(sum.value()).map((value) => value * 2);
```

The public trait-wrapped value protocol is `Trait<dictionary, value, item>`.
Most code can use the shorter `Value<dictionary, item>` helper:

```ts
type WrappedOption<item> = Value<typeof Option, item>;
```

`define(type_id)` creates the callable dictionary, assigns its kind, and routes
calls through a cached constructor. The lower-level
`as_trait(dictionary, value)` and `as_trait_cached(dictionary)` helpers remain
available for experiments that need to manage construction directly.

Each data type registers its raw value once in `TraitTypes<item>`. `Value` uses
that registry to type helper functions, trait implementations, and fluent
methods.

The wrapped value's prototype points at a shared trait prototype, which
delegates to the dictionary. Symbol-scoped implementations and direct fluent
aliases are inherited through that prototype. Since implementations are
this-based, the fluent aliases can use the implementation functions directly.

Data type modules use the same callable dictionary for public wrapping and their
own constructors.

Each data type exports an open dictionary interface. Trait implementations are
validated and installed through curried trait-level installers like
`Format.implement(Option)({ ... })`. The first call fixes the dictionary, which
lets TypeScript infer generic implementation parameters from the `this`-based
method shape. Trait definitions are prototype-backed objects made with
`define_trait`; each definition inherits the shared installer and implementation
accessor, while public helper methods keep trait-specific types. Their bodies
usually dispatch through `call_trait_method`. Outside the declaring module, use
the same extension point through module augmentation.

Implementation methods usually do not need explicit generic parameters. For
`Traversable.traverse`, collection implementations split empty and non-empty
inputs: the empty branch returns the contextual empty structure, while the
non-empty branch seeds the accumulator from the last mapped value so TypeScript
can infer the output item type before the fold continues.

```ts
import {
  call_trait_method,
  define_trait,
  type Dictionary,
  type TraitDictionary,
  type Value,
} from "./trait.ts";

const size_trait = Symbol("Size");

interface Size<dictionary extends Dictionary> extends
  TraitDictionary<
    dictionary,
    typeof size_trait,
    {
      size: <item>(this: Value<dictionary, item>) => number;
    }
  > {}

const Size = define_trait(size_trait, {
  size<
    dictionary extends Size<dictionary>,
    item,
  >(value: Value<dictionary, item>) {
    return call_trait_method(this.implementation(value).size<item>, value);
  },
});

declare module "./list.ts" {
  interface AsList extends Size<AsList> {}
}

Size.implement(List)({
  size() {
    return to_array(this).length;
  },
});
```

There is no `OptionBox` or `OptionTrait` type. The fluent methods are derived
from the dictionary shape plus the wrapped value and item type.

Direct fluent aliases still work when a data type opts into them:

```ts
const parsed = ok("42").bind((text) => {
  return from_number(Number.parseInt(text, 10));
});

parsed.value(); // { tag: "ok", value: 42 }
```

`perform` is a small do-notation experiment. It runs a generator over one monad
dictionary and uses `yield*` to bind each wrapped value:

```ts
const decoded = perform(function* () {
  const text = yield* ok("42");
  const number = yield* from_number(Number.parseInt(text, 10));

  return number + 1;
});

decoded.value(); // { tag: "ok", value: 43 }
```

`Task` shows the same trait shape for deferred async work:

```ts
const greeting = perform(function* () {
  const id = yield* from_fn(async () => 7);
  const name = yield* from_fn(async () => "Ada #" + id);

  return "hello " + name;
});

await run(greeting); // "hello Ada #7"
```

## Built-In Shapes

`src/array.ts`, `src/map.ts`, and `src/record.ts` wrap familiar JavaScript data
shapes without replacing them:

- `ArrayT<item>` wraps `readonly item[]` and implements list-like `Functor`,
  `Applicative`, `Monad`, `Foldable`, `Traversable`, `Semigroup`, `Monoid`, and
  `Alternative`.
- `MapT<item>` wraps `ReadonlyMap<string, item>` and implements value-focused
  `Functor`, `Foldable`, `Traversable`, `Semigroup`, and `Monoid`.
- `RecordT<item>` wraps `Readonly<Record<string, item>>` with the same
  value-focused traits as `MapT`.

Maps and records use right-biased `concat`, where values from the right side
replace matching keys from the left side. They intentionally do not implement
`Applicative` or `Monad`, because there is no obvious lawful `pure` for an
arbitrary key space.

The root module exports these built-in-shaped modules under namespaces to avoid
helper-name collisions:

```ts
import { array, map, record } from "./src/mod.ts";
```

Each data type has an open dictionary interface such as `AsOption` or `AsList`.
Entries are added one trait at a time next to the implementation.
`Format.implement(Option)({ ... })` validates that every required `Format`
method exists, installs the collision-free symbol slot, and copies direct fluent
aliases onto the dictionary.

## Benchmarks

`bench/value_construction.bench.ts` compares the current prototype-chain wrapper
against the previous proxy-style baseline, constructor-cache variants, and
cheaper construction shapes. Each benchmark iteration performs 10,000 inner-loop
constructions or read cycles:

- raw option payload construction
- current `some(...)`, `Option(raw)`, and `as_trait(dictionary, raw)`
  construction
- cached `as_trait_cached(dictionary)(raw)` construction
- WeakMap, hidden-symbol, and lazy self-replacing constructor-cache variants
- legacy proxy-style trait construction
- tuple `[dictionary, raw]` construction
- record `{ dictionary, raw }` construction
- prototype-backed symbol object construction
- `value()` or direct payload reads for the current, tuple, and prototype shapes

`bench/library_comparison.bench.ts` compares this repository's `Option` and
`Result` wrappers with similar data types from `fp-ts`, `effect`, `purify-ts`,
and `true-myth`:

- `Option`/`Maybe` and `Result`/`Either` construction.
- Happy-path `map` plus `bind`/`chain`/`flatMap` composition.
- Failure-path `none`/`left`/`err` composition.

These are microbenchmarks, not a full library ranking. The libraries expose
different runtime shapes: this repo boxes values with a trait dictionary,
`fp-ts` uses standalone combinators over plain tagged objects, `effect` uses
optimized module functions, `purify-ts` uses methods on ADT instances, and
`true-myth` uses standalone functions over ADT instances.

Run it with:

```sh
deno task bench
```
