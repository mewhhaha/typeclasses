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

## Shape

The core wrapper machinery lives in `src/trait.ts` and `src/trait_value.ts`.
Application-level trait definitions live in `src/traits.ts`.

Each data type exports a type and a same-named function. The function wraps an
existing contextual value as a fluent `Trait<dictionary, value, item>` and also
acts as the trait dictionary. Constructors and other helpers are normal exported
functions that return wrapped values.

The `Registry` interface in `src/registry.ts` is the type-level map from a data
type's unique symbol to its contextual shape. That lets the short
`Value<typeof Option, item>` type recover that `Option` stores `Option<item>`.

Trait implementation functions use `this` as their receiver and assert it at
runtime. The canonical trait slot is a unique symbol, so two traits can both
have a method named `fmt` without sharing a runtime property. Data types can
also expose direct fluent aliases like `.fmt()` or `.map()` when those names are
useful for examples.

```ts
import { kind, require_this, trait_constructor, type Value } from "./trait.ts";
import { Format, Monad } from "./traits.ts";

export type Option<item> =
  | { tag: "some"; value: item }
  | { tag: "none" };

export const option_kind: unique symbol = Symbol("Option");

declare module "./registry.ts" {
  interface Registry<item> {
    [option_kind]: Option<item>;
  }
}

export interface OptionDictionary {
  <item>(value: Option<item>): OptionValue<item>;
  [kind]: typeof option_kind;
}

type OptionValue<item> = Value<OptionDictionary, item>;

export const Option = function Option<item>(
  value: Option<item>,
): OptionValue<item> {
  return option_trait(value);
} as OptionDictionary;

Option[kind] = option_kind;

const option_trait = trait_constructor(Option);

export function some<item>(
  value: item,
): OptionValue<item> {
  return Option({ tag: "some", value });
}

export function none<item = never>(): OptionValue<item> {
  return Option({ tag: "none" });
}

Format.implement(Option, {
  fmt(this: OptionValue<unknown> | void): string {
    const option = require_this(this, "Option.Format.fmt").value();
    return option.tag === "none" ? "None" : "Some(" + option.value + ")";
  },
});

export interface OptionDictionary extends Format.Trait<typeof Option> {}

Monad.implement(Option, {
  bind<from, to>(
    this: OptionValue<from> | void,
    fn: (value: from) => OptionValue<to>,
  ): OptionValue<to> {
    const option = require_this(this, "Option.Monad.bind").value();

    if (option.tag === "none") {
      return none<to>();
    }

    return fn(option.value);
  },
});

export interface OptionDictionary extends Monad.Trait<typeof Option> {}
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

`trait(dictionary, value)` stores the dictionary internally. The wrapped value's
prototype points at a shared trait prototype, which delegates to the dictionary.
Symbol-scoped implementations are inherited through that prototype. Direct
aliases are inherited the same way, so fluent calls still use the wrapped value
as `this`.

Data type constructors can use `trait_constructor(dictionary)` to cache the
shared prototype once instead of looking it up for every value.

Each data type exports an open dictionary interface. Trait implementations are
validated and installed through trait-level installers like `Format.implement`.
The installer attaches the symbol-scoped implementation and copies direct fluent
aliases. Outside the declaring module, use the same extension point through
module augmentation. `Receiver` keeps custom trait method receivers short:

```ts
import { implement_trait } from "./traits.ts";

const size_trait: unique symbol = Symbol("Size");

interface SizeImplementation<dictionary extends Dictionary> {
  size: <item>(this: Receiver<dictionary, item>) => number;
}

interface Size<dictionary extends Dictionary> {
  [size_trait]: SizeImplementation<dictionary>;
}

function Size() {}

namespace Size {
  export type Trait<dictionary extends Dictionary> =
    & Size<dictionary>
    & SizeImplementation<dictionary>;
}

Size.implement = function implement<dictionary extends Dictionary>(
  dictionary: dictionary,
  implementation: SizeImplementation<dictionary>,
): SizeImplementation<dictionary> {
  return implement_trait(dictionary, size_trait, implementation);
};

declare module "./list.ts" {
  interface ListDictionary extends Size.Trait<typeof List> {}
}

Size.implement(List, {
  size<item>(this: Receiver<typeof List, item>): number {
    const list = require_this(this, "List.Size.size");
    return to_array(list).length;
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

Each data type has an open dictionary interface such as `OptionDictionary` or
`ListDictionary`. Entries are added one trait at a time next to the
implementation. `Format.implement(Option, { ... })` validates that every
required `Format` method exists, installs the collision-free symbol slot, and
copies direct fluent aliases onto the dictionary.

## Benchmarks

`bench/value_construction.bench.ts` compares the current prototype-chain wrapper
against the previous proxy-style baseline and cheaper construction shapes. Each
benchmark iteration performs 10,000 inner-loop constructions or read cycles:

- raw option payload construction
- current `some(...)`, `Option(raw)`, and `trait(dictionary, raw)` construction
- cached `trait_constructor(dictionary)` construction
- legacy proxy-style `trait(dictionary, raw)` construction
- tuple `[dictionary, raw]` construction
- record `{ dictionary, raw }` construction
- prototype-backed symbol object construction
- `value()` or direct payload reads for the current, tuple, and prototype shapes

Run it with:

```sh
deno task bench
```
