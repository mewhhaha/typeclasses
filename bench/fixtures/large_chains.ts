import { Either, Left, Right } from "../../src/either.ts";
import { Just, Nothing } from "../../src/maybe.ts";
import { Do } from "../../src/typeclasses.ts";

export const do_length = 8;

export function maybe_do(input: number, on_success?: (value: number) => void) {
  return Do(function* () {
    const value_0 = yield* Just(input);
    const value_1 = yield* Just(value_0 + 1);
    const value_2 = yield* Just(value_1 + 1);
    const value_3 = yield* Just(value_2 + 1);
    const value_4 = yield* Just(value_3 + 1);
    const value_5 = yield* Just(value_4 + 1);
    const value_6 = yield* Just(value_5 + 1);
    const value_7 = yield* Just(value_6 + 1);
    const value_8 = yield* Just(value_7 + 1);
    on_success?.(value_8);
    return value_8 * 2;
  });
}

export function either_do(input: number, on_success?: (value: number) => void) {
  return Do(function* () {
    const value_0 = yield* Right(input);
    const value_1 = yield* Right(value_0 + 1);
    const value_2 = yield* Right(value_1 + 1);
    const value_3 = yield* Right(value_2 + 1);
    const value_4 = yield* Right(value_3 + 1);
    const value_5 = yield* Right(value_4 + 1);
    const value_6 = yield* Right(value_5 + 1);
    const value_7 = yield* Right(value_6 + 1);
    const value_8 = yield* Right(value_7 + 1);
    on_success?.(value_8);
    return value_8 * 2;
  });
}

export function observe(input: number) {
  const events: string[] = [];
  const maybe = maybe_do(input, (value) => events.push("maybe:" + value));
  const either = either_do(input, (value) => events.push("either:" + value));
  const absent = Do(function* () {
    const first = yield* Just(input);
    const second = yield* Nothing<number>();
    events.push("unreachable maybe:" + first);
    return second;
  });
  const failed = Do(Either.with_left<string>(), function* () {
    const first = yield* Right<string, number>(input);
    const second = yield* Left<string, number>("bad");
    events.push("unreachable either:" + first);
    return second;
  });
  return {
    maybe: maybe.value(),
    either: either.value(),
    absent: absent.value(),
    failed: failed.value(),
    events,
  };
}
