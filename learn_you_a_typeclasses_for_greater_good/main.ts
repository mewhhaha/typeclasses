import { lesson_01_values_and_contexts } from "./01_values_and_contexts.ts";
import { lesson_02_typeclasses } from "./02_typeclasses.ts";
import { lesson_03_patterns_and_guards } from "./03_patterns_and_guards.ts";
import { lesson_04_lists_and_laziness } from "./04_lists_and_laziness.ts";
import { lesson_05_folds_and_monoids } from "./05_folds_and_monoids.ts";
import { lesson_06_functors } from "./06_functors.ts";
import { lesson_07_applicatives } from "./07_applicatives.ts";
import { lesson_08_monads_and_do } from "./08_monads_and_do.ts";
import { lesson_09_custom_data_types } from "./09_custom_data_types.ts";
import { lesson_10_reader_state_writer } from "./10_reader_state_writer.ts";
import { lesson_11_tasks } from "./11_tasks.ts";
import { lesson_12_effect_programs } from "./12_effect_programs.ts";
import { lesson_13_alternative_and_traversable } from "./13_alternative_and_traversable.ts";
import { lesson_14_stm } from "./14_stm.ts";
import { lesson_15_loop } from "./15_loop.ts";

type Lesson = readonly [
  string,
  () => void | Promise<void>,
];

const lessons: readonly Lesson[] = [
  ["values and contexts", lesson_01_values_and_contexts],
  ["typeclasses", lesson_02_typeclasses],
  ["patterns and guards", lesson_03_patterns_and_guards],
  ["lists and laziness", lesson_04_lists_and_laziness],
  ["folds and monoids", lesson_05_folds_and_monoids],
  ["functors", lesson_06_functors],
  ["applicatives", lesson_07_applicatives],
  ["monads and do", lesson_08_monads_and_do],
  ["custom data types", lesson_09_custom_data_types],
  ["reader state writer", lesson_10_reader_state_writer],
  ["tasks", lesson_11_tasks],
  ["effect programs", lesson_12_effect_programs],
  ["alternative and traversable", lesson_13_alternative_and_traversable],
  ["stm", lesson_14_stm],
  ["loop", lesson_15_loop],
];

for (const [name, run] of lessons) {
  await run();
  console.log("learn_you_a_typeclasses ok", name);
}
