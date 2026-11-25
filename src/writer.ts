import { array_concat_method, ArrayT } from "./array.ts";
import { ChunkLog, type RawChunkLog } from "./chunk_log.ts";
import { from_array as list_from_array, List, type RawList } from "./list.ts";
import { MapT } from "./map.ts";
import { SetT } from "./set.ts";
import {
  type As,
  as_data,
  type Data,
  data,
  type Dictionary,
  is_data,
  kind,
  type type_data,
  type type_identity,
  type type_item,
  type WrappedData,
} from "./typeclass.ts";
import { register_traversal } from "./traversal.ts";
import { type CustomDoRunner, do_runner_method } from "./typeclasses/monad.ts";
import {
  type Effect,
  is_effect,
  is_lift_of,
  type Lift,
  pure,
  suspend,
  type TaggedOperation,
} from "./effects.ts";
import {
  cell_dictionary,
  type CellIdentity,
  type NominalKey,
  type WithoutCell,
} from "./cell.ts";
import { inspect } from "./inspect.ts";
import {
  Applicative,
  applicative_lift_method,
  Functor,
  Monad,
  type Monoid as MonoidDictionary,
  Show,
} from "./typeclasses.ts";

/** @ignore */
export const writer_identity: unique symbol = /* @__PURE__ */ Symbol(
  "writer_identity",
);

/** A value paired with output accumulated through a Monoid dictionary. */
export type RawWriter<
  output extends Dictionary,
  log,
  item,
> = readonly [item, Data<output, log>];

/** @ignore */
export interface AsWriterLambda<output extends Dictionary, log> {
  readonly [type_item]: unknown;
  readonly [type_data]: RawWriter<output, log, this[typeof type_item]>;
}

/** The callable Writer dictionary for one output and log type. */
export interface AsWriter<
  output extends Dictionary,
  log,
> extends
  As<AsWriterLambda<output, log>, typeof writer_identity>,
  Show<AsWriter<output, log>>,
  Monad<AsWriter<output, log>> {
  /** Wraps an item and its accumulated output. */
  <item>(value: RawWriter<output, log, item>): Writer<output, log, item>;
}

/** A Writer pair wrapped with its typeclass dictionary. */
export type Writer<
  output extends Dictionary,
  log,
  item,
> = WrappedData<
  AsWriter<output, log>,
  RawWriter<output, log, item>,
  item
>;

/** @ignore */
export type WriterConstructor =
  & Omit<AsWriter<Dictionary, unknown>, "pure">
  & {
    <item>(
      value: RawWriter<Dictionary, unknown, item>,
    ): Data<AsWriter<Dictionary, unknown>, item>;
    <output extends MonoidDictionary<output>, log, item>(
      value: RawWriter<output, log, item>,
    ): Writer<output, log, item>;
    /** Configures Writer with the empty value for an output Monoid. */
    with<output extends MonoidDictionary<output>, log>(
      empty: Data<output, log>,
    ): AsWriter<output, log>;
  };

/** The Writer dictionary and configurable constructor. */
export const Writer = data<
  AsWriter<Dictionary, unknown>
>(writer_identity) as unknown as WriterConstructor;
const writer_kind = Writer[kind];

const array_kind = ArrayT[kind];
const array_prototype = /* @__PURE__ */ Object.getPrototypeOf(ArrayT([]));
const canonical_array_concat = array_concat_method;

const list_kind = List[kind];
const list_nil_prototype = /* @__PURE__ */ Object.getPrototypeOf(List.Nil());
const list_cons_prototype = /* @__PURE__ */ Object.getPrototypeOf(
  List(["Cons", undefined, ["Nil"]]),
);
const canonical_list_concat = /* @__PURE__ */ (() => List.concat)();

const set_kind = SetT[kind];
const set_prototype = /* @__PURE__ */ Object.getPrototypeOf(SetT.empty());
const canonical_set_concat = /* @__PURE__ */ (() => SetT.concat)();

const map_kind = MapT[kind];
const map_prototype = /* @__PURE__ */ Object.getPrototypeOf(MapT.empty());
const canonical_map_concat = /* @__PURE__ */ (() => MapT.concat)();

const chunk_log_kind = ChunkLog[kind];
const chunk_log_prototype = /* @__PURE__ */ Object.getPrototypeOf(
  ChunkLog.empty(),
);
const canonical_chunk_log_concat = /* @__PURE__ */ (() => ChunkLog.concat)();

const LOG_NONE = 0;
const LOG_ARRAY = 1;
const LOG_LIST = 2;
const LOG_SET = 3;
const LOG_MAP = 4;
const LOG_CHUNK = 5;

type WriterLogBuffer = {
  readonly items: unknown[];
  sealed: boolean;
  shared?: boolean;
};
const bw_item = Symbol("Writer.item");
const bw_buf = Symbol("Writer.buf");
const bw_len = Symbol("Writer.len");
const bw_cached = Symbol("Writer.cached");
type BufferedWriterTarget = {
  [bw_item]: unknown;
  [bw_buf]: WriterLogBuffer;
  [bw_len]: number;
  [bw_cached]: RawWriter<Dictionary, unknown, unknown> | undefined;
};
type MakeBufferedWriter = (
  item: unknown,
  buf: WriterLogBuffer,
  len: number,
) => Data<AsWriter<Dictionary, unknown>, unknown>;
type MakePlainWriter = (
  item: unknown,
  output: Data<Dictionary, unknown>,
) => Data<AsWriter<Dictionary, unknown>, unknown>;

function buffered_writer_value(
  this: BufferedWriterTarget,
): RawWriter<Dictionary, unknown, unknown> {
  let cached = this[bw_cached];
  if (cached !== undefined) return cached;
  const buf = this[bw_buf];
  const len = this[bw_len];
  let arr: unknown[];
  if (!buf.shared && len === buf.items.length) {
    buf.sealed = true;
    arr = buf.items;
  } else {
    arr = buf.items.slice(0, len);
  }
  cached = [
    this[bw_item],
    ArrayT(arr) as unknown as Data<Dictionary, unknown>,
  ] as const;
  this[bw_cached] = cached;
  return cached;
}

function create_buffered_writer_factory(
  dictionary: unknown,
): MakeBufferedWriter {
  const dict = dictionary as (
    v: RawWriter<Dictionary, unknown, unknown>,
  ) => Data<AsWriter<Dictionary, unknown>, unknown>;
  const sample = dict(
    [undefined, undefined] as unknown as RawWriter<
      Dictionary,
      unknown,
      unknown
    >,
  );
  const base_proto = Object.getPrototypeOf(sample);
  const bw_proto = Object.create(base_proto);
  Object.defineProperty(bw_proto, "value", { value: buffered_writer_value });

  function BufferedWriter(
    this: BufferedWriterTarget,
    item: unknown,
    buf: WriterLogBuffer,
    len: number,
  ) {
    this[bw_item] = item;
    this[bw_buf] = buf;
    this[bw_len] = len;
    this[bw_cached] = undefined;
  }
  BufferedWriter.prototype = bw_proto;
  const Ctor = BufferedWriter as unknown as {
    new (
      item: unknown,
      buf: WriterLogBuffer,
      len: number,
    ): Data<AsWriter<Dictionary, unknown>, unknown>;
  };
  return (item, buf, len) => new Ctor(item, buf, len);
}

const make_writer_bw = /* @__PURE__ */ create_buffered_writer_factory(Writer);

const writer_cell_empties = new WeakMap<
  object,
  () => Data<Dictionary, unknown>
>();

/** @ignore Create a fresh empty output value for a Writer cell. */
export function writer_cell_empty<
  key extends PropertyKey,
  output extends Dictionary,
  log,
>(cell: AsWriterCell<key, output, log>): Data<output, log> {
  const create = writer_cell_empties.get(cell);
  if (create === undefined) {
    throw new TypeError("Expected a Writer cell created by writer_cell");
  }
  return create() as Data<output, log>;
}

Object.defineProperty(Writer, "with", {
  value: configured_writer,
});

/** Creates a Writer value from an item and accumulated output. */
export function writer<
  output extends MonoidDictionary<output>,
  log,
  item,
>(
  value: item,
  output: Data<output, log>,
): Writer<output, log, item> {
  return Writer([value, output] as const) as unknown as Writer<
    output,
    log,
    item
  >;
}

/** Appends output without producing a meaningful item. */
export function tell<output extends MonoidDictionary<output>, log>(
  output: Data<output, log>,
): Writer<output, log, void> {
  return writer(undefined, output);
}

/** @ignore */
export interface AsWriterCellLambda<output extends Dictionary, log> {
  readonly [type_item]: unknown;
  readonly [type_data]: RawWriter<output, log, this[typeof type_item]>;
}

/**
 * A keyed Writer cell: its callable dictionary and the operations writing it.
 *
 * The operations live on the dictionary rather than in a wrapper type so that
 * `typeof cell` is exactly the dictionary its values carry, which is what lets
 * `Uses<typeof cell>` cancel against those values in `Program.scope`.
 */
export interface AsWriterCell<
  key extends PropertyKey,
  output extends Dictionary,
  log,
> extends
  As<
    AsWriterCellLambda<output, log>,
    CellIdentity<typeof writer_identity, key>
  >,
  Show<AsWriterCell<key, output, log>>,
  Monad<AsWriterCell<key, output, log>> {
  /** Wraps an item and its accumulated output. */
  <item>(
    value: RawWriter<output, log, item>,
  ): WriterCellValue<key, output, log, item>;
  /** Appends output to this cell without producing a meaningful item. */
  tell(output: Data<output, log>): WriterCellValue<key, output, log, void>;
  /** Pairs an item with output appended to this cell. */
  write<item>(
    value: item,
    output: Data<output, log>,
  ): WriterCellValue<key, output, log, item>;
}

/** A Writer pair wrapped with its cell's dictionary. */
export type WriterCellValue<
  key extends PropertyKey,
  output extends Dictionary,
  log,
  item,
> = WrappedData<
  AsWriterCell<key, output, log>,
  RawWriter<output, log, item>,
  item
>;

/** Declare a Writer cell using a runtime key and its empty output. */
export function writer_cell<
  const key extends PropertyKey,
  output extends MonoidDictionary<output>,
  log,
>(
  key: key & NominalKey<key>,
  empty: Data<output, log>,
): AsWriterCell<key, output, log> {
  return make_writer_cell<key, output, log>(key, empty);
}

function make_writer_cell<
  key extends PropertyKey,
  output extends Dictionary,
  log,
>(key: key, empty: Data<output, log>): AsWriterCell<key, output, log> {
  const dictionary = cell_dictionary<AsWriterCell<key, output, log>>(
    Writer,
    key,
  );
  const make_bw = create_buffered_writer_factory(dictionary);
  const make_plain: MakePlainWriter = (item, out) =>
    dictionary(
      [item, out] as RawWriter<output, log, unknown>,
    ) as unknown as Data<AsWriter<Dictionary, unknown>, unknown>;

  writer_cell_empties.set(
    dictionary,
    () => empty_output(empty) as Data<Dictionary, unknown>,
  );

  Object.defineProperties(dictionary, {
    tell: {
      value: (output: Data<output, log>) =>
        wrap(undefined, output) as WriterCellValue<key, output, log, void>,
    },
    write: {
      value: <item>(value: item, output: Data<output, log>) =>
        wrap(value, output),
    },
  });

  Show.instance(dictionary)({
    show() {
      const [value, output] = this.value();
      return "Writer(" + inspect(value) + ", " +
        inspect((output as Data<Dictionary, unknown>).value()) + ")";
    },
  });

  Functor.instance(dictionary)({
    map(fn) {
      return writer_map(
        this as unknown as Data<AsWriter<Dictionary, unknown>, unknown>,
        fn as (value: unknown) => unknown,
        make_bw,
        make_plain,
      ) as unknown as WriterCellValue<key, output, log, ReturnType<typeof fn>>;
    },
  });

  Applicative.instance(dictionary)({
    pure(value) {
      return wrap(value, empty_output(empty) as Data<output, log>);
    },

    [applicative_lift_method](fn, rest) {
      return writer_lift(
        this as unknown as Data<AsWriter<Dictionary, unknown>, unknown>,
        fn,
        rest as unknown as readonly Data<
          AsWriter<Dictionary, unknown>,
          unknown
        >[],
        make_bw,
        make_plain,
      ) as never;
    },

    ap(value) {
      return writer_ap(
        this as unknown as Data<AsWriter<Dictionary, unknown>, unknown>,
        value as unknown as Data<AsWriter<Dictionary, unknown>, unknown>,
        make_bw,
        make_plain,
      ) as never;
    },
  });

  Monad.instance(dictionary)({
    bind(fn) {
      return writer_bind(
        this as unknown as Data<AsWriter<Dictionary, unknown>, unknown>,
        fn as unknown as (
          value: unknown,
        ) => Data<AsWriter<Dictionary, unknown>, unknown>,
        make_bw,
        make_plain,
      ) as never;
    },
  });

  register_writer_fast_paths(
    dictionary,
    () => empty_output(empty) as Data<Dictionary, unknown>,
  );

  return dictionary;

  function wrap<item>(
    value: item,
    output: Data<output, log>,
  ): WriterCellValue<key, output, log, item> {
    return dictionary([value, output] as RawWriter<output, log, item>);
  }
}

/** @ignore */
export type WithoutWriterCell<requirements, key extends PropertyKey> =
  WithoutCell<requirements, typeof writer_identity, key>;

/**
 * The empty output every lift of `key` in `requirements` accumulates into.
 *
 * One `run_writer` drains every operation addressed to its cell, so the
 * accumulator has to satisfy all of them at once: each lift contributes a
 * parameter position, so lifts writing into different Monoids under one key
 * yield an intersection no value supplies. Lifts of other cells contribute
 * nothing and stay pending.
 */
export type WriterCellEmpty<requirements, key extends PropertyKey> = (
  requirements extends Lift<infer dictionary, infer _item>
    ? dictionary[typeof type_identity] extends
      CellIdentity<typeof writer_identity, key>
      ? dictionary extends
        { readonly [type_data]: readonly [unknown, infer empty] }
        ? (empty: empty) => void
      : never
    : never
    : never
) extends (empty: infer empty) => void ? empty : unknown;

/**
 * The empty output a terminal cell run needs, or `never` when the effect still
 * carries requirements that the terminal runner cannot discharge.
 */
export type TerminalWriterCellEmpty<requirements, key extends PropertyKey> =
  [WithoutWriterCell<requirements, key>] extends [never]
    ? WriterCellEmpty<requirements, key>
    : never;

/** @ignore */
export type WithoutWriter<requirements> = requirements extends
  Lift<infer dictionary, infer _item>
  ? dictionary[typeof type_identity] extends typeof writer_identity ? never
  : requirements
  : requirements;

/**
 * The empty output every Writer lift in `requirements` accumulates into.
 *
 * All Writer lifts share one runtime dictionary, so a single `run_writer`
 * concatenates every `tell` in the program into one accumulator. That
 * accumulator has to satisfy all of them at once: each lift contributes a
 * parameter position, so lifts writing into different Monoids yield an
 * intersection no value supplies, and the program is rejected instead of
 * concatenating mismatched outputs.
 */
export type WriterEmpty<requirements> = (
  requirements extends Lift<infer dictionary, infer _item>
    ? dictionary[typeof type_identity] extends typeof writer_identity
      ? dictionary extends
        { readonly [type_data]: readonly [unknown, infer empty] }
        ? (empty: empty) => void
      : never
    : never
    : never
) extends (empty: infer empty) => void ? empty : unknown;

/** Handles one cell's lifts starting from its declared empty output. */
export function run_writer<
  key extends PropertyKey,
  output extends Dictionary,
  log,
  requirements,
  item,
>(
  cell: AsWriterCell<key, output, log>,
  effect: Effect<requirements, item>,
): Effect<
  WithoutWriterCell<requirements, key>,
  readonly [item, Data<output, log> & WriterCellEmpty<requirements, key>]
>;
/** Handles Writer lifts from the supplied empty output value. */
export function run_writer<requirements, item>(
  effect: Effect<requirements, item>,
  empty: WriterEmpty<requirements>,
): Effect<
  WithoutWriter<requirements>,
  readonly [item, WriterEmpty<requirements>]
>;
/** Handles one cell's lifts from the supplied empty output value. */
export function run_writer<
  key extends PropertyKey,
  output extends Dictionary,
  log,
  requirements,
  item,
>(
  cell: AsWriterCell<key, output, log>,
  effect: Effect<requirements, item>,
  empty: NoInfer<Data<output, log>> & WriterCellEmpty<requirements, key>,
): Effect<
  WithoutWriterCell<requirements, key>,
  readonly [item, Data<output, log> & WriterCellEmpty<requirements, key>]
>;
export function run_writer(
  first:
    | Effect<unknown, unknown>
    | AsWriterCell<PropertyKey, Dictionary, unknown>,
  second: unknown,
  third?: unknown,
): Effect<unknown, unknown> {
  if (arguments.length === 2) {
    const create_empty = writer_cell_empties.get(first as object);
    if (create_empty !== undefined) {
      const cell = first as AsWriterCell<PropertyKey, Dictionary, unknown>;
      return run_writer_kind(
        second as Effect<unknown, unknown>,
        cell[kind] as AsWriter<Dictionary, unknown>[typeof kind],
        create_empty(),
      );
    }

    return run_writer_kind(
      first as Effect<unknown, unknown>,
      writer_kind,
      second,
    );
  }

  return run_writer_kind(
    second as Effect<unknown, unknown>,
    (first as AsWriterCell<PropertyKey, Dictionary, unknown>)[
      kind
    ] as AsWriter<Dictionary, unknown>[typeof kind],
    third,
  );
}

function flush_log_output(
  mode: number,
  current_output: Data<Dictionary, unknown>,
  arr_buf: unknown[] | undefined,
  set_buf: Set<unknown> | undefined,
  map_buf: Map<unknown, unknown> | undefined,
  chunk_buf: RawChunkLog<unknown> | undefined,
): Data<Dictionary, unknown> {
  switch (mode) {
    case LOG_ARRAY:
      if (arr_buf !== undefined) {
        return ArrayT(arr_buf) as unknown as Data<Dictionary, unknown>;
      }
      return current_output;
    case LOG_LIST:
      if (arr_buf !== undefined) {
        return list_from_array(arr_buf) as unknown as Data<Dictionary, unknown>;
      }
      return current_output;
    case LOG_SET:
      if (set_buf !== undefined) {
        return as_data(SetT, set_buf) as unknown as Data<Dictionary, unknown>;
      }
      return current_output;
    case LOG_MAP:
      if (map_buf !== undefined) {
        return as_data(MapT, map_buf) as unknown as Data<Dictionary, unknown>;
      }
      return current_output;
    case LOG_CHUNK:
      if (chunk_buf !== undefined) {
        return (chunk_buf.tag === "empty"
          ? ChunkLog.empty()
          : ChunkLog(chunk_buf)) as unknown as Data<Dictionary, unknown>;
      }
      return current_output;
    default:
      return current_output;
  }
}

function append_list_log(buffer: unknown[], list: RawList<unknown>): void {
  let cur = list;
  while (cur[0] === "Cons") {
    buffer.push(cur[1]);
    cur = cur[2];
  }
}

function append_bw_items(
  buffer: unknown[],
  buf: WriterLogBuffer,
  len: number,
): void {
  const items = buf.items;
  if (len === 1) {
    buffer.push(items[0]);
    return;
  }
  for (let i = 0; i < len; i += 1) buffer.push(items[i]);
}

function has_kind(value: unknown, expected: unknown): boolean {
  return typeof value === "object" && value !== null &&
    (value as Dictionary)[kind] === expected;
}

function run_writer_kind<requirements, item>(
  effect: Effect<requirements, item>,
  runtime_kind: AsWriter<Dictionary, unknown>[typeof kind],
  empty: WriterEmpty<requirements>,
): Effect<
  WithoutWriter<requirements>,
  readonly [item, WriterEmpty<requirements>]
> {
  let current = effect as Effect<requirements, unknown>;
  let current_output = empty as Data<Dictionary, unknown>;
  let mode = detect_log_mode(current_output);
  let arr_buf: unknown[] | undefined;
  let set_buf: Set<unknown> | undefined;
  let map_buf: Map<unknown, unknown> | undefined;
  let chunk_buf: RawChunkLog<unknown> | undefined;

  while (true) {
    switch (current[0]) {
      case "pure": {
        current_output = flush_log_output(
          mode,
          current_output,
          arr_buf,
          set_buf,
          map_buf,
          chunk_buf,
        );
        return pure(
          [current[1] as item, current_output] as const,
        ) as unknown as Effect<
          WithoutWriter<requirements>,
          readonly [item, WriterEmpty<requirements>]
        >;
      }
      case "impure": {
        const operation = current[1];
        if (is_lift_of(operation, runtime_kind)) {
          const entry = operation[1] as Data<
            AsWriter<Dictionary, unknown>,
            unknown
          >;
          const entry_bw = entry as unknown as BufferedWriterTarget;
          const entry_buf = entry_bw[bw_buf];
          let value: unknown;
          if (
            entry_buf !== undefined &&
            mode === LOG_ARRAY &&
            ArrayT.concat === canonical_array_concat
          ) {
            value = entry_bw[bw_item];
            if (arr_buf === undefined) {
              arr_buf = [];
              append_array_log(
                arr_buf,
                current_output.value() as readonly unknown[],
              );
            }
            append_bw_items(arr_buf, entry_buf, entry_bw[bw_len]);
          } else {
            const pair = entry.value();
            value = pair[0];
            const next_output = pair[1];
            if (
              mode === LOG_ARRAY &&
              ArrayT.concat === canonical_array_concat &&
              has_kind(next_output, array_kind)
            ) {
              if (arr_buf === undefined) {
                arr_buf = [];
                append_array_log(
                  arr_buf,
                  current_output.value() as readonly unknown[],
                );
              }
              append_array_log(
                arr_buf,
                next_output.value() as readonly unknown[],
              );
            } else if (
              mode === LOG_LIST &&
              List.concat === canonical_list_concat &&
              has_kind(next_output, list_kind)
            ) {
              if (arr_buf === undefined) {
                arr_buf = [];
                append_list_log(
                  arr_buf,
                  current_output.value() as RawList<unknown>,
                );
              }
              append_list_log(arr_buf, next_output.value() as RawList<unknown>);
            } else if (
              mode === LOG_SET &&
              SetT.concat === canonical_set_concat &&
              has_kind(next_output, set_kind)
            ) {
              if (set_buf === undefined) {
                set_buf = new Set(
                  current_output.value() as ReadonlySet<unknown>,
                );
              }
              for (const el of next_output.value() as ReadonlySet<unknown>) {
                set_buf.add(el);
              }
            } else if (
              mode === LOG_MAP &&
              MapT.concat === canonical_map_concat &&
              has_kind(next_output, map_kind)
            ) {
              if (map_buf === undefined) {
                map_buf = new Map(
                  current_output.value() as ReadonlyMap<unknown, unknown>,
                );
              }
              for (
                const [k, v] of next_output.value() as ReadonlyMap<
                  unknown,
                  unknown
                >
              ) {
                map_buf.set(k, v);
              }
            } else if (
              mode === LOG_CHUNK &&
              ChunkLog.concat === canonical_chunk_log_concat &&
              has_kind(next_output, chunk_log_kind)
            ) {
              if (chunk_buf === undefined) {
                chunk_buf = current_output.value() as RawChunkLog<unknown>;
              }
              const next_raw = next_output.value() as RawChunkLog<unknown>;
              if (chunk_buf.tag === "empty") chunk_buf = next_raw;
              else if (next_raw.tag !== "empty") {
                chunk_buf = { tag: "concat", left: chunk_buf, right: next_raw };
              }
            } else {
              current_output = flush_log_output(
                mode,
                current_output,
                arr_buf,
                set_buf,
                map_buf,
                chunk_buf,
              );
              arr_buf = undefined;
              set_buf = undefined;
              map_buf = undefined;
              chunk_buf = undefined;
              mode = LOG_NONE;
              current_output = concat_output(
                current_output,
                next_output,
              ) as Data<Dictionary, unknown>;
            }
          }
          current = current[2](value) as Effect<requirements, unknown>;
          continue;
        }

        // Flush any mutable buffer before suspending so replayed continuations
        // observe an immutable snapshot rather than sharing a buffer.
        current_output = flush_log_output(
          mode,
          current_output,
          arr_buf,
          set_buf,
          map_buf,
          chunk_buf,
        );
        arr_buf = undefined;
        set_buf = undefined;
        map_buf = undefined;
        chunk_buf = undefined;
        const suspended = current;
        const suspended_output = current_output as WriterEmpty<requirements>;
        return suspend(
          suspended[1] as WithoutWriter<requirements>,
          (value) =>
            run_writer_kind(
              suspended[2](value),
              runtime_kind,
              suspended_output,
            ),
        ) as Effect<
          WithoutWriter<requirements>,
          readonly [item, WriterEmpty<requirements>]
        >;
      }
    }
  }
}

/**
 * The empty output a terminal run needs, or `never` when the effect still
 * carries requirements that `run_writer_terminal` cannot discharge.
 */
export type TerminalWriterEmpty<requirements> =
  [WithoutWriter<requirements>] extends [never] ? WriterEmpty<requirements>
    : never;

/** Runs one cell value starting from its declared empty output. */
export function run_writer_terminal<
  key extends PropertyKey,
  output extends MonoidDictionary<output>,
  log,
  item,
>(
  cell: AsWriterCell<key, output, log>,
  writer: WriterCellValue<key, output, log, item>,
): readonly [item, Data<output, log>];
/** Runs an effect whose only remaining lifts address `cell`, using its empty output. */
export function run_writer_terminal<
  key extends PropertyKey,
  output extends MonoidDictionary<output>,
  log,
  requirements,
  item,
>(
  cell: AsWriterCell<key, output, log>,
  effect:
    & Effect<requirements, item>
    & ([WithoutWriterCell<requirements, key>] extends [never] ? unknown
      : never),
): readonly [item, Data<output, log>];
/** Runs one Writer value or an effect containing only Writer lifts. */
export function run_writer_terminal<
  output extends MonoidDictionary<output>,
  log,
  item,
>(
  writer: Writer<output, log, item>,
  empty: Data<output, log>,
): readonly [item, Data<output, log>];
/** Runs an effect containing only Writer lifts. */
export function run_writer_terminal<requirements, item>(
  effect: Effect<requirements, item>,
  empty: TerminalWriterEmpty<requirements>,
): readonly [item, WriterEmpty<requirements>];
/** Runs a Writer value or an effect containing only Writer lifts. */
export function run_writer_terminal<
  requirements,
  output extends MonoidDictionary<output>,
  log,
  item,
>(
  value:
    | Writer<output, log, item>
    | Effect<requirements, item>,
  empty: Data<output, log> & TerminalWriterEmpty<requirements>,
): readonly [item, Data<output, log>];
/** Runs one cell value. */
export function run_writer_terminal<
  key extends PropertyKey,
  output extends MonoidDictionary<output>,
  log,
  item,
>(
  cell: AsWriterCell<key, output, log>,
  writer: WriterCellValue<key, output, log, item>,
  empty: Data<output, log>,
): readonly [item, Data<output, log>];
/** Runs an effect whose only remaining lifts address `cell`. */
export function run_writer_terminal<
  key extends PropertyKey,
  output extends MonoidDictionary<output>,
  log,
  requirements,
  item,
>(
  cell: AsWriterCell<key, output, log>,
  effect: Effect<requirements, item>,
  empty:
    & NoInfer<Data<output, log>>
    & TerminalWriterCellEmpty<requirements, key>,
): readonly [item, Data<output, log>];
export function run_writer_terminal(
  first: unknown,
  second: unknown,
  third?: unknown,
): readonly [unknown, unknown] {
  if (arguments.length === 2) {
    const create_empty = writer_cell_empties.get(first as object);
    if (create_empty !== undefined) {
      const cell = first as AsWriterCell<PropertyKey, Dictionary, unknown>;
      return run_writer_terminal_kind(
        second as Effect<unknown, unknown>,
        cell[kind] as AsWriter<Dictionary, unknown>[typeof kind],
        create_empty(),
      );
    }
    return run_writer_terminal_kind(
      first as Effect<unknown, unknown>,
      writer_kind,
      second as Data<Dictionary, unknown>,
    );
  }

  return run_writer_terminal_kind(
    second as Effect<unknown, unknown>,
    (first as AsWriterCell<PropertyKey, Dictionary, unknown>)[
      kind
    ] as AsWriter<Dictionary, unknown>[typeof kind],
    third as Data<Dictionary, unknown>,
  );
}

function run_writer_terminal_kind(
  effect: Effect<unknown, unknown>,
  runtime_kind: AsWriter<Dictionary, unknown>[typeof kind],
  empty: Data<Dictionary, unknown>,
): readonly [unknown, Data<Dictionary, unknown>] {
  type output = Dictionary;
  type log = unknown;
  type item = unknown;

  if (is_data(effect)) {
    if (
      (effect as unknown as Data<AsWriter<Dictionary, unknown>, unknown>)[
        kind
      ] !==
        runtime_kind
    ) {
      throw new TypeError("Unhandled effect operation: lift");
    }

    const [value, next_output] = (effect as unknown as Writer<
      output,
      log,
      item
    >).value();
    return [value, concat_output(empty, next_output)];
  }

  let current = effect as Effect<
    Lift<AsWriter<output, log>, unknown>,
    unknown
  >;
  let current_output = empty;
  let mode = detect_log_mode(empty);
  let arr_buf: unknown[] | undefined;
  let set_buf: Set<unknown> | undefined;
  let map_buf: Map<unknown, unknown> | undefined;
  let chunk_buf: RawChunkLog<unknown> | undefined;

  while (true) {
    if (!is_effect(current)) {
      throw new TypeError("Invalid effect value");
    }

    if (current[0] === "pure") {
      current_output = flush_log_output(
        mode,
        current_output,
        arr_buf,
        set_buf,
        map_buf,
        chunk_buf,
      );
      return [current[1] as item, current_output];
    }

    if (current[0] !== "impure") {
      throw new TypeError("Invalid effect value");
    }

    const operation = current[1];

    if (!is_lift_of(operation, runtime_kind)) {
      throw new TypeError(
        "Unhandled effect operation: " + (operation as TaggedOperation)[0],
      );
    }

    const entry = operation[1] as Data<AsWriter<Dictionary, unknown>, unknown>;
    const entry_bw = entry as unknown as BufferedWriterTarget;
    const entry_buf = entry_bw[bw_buf];
    let value: unknown;
    if (
      entry_buf !== undefined &&
      mode === LOG_ARRAY &&
      ArrayT.concat === canonical_array_concat
    ) {
      value = entry_bw[bw_item];
      if (arr_buf === undefined) {
        arr_buf = [];
        append_array_log(arr_buf, current_output.value() as readonly unknown[]);
      }
      append_bw_items(arr_buf, entry_buf, entry_bw[bw_len]);
    } else {
      const pair = entry.value();
      value = pair[0];
      const next_output = pair[1];
      if (
        mode === LOG_ARRAY &&
        ArrayT.concat === canonical_array_concat &&
        has_kind(next_output, array_kind)
      ) {
        if (arr_buf === undefined) {
          arr_buf = [];
          append_array_log(
            arr_buf,
            current_output.value() as readonly unknown[],
          );
        }
        append_array_log(arr_buf, next_output.value() as readonly unknown[]);
      } else if (
        mode === LOG_LIST &&
        List.concat === canonical_list_concat &&
        has_kind(next_output, list_kind)
      ) {
        if (arr_buf === undefined) {
          arr_buf = [];
          append_list_log(arr_buf, current_output.value() as RawList<unknown>);
        }
        append_list_log(arr_buf, next_output.value() as RawList<unknown>);
      } else if (
        mode === LOG_SET &&
        SetT.concat === canonical_set_concat &&
        has_kind(next_output, set_kind)
      ) {
        if (set_buf === undefined) {
          set_buf = new Set(current_output.value() as ReadonlySet<unknown>);
        }
        for (const el of next_output.value() as ReadonlySet<unknown>) {
          set_buf.add(el);
        }
      } else if (
        mode === LOG_MAP &&
        MapT.concat === canonical_map_concat &&
        has_kind(next_output, map_kind)
      ) {
        if (map_buf === undefined) {
          map_buf = new Map(
            current_output.value() as ReadonlyMap<unknown, unknown>,
          );
        }
        for (
          const [k, v] of next_output.value() as ReadonlyMap<unknown, unknown>
        ) {
          map_buf.set(k, v);
        }
      } else if (
        mode === LOG_CHUNK &&
        ChunkLog.concat === canonical_chunk_log_concat &&
        has_kind(next_output, chunk_log_kind)
      ) {
        if (chunk_buf === undefined) {
          chunk_buf = current_output.value() as RawChunkLog<unknown>;
        }
        const next_raw = next_output.value() as RawChunkLog<unknown>;
        if (chunk_buf.tag === "empty") chunk_buf = next_raw;
        else if (next_raw.tag !== "empty") {
          chunk_buf = { tag: "concat", left: chunk_buf, right: next_raw };
        }
      } else {
        current_output = flush_log_output(
          mode,
          current_output,
          arr_buf,
          set_buf,
          map_buf,
          chunk_buf,
        );
        arr_buf = undefined;
        set_buf = undefined;
        map_buf = undefined;
        chunk_buf = undefined;
        mode = LOG_NONE;
        current_output = concat_output(current_output, next_output);
      }
    }
    current = current[2](value) as Effect<
      Lift<AsWriter<output, log>, unknown>,
      unknown
    >;
  }
}

/** @ignore */
export type WriterOutput<requirements> = requirements extends Lift<
  AsWriter<infer output, infer _log>,
  infer _item
> ? output
  : never;

/** @ignore */
export type WriterLog<requirements> = requirements extends Lift<
  AsWriter<infer _output, infer log>,
  infer _item
> ? log
  : never;

function writer_map(
  self: Data<AsWriter<Dictionary, unknown>, unknown>,
  fn: (value: unknown) => unknown,
  make_bw: MakeBufferedWriter,
  make_plain: MakePlainWriter,
): Data<AsWriter<Dictionary, unknown>, unknown> {
  const bw = self as unknown as BufferedWriterTarget;
  const buf = bw[bw_buf];
  if (buf !== undefined) {
    buf.shared = true;
    return make_bw(fn(bw[bw_item]), buf, bw[bw_len]);
  }
  const [value, output] = self.value();
  return make_plain(fn(value), output);
}

function combine_writer_outputs(
  left_bw: BufferedWriterTarget | undefined,
  left_output: Data<Dictionary, unknown> | undefined,
  right_bw: BufferedWriterTarget | undefined,
  right_output: Data<Dictionary, unknown> | undefined,
  result_item: unknown,
  make_bw: MakeBufferedWriter,
  make_plain: MakePlainWriter,
): Data<AsWriter<Dictionary, unknown>, unknown> {
  if (left_bw !== undefined) {
    const left_buf = left_bw[bw_buf];
    if (ArrayT.concat === canonical_array_concat) {
      if (right_bw !== undefined) {
        const right_buf = right_bw[bw_buf];
        const left_len = left_bw[bw_len];
        const right_len = right_bw[bw_len];
        if (!left_buf.sealed && left_len === left_buf.items.length) {
          left_buf.shared = true;
          append_bw_items(left_buf.items, right_buf, right_len);
          return make_bw(result_item, left_buf, left_len + right_len);
        }
        const items = left_buf.items.slice(0, left_len);
        append_bw_items(items, right_buf, right_len);
        return make_bw(
          result_item,
          { items, sealed: false },
          left_len + right_len,
        );
      }
      if (has_kind(right_output, array_kind)) {
        const left_len = left_bw[bw_len];
        const right_items = right_output!.value() as readonly unknown[];
        if (!left_buf.sealed && left_len === left_buf.items.length) {
          left_buf.shared = true;
          append_array_log(left_buf.items, right_items);
          return make_bw(result_item, left_buf, left_buf.items.length);
        }
        const items = left_buf.items.slice(0, left_len);
        append_array_log(items, right_items);
        return make_bw(result_item, { items, sealed: false }, items.length);
      }
    }
    const materialized_left = (
      left_bw as unknown as Data<AsWriter<Dictionary, unknown>, unknown>
    ).value()[1];
    const materialized_right = right_bw !== undefined
      ? (right_bw as unknown as Data<AsWriter<Dictionary, unknown>, unknown>)
        .value()[1]
      : right_output!;
    return make_plain(
      result_item,
      concat_output(materialized_left, materialized_right),
    );
  }

  if (
    has_canonical_array_concat(left_output!) &&
    ArrayT.concat === canonical_array_concat
  ) {
    if (right_bw !== undefined) {
      const items: unknown[] = [];
      append_array_log(items, left_output!.value() as readonly unknown[]);
      append_bw_items(items, right_bw[bw_buf], right_bw[bw_len]);
      return make_bw(result_item, { items, sealed: false }, items.length);
    }
    if (has_kind(right_output, array_kind)) {
      const items: unknown[] = [];
      append_array_log(items, left_output!.value() as readonly unknown[]);
      append_array_log(items, right_output!.value() as readonly unknown[]);
      return make_bw(result_item, { items, sealed: false }, items.length);
    }
  }

  const materialized_right = right_bw !== undefined
    ? (right_bw as unknown as Data<AsWriter<Dictionary, unknown>, unknown>)
      .value()[1]
    : right_output!;
  return make_plain(
    result_item,
    concat_output(left_output!, materialized_right),
  );
}

function writer_bind(
  self: Data<AsWriter<Dictionary, unknown>, unknown>,
  fn: (value: unknown) => Data<AsWriter<Dictionary, unknown>, unknown>,
  make_bw: MakeBufferedWriter,
  make_plain: MakePlainWriter,
): Data<AsWriter<Dictionary, unknown>, unknown> {
  const left_target = self as unknown as BufferedWriterTarget;
  const left_is_bw = left_target[bw_buf] !== undefined;
  let left_item: unknown;
  let left_output: Data<Dictionary, unknown> | undefined;
  if (left_is_bw) {
    left_item = left_target[bw_item];
  } else {
    const pair = self.value();
    left_item = pair[0];
    left_output = pair[1];
  }
  const next = fn(left_item);
  const right_target = next as unknown as BufferedWriterTarget;
  if (right_target[bw_buf] !== undefined) {
    return combine_writer_outputs(
      left_is_bw ? left_target : undefined,
      left_output,
      right_target,
      undefined,
      right_target[bw_item],
      make_bw,
      make_plain,
    );
  }
  const [right_item, right_output] = next.value();
  return combine_writer_outputs(
    left_is_bw ? left_target : undefined,
    left_output,
    undefined,
    right_output,
    right_item,
    make_bw,
    make_plain,
  );
}

function writer_ap(
  self: Data<AsWriter<Dictionary, unknown>, unknown>,
  value: Data<AsWriter<Dictionary, unknown>, unknown>,
  make_bw: MakeBufferedWriter,
  make_plain: MakePlainWriter,
): Data<AsWriter<Dictionary, unknown>, unknown> {
  const left_target = self as unknown as BufferedWriterTarget;
  const left_is_bw = left_target[bw_buf] !== undefined;
  let fn: unknown;
  let left_output: Data<Dictionary, unknown> | undefined;
  if (left_is_bw) {
    fn = left_target[bw_item];
  } else {
    const pair = self.value();
    fn = pair[0];
    left_output = pair[1];
  }
  const right_target = value as unknown as BufferedWriterTarget;
  const right_is_bw = right_target[bw_buf] !== undefined;
  let item: unknown;
  let right_output: Data<Dictionary, unknown> | undefined;
  if (right_is_bw) {
    item = right_target[bw_item];
  } else {
    const pair = value.value();
    item = pair[0];
    right_output = pair[1];
  }
  const result = (fn as (item: unknown) => unknown)(item);
  return combine_writer_outputs(
    left_is_bw ? left_target : undefined,
    left_output,
    right_is_bw ? right_target : undefined,
    right_output,
    result,
    make_bw,
    make_plain,
  );
}

type WriterLogAcc = {
  mode: number;
  current: Data<Dictionary, unknown> | undefined;
  arr_obj: WriterLogBuffer | undefined;
  arr: unknown[] | undefined;
  set: Set<unknown> | undefined;
  map: Map<unknown, unknown> | undefined;
  chunk: RawChunkLog<unknown> | undefined;
};

function append_log_acc(
  acc: WriterLogAcc,
  entry: Data<AsWriter<Dictionary, unknown>, unknown>,
): unknown {
  const entry_bw = entry as unknown as BufferedWriterTarget;
  const entry_buf = entry_bw[bw_buf];
  if (
    entry_buf !== undefined &&
    acc.mode === LOG_ARRAY &&
    ArrayT.concat === canonical_array_concat
  ) {
    if (acc.arr === undefined) {
      acc.arr = [];
      append_array_log(
        acc.arr,
        acc.current!.value() as readonly unknown[],
      );
    }
    append_bw_items(acc.arr, entry_buf, entry_bw[bw_len]);
    return entry_bw[bw_item];
  }
  const [val, next_output] = entry.value();
  if (
    acc.mode === LOG_ARRAY &&
    ArrayT.concat === canonical_array_concat &&
    has_kind(next_output, array_kind)
  ) {
    if (acc.arr === undefined) {
      acc.arr = [];
      append_array_log(acc.arr, acc.current!.value() as readonly unknown[]);
    }
    append_array_log(acc.arr, next_output.value() as readonly unknown[]);
  } else if (
    acc.mode === LOG_LIST &&
    List.concat === canonical_list_concat &&
    has_kind(next_output, list_kind)
  ) {
    if (acc.arr === undefined) {
      acc.arr = [];
      append_list_log(acc.arr, acc.current!.value() as RawList<unknown>);
    }
    append_list_log(acc.arr, next_output.value() as RawList<unknown>);
  } else if (
    acc.mode === LOG_SET &&
    SetT.concat === canonical_set_concat &&
    has_kind(next_output, set_kind)
  ) {
    if (acc.set === undefined) {
      acc.set = new Set(acc.current!.value() as ReadonlySet<unknown>);
    }
    for (const el of next_output.value() as ReadonlySet<unknown>) {
      acc.set.add(el);
    }
  } else if (
    acc.mode === LOG_MAP &&
    MapT.concat === canonical_map_concat &&
    has_kind(next_output, map_kind)
  ) {
    if (acc.map === undefined) {
      acc.map = new Map(acc.current!.value() as ReadonlyMap<unknown, unknown>);
    }
    for (
      const [k, v] of next_output.value() as ReadonlyMap<unknown, unknown>
    ) {
      acc.map.set(k, v);
    }
  } else if (
    acc.mode === LOG_CHUNK &&
    ChunkLog.concat === canonical_chunk_log_concat &&
    has_kind(next_output, chunk_log_kind)
  ) {
    if (acc.chunk === undefined) {
      acc.chunk = acc.current!.value() as RawChunkLog<unknown>;
    }
    const next_raw = next_output.value() as RawChunkLog<unknown>;
    if (acc.chunk.tag === "empty") acc.chunk = next_raw;
    else if (next_raw.tag !== "empty") {
      acc.chunk = { tag: "concat", left: acc.chunk, right: next_raw };
    }
  } else {
    acc.current = flush_log_output(
      acc.mode,
      acc.current!,
      acc.arr,
      acc.set,
      acc.map,
      acc.chunk,
    );
    acc.arr = undefined;
    acc.arr_obj = undefined;
    acc.set = undefined;
    acc.map = undefined;
    acc.chunk = undefined;
    acc.mode = LOG_NONE;
    acc.current = concat_output(acc.current, next_output);
  }
  return val;
}

function writer_lift(
  self: Data<AsWriter<Dictionary, unknown>, unknown>,
  fn: (...values: unknown[]) => unknown,
  rest: readonly Data<AsWriter<Dictionary, unknown>, unknown>[],
  make_bw: MakeBufferedWriter,
  make_plain: MakePlainWriter,
): Data<AsWriter<Dictionary, unknown>, unknown> {
  const len = rest.length;
  if (len === 0) return writer_map(self, fn, make_bw, make_plain);

  const first_target = self as unknown as BufferedWriterTarget;
  const first_is_bw = first_target[bw_buf] !== undefined;
  let first_item: unknown;
  let first_output: Data<Dictionary, unknown> | undefined;
  if (first_is_bw) {
    first_item = first_target[bw_item];
  } else {
    const pair = self.value();
    first_item = pair[0];
    first_output = pair[1];
  }

  if (len === 1) {
    const second_w = rest[0];
    const second_target = second_w as unknown as BufferedWriterTarget;
    const second_is_bw = second_target[bw_buf] !== undefined;
    let second_item: unknown;
    let second_output: Data<Dictionary, unknown> | undefined;
    if (second_is_bw) {
      second_item = second_target[bw_item];
    } else {
      const pair = second_w.value();
      second_item = pair[0];
      second_output = pair[1];
    }
    const result = fn(first_item, second_item);
    return combine_writer_outputs(
      first_is_bw ? first_target : undefined,
      first_output,
      second_is_bw ? second_target : undefined,
      second_output,
      result,
      make_bw,
      make_plain,
    );
  }

  // N-ary lift (len >= 2): buffer canonical logs in O(N) while preserving
  // exact left-to-right custom concat order before calling fn(...values).
  const values = new Array<unknown>(len + 1);
  values[0] = first_item;
  const acc: WriterLogAcc = {
    mode: LOG_NONE,
    current: first_output,
    arr_obj: undefined,
    arr: undefined,
    set: undefined,
    map: undefined,
    chunk: undefined,
  };
  if (first_is_bw) {
    if (ArrayT.concat === canonical_array_concat) {
      acc.mode = LOG_ARRAY;
      const first_buf = first_target[bw_buf];
      const first_len = first_target[bw_len];
      if (!first_buf.sealed && first_len === first_buf.items.length) {
        first_buf.shared = true;
        acc.arr_obj = first_buf;
        acc.arr = first_buf.items;
      } else {
        acc.arr = first_buf.items.slice(0, first_len);
        acc.arr_obj = { items: acc.arr, sealed: false };
      }
    } else {
      acc.current = self.value()[1];
    }
  } else {
    acc.mode = detect_log_mode(first_output!);
    if (acc.mode === LOG_ARRAY) {
      acc.arr = [];
      append_array_log(acc.arr, first_output!.value() as readonly unknown[]);
      acc.arr_obj = { items: acc.arr, sealed: false };
    }
  }

  for (let i = 0; i < len; i += 1) {
    values[i + 1] = append_log_acc(acc, rest[i]);
  }

  const result = fn(...values);
  if (acc.mode === LOG_ARRAY && acc.arr_obj !== undefined) {
    return make_bw(result, acc.arr_obj, acc.arr_obj.items.length);
  }
  return make_plain(
    result,
    flush_log_output(
      acc.mode,
      acc.current!,
      acc.arr,
      acc.set,
      acc.map,
      acc.chunk,
    ),
  );
}

Show.instance(Writer)({
  show() {
    const [value, output] = this.value();
    return "Writer(" + inspect(value) + ", " +
      inspect((output as Data<Dictionary, unknown>).value()) + ")";
  },
});

Functor.instance(Writer)({
  map(fn) {
    return writer_map(
      this as unknown as Data<AsWriter<Dictionary, unknown>, unknown>,
      fn as (value: unknown) => unknown,
      make_writer_bw,
      writer_any,
    ) as never;
  },
});

Applicative.instance(Writer)({
  pure(value) {
    const bw = this as unknown as BufferedWriterTarget;
    if (bw[bw_buf] !== undefined) {
      return writer_any(
        value,
        ArrayT.empty() as unknown as Data<Dictionary, unknown>,
      );
    }
    const [_ignored, output] = (this as unknown as Data<
      AsWriter<Dictionary, unknown>,
      unknown
    >).value();
    return writer_any(value, empty_output(output));
  },

  [applicative_lift_method](fn, rest) {
    return writer_lift(
      this as unknown as Data<AsWriter<Dictionary, unknown>, unknown>,
      fn,
      rest as unknown as readonly Data<
        AsWriter<Dictionary, unknown>,
        unknown
      >[],
      make_writer_bw,
      writer_any,
    ) as never;
  },

  ap(value) {
    return writer_ap(
      this as unknown as Data<AsWriter<Dictionary, unknown>, unknown>,
      value as unknown as Data<AsWriter<Dictionary, unknown>, unknown>,
      make_writer_bw,
      writer_any,
    ) as never;
  },
});

Monad.instance(Writer)({
  bind(fn) {
    return writer_bind(
      this as unknown as Data<AsWriter<Dictionary, unknown>, unknown>,
      fn as unknown as (
        value: unknown,
      ) => Data<AsWriter<Dictionary, unknown>, unknown>,
      make_writer_bw,
      writer_any,
    ) as never;
  },
});

register_writer_do(Writer);

/** Extracts the output dictionary required by Writer lifts. */
export type WriterEffectOutput<requirements> = WriterOutput<requirements>;
/** Extracts the log item required by Writer lifts. */
export type WriterEffectLog<requirements> = WriterLog<requirements>;

function writer_any<item>(
  value: item,
  output: unknown,
): Data<AsWriter<Dictionary, unknown>, item> {
  return Writer([
    value,
    output as Data<Dictionary, unknown>,
  ] as RawWriter<Dictionary, unknown, item>);
}

function empty_output(output: unknown): unknown {
  const monoid = output as Data<MonoidDictionary<Dictionary>, unknown>;

  return monoid.empty();
}

function concat_output<output extends Dictionary, log>(
  left: Data<output, log>,
  right: unknown,
): Data<output, log>;
function concat_output(left: unknown, right: unknown): unknown;
function concat_output(left: unknown, right: unknown): unknown {
  const monoid = left as Data<MonoidDictionary<Dictionary>, unknown>;

  return monoid.concat(
    right as Data<MonoidDictionary<Dictionary>, unknown>,
  );
}

function configured_writer<
  output extends MonoidDictionary<output>,
  log,
>(empty: Data<output, log>): AsWriter<output, log> {
  const dictionary = data<AsWriter<output, log>>(writer_identity);
  const make_bw = create_buffered_writer_factory(dictionary);
  const make_plain: MakePlainWriter = (item, out) =>
    dictionary(
      [item, out] as RawWriter<output, log, unknown>,
    ) as unknown as Data<AsWriter<Dictionary, unknown>, unknown>;

  Show.instance(dictionary)({
    show() {
      const [value, output] = this.value();
      return "Writer(" + inspect(value) + ", " +
        inspect(output.value()) + ")";
    },
  });

  Functor.instance(dictionary)({
    map(fn) {
      return writer_map(
        this as unknown as Data<AsWriter<Dictionary, unknown>, unknown>,
        fn as (value: unknown) => unknown,
        make_bw,
        make_plain,
      ) as unknown as Writer<output, log, ReturnType<typeof fn>>;
    },
  });

  Applicative.instance(dictionary)({
    pure(value) {
      return wrap(value, empty.empty());
    },

    [applicative_lift_method](fn, rest) {
      return writer_lift(
        this as unknown as Data<AsWriter<Dictionary, unknown>, unknown>,
        fn,
        rest as unknown as readonly Data<
          AsWriter<Dictionary, unknown>,
          unknown
        >[],
        make_bw,
        make_plain,
      ) as never;
    },

    ap(value) {
      return writer_ap(
        this as unknown as Data<AsWriter<Dictionary, unknown>, unknown>,
        value as unknown as Data<AsWriter<Dictionary, unknown>, unknown>,
        make_bw,
        make_plain,
      ) as never;
    },
  });

  Monad.instance(dictionary)({
    bind(fn) {
      return writer_bind(
        this as unknown as Data<AsWriter<Dictionary, unknown>, unknown>,
        fn as unknown as (
          value: unknown,
        ) => Data<AsWriter<Dictionary, unknown>, unknown>,
        make_bw,
        make_plain,
      ) as never;
    },
  });

  register_writer_fast_paths(
    dictionary,
    () => empty.empty() as Data<Dictionary, unknown>,
  );

  return dictionary;

  function wrap<item>(
    value: item,
    output: Data<output, log>,
  ): Writer<output, log, item> {
    return dictionary([value, output] as const);
  }
}

function has_canonical_concat_walk(
  output: object,
  canonical: unknown,
): boolean {
  for (
    let current: object | null = output;
    current !== null;
    current = Object.getPrototypeOf(current)
  ) {
    const descriptor = Object.getOwnPropertyDescriptor(current, "concat");
    if (descriptor !== undefined) {
      return descriptor.value === canonical;
    }
  }
  return false;
}

function has_canonical_list_concat(
  output: Data<Dictionary, unknown>,
): boolean {
  const proto = Object.getPrototypeOf(output);
  if (
    (proto === list_nil_prototype || proto === list_cons_prototype) &&
    !Object.hasOwn(output, "concat") &&
    !Object.hasOwn(proto, "concat")
  ) {
    return List.concat === canonical_list_concat;
  }
  return has_canonical_concat_walk(output, canonical_list_concat);
}

function has_canonical_proto_concat(
  output: Data<Dictionary, unknown>,
  expected_proto: object,
  dict: { readonly concat: unknown },
  canonical: unknown,
): boolean {
  if (
    Object.getPrototypeOf(output) === expected_proto &&
    !Object.hasOwn(output, "concat") &&
    !Object.hasOwn(expected_proto, "concat")
  ) {
    return dict.concat === canonical;
  }
  return has_canonical_concat_walk(output, canonical);
}

function detect_log_mode(output: Data<Dictionary, unknown>): number {
  if (typeof output !== "object" || output === null) return LOG_NONE;
  const k = (output as Dictionary)[kind];
  if (k === array_kind) {
    return has_canonical_array_concat(output) ? LOG_ARRAY : LOG_NONE;
  }
  if (k === list_kind) {
    return has_canonical_list_concat(output) ? LOG_LIST : LOG_NONE;
  }
  if (k === set_kind) {
    return has_canonical_proto_concat(
        output,
        set_prototype,
        SetT,
        canonical_set_concat,
      )
      ? LOG_SET
      : LOG_NONE;
  }
  if (k === map_kind) {
    return has_canonical_proto_concat(
        output,
        map_prototype,
        MapT,
        canonical_map_concat,
      )
      ? LOG_MAP
      : LOG_NONE;
  }
  if (k === chunk_log_kind) {
    return has_canonical_proto_concat(
        output,
        chunk_log_prototype,
        ChunkLog,
        canonical_chunk_log_concat,
      )
      ? LOG_CHUNK
      : LOG_NONE;
  }
  return LOG_NONE;
}

/** @ignore */
export function has_canonical_array_concat(
  output: Data<Dictionary, unknown>,
): boolean {
  if (
    typeof output !== "object" || output === null ||
    (output as Dictionary)[kind] !== array_kind
  ) return false;
  if (
    Object.getPrototypeOf(output) === array_prototype &&
    !Object.hasOwn(output, "concat") &&
    !Object.hasOwn(array_prototype, "concat")
  ) {
    return ArrayT.concat === canonical_array_concat;
  }
  return has_canonical_concat_walk(output, canonical_array_concat);
}

/** @ignore */
export function is_canonical_array_concat_method(): boolean {
  return ArrayT.concat === canonical_array_concat;
}

/** @ignore */
export function append_array_log(
  buffer: unknown[],
  values: Iterable<unknown>,
): void {
  if (Array.isArray(values)) {
    const len = values.length;
    if (len === 1) {
      buffer.push(values[0]);
      return;
    }
    for (let index = 0; index < len; index += 1) {
      buffer.push(values[index]);
    }
    return;
  }
  for (const value of values) buffer.push(value);
}

function register_writer_do(dictionary: unknown): void {
  const dict = dictionary as AsWriter<Dictionary, unknown> & {
    (
      v: RawWriter<Dictionary, unknown, unknown>,
    ): Data<AsWriter<Dictionary, unknown>, unknown>;
  };
  const d_kind = dict[kind];
  const c_bind = dict.bind;
  const c_pure = dict.pure;
  const writer_do: CustomDoRunner = (first_value, first_iterator) => {
    const first = first_value as Data<AsWriter<Dictionary, unknown>, unknown>;
    if (
      first[kind] !== d_kind || first.bind !== c_bind || first.pure !== c_pure
    ) return undefined;
    const first_bw = first as unknown as BufferedWriterTarget;
    let first_item: unknown;
    let current_output: Data<Dictionary, unknown>;
    let mode: number;
    let arr_buf: unknown[] | undefined;
    let set_buf: Set<unknown> | undefined;
    let map_buf: Map<unknown, unknown> | undefined;
    let chunk_buf: RawChunkLog<unknown> | undefined;

    if (
      first_bw[bw_buf] !== undefined &&
      ArrayT.concat === canonical_array_concat
    ) {
      first_item = first_bw[bw_item];
      current_output = undefined as unknown as Data<Dictionary, unknown>;
      mode = LOG_ARRAY;
      arr_buf = first_bw[bw_buf].items.slice(0, first_bw[bw_len]);
    } else {
      const pair = first.value();
      first_item = pair[0];
      current_output = pair[1];
      mode = detect_log_mode(current_output);
    }

    let next = first_iterator.next(first_item);
    while (!next.done) {
      const current = next.value as Data<
        AsWriter<Dictionary, unknown>,
        unknown
      >;
      const current_bw = current as unknown as BufferedWriterTarget;
      const current_buf = current_bw[bw_buf];
      let val: unknown;
      if (
        current_buf !== undefined &&
        mode === LOG_ARRAY &&
        ArrayT.concat === canonical_array_concat
      ) {
        val = current_bw[bw_item];
        if (arr_buf === undefined) {
          arr_buf = [];
          append_array_log(
            arr_buf,
            current_output.value() as readonly unknown[],
          );
        }
        append_bw_items(arr_buf, current_buf, current_bw[bw_len]);
      } else {
        const pair = current.value();
        val = pair[0];
        const next_output = pair[1];
        if (
          mode === LOG_ARRAY &&
          ArrayT.concat === canonical_array_concat &&
          has_kind(next_output, array_kind)
        ) {
          if (arr_buf === undefined) {
            arr_buf = [];
            append_array_log(
              arr_buf,
              current_output.value() as readonly unknown[],
            );
          }
          append_array_log(arr_buf, next_output.value() as readonly unknown[]);
        } else if (
          mode === LOG_LIST &&
          List.concat === canonical_list_concat &&
          has_kind(next_output, list_kind)
        ) {
          if (arr_buf === undefined) {
            arr_buf = [];
            append_list_log(
              arr_buf,
              current_output.value() as RawList<unknown>,
            );
          }
          append_list_log(arr_buf, next_output.value() as RawList<unknown>);
        } else if (
          mode === LOG_SET &&
          SetT.concat === canonical_set_concat &&
          has_kind(next_output, set_kind)
        ) {
          if (set_buf === undefined) {
            set_buf = new Set(current_output.value() as ReadonlySet<unknown>);
          }
          for (const el of next_output.value() as ReadonlySet<unknown>) {
            set_buf.add(el);
          }
        } else if (
          mode === LOG_MAP &&
          MapT.concat === canonical_map_concat &&
          has_kind(next_output, map_kind)
        ) {
          if (map_buf === undefined) {
            map_buf = new Map(
              current_output.value() as ReadonlyMap<unknown, unknown>,
            );
          }
          for (
            const [k, v] of next_output.value() as ReadonlyMap<unknown, unknown>
          ) {
            map_buf.set(k, v);
          }
        } else if (
          mode === LOG_CHUNK &&
          ChunkLog.concat === canonical_chunk_log_concat &&
          has_kind(next_output, chunk_log_kind)
        ) {
          if (chunk_buf === undefined) {
            chunk_buf = current_output.value() as RawChunkLog<unknown>;
          }
          const next_raw = next_output.value() as RawChunkLog<unknown>;
          if (chunk_buf.tag === "empty") chunk_buf = next_raw;
          else if (next_raw.tag !== "empty") {
            chunk_buf = { tag: "concat", left: chunk_buf, right: next_raw };
          }
        } else {
          current_output = flush_log_output(
            mode,
            current_output,
            arr_buf,
            set_buf,
            map_buf,
            chunk_buf,
          );
          arr_buf = undefined;
          set_buf = undefined;
          map_buf = undefined;
          chunk_buf = undefined;
          mode = LOG_NONE;
          current_output = concat_output(current_output, next_output);
        }
      }
      next = first_iterator.next(val);
    }
    current_output = flush_log_output(
      mode,
      current_output,
      arr_buf,
      set_buf,
      map_buf,
      chunk_buf,
    );
    return dict([next.value, current_output] as const);
  };
  Object.defineProperty(dictionary as object, do_runner_method, {
    value: writer_do,
  });
}

function identity_array<to>(items: Iterable<to>): to[] {
  return items as to[];
}

function register_writer_fast_paths(
  dictionary: unknown,
  create_empty: () => Data<Dictionary, unknown>,
): void {
  register_writer_do(dictionary);
  const dict = dictionary as AsWriter<Dictionary, unknown> & {
    (
      v: RawWriter<Dictionary, unknown, unknown>,
    ): Data<AsWriter<Dictionary, unknown>, unknown>;
  };
  const traverse_impl = <from, to, result>(
    items: Iterable<from>,
    fn: (item: from) => Data<AsWriter<Dictionary, unknown>, to>,
    build: (items: Iterable<to>) => result,
  ): Data<AsWriter<Dictionary, unknown>, result> => {
    const initial_output = create_empty();
    const acc: WriterLogAcc = {
      mode: detect_log_mode(initial_output),
      current: initial_output,
      arr_obj: undefined,
      arr: undefined,
      set: undefined,
      map: undefined,
      chunk: undefined,
    };

    let out: to[];
    if (Array.isArray(items)) {
      const len = items.length;
      out = new Array<to>(len);
      for (let i = 0; i < len; i += 1) {
        out[i] = append_log_acc(acc, fn(items[i])) as to;
      }
    } else {
      out = [];
      for (const item of items) {
        out.push(append_log_acc(acc, fn(item)) as to);
      }
    }
    const final_output = flush_log_output(
      acc.mode,
      acc.current!,
      acc.arr,
      acc.set,
      acc.map,
      acc.chunk,
    );
    return dict([build(out), final_output] as const) as Data<
      AsWriter<Dictionary, unknown>,
      result
    >;
  };
  register_traversal(
    dict,
    traverse_impl,
    <from, to>(
      items: readonly from[],
      fn: (item: from) => Data<AsWriter<Dictionary, unknown>, to>,
    ) => traverse_impl(items, fn, identity_array<to>),
  );
}
