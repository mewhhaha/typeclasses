# Traits Examples

Small Deno examples for pseudo traits using the same type-plus-empty-function
pattern from `../binned/AGENTS.md`.

The repository demonstrates common functional paradigms without trying to be a
complete functional programming library:

- `Functor` for `map`
- `Applicative` for `pure` and `ap`
- `Monad` for `bind` and `perform`
- `Foldable` for `fold`
- `Format` and `Equal` as small utility traits

## Run

```sh
deno task test
deno task check
deno task example
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

Dictionary functions use `this` as their receiver and assert it at runtime, so
the generic wrapper can rebind dictionary functions as methods on wrapped
values.

```ts
import { kind, require_this, type Trait, trait, type Value } from "./trait.ts";
import { Format, Monad } from "./traits.ts";

export type Option<item> =
  | { tag: "some"; value: item }
  | { tag: "none" };

type OptionValue<item> = Trait<typeof Option, Option<item>, item>;

export const option_kind: unique symbol = Symbol("Option");

declare module "./registry.ts" {
  interface Registry<item> {
    [option_kind]: Option<item>;
  }
}

export function Option<item>(
  value: Option<item>,
): OptionValue<item> {
  return trait<typeof Option, Option<item>, item>(Option, value);
}

Option[kind] = option_kind;

export function some<item>(
  value: item,
): OptionValue<item> {
  return Option({ tag: "some", value });
}

export function none<item = never>(): OptionValue<item> {
  return Option({ tag: "none" });
}

Option.fmt = function fmt(
  this: Trait<typeof Option, Option<unknown>, unknown> | void,
): string {
  const option = require_this(this, "Option.fmt").value();
  return option.tag === "none" ? "None" : "Some(" + option.value + ")";
};

declare module "./traits.ts" {
  interface FormatImpl {
    [option_kind]: Format<typeof Option>;
  }
}

Option.bind = function bind<from, to>(
  this: OptionValue<from> | void,
  fn: (value: from) => OptionValue<to>,
): OptionValue<to> {
  const option = require_this(this, "Option.bind").value();

  if (option.tag === "none") {
    return none<to>();
  }

  return fn(option.value);
};

declare module "./traits.ts" {
  interface MonadImpl {
    [option_kind]: Monad<typeof Option>;
  }
}
```

See `src/option.ts`, `src/result.ts`, `src/list.ts`, and `src/task.ts` for
complete examples.

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

`trait(dictionary, value)` stores the dictionary internally. Any function on
that dictionary becomes a fluent method on the wrapped value. When a function is
read from a wrapped value, the wrapper looks it up on `typeof Option` and calls
it with the wrapped option as `this`. Methods that preserve the context return
wrapped values directly.

There is no `OptionBox` or `OptionTrait` type. The fluent methods are derived
from the dictionary shape plus the wrapped value and item type.

Generic trait helper functions delegate to those wrapped methods:

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

Each trait has an open implementation registry such as `FormatImpl` or
`FunctorImpl`. Entries are added one trait at a time next to the implementation.
Because `Format<typeof Option>` is self-constrained, registering it also proves
that `typeof Option` has the required `fmt` implementation.
