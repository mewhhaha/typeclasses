import { Just, Nothing } from "../src/maybe.ts";
import { Ord } from "../src/typeclasses.ts";

const shown = Just({ count: 1 }).show();

if (shown !== "Just({ count: 1 })") {
  throw new Error("unexpected Show output: " + shown);
}

if (!Just(42).eq(Just(42))) {
  throw new Error("Eq failed under Node");
}

if (Ord.compare(Nothing<number>(), Just(1)) !== "lt") {
  throw new Error("Ord failed under Node");
}

if (Ord.compare(Just({ count: 1 }), Just({ count: 2 })) !== "lt") {
  throw new Error("Ord structural fallback failed under Node");
}

const matched = Just(41).match({
  Just: (value) => value + 1,
  Nothing: () => 0,
});

if (matched !== 42) {
  throw new Error("match failed under Node");
}
