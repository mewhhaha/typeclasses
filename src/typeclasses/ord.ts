import {
  call_typeclass_method,
  type Data,
  type Dictionary,
  type Typeclass,
  typeclass,
  type TypeclassDictionary,
} from "../typeclass.ts";
import { inspect } from "../inspect.ts";
import { Eq, type Eq as EqDictionary } from "./eq.ts";

/** Result of a three-way comparison. */
export type Ordering = "lt" | "eq" | "gt";

/** Runtime token for the Ord typeclass. */
export const ord_typeclass = Symbol("Ord");

/** Eq dictionary capability for total ordering. */
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

/** The minimal complete definition of an Ord instance. */
export type MinimalOrd<dictionary extends Ord<dictionary>> = {
  compare: <item>(
    this: Data<dictionary, item>,
    right: Data<dictionary, item>,
  ) => Ordering;
};

/** @ignore */
export type OrdTypeclass =
  & Typeclass<typeof ord_typeclass, {
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
  }>
  & {
    derive<dictionary extends Ord<dictionary>>(
      dictionary: dictionary,
    ): (minimal: MinimalOrd<dictionary>) => void;
  };

/** Operations for ordering values through Ord dictionaries. */
export const Ord: OrdTypeclass = typeclass(ord_typeclass, {
  derive<dictionary extends Ord<dictionary>>(
    dictionary: dictionary,
  ): (minimal: MinimalOrd<dictionary>) => void {
    return (minimal) => {
      Ord.instance(dictionary)({
        compare: minimal.compare,
      });

      Eq.instance(dictionary)({
        eq<item>(
          this: Data<dictionary, item>,
          right: Data<dictionary, item>,
        ): boolean {
          return this.compare(right) === "eq";
        },
      });
    };
  },

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

/** Compare supported JavaScript values using the library's stable fallback. */
export function compare_unknown(left: unknown, right: unknown): Ordering {
  if (Object.is(left, right)) {
    return "eq";
  }

  const left_type = typeof left;
  const right_type = typeof right;

  if (left_type !== right_type) {
    return compare_number(type_rank(left), type_rank(right));
  }

  if (left_type === "number" && right_type === "number") {
    return compare_number(left as number, right as number);
  }

  if (left_type === "bigint" && right_type === "bigint") {
    return compare_bigint(left as bigint, right as bigint);
  }

  if (left_type === "string" && right_type === "string") {
    return compare_string(left as string, right as string);
  }

  if (left_type === "boolean" && right_type === "boolean") {
    return compare_number(Number(left), Number(right));
  }

  if (left_type === "symbol" && right_type === "symbol") {
    const description_order = compare_string(String(left), String(right));

    if (description_order !== "eq") {
      return description_order;
    }

    return compare_number(
      symbol_id(left as symbol),
      symbol_id(right as symbol),
    );
  }

  if (
    (left_type === "object" && left !== null && right !== null) ||
    left_type === "function"
  ) {
    const rendered_order = compare_string(inspect(left), inspect(right));

    if (rendered_order !== "eq") {
      return rendered_order;
    }

    return compare_number(
      reference_id(left as object),
      reference_id(right as object),
    );
  }

  return compare_number(type_rank(left), type_rank(right));
}

/** Compare two numbers with a three-way result. */
export function compare_number(left: number, right: number): Ordering {
  if (Object.is(left, right)) {
    return "eq";
  }

  if (Number.isNaN(left)) {
    return "gt";
  }

  if (Number.isNaN(right)) {
    return "lt";
  }

  if (left === right) {
    return Object.is(left, -0) ? "lt" : "gt";
  }

  if (left < right) {
    return "lt";
  }

  if (left > right) {
    return "gt";
  }

  return "eq";
}

const reference_ids = new WeakMap<object, number>();
const symbol_ids = new Map<symbol, number>();
let next_identity = 1;

function compare_string(left: string, right: string): Ordering {
  if (left < right) {
    return "lt";
  }

  if (left > right) {
    return "gt";
  }

  return "eq";
}

function reference_id(value: object): number {
  const existing = reference_ids.get(value);

  if (existing !== undefined) {
    return existing;
  }

  const id = next_identity;
  next_identity += 1;
  reference_ids.set(value, id);
  return id;
}

function symbol_id(value: symbol): number {
  const existing = symbol_ids.get(value);

  if (existing !== undefined) {
    return existing;
  }

  const id = next_identity;
  next_identity += 1;
  symbol_ids.set(value, id);
  return id;
}

function type_rank(value: unknown): number {
  if (value === null) {
    return 1;
  }

  switch (typeof value) {
    case "undefined":
      return 0;
    case "boolean":
      return 2;
    case "number":
      return 3;
    case "bigint":
      return 4;
    case "string":
      return 5;
    case "symbol":
      return 6;
    case "function":
      return 7;
    case "object":
      return 8;
    default:
      return 9;
  }
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
