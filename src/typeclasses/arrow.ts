import {
  call_typeclass_method,
  type Dictionary,
  typeclass,
  type TypeclassDictionary,
  type WrappedData,
} from "../typeclass.ts";
import type { Category as CategoryDictionary } from "./category.ts";

export const arrow_typeclass = Symbol("Arrow");

export interface Arrow<dictionary extends Dictionary>
  extends
    TypeclassDictionary<
      dictionary,
      typeof arrow_typeclass,
      {
        arr: <from, to>(
          this: dictionary,
          fn: (value: from) => to,
        ) => WrappedData<dictionary, unknown, to>;
        first: <raw, from, to, extra>(
          this: WrappedData<dictionary, raw, to>,
        ) => WrappedData<dictionary, unknown, readonly [to, extra]>;
        second: <raw, from, to, extra>(
          this: WrappedData<dictionary, raw, to>,
        ) => WrappedData<dictionary, unknown, readonly [extra, to]>;
      }
    >,
    CategoryDictionary<dictionary> {}

export const Arrow = typeclass(arrow_typeclass, {
  arr<
    dictionary extends Arrow<dictionary>,
    from,
    to,
  >(
    dictionary: dictionary,
    fn: (value: from) => to,
  ): WrappedData<dictionary, unknown, to> {
    return call_typeclass_method(
      this.instance_for(dictionary).arr<from, to>,
      dictionary,
      fn,
    );
  },

  first<
    dictionary extends Arrow<dictionary>,
    raw,
    from,
    to,
    extra,
  >(
    arrow: WrappedData<dictionary, raw, to>,
  ): WrappedData<dictionary, unknown, readonly [to, extra]> {
    return call_typeclass_method(
      this.instance_for(arrow).first<raw, from, to, extra>,
      arrow,
    );
  },

  second<
    dictionary extends Arrow<dictionary>,
    raw,
    from,
    to,
    extra,
  >(
    arrow: WrappedData<dictionary, raw, to>,
  ): WrappedData<dictionary, unknown, readonly [extra, to]> {
    return call_typeclass_method(
      this.instance_for(arrow).second<raw, from, to, extra>,
      arrow,
    );
  },
});
