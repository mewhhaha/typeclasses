// docs:begin custom-dictionary
import {
  type As,
  type Data,
  data,
  type type_data,
  type type_item,
} from "../src/typeclass.ts";
import { Functor } from "../src/typeclasses/functor.ts";

const box_identity = Symbol("Box");
type RawBox<item> = { readonly item: item };
interface AsBox extends As<AsBox, typeof box_identity>, Functor<AsBox> {
  readonly [type_item]: unknown;
  readonly [type_data]: RawBox<this[typeof type_item]>;
}
type Box<item> = Data<AsBox, item>;
const Box: AsBox = data<AsBox>(box_identity);

Functor.instance(Box)({
  map(fn) {
    return Box({ item: fn(this.value().item) });
  },
});

const incremented: Box<number> = Box({ item: 41 }).map((item) => item + 1);
incremented.value(); // { item: 42 }
// docs:end custom-dictionary

export function documented_dictionary() {
  return incremented.value();
}
