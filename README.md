# Typeclasses

Typeclasses is a Deno and TypeScript library for Haskell-style typeclasses with
runtime dictionaries and fluent wrapped values. It is published as
`@mewhhaha/typeclasses`.

It provides reusable typeclass definitions, data types, effect programs,
examples, case studies, benchmarks, and a source transformer:

- `Functor` for `map`
- `Applicative` for `pure` and `ap`
- `Monad` for `bind` and `Do`
- `Foldable` for `fold`
- `Traversable` for flipping structures through an applicative
- `Ord` for ordered comparisons
- `Semigroup` and `Monoid` for appendable/empty structures
- `Alternative` for empty/fallback list-like contexts
- `Bifunctor`, `Contravariant`, and `Profunctor` for multi-variance mapping
- `Category` and `Arrow` for composable function-like contexts
- `Comonad` for extracting and extending contextual values
- `MonadError` for monads with recoverable failures
- `Parse` for parser-like values that can consume string input
- `Show` and `Eq` as small utility typeclasses

## Run

```sh
deno task test
deno task check
deno task example
deno task case-study
deno task bench
```

The comparison benchmarks use pinned npm packages through `deno.json` imports,
so the first run may download `fp-ts`, `effect`, `purify-ts`, and `true-myth`.

Use the package from JSR with explicit imports:

```ts
import { Do, just, nothing, Show } from "jsr:@mewhhaha/typeclasses";
```

The published package exposes two entrypoints:

- `jsr:@mewhhaha/typeclasses` for the library.
- `jsr:@mewhhaha/typeclasses/transform` for the source transformer.

Before publishing, run the dry-run task:

```sh
deno task publish:dry-run
```

The publish tasks intentionally do not use `--allow-slow-types`. Public exports
carry explicit types so Deno can generate package docs and Node declaration
files.

The package is MIT licensed.

## Shape

The core wrapper and typeclass-definition machinery lives in `src/typeclass.ts`
and `src/data_value.ts`. Application-level typeclass definitions live in
`src/typeclasses/`, with `src/typeclasses.ts` re-exporting them for examples.

Each data type exports a type and a same-named function. The function wraps an
existing contextual value as a fluent `WrappedData<dictionary, value, item>` and
also acts as the data dictionary. Constructors and other helpers are normal
exported functions that return wrapped values.

Each data type declares its raw value shape directly on its dictionary interface
with type-only phantom symbols. That maps the contextual `item` to the raw value
the dictionary wraps, so `Data<typeof Maybe, item>` can recover that `Maybe`
stores `Maybe<item>` without a global registry or a public kind symbol.

Typeclass instance methods receive the wrapped value as `this`. The installer
stores that this-based instance in the canonical symbol slot and exposes direct
fluent aliases like `.show()` and `.map()`. The canonical typeclass slot is a
unique symbol, so two typeclasses can both have a method named `show` without
sharing a runtime property.

```ts
import {
  type As,
  type Data,
  data,
  type type_data,
  type type_item,
} from "./typeclass.ts";
import { Monad, Show } from "./typeclasses.ts";

export type Maybe<item> =
  | readonly ["just", item]
  | readonly ["nothing"];

export interface AsMaybe extends As<AsMaybe>, Show<AsMaybe>, Monad<AsMaybe> {
  readonly [type_item]: unknown;
  readonly [type_data]: Maybe<this[typeof type_item]>;
}

export const Maybe: AsMaybe = data<AsMaybe>();

export function just<item>(
  value: item,
): Data<AsMaybe, item> {
  return Maybe(["just", value]);
}

export function nothing<item = never>(): Data<AsMaybe, item> {
  return Maybe(["nothing"]);
}

Show.instance(Maybe)({
  show() {
    const [tag, value] = this.value();

    switch (tag) {
      case "nothing":
        return "Nothing";
      case "just":
        return "Just(" + value + ")";
    }
  },
});

Monad.instance(Maybe)({
  bind(fn) {
    const [tag, value] = this.value();

    switch (tag) {
      case "nothing":
        return nothing();
      case "just":
        return fn(value);
    }
  },
});
```

See `src/maybe.ts`, `src/either.ts`, `src/identity.ts`, `src/predicate.ts`,
`src/fn.ts`, `src/tuple.ts`, `src/list.ts`, `src/task.ts`, `src/array.ts`,
`src/map.ts`, and `src/record.ts` for complete examples.

## Fluent API

Wrapped values chain directly through the implemented typeclasses:

```ts
const sum = just((left: number) => {
  return (right: number) => left + right;
})
  .ap(just(20))
  .ap(just(22));

sum.value(); // ["just", 42]
sum.eq(just(42)); // true
```

If the wrapped raw value is a function, the wrapper also exposes `.run(...)` as
the typed shortcut for `.value()(...)`. That keeps callable data types such as
`Fn`, `Task`, `Reader`, `State`, and `IterableT` from leaking double calls into
examples.

The same-named function wraps an existing raw context when you already have one:

```ts
const doubled = Maybe(sum.value()).map((value) => value * 2);
```

The public data-wrapped value protocol is
`WrappedData<dictionary, value, item>`. Most code can use the shorter
`Data<dictionary, item>` helper:

```ts
type WrappedMaybe<item> = Data<typeof Maybe, item>;
```

`data<AsMaybe>()` creates the callable dictionary, assigns an internal kind, and
routes calls through a cached constructor. The lower-level
`as_data(dictionary, value)` and `as_data_cached(dictionary)` helpers remain
available for integrations that need to manage construction directly.

Each data type declares its raw value shape once on the `As...` interface.
`Data` uses that shape to type helper functions, instance methods, and fluent
methods.

The wrapped value's prototype points at a shared data prototype, which delegates
to the dictionary. Symbol-scoped implementations and direct fluent aliases are
inherited through that prototype. Since implementations are this-based, the
fluent aliases can use the instance functions directly.

Data type modules use the same callable dictionary for public wrapping and their
own constructors.

Each data type exports an open dictionary interface. Typeclass instances are
validated and installed through curried typeclass-level installers like
`Show.instance(Maybe)({ ... })`. The first call fixes the dictionary, which lets
TypeScript infer generic implementation parameters from the `this`-based method
shape. Typeclass definitions are prototype-backed objects made with `typeclass`;
each definition inherits the shared installer and instance accessor, while
public helper methods keep typeclass-specific types. Their bodies usually
dispatch through `call_typeclass_method`. Outside the declaring module, extend a
dictionary by augmenting its exported `As...` interface and installing the
implementation on the callable dictionary.

Implementation methods usually do not need explicit generic parameters. For
`Traversable.traverse`, collection implementations split empty and non-empty
inputs: the empty branch returns the contextual empty structure, while the
non-empty branch seeds the accumulator from the last mapped value so TypeScript
can infer the output item type before the fold continues.

```ts
import {
  call_typeclass_method,
  type Data,
  type Dictionary,
  typeclass,
  type TypeclassDictionary,
} from "./typeclass.ts";

const size_typeclass = Symbol("Size");

interface Size<dictionary extends Dictionary> extends
  TypeclassDictionary<
    dictionary,
    typeof size_typeclass,
    {
      size: <item>(this: Data<dictionary, item>) => number;
    }
  > {}

const Size = typeclass(size_typeclass, {
  size<
    dictionary extends Size<dictionary>,
    item,
  >(value: Data<dictionary, item>) {
    return call_typeclass_method(this.instance_for(value).size<item>, value);
  },
});

declare module "./list.ts" {
  interface AsList extends Size<AsList> {}
}

Size.instance(List)({
  size() {
    return to_array(this).length;
  },
});
```

There is no `MaybeBox` or `MaybeInstance` type. The fluent methods are derived
from the dictionary shape plus the wrapped value and item type.

Direct fluent aliases still work when a data type opts into them:

```ts
const parsed = right("42").bind((text) => {
  return from_number(Number.parseInt(text, 10));
});

parsed.value(); // ["right", 42]
```

`Either` does not fix the error payload to `string`; `left(value)` keeps the
error value's type. The examples use strings because they are easy to inspect.

## Tagged Values

Data constructors use tuple tags. Deconstruct the raw value and switch on the
tag when you want direct branching:

```ts
const [tag, value] = just(42).value();

switch (tag) {
  case "nothing":
    value; // undefined
    break;
  case "just":
    value; // number
    break;
}
```

For expression-style branching, use the `match` helper. The handler record must
cover every tag in the value:

```ts
const label = match(just(42), {
  nothing: () => "missing",
  just: (value) => "value:" + value.toString(),
});
```

`Do` is generator-based do notation. It runs a generator over one monad
dictionary and uses `yield*` to bind each wrapped value:

```ts
const decoded = Do(function* () {
  const text = yield* right("42");
  const number = yield* from_number(Number.parseInt(text, 10));

  return number + 1;
});

decoded.value(); // ["right", 43]
```

`Task` shows the same typeclass shape for deferred async work:

```ts
const greeting = Do(function* () {
  const id = yield* from_fn(async () => 7);
  const name = yield* from_fn(async () => "Ada #" + id);

  return "hello " + name;
});

await greeting.run(); // "hello Ada #7"
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
  yield* tell(ArrayT([scoped_label + ":" + before.toString()]));

  return yield* get<number>();
});

await Effect.interpret(program)
  .handle((effect) => run_reader(effect, { label: "step", increment: 2 }))
  .handle((effect) => run_state(effect, 40))
  .handle((effect) => run_writer(effect, ArrayT<string>([])))
  .run(run_task);
```

## Build-Time Transform

The package also exports the source transformer as `./transform`:

```ts
import { transform_do_program_source } from "@mewhhaha/typeclasses/transform";

const result = transform_do_program_source(source_text, "input.ts");

result.code; // transformed TypeScript source
result.diagnostics; // skipped unsupported patterns
result.transformed; // number of rewritten sites
```

The transformer is meant for bundlers, build scripts, or local workflows that
want the ergonomic `Do(function* () { ... })` and
`Program(function* () { ... })` syntax in source code, but cheaper raw bindings
in emitted code. It currently lowers supported `Do` blocks to direct typeclass
method chains, supported `Program` blocks to `Effect.bind`/`Effect.map`/
`Effect.pure`, `return yield* value` to the monadic right identity, and static
`Effect.handle_with(program, [handlers...])` calls to nested runner calls. The
transform also removes generated wrapper IIFEs where it can preserve evaluation
order.

Unsupported control-flow shapes are left unchanged and reported through
`diagnostics`, so a bundler plugin can decide whether to fail the build or keep
the original source. The repository task exposes the same tool on the command
line:

```sh
deno task transform --write src/file.ts
```

## Tail Loops

Use `loop(initial, step)` for explicit tail recursion without growing the
JavaScript call stack. The callback returns either `done(value)` or
`rec(nextState)`, so only tail calls are expressible:

```ts
const factorial = loop({ n: 6, acc: 1 }, ({ n, acc }) => {
  if (n <= 1) {
    return done(acc);
  }

  return rec({ n: n - 1, acc: acc * n });
});
```

## Benchmarks

The benchmark folder is part of the library maintenance harness. The broad task
runs every benchmark file:

```sh
deno task bench
```

Focused benchmarks can be run directly:

```sh
deno bench --allow-env --allow-read --allow-write=/tmp bench/algorithm_contexts.bench.ts
deno bench bench/iterable_pipeline.bench.ts
deno bench --allow-env --allow-read --allow-write=/tmp bench/do_vs_program.bench.ts
deno task bench:case-studies
```

`bench/algorithm_contexts.bench.ts` runs the same small algorithms through
different contexts:

- a `Functor` scoring pass
- an `Applicative` product builder
- a `Monad` dependent product builder

It compares native arrays and generators with `ArrayT`, `List`, `IterableT`,
`Maybe`, `Either`, `Validation`, and the functor-only `MapT`, `RecordT`, and
`SetT`. `IterableT` is intentionally replayable (`() => Iterable<item>`) so its
list-like applicative and monad instances remain lawful. A raw JavaScript
`Iterator` is one-shot, so the benchmark uses native generator baselines for
that shape and forces them to arrays before recording the result.

`bench/iterable_pipeline.bench.ts` focuses on one lazy pipeline and compares
`IterableT` against materializing every `Array.map` step, native generator maps,
and a manual fused loop baseline.

## Haskell Comparisons

The Haskell version usually starts from a typeclass constraint. In this repo the
dictionary is carried by the wrapped value instead, so generic code accepts a
`Data<dictionary, item>` and calls the exported typeclass helper.

### Functor

```hs
fmap (+1) (Just 41)
```

```ts
Functor.map(just(41), (value) => value + 1);
just(41).map((value) => value + 1);
```

### Applicative

```hs
(+) <$> Just 20 <*> Just 22
```

```ts
Applicative.lift(
  (left, right) => left + right,
  just(20),
  just(22),
);

just((left: number) => {
  return (right: number) => left + right;
})
  .ap(just(20))
  .ap(just(22));
```

The applicative API is explicit TypeScript: use `Applicative.lift` when the
inputs are independent, or fluent `ap` when you already have a contextual
function. Parser-style applicatives can use the same shape by lifting a field
constructor over independent parser values.

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
    return nothing<number>();
  }

  return just(port);
}

function safe_port(text: string) {
  return read_port(text)
    .bind((port) => {
      if (port > 0) {
        return just(port);
      }

      return nothing();
    });
}
```

`Either` fills the same role as a conventional `Either error item`:

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

### Ord

```hs
compare (Just 2) (Just 1)
maximum [20, 42]
```

```ts
Ord.compare(just(2), just(1)); // "gt"
Ord.max(identity(20), identity(42)).value(); // 42
```

`Ord` extends `Eq` and returns `"lt"`, `"eq"`, or `"gt"`. `Maybe`, `Either`,
`Identity`, `ArrayT`, and `List` implement it with the usual tag ordering and
lexicographic collection comparison.

### Bifunctor and MonadError

```hs
bimap length (+1) (Left "missing")
catchError (Left "missing") (\error -> Right (length error))
```

```ts
Bifunctor.bimap(
  either_left<string, number>("missing"),
  (message) => message.length,
  (value) => value + 1,
);

MonadError.catch_error(
  either_left<string, number>("missing"),
  (error) => either_right(String(error).length),
);
```

`Either` is the natural implementation for both typeclasses. `Validation` stays
applicative-only here: changing the error type would also need a new semigroup
for the new error type, so a general `Bifunctor` instance would be misleading.

### Tuple

```hs
fmap (+1) ("count", 41)
bimap length (+1) ("count", 41)
fst ("count", 41)
```

```ts
const value = tuple("count", 41);

Functor.map(value, (item) => item + 1).value(); // ["count", 42]
Bifunctor.bimap(
  value,
  (label) => label.length,
  (item) => item + 1,
).value(); // [5, 42]

fst(value); // "count"
snd(value); // 41
swap(value).value(); // [41, "count"]
```

`Tuple<left, right>` stores a plain pair as `readonly [left, right]`. Its normal
`item` slot is the right side, so `Functor`, `Foldable`, `Traversable`, and
`Comonad` work over the second value just like Haskell's `(,) left`. `Bifunctor`
maps both slots.

### Contravariant

```hs
contramap score positive
```

```ts
const positive = predicate((value: number) => value > 0);
const positive_score = Contravariant.contramap(
  positive,
  (user: { readonly score: number }) => user.score,
);

positive_score.run({ score: 1 }); // true
```

`Predicate` is contravariant because mapping happens before the value reaches
the predicate.

### Comonad

```hs
extract (Identity 41)
extend (\wrapped -> extract wrapped + 1) (Identity 41)
```

```ts
const value = identity(41);

Comonad.extract(value); // 41
Comonad.extend(value, (wrapped) => wrapped.value() + 1).value(); // 42

const counted = tuple("count", 41);

Comonad.extract(counted); // 41
Comonad.extend(counted, (wrapped) => {
  const [label, item] = wrapped.value();

  return String(label) + ":" + item.toString();
}).value(); // ["count", "count:41"]
```

`Identity` is intentionally boring, which makes the laws easy to see. `Tuple` is
the more practical instance: the left slot remains available as context while
`extend` computes a new focused right slot from the whole pair.

### Profunctor, Category, Arrow, and Parse

```hs
dimap name show length
arr (+1) >>> arr (*2)
first (arr (+1))
```

```ts
const named_length = Profunctor.dimap(
  fn((text: string) => text.length),
  (user: { readonly name: string }) => user.name,
  (length) => "len:" + length.toString(),
);

const composed = Category.compose(
  fn((value: number) => value * 2),
  fn((value: number) => value + 1),
);

const first = Arrow.first(fn((value: number) => value + 1));
const parsed = Parse.parse(
  fn((text: string) => Number.parseInt(text, 10)),
  "42",
);
```

`Fn` is the small function carrier for these typeclasses. Use `fn(...)` or
`arr(...)` to keep `.run(...)` typed. The higher-arity typeclasses are
represented with raw-value generics because this library's core
`Data<dictionary, item>` tracks one item slot, while Haskell's function-like
classes are parameterized over both input and output.

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

`List` is the recursive list implementation. `ArrayT` is the wrapper for native
JavaScript arrays.

### Foldable

```hs
foldl' (+) 0 [1, 2, 3]
```

```ts
Foldable.fold(
  ArrayT([1, 2, 3]),
  0,
  (sum, item) => sum + item,
);
```

`Foldable` is intentionally just the core fold operation. Haskell helpers such
as `sum`, `length`, `foldMap`, and `mconcat` can be written on top of that
operation when an example needs them.

### Traversable

```hs
traverse readMaybe ["1", "2", "3"]
sequenceA [Just 1, Just 2, Just 3]
```

```ts
Traversable.traverse(
  ArrayT(["1", "2", "3"]),
  either_right(undefined),
  (text) => either_from_number(Number.parseInt(text, 10)),
);

Traversable.sequence(
  ArrayT([just(1), just(2), just(3)]),
  just(undefined),
);
```

`Traversable` flips a container of effects into an effect containing a
container. This is the same shape as Haskell's `traverse` and `sequenceA`, but
the TypeScript version receives one value from the target applicative as the
dictionary witness.

### Semigroup and Monoid

```hs
[1, 2] <> [3]
mempty <> ["done"]
mconcat [[1], [2], [3]]
```

```ts
Semigroup.concat(
  ArrayT([1, 2]),
  ArrayT([3]),
);

Monoid.concat(
  Monoid.empty(ArrayT<string>([])),
  ArrayT(["done"]),
);

Foldable.fold(
  ArrayT([
    ArrayT([1]),
    ArrayT([2]),
    ArrayT([3]),
  ]),
  Monoid.empty(ArrayT<number>([])),
  Monoid.concat,
);
```

`Semigroup` provides associative combination. `Monoid` adds `empty`. The
receiver value is the runtime dictionary witness, so `Monoid.empty` takes a
representative value of the data type whose empty value should be produced.

### Alternative

```hs
Nothing <|> Just 42
[1, 2] <|> [3, 4]
```

```ts
Alternative.alt(nothing<number>(), just(42));

Alternative.alt(
  ArrayT([1, 2]),
  ArrayT([3, 4]),
);
```

`Alternative` is the common "empty plus choice" interface. `Maybe` chooses the
first successful branch, arrays concatenate branches, and parser examples use
the same idea for backtracking choices.

### Parser Combinators

Haskell parser libraries such as Megaparsec build larger grammars from small
`Functor`, `Applicative`, `Monad`, and `Alternative` pieces:

```hs
parameters =
  between (symbol "(") (symbol ")") (identifier `sepBy` symbol ",")

declaration =
  choice [keyword "let", keyword "const"]
```

The programming-language parser case study follows that shape with ordinary
TypeScript functions:

```ts
const parameters = between(
  symbol("("),
  sep_by(identifier, symbol(",")),
  symbol(")"),
);

const declaration = choice([
  keyword("let"),
  keyword("const"),
]);
```

The parser is still just another data type with typeclass instances; the
combinators are convenience functions for the grammar domain.

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

endpoint.run({ host: "localhost", port: 8080 });
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

counter.run(40); // [40, 42]
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
  yield* tell(ArrayT(["start"]));

  return 42;
});

const [value, logs] = program.value();

value; // 42
to_array(logs); // ["start"]
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
  yield* tell(ArrayT([config.label + ":" + before.toString()]));

  return yield* get<number>();
});

await Effect.interpret(program)
  .handle((effect) => run_reader(effect, { label: "step", increment: 2 }))
  .handle((effect) => run_state(effect, 40))
  .handle((effect) => run_writer(effect, ArrayT<string>([])))
  .run(run_task);
```

Each handler removes one capability from the effect type and returns a smaller
effect. The final `.run(run_task)` call is the terminal runner that executes the
remaining `Task` effect. That gives a transformer-like composition story without
defining `ReaderT`, `StateT`, `WriterT`, and every concrete stack combination.

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

await program.run();
```

`Task` is deferred async work. It is intentionally a thunk,
`() => Promise<item>`, so construction does not start the operation.

### Async and Concurrency

Haskell separates applicative independence from monadic dependency:

```hs
UserAndScore <$> fetchUser id <*> fetchScore id

fetchUser id >>= fetchProfile
```

The same distinction matters for `Task`. Applicative composition can start
independent tasks together, while `Do` sequences dependent work:

```ts
const parallel = Applicative.lift(
  (user, score) => ({ user, score }),
  from_fn(() => fetch_user(id)),
  from_fn(() => fetch_score(id)),
);

const dependent = Do(function* () {
  const user = yield* from_fn(() => fetch_user(id));

  return yield* from_fn(() => fetch_profile(user.id));
});

await parallel.run();
await dependent.run();
```

This is the same rule as Haskell's `Applicative` versus `Monad`: use applicative
style when later operations do not need earlier results, and use monadic style
when they do.

### STM

```hs
atomically $ do
  before <- readTVar counter
  writeTVar counter (before + 1)
  pure before
```

```ts
const counter = new_tvar(0);

const increment = Do(function* () {
  const before = yield* read_tvar(counter);

  yield* write_tvar(counter, before + 1);

  return before;
});

atomically(increment);
```

`Stm` keeps writes in a journal until `atomically` commits them. `retry` and
`or_else` provide the familiar transactional choice shape, so failed branches
can roll back their writes before another transaction is attempted.

### Resource Handling

Haskell's `bracket` and `finally` make cleanup explicit around effectful code:

```hs
bracket acquire release use
```

JavaScript already has the same control-flow shape with `try`/`finally`, and not
every platform resource implements `[Symbol.dispose]`:

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

The important Haskell lesson is the bracket shape: acquire, use, and release
stay together. The repo keeps that shape direct instead of hiding it behind a
typeclass until a data type needs a reusable resource abstraction.

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

| JavaScript shape                 | Wrapper in this repo             | Natural typeclasses                                                                                                 |
| -------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `readonly item[]`                | `ArrayT`                         | `Functor`, `Applicative`, `Monad`, `Foldable`, `Traversable`, `Semigroup`, `Monoid`, `Alternative`                  |
| recursive list                   | `List`                           | Same list-like typeclasses, useful for generator-heavy algorithms                                                   |
| `ReadonlyMap<string, item>`      | `MapT`                           | `Functor`, `Foldable`, `Traversable`, `Semigroup`, `Monoid`                                                         |
| `Readonly<Record<string, item>>` | `RecordT`                        | Same value-focused typeclasses as `MapT`                                                                            |
| `Set<item>`                      | `SetT`                           | `Functor`, `Foldable`, `Semigroup`, `Monoid`; mapping keeps JavaScript set semantics and can collapse duplicates    |
| `PromiseLike<item>`              | `Task` via `from_promise`        | Use `Task` so work is deferred; raw promises are already running                                                    |
| `() => Promise<item>`            | `Task` via `from_fn`             | `Functor`, parallel `Applicative`, sequential `Monad`                                                               |
| `Iterable<item>` / generator     | `IterableT`                      | replayable lazy `Functor`, `Applicative`, `Monad`, `Foldable`, `Traversable`, `Semigroup`, `Monoid`, `Alternative`  |
| `AsyncIterable<item>`            | `AsyncIterableT`                 | replayable async `Functor`, `Applicative`, `Monad`, `Semigroup`, `Monoid`, `Alternative`; collect with `to_array`   |
| `ReadableStream<item>`           | `ReadableStreamT`                | opaque stream wrapper plus `to_async_iterable`; native streams are stateful and can be locked/consumed              |
| typed arrays                     | `TypedArrayT`                    | `Show`, `Eq`, `Foldable`; no general `Functor` because output must stay compatible with the typed-array constructor |
| `ArrayBuffer` / `DataView`       | `ArrayBufferT` / `DataViewT`     | byte-level `Show`, `Eq`, `Foldable`, `Semigroup`, `Monoid`                                                          |
| `URLSearchParams` / `FormData`   | `URLSearchParamsT` / `FormDataT` | entry-level `Show`, `Eq`, `Foldable`, `Semigroup`, `Monoid`; usually decode into `Either` or `Validation` first     |
| `WeakMap` / `WeakSet`            | `WeakMapT` / `WeakSetT`          | opaque `Show` and identity `Eq`; no fold because JavaScript intentionally makes them non-iterable                   |
| `Date`, `RegExp`, `Error`        | `DateT`, `RegExpT`, `ErrorT`     | `Show` and `Eq` utility wrappers, not `Functor`/`Monad` containers                                                  |

`SetT` keeps JavaScript `Set` behavior. Equality is identity for objects and
SameValueZero for primitives, so mapping can collapse values:

```ts
new Set([1, 2, 3].map(() => 0)); // Set { 0 }
```

That can still be useful, but it is set behavior rather than list behavior.

For `IterableT` and `AsyncIterableT`, the main design choice is replayability.
Many iterators are one-shot mutable cursors. The preferred constructors store a
factory, `() => Iterable<item>` or `() => AsyncIterable<item>`. The plain
`from_iterable` helper materializes values to make a replayable source. Calling
a continuation more than once must not accidentally reuse a consumed iterator.

Chained `IterableT` maps compose lazily. Each `.map` adds a generator layer, but
it does not allocate an intermediate collection. Work happens when a consumer
iterates, folds, or materializes the final value:

```ts
const values = iterable_from_factory(function* () {
  yield* [1, 2, 3];
});

const pipeline = values
  .map((value) => value + 1)
  .map((value) => value * 10)
  .map((value) => "value:" + value.toString());

iterable_to_array(pipeline); // ["value:20", "value:30", "value:40"]
```

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
  value-focused typeclasses as `MapT`.
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

Each data type has an open dictionary interface such as `AsMaybe` or `AsList`.
Entries are added one typeclass at a time next to the implementation.
`Show.instance(Maybe)({ ... })` validates that every required `Show` method
exists, installs the collision-free symbol slot, and copies direct fluent
aliases onto the dictionary.

## Examples

Focused repository examples live in `examples/`:

- `examples/basics.ts` covers `Maybe`, `Either`, `Applicative`, validation,
  pattern guards, and `match`.
- `examples/custom_typeclass.ts` shows extending a data type with a local
  typeclass.
- `examples/built_in_shapes.ts` covers JavaScript-shaped wrappers such as
  arrays, maps, sets, iterables, streams, form data, and binary buffers.
- `examples/monads.ts` shows `Do` with `Reader`, `State`, `Task`, `Stm`, and
  decoding with `Either`.
- `examples/effects.ts` composes `Reader`, `State`, `Writer`, and `Task` with
  `Program`.

`examples/main.ts` is only a runner for those focused files.

`learn_you_a_typeclasses_for_greater_good/` is a longer Haskell-inspired
tutorial made of executable lessons. It is included in the published package.
Run it from the repository with `deno task learn`.

Larger repository-only application-shaped demos live in `case_studies/`:

- `case_studies/http_router/` builds a small typed HTTP router on `URLPattern`.
  `router.ts` contains the `UrlPatternList` data type and route composition,
  while `handlers.ts` and `mod.ts` define the concrete HTTP app. Routes carry
  method checks, typed path params, typed query params, and compose as a
  first-match `Alternative` route list. Handlers are `Program`s with `Reader`
  for route input and `Writer<AsyncIterableT<string>>` for streamed response
  bodies, so the same router can return HTML pages or JSON responses.
- `case_studies/cloudflare_crud_worker/` models a Cloudflare Worker CRUD API for
  `/todos`. The request program uses `Reader` for request context, `Task` for
  JSON body reads and async storage, a custom `Database` effect for list/create/
  read/update/delete operations, a custom `Clock` effect for timestamps, and a
  custom `Trace` effect for request and domain events. A trace-scope interpreter
  can also observe selected effects before their concrete runner, so database
  operations automatically produce `crud.database.*.start` and
  `crud.database.*.finish` trace lines without adding trace calls to the route
  handlers. The same program can run against an in-memory dry-run database with
  trace lines collected through `Writer`, or against a D1-style runtime with
  trace events sent through a console/task sink.
- `case_studies/io_application/` models a small CLI with `echo`, `cat`, and
  `write` commands. It uses a custom `FileSystem` effect for
  `ReadFile`/`WriteFile`, `Reader` for argv, `Writer` for stdout lines, and
  `Task` only at the interpreter boundary. The same program runs against an IO
  interpreter or a dry-run interpreter that records planned writes without
  mutating the backing store.
- `case_studies/agent_harness/` models an agent loop as another IO program. A
  custom `LanguageModel` effect produces tool requests or a final answer; the
  harness executes filesystem tools, appends tool results to the transcript,
  writes stdout with `Writer`, and repeats until the model returns `final`.

## Benchmarks

`bench/value_construction.bench.ts` compares the current prototype-chain wrapper
against constructor-cache variants and cheaper construction shapes. Each
benchmark iteration performs 10,000 inner-loop constructions or read cycles:

- raw maybe payload construction
- current `just(...)`, `Maybe(raw)`, and `as_data(dictionary, raw)` construction
- cached `as_data_cached(dictionary)(raw)` construction
- WeakMap, hidden-symbol, and lazy self-replacing constructor-cache variants
- tuple `[dictionary, raw]` construction
- record `{ dictionary, raw }` construction
- prototype-backed symbol object construction
- `value()` or direct payload reads for the current, tuple, and prototype shapes

`bench/library_comparison.bench.ts` compares this repository's `Maybe` and
`Either` wrappers with similar data types from `fp-ts`, `effect`, `purify-ts`,
and `true-myth`:

- `Maybe`/`Maybe` and `Either`/`Either` construction.
- Happy-path `map` plus `bind`/`chain`/`flatMap` composition.
- Failure-path `nothing`/`left`/`left` composition.

These are microbenchmarks, not a full library ranking. The libraries expose
different runtime shapes: this repo boxes values with a data dictionary, `fp-ts`
uses standalone combinators over plain tagged objects, `effect` uses optimized
module functions, `purify-ts` uses methods on ADT instances, and `true-myth`
uses standalone functions over ADT instances.

Run it with:

```sh
deno task bench
```
