import type { RawBox, RawReader, RawResult } from "./shapes.ts";
// Third-party declarations extend TypeLambda without editing its module.
import type { TypeLambda, Value } from "./lambda.ts";
export { combine, map } from "./lambda.ts";
declare const box_identity: unique symbol;
declare const result_identity: unique symbol;
declare const reader_identity: unique symbol;
export interface BoxLambda extends TypeLambda {
  readonly identity: typeof box_identity;
  readonly result: RawBox<this["argument"]>;
}
export interface ResultLambda<error> extends TypeLambda {
  readonly identity: typeof result_identity;
  readonly result: RawResult<error, this["argument"]>;
}
export interface ReaderLambda<environment> extends TypeLambda {
  readonly identity: typeof reader_identity;
  readonly result: RawReader<environment, this["argument"]>;
}
export type Box<item> = Value<BoxLambda, item>;
export type Result<error, item> = Value<ResultLambda<error>, item>;
export type Reader<environment, item> = Value<ReaderLambda<environment>, item>;
export declare function box<item>(item: item): Box<item>;
export declare function result<error, item>(
  value: readonly ["Left", error] | readonly ["Right", item],
): Result<error, item>;
export declare function reader<environment, item>(
  value: (environment: environment) => item,
): Reader<environment, item>;
