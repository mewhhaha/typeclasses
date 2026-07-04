# Traits Examples

Small Deno examples for pseudo traits using the same type-plus-empty-function
pattern from `../binned/AGENTS.md`.

The repository demonstrates common functional paradigms without trying to be a
complete functional programming library:

- `Functor` for `map`
- `Applicative` for `pure` and `ap`
- `Monad` for `bind` and `Do`
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
`src/trait_value.ts`. Application-level trait definitions live in `src/traits/`,
with `src/traits.ts` re-exporting them for examples.

Each data type exports a type and a same-named function. The function wraps an
existing contextual value as a fluent `Trait<dictionary, value, item>` and also
acts as the trait dictionary. Constructors and other helpers are normal exported
functions that return wrapped values.

Each data type registers its raw value shape in `TraitTypes<dictionary, item>`.
That maps a dictionary kind to the value it wraps, so
`Value<typeof Option, item>` can recover that `Option` stores `Option<item>`
without putting a phantom value member on every dictionary.

Trait implementation functions receive the wrapped value as `this`. The
installer stores that this-based implementation in the canonical symbol slot and
exposes direct fluent aliases like `.fmt()` and `.map()`. The canonical trait
slot is a unique symbol, so two traits can both have a method named `fmt`
without sharing a runtime property.

```ts
import { type As, define } from "./trait.ts";
import { Format, Monad } from "./traits.ts";

export type Option<item> =
  | readonly ["some", item]
  | readonly ["none"];

export const option_kind = Symbol("Option");

declare module "./trait.ts" {
  interface TraitTypes<dictionary, item> {
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
  return Option(["some", value]);
}

export function none<item = never>() {
  return Option(["none"]);
}

Format.implement(Option)({
  fmt() {
    const option = this.value();
    return option[0] === "none" ? "None" : "Some(" + option[1] + ")";
  },
});

export interface AsOption extends Format<AsOption> {}

Monad.implement(Option)({
  bind(fn) {
    const option = this.value();

    if (option[0] === "none") {
      return none();
    }

    return fn(option[1]);
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

sum.value(); // ["some", 42]
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

Each data type registers its raw value once in `TraitTypes<dictionary, item>`.
`Value` uses that registry to type helper functions, trait implementations, and
fluent methods.

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

parsed.value(); // ["ok", 42]
```

`Result` does not fix the error payload to `string`; `err(value)` keeps the
error value's type. The examples use strings because they are easy to inspect.

`Do` is a small do-notation experiment. It runs a generator over one monad
dictionary and uses `yield*` to bind each wrapped value:

```ts
const decoded = Do(function* () {
  const text = yield* ok("42");
  const number = yield* from_number(Number.parseInt(text, 10));

  return number + 1;
});

decoded.value(); // ["ok", 43]
```

`Task` shows the same trait shape for deferred async work:

```ts
const greeting = Do(function* () {
  const id = yield* from_fn(async () => 7);
  const name = yield* from_fn(async () => "Ada #" + id);

  return "hello " + name;
});

await greeting.value()(); // "hello Ada #7"
```

For mixed capabilities, use effects. `Program.scope<Allowed>()` creates a typed
boundary for the operations a `Program` block may yield. The block can still run
a too-wide nested effect locally to make it fit the scope:

```ts
type Label =
  | Uses<AsReader<LabelConfig>>
  | Uses<AsTask>;
type App =
  | Uses<AsReader<Config>>
  | Uses<AsState<number>>
  | Uses<AsWriter<AsArray, string>>
  | Uses<AsTask>;

const Label = Program.scope<Label>();
const App = Program.scope<App>();

const label = Label(function* () {
  const config = yield* ask<LabelConfig>();
  const suffix = yield* from_fn(async () => ":async");

  return config.label + suffix;
});

const program = App(function* () {
  const config = yield* ask<Config>();
  const before = yield* get<number>();
  const scoped_label = yield* run_reader(label, { label: config.label });

  yield* modify((value) => value + config.increment);
  yield* tell(array_from_array([scoped_label + ":" + before.toString()]));

  return yield* get<number>();
});

await run(
  run_writer(
    run_state(
      run_reader(program, { label: "step", increment: 2 }),
      40,
    ),
    array_from_array<string>([]),
  ),
);
```

## Haskell Comparisons

The Haskell version usually starts from a typeclass constraint. In this repo the
dictionary is carried by the wrapped value instead, so generic code accepts a
`Value<dictionary, item>` and calls the exported trait helper.

### Functor

```hs
fmap (+1) (Just 41)
```

```ts
Functor.map(some(41), (value) => value + 1);
some(41).map((value) => value + 1);
```

### Applicative

```hs
(+) <$> Just 20 <*> Just 22
```

```ts
Applicative.lift(
  (left, right) => left + right,
  some(20),
  some(22),
);

some((left: number) => {
  return (right: number) => left + right;
})
  .ap(some(20))
  .ap(some(22));
```

### Monad

```hs
parse input >>= validate >>= save
```

```ts
parse(input)
  .bind(validate)
  .bind(save);
```

Generator `Do` is the closest equivalent to Haskell `do` notation:

```hs
do
  text <- parse input
  value <- validate text
  save value
```

```ts
Do(function* () {
  const text = yield* parse(input);
  const value = yield* validate(text);

  return yield* save(value);
});
```

### Maybe and Either

```hs
safePort :: String -> Maybe Int
safePort text =
  readMaybe text >>= \port ->
    if port > 0 then Just port else Nothing
```

```ts
function read_port(text: string) {
  const port = Number.parseInt(text, 10);

  if (!Number.isInteger(port)) {
    return none<number>();
  }

  return some(port);
}

function safe_port(text: string) {
  return read_port(text)
    .bind((port) => {
      if (port > 0) {
        return some(port);
      }

      return none();
    });
}
```

`Result` fills the same role as a conventional `Either error item`:

```hs
decode input =
  parse input >>= validate
```

```ts
function decode(input: unknown) {
  return parse(input)
    .bind(validate);
}
```

### List

```hs
do
  left <- [1, 2]
  right <- [10, 20]
  pure (left + right)
```

```ts
Do(function* () {
  const left = yield* list_from_array([1, 2]);
  const right = yield* list_from_array([10, 20]);

  return left + right;
});
```

`List` is the recursive list experiment. `ArrayT` is the wrapper for native
JavaScript arrays.

### Reader

```hs
endpoint :: Reader Config String
endpoint = do
  config <- ask
  pure (host config <> ":" <> show (port config))
```

```ts
const endpoint = Do(function* () {
  const config = yield* ask<Config>();

  return config.host + ":" + config.port.toString();
});

endpoint.value()({ host: "localhost", port: 8080 });
```

Effects use `run_reader` when Reader is one capability inside a larger program:

```ts
const without_reader = run_reader(program, config);
```

### State

```hs
counter :: State Int Int
counter = do
  before <- get
  modify (+2)
  pure before
```

```ts
const counter = Do(function* () {
  const before = yield* get<number>();

  yield* modify((value: number) => value + 2);

  return before;
});

counter.value()(40); // [40, 42]
```

### Writer

```hs
program :: Writer [String] Int
program = do
  tell ["start"]
  pure 42
```

```ts
const program = Do(function* () {
  yield* tell(array_from_array(["start"]));

  return 42;
});

const [value, logs] = program.value();

value; // 42
array_to_array(logs); // ["start"]
```

`Writer` is parameterized by the monoidal output. Arrays are just one concrete
choice through `ArrayT`; the same `Writer` machinery can accumulate any output
with a `Monoid` implementation.

### Effects Instead of Transformers

Haskell often reaches for transformer stacks such as
`ReaderT Config (StateT Count (WriterT [String] IO)) item`. This repo keeps the
plain `Reader`, `State`, `Writer`, and `Task` data types separate, and composes
mixed programs with `Effect`/`Program` instead:

```ts
type App =
  | Uses<AsReader<Config>>
  | Uses<AsState<number>>
  | Uses<AsWriter<AsArray, string>>
  | Uses<AsTask>;

const App = Program.scope<App>();

const program = App(function* () {
  const config = yield* ask<Config>();
  const before = yield* get<number>();

  yield* modify((value: number) => value + config.increment);
  yield* tell(array_from_array([config.label + ":" + before.toString()]));

  return yield* get<number>();
});

await run(
  run_writer(
    run_state(
      run_reader(program, { label: "step", increment: 2 }),
      40,
    ),
    array_from_array<string>([]),
  ),
);
```

Each runner removes one capability from the effect type. That gives a
transformer-like composition story without defining `ReaderT`, `StateT`,
`WriterT`, and every concrete stack combination.

### IO and Task

```hs
program :: IO Int
program = do
  text <- readFile "port.txt"
  pure (read text)
```

```ts
const program = Do(function* () {
  const text = yield* from_fn(() => Deno.readTextFile("port.txt"));

  return Number.parseInt(text, 10);
});

await program.value()();
```

`Task` is deferred async work. It is intentionally a thunk,
`() => Promise<item>`, so construction does not start the operation.

### Validation

Haskell validation examples usually use an applicative that accumulates errors
instead of stopping at the first one:

```hs
Profile <$> validateName input <*> validateEmail input
```

```ts
Applicative.lift(
  (name, email) => ({ name, email }),
  validate_name(input),
  validate_email(input),
);
```

`Validation` implements `Applicative`, `Functor`, `Foldable`, and `Traversable`,
but not `Monad`: a lawful monad would make later validations depend on earlier
values and lose independent error accumulation.

Like `Writer`, `Validation` now separates the accumulation rule from the default
error shape. `invalid("message")` is a convenience for `readonly string[]`
errors, while `invalid_with(error, semigroup)` can accumulate any error payload
with an explicit semigroup.

## JavaScript Shapes

The useful question for a JavaScript shape is which laws it can support without
surprising runtime behavior.

| JavaScript shape                 | Wrapper in this repo             | Natural traits                                                                                                           |
| -------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `readonly item[]`                | `ArrayT`                         | `Functor`, `Applicative`, `Monad`, `Foldable`, `Traversable`, `Semigroup`, `Monoid`, `Alternative`                       |
| recursive list                   | `List`                           | Same list-like traits, useful for generator experiments                                                                  |
| `ReadonlyMap<string, item>`      | `MapT`                           | `Functor`, `Foldable`, `Traversable`, `Semigroup`, `Monoid`                                                              |
| `Readonly<Record<string, item>>` | `RecordT`                        | Same value-focused traits as `MapT`                                                                                      |
| `Set<item>`                      | `SetT`                           | `Functor`, `Foldable`, `Semigroup`, `Monoid`; mapping keeps JavaScript set semantics and can collapse duplicates         |
| `PromiseLike<item>`              | `Task` via `from_promise`        | Use `Task` so work is deferred; raw promises are already running                                                         |
| `() => Promise<item>`            | `Task` via `from_fn`             | `Functor`, parallel `Applicative`, sequential `Monad`                                                                    |
| `Iterable<item>` / generator     | `IterableT`                      | replayable lazy `Functor`, `Applicative`, `Monad`, `Foldable`, `Traversable`, `Semigroup`, `Monoid`, `Alternative`       |
| `AsyncIterable<item>`            | `AsyncIterableT`                 | replayable async `Functor`, `Applicative`, `Monad`, `Semigroup`, `Monoid`, `Alternative`; collect with `to_array`        |
| `ReadableStream<item>`           | `ReadableStreamT`                | opaque stream wrapper plus `to_async_iterable`; native streams are stateful and can be locked/consumed                   |
| typed arrays                     | `TypedArrayT`                    | `Format`, `Equal`, `Foldable`; no general `Functor` because output must stay compatible with the typed-array constructor |
| `ArrayBuffer` / `DataView`       | `ArrayBufferT` / `DataViewT`     | byte-level `Format`, `Equal`, `Foldable`, `Semigroup`, `Monoid`                                                          |
| `URLSearchParams` / `FormData`   | `URLSearchParamsT` / `FormDataT` | entry-level `Format`, `Equal`, `Foldable`, `Semigroup`, `Monoid`; usually decode into `Result` or `Validation` first     |
| `WeakMap` / `WeakSet`            | `WeakMapT` / `WeakSetT`          | opaque `Format` and identity `Equal`; no fold because JavaScript intentionally makes them non-iterable                   |
| `Date`, `RegExp`, `Error`        | `DateT`, `RegExpT`, `ErrorT`     | `Format` and `Equal` utility wrappers, not `Functor`/`Monad` containers                                                  |

`SetT` keeps JavaScript `Set` behavior. Equality is identity for objects and
SameValueZero for primitives, so mapping can collapse values:

```ts
new Set([1, 2, 3].map(() => 0)); // Set { 0 }
```

That can still be useful, but it is set behavior rather than list behavior.

For `IterableT` and `AsyncIterableT`, the main design choice is replayability.
Many iterators are one-shot mutable cursors. The preferred constructors store a
factory, `() => Iterable<item>` or `() => AsyncIterable<item>`. The plain
`from_iterable` helper materializes values to make a replayable source. That is
the same issue the list `Do` experiments exposed: calling a continuation more
than once must not accidentally reuse a consumed iterator.

`ReadableStream` has similar constraints plus cancellation and backpressure. The
pragmatic shape is usually:

```ts
async function* from_stream<item>(stream: ReadableStream<item>) {
  const reader = stream.getReader();

  try {
    while (true) {
      const next = await reader.read();

      if (next.done) {
        return;
      }

      yield next.value;
    }
  } finally {
    reader.releaseLock();
  }
}
```

`ReadableStreamT` exposes this as `to_async_iterable`, which returns an
`AsyncIterableT`. Running tasks in workers is a runner concern layered under
`Task`, not a separate data type, so it is intentionally not modeled here.

## Built-In Shapes

`src/array.ts`, `src/map.ts`, `src/record.ts`, and the other built-in-shaped
modules wrap familiar JavaScript data shapes without replacing them:

- `ArrayT<item>` wraps `readonly item[]` and implements list-like `Functor`,
  `Applicative`, `Monad`, `Foldable`, `Traversable`, `Semigroup`, `Monoid`, and
  `Alternative`.
- `MapT<item>` wraps `ReadonlyMap<string, item>` and implements value-focused
  `Functor`, `Foldable`, `Traversable`, `Semigroup`, and `Monoid`.
- `RecordT<item>` wraps `Readonly<Record<string, item>>` with the same
  value-focused traits as `MapT`.
- `SetT<item>` wraps `ReadonlySet<item>` with JavaScript set semantics.
- `IterableT<item>` and `AsyncIterableT<item>` use replayable factories.
- `ArrayBufferT`, `DataViewT`, and `TypedArrayT` expose byte/numeric folding
  without pretending binary buffers are general-purpose functors.
- `URLSearchParamsT` and `FormDataT` fold over key/value entries.
- `WeakMapT`, `WeakSetT`, `DateT`, `RegExpT`, and `ErrorT` are utility wrappers
  for formatting/equality rather than collection programming.

Maps and records use right-biased `concat`, where values from the right side
replace matching keys from the left side. They intentionally do not implement
`Applicative` or `Monad`, because there is no obvious lawful `pure` for an
arbitrary key space.

The root module exports these built-in-shaped modules under namespaces to avoid
helper-name collisions:

```ts
import {
  array,
  async_iterable,
  map,
  record,
  set,
  typed_array,
  url_search_params,
} from "./src/mod.ts";
```

Each data type has an open dictionary interface such as `AsOption` or `AsList`.
Entries are added one trait at a time next to the implementation.
`Format.implement(Option)({ ... })` validates that every required `Format`
method exists, installs the collision-free symbol slot, and copies direct fluent
aliases onto the dictionary.

## Benchmarks

`bench/value_construction.bench.ts` compares the current prototype-chain wrapper
against constructor-cache variants and cheaper construction shapes. Each
benchmark iteration performs 10,000 inner-loop constructions or read cycles:

- raw option payload construction
- current `some(...)`, `Option(raw)`, and `as_trait(dictionary, raw)`
  construction
- cached `as_trait_cached(dictionary)(raw)` construction
- WeakMap, hidden-symbol, and lazy self-replacing constructor-cache variants
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
