import { List } from "../src/list.ts";
import { Option } from "../src/option.ts";
import { Result } from "../src/result.ts";
import {
  add_values,
  keep_positive,
  label_values,
  sum_values,
} from "../src/examples.ts";
import { Applicative, Format, Functor, Monad } from "../src/trait.ts";

const option = Option.some(21);
const doubled_option = Functor.map(Option, option, (value: number) => {
  return value * 2;
});

const list = List.from_array([1, 2, 3]);
const labeled_list = label_values(List, list);

const result = Monad.flat_map(
  Result,
  Result.ok("42"),
  (text: string) => Result.from_number(Number.parseInt(text, 10)),
);

const applicative_list = Applicative.ap(
  List,
  List.from_array([
    (value: number) => value + 1,
    (value: number) => value * 10,
  ]),
  List.from_array([1, 2]),
);

const generic_option_sum = add_values(Option, Option.some(20), Option.some(22));
const generic_list_sum = add_values(
  List,
  List.from_array([1, 10]),
  List.from_array([2, 20]),
);
const positive_result = keep_positive(
  Result,
  Result.ok(-1),
  (value) => Result.err("negative: " + value.toString()),
);
const fluent_option = Option(Option.some((left: number) => {
  return (right: number) => left + right;
}))
  .ap(Option.some(20))
  .ap(Option.some(22));
const fluent_result = Result(Result.ok("42"))
  .flat_map((text) => Result.from_number(Number.parseInt(text, 10)))
  .map((value) => value + 1);
const fluent_list = List(List.from_array([1, 2, 3]))
  .map((value) => value * 2);

console.log("option", Format.fmt(Option, doubled_option));
console.log("list labels", Format.fmt(List, labeled_list));
console.log("list sum", sum_values(List, list));
console.log("result", Format.fmt(Result, result));
console.log("applicative list", Format.fmt(List, applicative_list));
console.log("generic option sum", Format.fmt(Option, generic_option_sum));
console.log("generic list sum", Format.fmt(List, generic_list_sum));
console.log("generic positive result", Format.fmt(Result, positive_result));
console.log("fluent option", fluent_option.fmt());
console.log("fluent result", fluent_result.fmt());
console.log("fluent list", fluent_list.fmt());
