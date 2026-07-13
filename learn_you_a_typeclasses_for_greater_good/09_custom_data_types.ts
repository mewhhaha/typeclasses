import { assert_equals } from "../src/assert.ts";
import {
  type As,
  type Data,
  data,
  type type_data,
  type type_item,
} from "../src/typeclass.ts";
import { Foldable, Functor, Show } from "../src/typeclasses.ts";

type Tree<item> =
  | readonly ["leaf", item]
  | readonly ["branch", Tree<item>, Tree<item>];

declare const tree_identity: unique symbol;

interface AsTree
  extends
    As<AsTree, typeof tree_identity>,
    Show<AsTree>,
    Functor<AsTree>,
    Foldable<AsTree> {
  readonly [type_item]: unknown;
  readonly [type_data]: Tree<this[typeof type_item]>;
}

type TreeValue<item> = Data<AsTree, item>;

const Tree = data<AsTree>();

export function lesson_09_custom_data_types() {
  const tree = branch(
    leaf(20),
    branch(leaf(1), leaf(21)),
  );
  const doubled = tree.map((value) => value * 2);
  const total = Foldable.fold(tree, 0, (state, item) => state + item);

  assert_equals(tree.show(), "Branch(Leaf(20), Branch(Leaf(1), Leaf(21)))");
  assert_equals(doubled.show(), "Branch(Leaf(40), Branch(Leaf(2), Leaf(42)))");
  assert_equals(total, 42);
}

function leaf<item>(value: item): TreeValue<item> {
  return Tree(["leaf", value]);
}

function branch<item>(
  left: TreeValue<item>,
  right: TreeValue<item>,
): TreeValue<item> {
  return Tree(["branch", left.value(), right.value()]);
}

Show.instance(Tree)({
  show() {
    return show_tree(this.value());
  },
});

Functor.instance(Tree)({
  map(fn) {
    return Tree(map_tree(this.value(), fn));
  },
});

Foldable.instance(Tree)({
  fold(initial, fn) {
    return fold_tree(this.value(), initial, fn);
  },
});

function show_tree<item>(tree: Tree<item>): string {
  switch (tree[0]) {
    case "leaf":
      return "Leaf(" + Deno.inspect(tree[1]) + ")";
    case "branch":
      return "Branch(" + show_tree(tree[1]) + ", " + show_tree(tree[2]) + ")";
  }
}

function map_tree<from, to>(
  tree: Tree<from>,
  fn: (value: from) => to,
): Tree<to> {
  switch (tree[0]) {
    case "leaf":
      return ["leaf", fn(tree[1])];
    case "branch":
      return ["branch", map_tree(tree[1], fn), map_tree(tree[2], fn)];
  }
}

function fold_tree<item, out>(
  tree: Tree<item>,
  initial: out,
  fn: (state: out, item: item) => out,
): out {
  switch (tree[0]) {
    case "leaf":
      return fn(initial, tree[1]);
    case "branch": {
      const left = fold_tree(tree[1], initial, fn);
      return fold_tree(tree[2], left, fn);
    }
  }
}
