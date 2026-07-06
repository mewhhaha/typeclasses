import { from_array, List, to_array } from "../src/list.ts";
import {
  call_typeclass_method,
  type Data,
  type Dictionary,
  typeclass,
  type TypeclassDictionary,
} from "../src/typeclass.ts";

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

declare module "../src/list.ts" {
  interface AsList extends Size<AsList> {}
}

Size.instance(List)({
  size() {
    return to_array(this).length;
  },
});

export function run_custom_typeclass_examples() {
  const list = from_array([1, 2, 3]);
  const sized_list = List(list.value());

  console.log("custom typeclass list size", Size.size(sized_list));
  console.log("custom fluent list size", sized_list.size());
}
