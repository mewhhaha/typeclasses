import {
  call_typeclass_method,
  type Dictionary,
  type Typeclass,
  typeclass,
  type TypeclassDictionary,
  type WrappedData,
} from "../typeclass.ts";

/** Runtime token for the Parse typeclass. */
export const parse_typeclass = Symbol("Parse");

/** Dictionary capability for applying string parsers. */
export interface Parse<dictionary extends Dictionary>
  extends
    TypeclassDictionary<
      dictionary,
      typeof parse_typeclass,
      {
        parse: <item>(
          this: WrappedData<dictionary, (input: string) => item, item>,
          input: string,
        ) => item;
      }
    > {}

/** @ignore */
export type ParseTypeclass = Typeclass<typeof parse_typeclass, {
  parse<dictionary extends Parse<dictionary>, item>(
    parser: WrappedData<dictionary, (input: string) => item, item>,
    input: string,
  ): item;
}>;

/** Operations for parsing strings with wrapped parser functions. */
export const Parse: ParseTypeclass = typeclass(parse_typeclass, {
  parse<
    dictionary extends Parse<dictionary>,
    item,
  >(
    parser: WrappedData<dictionary, (input: string) => item, item>,
    input: string,
  ): item {
    return call_typeclass_method(
      this.instance_for(parser).parse<item>,
      parser,
      input,
    );
  },
});
