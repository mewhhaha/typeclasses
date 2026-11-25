import {
  type Data,
  type Dictionary,
  instance_for_token,
  type Typeclass,
  typeclass,
  type TypeclassDictionary,
} from "../typeclass.ts";
import { inspect } from "../inspect.ts";
import { Eq, type Eq as EqDictionary } from "./eq.ts";

/** Result of a three-way comparison. */
export type Ordering = "lt" | "eq" | "gt";

/** Runtime token for the Ord typeclass. */
export const ord_typeclass = /* @__PURE__ */ Symbol("Ord");

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
      dictionary: Ord<dictionary>,
    ): (minimal: MinimalOrd<dictionary>) => void;
  };

/** Operations for ordering values through Ord dictionaries. */
export const Ord: OrdTypeclass = /* @__PURE__ */ typeclass(ord_typeclass, {
  derive<dictionary extends Ord<dictionary>>(
    dictionary: Ord<dictionary>,
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

  compare: ord_compare,

  lt<dictionary extends Ord<dictionary>, item>(
    left: Data<dictionary, item>,
    right: Data<dictionary, item>,
  ): boolean {
    return ord_compare(left, right) === "lt";
  },

  lte<dictionary extends Ord<dictionary>, item>(
    left: Data<dictionary, item>,
    right: Data<dictionary, item>,
  ): boolean {
    return ord_compare(left, right) !== "gt";
  },

  gt<dictionary extends Ord<dictionary>, item>(
    left: Data<dictionary, item>,
    right: Data<dictionary, item>,
  ): boolean {
    return ord_compare(left, right) === "gt";
  },

  gte<dictionary extends Ord<dictionary>, item>(
    left: Data<dictionary, item>,
    right: Data<dictionary, item>,
  ): boolean {
    return ord_compare(left, right) !== "lt";
  },

  min<dictionary extends Ord<dictionary>, item>(
    left: Data<dictionary, item>,
    right: Data<dictionary, item>,
  ): Data<dictionary, item> {
    return ord_compare(left, right) !== "gt" ? left : right;
  },

  max<dictionary extends Ord<dictionary>, item>(
    left: Data<dictionary, item>,
    right: Data<dictionary, item>,
  ): Data<dictionary, item> {
    return ord_compare(left, right) !== "lt" ? left : right;
  },
});

function ord_compare<dictionary extends Ord<dictionary>, item>(
  left: Data<dictionary, item>,
  right: Data<dictionary, item>,
): Ordering {
  return (instance_for_token(ord_typeclass, left).compare<item>).call(
    left,
    right,
  );
}

/** Compare supported JavaScript values using the library's stable fallback. */
export function compare_unknown(left: unknown, right: unknown): Ordering {
  if (Object.is(left, right)) return "eq";

  const left_type = typeof left;
  const right_type = typeof right;
  if (left_type !== right_type) {
    return compare_ordered(type_rank(left), type_rank(right));
  }

  switch (left_type) {
    case "number":
      return compare_number(left as number, right as number);
    case "bigint":
    case "string":
    case "boolean":
      return compare_ordered(left as string, right as string);
    case "symbol": {
      const rendered = compare_ordered(String(left), String(right));
      return rendered !== "eq" ? rendered : compare_ordered(
        stable_id(symbol_ids, left as symbol),
        stable_id(symbol_ids, right as symbol),
      );
    }
    case "object":
      if (left === null || right === null) {
        return compare_ordered(type_rank(left), type_rank(right));
      }
      // falls through
    case "function": {
      const rendered = compare_ordered(inspect(left), inspect(right));
      return rendered !== "eq" ? rendered : compare_ordered(
        stable_id(reference_ids, left as object),
        stable_id(reference_ids, right as object),
      );
    }
    default:
      return compare_ordered(type_rank(left), type_rank(right));
  }
}

/** Compare two numbers with a three-way result. */
export function compare_number(left: number, right: number): Ordering {
  if (Object.is(left, right)) return "eq";
  if (Number.isNaN(left)) return "gt";
  if (Number.isNaN(right)) return "lt";
  if (left === right) return Object.is(left, -0) ? "lt" : "gt";
  return left < right ? "lt" : "gt";
}

const reference_ids = new WeakMap<object, number>();
const symbol_ids = new Map<symbol, number>();
let next_identity = 1;

function compare_ordered(
  left: number | bigint | string | boolean,
  right: number | bigint | string | boolean,
): Ordering {
  return left < right ? "lt" : left > right ? "gt" : "eq";
}

function stable_id<key>(
  ids: { get(k: key): number | undefined; set(k: key, v: number): unknown },
  value: key,
): number {
  let id = ids.get(value);
  if (id === undefined) ids.set(value, id = next_identity++);
  return id;
}

const type_ranks: Record<string, number> = {
  undefined: 0,
  boolean: 2,
  number: 3,
  bigint: 4,
  string: 5,
  symbol: 6,
  function: 7,
  object: 8,
};

function type_rank(value: unknown): number {
  return value === null ? 1 : (type_ranks[typeof value] ?? 9);
}
