import {
  type As,
  type Data,
  data,
  type type_data,
  type type_item,
} from "./typeclass.ts";
import { Contravariant, Monoid, Semigroup, Show } from "./typeclasses.ts";

export type Predicate<item> = (value: item) => boolean;

export interface AsPredicate
  extends
    As<AsPredicate>,
    Show<AsPredicate>,
    Contravariant<AsPredicate>,
    Semigroup<AsPredicate>,
    Monoid<AsPredicate> {
  readonly [type_item]: unknown;
  readonly [type_data]: Predicate<this[typeof type_item]>;
}

export type PredicateValue<item> = Data<AsPredicate, item>;

export const Predicate: AsPredicate = data<AsPredicate>();

export function predicate<item>(
  value: Predicate<item>,
): PredicateValue<item> {
  return Predicate(value);
}

export function test<item>(
  value: PredicateValue<item>,
  item: item,
): boolean {
  return value.run(item);
}

Show.instance(Predicate)({
  show() {
    return "Predicate(?)";
  },
});

Contravariant.instance(Predicate)({
  contramap(fn) {
    const test = this.value();

    return predicate((value) => {
      return test(fn(value));
    });
  },
});

Semigroup.instance(Predicate)({
  concat(right) {
    const left = this.value();
    const right_value = right.value();

    return predicate((value) => {
      if (!left(value)) {
        return false;
      }

      return right_value(value);
    });
  },
});

Monoid.instance(Predicate)({
  empty() {
    return predicate(() => true);
  },
});
