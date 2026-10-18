import type { Data } from "../../src/typeclass.ts";
import { Applicative } from "../../src/typeclasses/applicative.ts";
import { Functor } from "../../src/typeclasses/functor.ts";

type TraverseItems<dictionary extends Applicative<dictionary>> = <
  from,
  to,
  result,
>(
  items: Iterable<from>,
  fn: (item: from) => Data<dictionary, to>,
  build: (items: Iterable<to>) => result,
) => Data<dictionary, result>;

const specializations = new WeakMap<object, unknown>();

/** @ignore Register a concrete dictionary's traversal without a module cycle. */
export function register_traversal<dictionary extends Applicative<dictionary>>(
  dictionary: dictionary,
  traverse: TraverseItems<dictionary>,
): void {
  specializations.set(dictionary, traverse);
}

type Tree<item> =
  | readonly [0, item]
  | readonly [1, Tree<item>, Tree<item>];

/** Traverse finite inputs in order with logarithmic construction depth. */
export function traverse_items<
  applicative extends Applicative<applicative>,
  from,
  to,
>(
  items: Iterable<from>,
  applicative: applicative,
  fn: (item: from) => Data<applicative, to>,
): Data<applicative, to[]> {
  return traverse_items_into(items, applicative, fn, (items) => [...items]);
}

/** Traverse into a final collection without an intermediate output array. */
export function traverse_items_into<
  applicative extends Applicative<applicative>,
  from,
  to,
  result,
>(
  items: Iterable<from>,
  applicative: applicative,
  fn: (item: from) => Data<applicative, to>,
  build: (items: Iterable<to>) => result,
): Data<applicative, result> {
  const specialized = specializations.get(applicative) as
    | TraverseItems<applicative>
    | undefined;
  if (specialized !== undefined) return specialized(items, fn, build);
  // Binary carry combines adjacent groups, without buffering the input first.
  const pending: (Data<applicative, Tree<to>> | undefined)[] = [];
  for (const item of items) {
    let action = Functor.map(
      fn(item),
      (item): Tree<to> => [0, item],
    );
    let level = 0;
    while (pending[level] !== undefined) {
      action = merge(pending[level]!, action);
      pending[level] = undefined;
      level += 1;
    }
    pending[level] = action;
  }
  let result: Data<applicative, Tree<to>> | undefined;
  for (let level = pending.length - 1; level >= 0; level -= 1) {
    const action = pending[level];
    if (action === undefined) continue;
    if (result === undefined) result = action;
    else result = merge(result, action);
  }
  if (result === undefined) return Applicative.pure(applicative, build([]));
  return Functor.map(result, (tree) => build(tree_items(tree)));

  function merge(
    left: Data<applicative, Tree<to>>,
    right: Data<applicative, Tree<to>>,
  ): Data<applicative, Tree<to>> {
    return Applicative.lift(
      (left, right): Tree<to> => [1, left, right],
      left,
      right,
    );
  }
}

function* tree_items<item>(tree: Tree<item>): Generator<item> {
  const pending = [tree];
  while (pending.length > 0) {
    const current = pending.pop()!;
    switch (current[0]) {
      case 0:
        yield current[1];
        break;
      case 1:
        pending.push(current[2], current[1]);
        break;
    }
  }
}
