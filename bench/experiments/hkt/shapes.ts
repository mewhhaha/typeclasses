export type RawBox<item> = { readonly item: item };
export type RawResult<error, item> =
  | readonly ["Left", error]
  | readonly ["Right", item];
export type RawReader<environment, item> = (environment: environment) => item;
