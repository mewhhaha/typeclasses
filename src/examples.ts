import type {
  Applicative,
  Foldable,
  Functor,
  Kind,
  Monad,
  TypeName,
} from "./trait.ts";

export function label_values<uri extends TypeName>(
  impl: Functor<uri>,
  value: Kind<uri, number>,
): Kind<uri, string> {
  return impl.map(value, (item: number) => "value:" + item.toString());
}

export function add_values<uri extends TypeName>(
  impl: Applicative<uri>,
  left: Kind<uri, number>,
  right: Kind<uri, number>,
): Kind<uri, number> {
  const add_right = impl.map(left, (left_value: number) => {
    return (right_value: number) => left_value + right_value;
  });

  return impl.ap(add_right, right);
}

export function keep_positive<uri extends TypeName>(
  impl: Monad<uri>,
  value: Kind<uri, number>,
  reject: (value: number) => Kind<uri, number>,
): Kind<uri, number> {
  return impl.flat_map(value, (item: number) => {
    if (item >= 0) {
      return impl.pure(item);
    }

    return reject(item);
  });
}

export function sum_values<uri extends TypeName>(
  impl: Foldable<uri>,
  value: Kind<uri, number>,
): number {
  return impl.fold(
    value,
    0,
    (state: number, item: number) => state + item,
  );
}
