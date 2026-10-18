// docs:begin calling-styles
import { Just } from "../src/maybe.ts";
import { Functor } from "../src/typeclasses/functor.ts";
import { fmap } from "../src/prelude.ts";

const fluent = Just(41).map((value) => value + 1);
const { map } = Functor;
const generic = map(Just(41), (value) => value + 1);
const function_first = fmap((value) => value + 1, Just(41));
// docs:end calling-styles

export function documented_calls() {
  return [fluent.value(), generic.value(), function_first.value()];
}
