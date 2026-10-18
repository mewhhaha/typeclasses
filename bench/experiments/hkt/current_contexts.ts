import type { RawBox, RawReader, RawResult } from "./shapes.ts";
// Third-party Functor-only dictionaries use production As/Data machinery.
// Third-party Functor-only dictionaries use production As/Data machinery.
import type { As, Data, type_data, type_item } from "../../../src/typeclass.ts";
import { Functor } from "../../../src/typeclasses/functor.ts";
const box_identity: unique symbol = Symbol("box_identity");
const result_identity: unique symbol = Symbol("result_identity");
const reader_identity: unique symbol = Symbol("reader_identity");
export interface AsBox extends As<AsBox, typeof box_identity>, Functor<AsBox> {
  readonly [type_item]: unknown;
  readonly [type_data]: RawBox<this[typeof type_item]>;
}
export interface AsResult<error>
  extends
    As<AsResult<error>, typeof result_identity>,
    Functor<AsResult<error>> {
  readonly [type_item]: unknown;
  readonly [type_data]: RawResult<error, this[typeof type_item]>;
}
export interface AsReader<environment>
  extends
    As<AsReader<environment>, typeof reader_identity>,
    Functor<AsReader<environment>> {
  readonly [type_item]: unknown;
  readonly [type_data]: RawReader<environment, this[typeof type_item]>;
}
export type Box<item> = Data<AsBox, item>;
export type Result<error, item> = Data<AsResult<error>, item>;
export type Reader<environment, item> = Data<AsReader<environment>, item>;
export declare function box<item>(item: item): Box<item>;
export declare function result<error, item>(
  value: readonly ["Left", error] | readonly ["Right", item],
): Result<error, item>;
export declare function reader<environment, item>(
  value: (environment: environment) => item,
): Reader<environment, item>;
export function map<dictionary extends Functor<dictionary>, from, to>(
  value: Data<dictionary, from>,
  fn: (item: from) => to,
): Data<dictionary, to> {
  return Functor.map(value, fn);
}
export declare function combine<
  dictionary extends Functor<dictionary>,
  first,
  second,
>(
  first: Data<dictionary, first>,
  second: Data<NoInfer<dictionary>, second>,
): void;
