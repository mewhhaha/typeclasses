import {
  type As,
  type Data,
  data,
  type type_data,
  type type_item,
  type WrappedData,
} from "./typeclass.ts";
import {
  Arrow,
  type ArrowContext,
  Category,
  Functor,
  Parse,
  Profunctor,
  type ProfunctorContext,
  Show,
} from "./typeclasses.ts";

export type Fn<input, item> = (value: input) => item;

interface FnContext extends ArrowContext, ProfunctorContext {
  readonly [type_data]: AsFn<this[typeof type_item]>;
}

export interface AsFn<input = unknown>
  extends
    As<AsFn<input>>,
    Show<AsFn<input>>,
    Functor<AsFn<input>>,
    Profunctor<AsFn<input>, input, FnContext>,
    Arrow<AsFn<input>, input, FnContext>,
    Parse<AsFn<input>> {
  readonly [type_item]: unknown;
  readonly [type_data]: Fn<input, this[typeof type_item]>;
}

export type FnValue<input, item> = Data<AsFn<input>, item>;

type FnConstructor =
  & {
    <input, item>(value: Fn<input, item>): FnValue<input, item>;
    withInput<input>(): AsFn<input>;
  }
  & {
    readonly [key in keyof AsFn<unknown>]: AsFn<unknown>[key];
  };

export const Fn = data<AsFn<unknown>>() as FnConstructor;

Object.defineProperty(Fn, "withInput", {
  value: fn_with_input,
});

function fn_with_input<input>(): AsFn<input> {
  return Fn as unknown as AsFn<input>;
}

export function fn<input, item>(value: Fn<input, item>): FnValue<input, item> {
  return Fn(value);
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
    const run = this.value();

    return Fn((value: unknown) => {
      return output(run(value));
    });
  },
});

Profunctor.instance(Fn)({
  dimap<to, next_input, next_to>(
    this: Data<AsFn<unknown>, to>,
    input: (value: next_input) => unknown,
    output: (value: to) => next_to,
  ) {
    const run = this.value();

    return Fn((value: next_input) => {
      return output(run(input(value)));
    });
  },
});

Category.instance(Fn)({
  id<item>(this: AsFn<unknown>) {
    return Fn((value: item) => {
      return value;
    });
  },

  compose<to, next_input>(
    this: Data<AsFn<unknown>, to>,
    before: Data<AsFn<next_input>, unknown>,
  ) {
    const after_run = this.value();
    const before_run = before.value();

    return Fn((value: next_input) => {
      return after_run(before_run(value));
    });
  },
});

Arrow.instance(Fn)({
  arr<from, to>(
    this: AsFn<unknown>,
    fn: (value: from) => to,
  ) {
    return Fn(fn);
  },

  first<to, extra>(this: Data<AsFn<unknown>, to>) {
    const run = this.value();

    return Fn((pair: readonly [unknown, extra]) => {
      return [run(pair[0]), pair[1]] as const;
    });
  },

  second<to, extra>(this: Data<AsFn<unknown>, to>) {
    const run = this.value();

    return Fn((pair: readonly [extra, unknown]) => {
      return [pair[0], run(pair[1])] as const;
    });
  },
});

Parse.instance(Fn)({
  parse<raw, item>(
    this: WrappedData<AsFn<unknown>, raw, item>,
    input: string,
  ) {
    const run = this.value() as (value: string) => item;

    return run(input);
  },
});
