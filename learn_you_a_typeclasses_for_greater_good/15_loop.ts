import { assert_equals } from "../src/assert.ts";
import { done, loop, rec } from "../src/loop.ts";

export function lesson_15_loop() {
  const factorial = loop({ n: 6, acc: 1 }, ({ n, acc }) => {
    if (n <= 1) {
      return done(acc);
    }

    return rec({ n: n - 1, acc: acc * n });
  });
  const sum = loop({ rest: [1, 2, 3, 4], total: 0 }, (state) => {
    const [head, ...tail] = state.rest;

    if (head === undefined) {
      return done(state.total);
    }

    return rec({
      rest: tail,
      total: state.total + head,
    });
  });

  assert_equals(factorial, 720);
  assert_equals(sum, 10);
}
