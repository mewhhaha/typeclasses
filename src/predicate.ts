import {
  type As,
  type Data,
  data,
  type type_data,
  type type_item,
} from "./typeclass.ts";
import { Contravariant, Monoid, Semigroup, Show } from "./typeclasses.ts";

/** @ignore */
export declare const predicate_identity: unique symbol;

/** A boolean test over values of one input type. */
export type Predicate<item> = (value: item) => boolean;

/** Dictionary type for contravariant predicates. */
export interface AsPredicate
  extends
    As<AsPredicate, typeof predicate_identity>,
    Show<AsPredicate>,
    Contravariant<AsPredicate>,
    Monoid<AsPredicate> {
  /** Higher-kinded slot for the predicate input type. */
  readonly [type_item]: unknown;
  /** Predicate representation at the selected input type. */
  readonly [type_data]: Predicate<this[typeof type_item]>;
}

/** A predicate wrapped with fluent contravariant methods. */
export type PredicateValue<item> = Data<AsPredicate, item>;

/** Callable Predicate dictionary and the source of its instances. */
export const Predicate: AsPredicate = data<AsPredicate>();

/** Wrap a predicate function. */
export function predicate<item>(
  value: Predicate<item>,
): PredicateValue<item> {
  return Predicate(value);
}

/** Test a value with a wrapped predicate. */
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
