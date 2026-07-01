import { List } from "../src/list.ts";
import { Option } from "../src/option.ts";
import { Result } from "../src/result.ts";
import {
  add_values,
  keep_positive,
  label_values,
  sum_values,
} from "../src/examples.ts";
import { Format } from "../src/trait.ts";

const option = Option.some(21);
const doubled_option = option.map((value: number) => {
  return value * 2;
});

const list = List.from_array([1, 2, 3]);
const labeled_list = label_values(List(list));

const result = Result.ok("42")
  .flat_map((text: string) => Result.from_number(Number.parseInt(text, 10)));

const applicative_list = List(
  List.from_array([
    (value: number) => value + 1,
    (value: number) => value * 10,
  ]),
)
  .ap(List.from_array([1, 2]));

const generic_option_sum = add_values(Option.some(20), Option.some(22));
const generic_list_sum = add_values(
  List(List.from_array([1, 10])),
  List.from_array([2, 20]),
);
const positive_result = keep_positive(
  Result.ok(-1),
  (value) => Result.err("negative: " + value.toString()),
);
const fluent_option = Option.some((left: number) => {
  return (right: number) => left + right;
})
  .ap(Option.some(20))
  .ap(Option.some(22));
const fluent_result = Result.ok("42")
  .flat_map((text) => Result.from_number(Number.parseInt(text, 10)))
  .map((value) => value + 1);
const fluent_list = List(List.from_array([1, 2, 3]))
  .map((value) => value * 2);

console.log("option", doubled_option.fmt());
console.log("list labels", Format.fmt(labeled_list));
console.log("list sum", sum_values(List(list)));
console.log("result", result.fmt());
console.log("applicative list", applicative_list.fmt());
console.log("generic option sum", Format.fmt(generic_option_sum));
console.log("generic list sum", Format.fmt(generic_list_sum));
console.log("generic positive result", Format.fmt(positive_result));
console.log("fluent option", fluent_option.fmt());
console.log("fluent result", fluent_result.fmt());
console.log("fluent list", fluent_list.fmt());
