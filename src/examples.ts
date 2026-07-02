import type { Dictionary, Value } from "./trait.ts";
import type { Applicative, Foldable, Functor, Monad } from "./traits.ts";

export function label_values<
  dictionary extends Dictionary & Functor<dictionary>,
>(
  value: Value<dictionary, number>,
): Value<dictionary, string> {
  return value.map((item: number) => {
    return "value:" + item.toString();
  });
}

export function add_values<
  dictionary extends Dictionary & Applicative<dictionary>,
>(
  left: Value<dictionary, number>,
  right: Value<dictionary, number>,
): Value<dictionary, number> {
  const add_right = left.map((left_value: number) => {
    return (right_value: number) => left_value + right_value;
  });

  return add_right.ap(right);
}

export function keep_positive<
  dictionary extends Dictionary & Monad<dictionary>,
>(
  value: Value<dictionary, number>,
  reject: (value: number) => Value<dictionary, number>,
): Value<dictionary, number> {
  return value.bind((item: number) => {
    if (item >= 0) {
      return value.pure(item);
    }

    return reject(item);
  });
}

export function sum_values<
  dictionary extends Dictionary & Foldable<dictionary>,
>(
  value: Value<dictionary, number>,
): number {
  return value.fold(0, (state: number, item: number) => state + item);
}
