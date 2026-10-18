import { from_array } from "../../src/iterable.ts";
import { Foldable } from "../../src/typeclasses.ts";
const items = Array.from({ length: 1_024 }, (_, index) => index);
export default {
  name: "retained 12-map Iterable plans with filtered terminal folds",
  create() {
    let value = from_array(items);
    for (let index = 0; index < 12; index += 1) {
      value = value.map((item) => item + 1);
    }
    return value.filter((item) => item % 2 === 0).take(256);
  },
  run(value: ReturnType<typeof from_array<number>>) {
    return Foldable.fold(value, 0, (sum, item) => sum + item);
  },
};
