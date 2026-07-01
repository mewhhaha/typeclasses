# Traits Examples

Small Deno examples for pseudo traits using the same type-plus-empty-function
pattern from `../binned/AGENTS.md`.

The repository demonstrates common functional paradigms without trying to be a
complete functional programming library:

- `Functor` for `map`
- `Applicative` for `pure` and `ap`
- `Monad` for `flat_map`
- `Foldable` for `fold`
- `Format` and `Equal` as small utility traits

## Run

```sh
deno task test
deno task check
deno task example
```

## Shape

Each data type exports a type and a same-named empty function. Trait methods are
attached to the function, then checked with `satisfies` beside the
implementation.

```ts
export type Option<item> =
  | { tag: "some"; value: item }
  | { tag: "none" };

export function Option() {}

Option.map = function map<from, to>(
  option: Option<from>,
  fn: (value: from) => to,
): Option<to> {
  if (option.tag === "none") {
    return option;
  }

  return { tag: "some", value: fn(option.value) };
};
```

See `src/option.ts`, `src/result.ts`, and `src/list.ts` for complete examples.
