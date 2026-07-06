import type { Data } from "./typeclass.ts";
import { Applicative, Foldable, Functor, Monad } from "./typeclasses.ts";

export function label_values<dictionary extends Functor<dictionary>>(
  value: Data<dictionary, number>,
): Data<dictionary, string> {
  return Functor.map(value, (item) => {
    return "value:" + item.toString();
  });
}

export function add_values<dictionary extends Applicative<dictionary>>(
  left: Data<dictionary, number>,
  right: Data<dictionary, number>,
): Data<dictionary, number> {
  const add_right = Functor.map(left, (left_value) => {
    return (right_value: number) => left_value + right_value;
  });

  return Applicative.ap(add_right, right);
}

export function keep_positive<dictionary extends Monad<dictionary>>(
  value: Data<dictionary, number>,
  reject: (value: number) => Data<dictionary, number>,
): Data<dictionary, number> {
  return Monad.bind(value, (item) => {
    if (item >= 0) {
      return Applicative.pure(value, item);
    }

    return reject(item);
  });
}

export function sum_values<dictionary extends Foldable<dictionary>>(
  value: Data<dictionary, number>,
): number {
  return Foldable.fold(value, 0, (state, item) => {
    return state + item;
  });
}
