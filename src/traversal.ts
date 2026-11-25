import {
  type Data,
  tagged_payload,
  tagged_tag,
  tagged_value,
} from "./typeclass.ts";
import { Applicative, applicative_pure } from "./typeclasses/applicative.ts";
import { custom_iterable } from "./internal.ts";
import { functor_map } from "./typeclasses/functor.ts";
import {
  do_runner_method,
  type FastDoSpec,
  Monad,
} from "./typeclasses/monad.ts";

type TraverseItems<dictionary extends Applicative<dictionary>> = <
  from,
  to,
  result,
>(
  items: Iterable<from>,
  fn: (item: from) => Data<dictionary, to>,
  build: (items: Iterable<to>) => result,
) => Data<dictionary, result>;

type SequentialTraverse<dictionary extends Applicative<dictionary>> = <
  from,
  to,
>(
  items: readonly from[],
  fn: (item: from) => Data<dictionary, to>,
) => Data<dictionary, to[]>;

const specializations = new WeakMap<object, unknown>();
const sequential_specializations = new WeakMap<object, unknown>();

/** @ignore Register a concrete dictionary's traversal without a module cycle. */
export function register_traversal<dictionary extends Applicative<dictionary>>(
  dictionary: dictionary,
  traverse: TraverseItems<dictionary>,
  sequential?: SequentialTraverse<dictionary>,
): void {
  specializations.set(dictionary, traverse);
  if (sequential !== undefined) {
    sequential_specializations.set(dictionary, sequential);
  }
}

type Tree<item> =
  | readonly [item]
  | readonly [Tree<item>, Tree<item>];

type TaggedItem<to> = {
  readonly [tagged_tag]?: PropertyKey;
  readonly [tagged_payload]?: to;
  readonly [tagged_value]?: () => readonly [string, to];
  value(): readonly [string, to];
};

const traversal_failed = /* @__PURE__ */ Symbol();

function unwrap_fast<to>(
  current: unknown,
  mode: 0 | 1 | 2,
): to | typeof traversal_failed {
  const tagged = current as TaggedItem<to>;
  if (mode === 2) return tagged.value() as unknown as to;
  const fail_tag = mode === 0 ? "Nothing" : "Left";
  const value_fn = tagged.value;
  if (value_fn !== undefined && value_fn === tagged[tagged_value]) {
    return tagged[tagged_tag] === fail_tag
      ? traversal_failed
      : tagged[tagged_payload] as to;
  }
  const raw = value_fn.call(tagged);
  return raw[0] === fail_tag ? traversal_failed : raw[1];
}

function make_leaf<item>(item: item): Tree<item> {
  return [item];
}

function make_branch<item>(left: Tree<item>, right: Tree<item>): Tree<item> {
  return [left, right];
}

function identity_array<item>(out: Iterable<item>): item[] {
  return out as item[];
}

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
  return traverse_items_into(items, applicative, fn, identity_array);
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
  const dict = applicative as unknown as {
    readonly [do_runner_method]?: FastDoSpec;
    readonly pure?: unknown;
  };
  const spec = dict[do_runner_method];
  if (Array.isArray(spec) && dict.pure === spec[4]) {
    const [mode, wrap] = spec;
    let failed: Data<applicative, unknown> | undefined;
    const out: to[] = [];
    for (const item of items) {
      const current = fn(item);
      if (failed === undefined) {
        const val = unwrap_fast<to>(current, mode);
        if (val === traversal_failed) failed = current;
        else out.push(val);
      }
    }
    return (failed ?? wrap(build(out))) as Data<applicative, result>;
  }
  const pending: (Data<applicative, Tree<to>> | undefined)[] = [];
  const push = (action: Data<applicative, Tree<to>>) => {
    let level = 0;
    while (pending[level] !== undefined) {
      action = Applicative.lift(make_branch, pending[level]!, action);
      pending[level] = undefined;
      level += 1;
    }
    pending[level] = action;
  };
  let iterable: Iterable<from> = items;
  if (Array.isArray(items) && items.length === 1) {
    const custom = custom_iterable(items);
    if (custom === undefined) {
      const first = fn(items[0]);
      if (items.length <= 1) return functor_map(first, (v) => build([v]));
      pending[0] = functor_map(first, make_leaf);
      for (let i = 1; i < items.length; i += 1) {
        push(functor_map(fn(items[i]), make_leaf));
      }
      iterable = [];
    } else {
      iterable = custom;
    }
  }
  // Binary carry combines adjacent groups, without buffering the input first.
  for (const item of iterable) push(functor_map(fn(item), make_leaf));
  let result: Data<applicative, Tree<to>> | undefined;
  for (let level = pending.length - 1; level >= 0; level -= 1) {
    const action = pending[level];
    if (action !== undefined) {
      result = result === undefined
        ? action
        : Applicative.lift(make_branch, result, action);
    }
  }
  return result === undefined
    ? applicative_pure(applicative, build([]))
    : functor_map(result, (tree) => build(tree_to_array(tree)));
}

/**
 * Explicit fail-fast traversal for monads. The callback is admitted by bind, so
 * later callbacks are never constructed after an eager failure (Maybe/Either).
 * Deferred monads construct each callback only when its predecessor succeeds.
 */
export function traverse_sequential<
  monad extends Monad<monad>,
  from,
  to,
>(
  items: readonly from[],
  monad: Monad<monad>,
  fn: (item: from) => Data<monad, to>,
): Data<monad, to[]> {
  const specialized = sequential_specializations.get(monad) as
    | SequentialTraverse<monad>
    | undefined;
  if (specialized !== undefined) return specialized(items, fn);
  const dict = monad as unknown as {
    readonly [do_runner_method]?: FastDoSpec;
    readonly bind?: unknown;
    readonly pure?: unknown;
  };
  const spec = dict[do_runner_method];
  if (Array.isArray(spec) && dict.bind === spec[3] && dict.pure === spec[4]) {
    const [mode, wrap] = spec;
    const len = items.length;
    const out = new Array<to>(len);
    for (let i = 0; i < len; i += 1) {
      const current = fn(items[i]);
      const val = unwrap_fast<to>(current, mode);
      if (val === traversal_failed) {
        return current as unknown as Data<monad, to[]>;
      }
      out[i] = val;
    }
    return wrap(out) as Data<monad, to[]>;
  }
  type Chain = { readonly item: to; readonly previous?: Chain };
  const len = items.length;
  let result = applicative_pure<monad, Chain | undefined>(
    monad as monad,
    undefined,
  );
  for (let i = 0; i < len; i += 1) {
    const item = items[i];
    result = Monad.bind(
      result,
      (previous) =>
        functor_map(fn(item), (value): Chain => ({ item: value, previous })),
    );
  }
  return functor_map(result, (chain) => {
    const out = new Array<to>(len);
    let index = len;
    while (chain !== undefined) {
      out[--index] = chain.item;
      chain = chain.previous;
    }
    return out;
  });
}

function tree_to_array<item>(tree: Tree<item>): item[] {
  const pending: Tree<item>[] = [tree];
  const out: item[] = [];
  while (pending.length > 0) {
    const current = pending.pop()!;
    if (current.length === 1) out.push(current[0]);
    else pending.push(current[1], current[0]);
  }
  return out;
}
