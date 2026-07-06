import {
  type As,
  data,
  type type_data,
  type type_item,
  type WrappedData,
} from "./typeclass.ts";
import {
  Arrow,
  Category,
  Functor,
  Parse,
  Profunctor,
  Show,
} from "./typeclasses.ts";

export type Fn<input, item> = (value: input) => item;

export interface AsFn
  extends
    As<AsFn>,
    Show<AsFn>,
    Functor<AsFn>,
    Profunctor<AsFn>,
    Category<AsFn>,
    Arrow<AsFn>,
    Parse<AsFn> {
  readonly [type_item]: unknown;
  readonly [type_data]: Fn<never, this[typeof type_item]>;
}

export type FnValue<input, item> = WrappedData<AsFn, Fn<input, item>, item>;

export const Fn: AsFn = data<AsFn>();

export function fn<input, item>(value: Fn<input, item>): FnValue<input, item> {
  return Fn(value) as FnValue<input, item>;
}

export function arr<input, item>(
  value: Fn<input, item>,
): FnValue<input, item> {
  return fn(value);
}

Show.instance(Fn)({
  show() {
    return "Fn(?)";
  },
});

Functor.instance(Fn)({
  map(output) {
    const run = this.value() as (value: unknown) => unknown;

    return Fn((value: unknown) => {
      return output(run(value) as never);
    });
  },
});

Profunctor.instance(Fn)({
  dimap<raw, from, to, next_from, next_to>(
    this: WrappedData<AsFn, raw, to>,
    input: (value: next_from) => from,
    output: (value: to) => next_to,
  ) {
    const run = this.value() as (value: from) => to;

    return unknown_typeclass<next_to>(
      Fn((value: next_from) => {
        return output(run(input(value)));
      }),
    );
  },
});

Category.instance(Fn)({
  id<item>(this: AsFn) {
    return unknown_typeclass<item>(
      Fn((value: item) => {
        return value;
      }),
    );
  },

  compose<after_raw, before_raw, from, middle, to>(
    this: WrappedData<AsFn, after_raw, to>,
    before: WrappedData<AsFn, before_raw, middle>,
  ) {
    const after_run = this.value() as (value: middle) => to;
    const before_run = before.value() as (value: from) => middle;

    return unknown_typeclass<to>(
      Fn((value: from) => {
        return after_run(before_run(value));
      }),
    );
  },
});

Arrow.instance(Fn)({
  arr<from, to>(
    this: AsFn,
    fn: (value: from) => to,
  ) {
    return unknown_typeclass<to>(Fn(fn as Fn<from, to>));
  },

  first<raw, from, to, extra>(this: WrappedData<AsFn, raw, to>) {
    const run = this.value() as (value: from) => to;

    return unknown_typeclass<readonly [to, extra]>(
      Fn((pair: readonly [from, extra]) => {
        return [run(pair[0]), pair[1]] as const;
      }),
    );
  },

  second<raw, from, to, extra>(this: WrappedData<AsFn, raw, to>) {
    const run = this.value() as (value: from) => to;

    return unknown_typeclass<readonly [extra, to]>(
      Fn((pair: readonly [extra, from]) => {
        return [pair[0], run(pair[1])] as const;
      }),
    );
  },
});

Parse.instance(Fn)({
  parse<raw, item>(
    this: WrappedData<AsFn, raw, item>,
    input: string,
  ) {
    const run = this.value() as (value: string) => item;

    return run(input);
  },
});

function unknown_typeclass<item>(
  value: unknown,
): WrappedData<AsFn, unknown, item> {
  return value as WrappedData<AsFn, unknown, item>;
}
