// Type-only alternative. No runtime, instance registration, Do, tagged matching,
// general dictionary members, or callable constructor implementation is claimed.
export interface TypeLambda {
  readonly argument: unknown;
  readonly result: unknown;
}
export type Apply<lambda extends TypeLambda, item> =
  (lambda & { readonly argument: item })["result"];
declare const context: unique symbol;
export interface Value<lambda extends TypeLambda, item> {
  readonly [context]?: (lambda: lambda) => lambda;
  value(): Apply<lambda, item>;
  map<output>(fn: (item: item) => output): Value<lambda, output>;
}
export function map<lambda extends TypeLambda, from, to>(
  value: Value<lambda, from>,
  fn: (item: from) => to,
): Value<lambda, to> {
  return value.map(fn);
}
export declare function combine<lambda extends TypeLambda, first, second>(
  first: Value<lambda, first>,
  second: Value<NoInfer<lambda>, second>,
): void;
