import {
  call_typeclass_method,
  type Data,
  type Dictionary,
  type Typeclass,
  typeclass,
  type TypeclassDictionary,
} from "../typeclass.ts";
import type { Eq as EqDictionary } from "./eq.ts";

export type Ordering = "lt" | "eq" | "gt";

export const ord_typeclass = Symbol("Ord");

export interface Ord<dictionary extends Dictionary> extends
  TypeclassDictionary<
    dictionary,
    typeof ord_typeclass,
    {
      compare: <item>(
        this: Data<dictionary, item>,
        right: Data<dictionary, item>,
      ) => Ordering;
    }
  >,
  EqDictionary<dictionary> {}

type OrdTypeclass = Typeclass<typeof ord_typeclass, {
  compare<dictionary extends Ord<dictionary>, item>(
    left: Data<dictionary, item>,
    right: Data<dictionary, item>,
  ): Ordering;
  lt<dictionary extends Ord<dictionary>, item>(
    left: Data<dictionary, item>,
    right: Data<dictionary, item>,
  ): boolean;
  lte<dictionary extends Ord<dictionary>, item>(
    left: Data<dictionary, item>,
    right: Data<dictionary, item>,
  ): boolean;
  gt<dictionary extends Ord<dictionary>, item>(
    left: Data<dictionary, item>,
    right: Data<dictionary, item>,
  ): boolean;
  gte<dictionary extends Ord<dictionary>, item>(
    left: Data<dictionary, item>,
    right: Data<dictionary, item>,
  ): boolean;
  min<dictionary extends Ord<dictionary>, item>(
    left: Data<dictionary, item>,
    right: Data<dictionary, item>,
  ): Data<dictionary, item>;
  max<dictionary extends Ord<dictionary>, item>(
    left: Data<dictionary, item>,
    right: Data<dictionary, item>,
  ): Data<dictionary, item>;
}>;

export const Ord: OrdTypeclass = typeclass(ord_typeclass, {
  compare<
    dictionary extends Ord<dictionary>,
    item,
  >(
    left: Data<dictionary, item>,
    right: Data<dictionary, item>,
  ): Ordering {
    return call_typeclass_method(
      this.instance_for(left).compare<item>,
      left,
      right,
    );
  },

  lt<dictionary extends Ord<dictionary>, item>(
    left: Data<dictionary, item>,
    right: Data<dictionary, item>,
  ): boolean {
    return this.compare(left, right) === "lt";
  },

  lte<dictionary extends Ord<dictionary>, item>(
    left: Data<dictionary, item>,
    right: Data<dictionary, item>,
  ): boolean {
    return this.compare(left, right) !== "gt";
  },

  gt<dictionary extends Ord<dictionary>, item>(
    left: Data<dictionary, item>,
    right: Data<dictionary, item>,
  ): boolean {
    return this.compare(left, right) === "gt";
  },

  gte<dictionary extends Ord<dictionary>, item>(
    left: Data<dictionary, item>,
    right: Data<dictionary, item>,
  ): boolean {
    return this.compare(left, right) !== "lt";
  },

  min<dictionary extends Ord<dictionary>, item>(
    left: Data<dictionary, item>,
    right: Data<dictionary, item>,
  ): Data<dictionary, item> {
    if (this.lte(left, right)) {
      return left;
    }

    return right;
  },

  max<dictionary extends Ord<dictionary>, item>(
    left: Data<dictionary, item>,
    right: Data<dictionary, item>,
  ): Data<dictionary, item> {
    if (this.gte(left, right)) {
      return left;
    }

    return right;
  },
});

export function compare_unknown(left: unknown, right: unknown): Ordering {
  if (Object.is(left, right)) {
    return "eq";
  }

  if (left instanceof Date && right instanceof Date) {
    return compare_number(left.getTime(), right.getTime());
  }

  const left_type = typeof left;
  const right_type = typeof right;

  if (left_type === "number" && right_type === "number") {
    return compare_number(left as number, right as number);
  }

  if (left_type === "bigint" && right_type === "bigint") {
    return compare_bigint(left as bigint, right as bigint);
  }

  if (left_type === "string" && right_type === "string") {
    return compare_number(
      (left as string).localeCompare(right as string),
      0,
    );
  }

  if (left_type === "boolean" && right_type === "boolean") {
    return compare_number(Number(left), Number(right));
  }

  return compare_number(
    Deno.inspect(left).localeCompare(Deno.inspect(right)),
    0,
  );
}

export function compare_number(left: number, right: number): Ordering {
  if (left < right) {
    return "lt";
  }

  if (left > right) {
    return "gt";
  }

  return "eq";
}

function compare_bigint(left: bigint, right: bigint): Ordering {
  if (left < right) {
    return "lt";
  }

  if (left > right) {
    return "gt";
  }

  return "eq";
}
