import { from_array as list_from_array } from "../src/list.ts";
import { some as option_some } from "../src/option.ts";
import {
  err as result_err,
  from_number as result_from_number,
  ok as result_ok,
} from "../src/result.ts";
import {
  add_values,
  keep_positive,
  label_values,
  sum_values,
} from "../src/examples.ts";
import { Format } from "../src/trait.ts";

const option = option_some(21);
const doubled_option = option.map((value: number) => {
  return value * 2;
});

const list = list_from_array([1, 2, 3]);
const labeled_list = label_values(list);

const result = result_ok("42")
  .flat_map((text: string) => result_from_number(Number.parseInt(text, 10)));

const applicative_list = list_from_array([
  (value: number) => value + 1,
  (value: number) => value * 10,
])
  .ap(list_from_array([1, 2]));

const generic_option_sum = add_values(option_some(20), option_some(22));
const generic_list_sum = add_values(
  list_from_array([1, 10]),
  list_from_array([2, 20]),
);
const positive_result = keep_positive(
  result_ok(-1),
  (value) => result_err("negative: " + value.toString()),
);
const fluent_option = option_some((left: number) => {
  return (right: number) => left + right;
})
  .ap(option_some(20))
  .ap(option_some(22));
const fluent_result = result_ok("42")
  .flat_map((text) => result_from_number(Number.parseInt(text, 10)))
  .map((value) => value + 1);
const fluent_list = list_from_array([1, 2, 3])
  .map((value) => value * 2);

console.log("option", doubled_option.fmt());
console.log("list labels", Format.fmt(labeled_list));
console.log("list sum", sum_values(list));
console.log("result", result.fmt());
console.log("applicative list", applicative_list.fmt());
console.log("generic option sum", Format.fmt(generic_option_sum));
console.log("generic list sum", Format.fmt(generic_list_sum));
console.log("generic positive result", Format.fmt(positive_result));
console.log("fluent option", fluent_option.fmt());
console.log("fluent result", fluent_result.fmt());
console.log("fluent list", fluent_list.fmt());
