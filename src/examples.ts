import type { Dictionary, Value } from "./trait.ts";
import { Applicative, Foldable, Functor, Monad } from "./traits.ts";

export function label_values<
  dictionary extends Dictionary & Functor<dictionary>,
>(
  value: Value<dictionary, number>,
): Value<dictionary, string> {
  return Functor.map(value, (item: number) => {
    return "value:" + item.toString();
  });
}

export function add_values<
  dictionary extends Dictionary & Applicative<dictionary>,
>(
  left: Value<dictionary, number>,
  right: Value<dictionary, number>,
): Value<dictionary, number> {
  const add_right = Functor.map(left, (left_value: number) => {
    return (right_value: number) => left_value + right_value;
  });

  return Applicative.ap(add_right, right);
}

export function keep_positive<
  dictionary extends Dictionary & Monad<dictionary>,
>(
  value: Value<dictionary, number>,
  reject: (value: number) => Value<dictionary, number>,
): Value<dictionary, number> {
  return Monad.bind(value, (item: number) => {
    if (item >= 0) {
      return Applicative.pure(value, item);
    }

    return reject(item);
  });
}

export function sum_values<
  dictionary extends Dictionary & Foldable<dictionary>,
>(
  value: Value<dictionary, number>,
): number {
  return Foldable.fold(value, 0, (state: number, item: number) => {
    return state + item;
  });
}
