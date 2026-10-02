import type { Data } from "./typeclass.ts";
import { Applicative, Functor } from "./typeclasses.ts";

type Tree<item> =
  | { readonly tag: "leaf"; readonly item: item }
  | {
    readonly tag: "branch";
    readonly left: Tree<item>;
    readonly right: Tree<item>;
  };

/** Traverse in input order, sharing immutable branches and materializing once. */
export function traverse_items<
  applicative extends Applicative<applicative>,
  from,
  to,
>(
  items: readonly from[],
  applicative: applicative,
  fn: (item: from) => Data<applicative, to>,
): Data<applicative, to[]> {
  if (items.length === 0) {
    return Applicative.pure(applicative, []);
  }

  return Functor.map(visit(0, items.length), materialize);

  function visit(start: number, end: number): Data<applicative, Tree<to>> {
    if (end - start === 1) {
      return Functor.map(fn(items[start]), (item): Tree<to> => ({
        tag: "leaf",
        item,
      }));
    }

    const middle = start + Math.floor((end - start) / 2);
    const left = visit(start, middle);
    const right = visit(middle, end);

    return Applicative.ap(
      Functor.map(left, (left) => (right: Tree<to>): Tree<to> => ({
        tag: "branch",
        left,
        right,
      })),
      right,
    );
  }
}

function materialize<item>(tree: Tree<item>): item[] {
  const pending = [tree];
  const out: item[] = [];

  while (pending.length > 0) {
    const current = pending.pop()!;

    switch (current.tag) {
      case "leaf":
        out.push(current.item);
        break;
      case "branch":
        pending.push(current.right, current.left);
        break;
    }
  }

  return out;
}
