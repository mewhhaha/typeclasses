type BoxedFunctor<item> = {
  map: (fn: (item: item) => unknown) => any;
};

type BoxedMonad<item> = {
  pure: (item: item) => any;
  flat_map: (fn: (item: item) => any) => any;
};

type BoxedFoldable<item, out> = {
  fold: (
    initial: out,
    fn: (state: out, item: item) => out,
  ) => out;
};

export function label_values(
  value: BoxedFunctor<number>,
): any {
  return value.map((item: number) => {
    return "value:" + item.toString();
  });
}

export function add_values<right>(
  left: BoxedFunctor<number>,
  right: right,
): any {
  const add_right = left.map((left_value: number) => {
    return (right_value: number) => left_value + right_value;
  });

  return add_right.ap(right);
}

export function keep_positive(
  value: BoxedMonad<number>,
  reject: (value: number) => any,
): any {
  return value.flat_map((item: number) => {
    if (item >= 0) {
      return value.pure(item);
    }

    return reject(item);
  });
}

export function sum_values(
  value: BoxedFoldable<number, number>,
): number {
  return value.fold(0, (state: number, item: number) => state + item);
}
