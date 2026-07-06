import {
  call_typeclass_method,
  type Dictionary,
  typeclass,
  type TypeclassDictionary,
  type WrappedData,
} from "../typeclass.ts";

export const parse_typeclass = Symbol("Parse");

export interface Parse<dictionary extends Dictionary>
  extends
    TypeclassDictionary<
      dictionary,
      typeof parse_typeclass,
      {
        parse: <raw, item>(
          this: WrappedData<dictionary, raw, item>,
          input: string,
        ) => item;
      }
    > {}

export const Parse = typeclass(parse_typeclass, {
  parse<
    dictionary extends Parse<dictionary>,
    raw,
    item,
  >(
    parser: WrappedData<dictionary, raw, item>,
    input: string,
  ): item {
    return call_typeclass_method(
      this.instance_for(parser).parse<raw, item>,
      parser,
      input,
    );
  },
});
