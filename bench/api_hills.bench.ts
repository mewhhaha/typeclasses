import { Just } from "../src/maybe.ts";
import { match_tagged } from "../src/typeclass.ts";

const values = Array.from({ length: 1_000 }, (_, index) => Just(index));
const cases = { Just: (item: number) => item, Nothing: () => 0 };
let sink = 0;
Deno.bench({
  name: "match/raw-tuple-boundary1000",
  group: "tagged match",
  baseline: true,
  fn() {
    for (const value of values) {
      sink += match_tagged<ReturnType<typeof value.value>, number>(
        value.value(),
        cases,
      );
    }
  },
});
Deno.bench({
  name: "match/direct-payload1000",
  group: "tagged match",
  fn() {
    for (const value of values) sink += value.match(cases);
  },
});
void sink;
