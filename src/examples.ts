import {
  Applicative,
  Foldable,
  Functor,
  type Kind,
  Monad,
  type TypeId,
} from "./trait.ts";

export function label_values<type_id extends TypeId>(
  impl: Functor<type_id>,
  value: Kind<type_id, number>,
): Kind<type_id, string> {
  return Functor.map(
    impl,
    value,
    (item: number) => "value:" + item.toString(),
  );
}

export function add_values<type_id extends TypeId>(
  impl: Applicative<type_id>,
  left: Kind<type_id, number>,
  right: Kind<type_id, number>,
): Kind<type_id, number> {
  const add_right = Functor.map(
    impl,
    left,
    (left_value: number) => {
      return (right_value: number) => left_value + right_value;
    },
  );

  return Applicative.ap(impl, add_right, right);
}

export function keep_positive<type_id extends TypeId>(
  impl: Monad<type_id>,
  value: Kind<type_id, number>,
  reject: (value: number) => Kind<type_id, number>,
): Kind<type_id, number> {
  return Monad.flat_map(impl, value, (item: number) => {
    if (item >= 0) {
      return impl.pure(item);
    }

    return reject(item);
  });
}

export function sum_values<type_id extends TypeId>(
  impl: Foldable<type_id>,
  value: Kind<type_id, number>,
): number {
  return Foldable.fold(
    impl,
    value,
    0,
    (state: number, item: number) => state + item,
  );
}
