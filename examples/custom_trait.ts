import { from_array, List, to_array } from "../src/list.ts";
import {
  call_trait_method,
  define_trait,
  type Dictionary,
  type TraitDictionary,
  type Value,
} from "../src/trait.ts";

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

declare module "../src/list.ts" {
  interface AsList extends Size<AsList> {}
}

Size.implement(List)({
  size() {
    return to_array(this).length;
  },
});

export function run_custom_trait_examples() {
  const list = from_array([1, 2, 3]);
  const sized_list = List(list.value());

  console.log("custom trait list size", Size.size(sized_list));
  console.log("custom fluent list size", sized_list.size());
}
