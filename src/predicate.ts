import type { Runnable } from "./data_value.ts";
import {
  type As,
  type Data,
  data,
  type type_data,
  type type_item,
} from "./typeclass.ts";
import { Contravariant, Monoid, Semigroup, Show } from "./typeclasses.ts";

/** @ignore */
export const predicate_identity: unique symbol = /* @__PURE__ */ Symbol(
  "predicate_identity",
);

/** A boolean test over values of one input type. */
export type RawPredicate<item> = (value: item) => boolean;

/** @ignore */
export interface AsPredicateLambda {
  readonly [type_item]: unknown;
  readonly [type_data]: RawPredicate<this[typeof type_item]>;
}

/** Dictionary type for contravariant predicates. */
export interface AsPredicate
  extends
    As<AsPredicateLambda, typeof predicate_identity>,
    Show<AsPredicate>,
    Contravariant<AsPredicate>,
    Monoid<AsPredicate>,
    Runnable {
}

/** A predicate wrapped with fluent contravariant methods. */
export type Predicate<item> = Data<AsPredicate, item>;

/** Callable Predicate dictionary and the source of its instances. */
export const Predicate: AsPredicate = /* @__PURE__ */ create_predicate();

/** Wrap a predicate function. */
export function predicate<item>(
  value: RawPredicate<item>,
): Predicate<item> {
  return Predicate(value);
}

/** Test a value with a wrapped predicate. */
export function test<item>(
  value: Predicate<item>,
  item: item,
): boolean {
  return value.run(item);
}

function create_predicate(): AsPredicate {
  const Predicate: AsPredicate = data<AsPredicate>(predicate_identity);
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

  return Predicate;
}
