import {
  type Effect as EffectValue,
  type Uses,
  type WithoutLift,
} from "../../src/effects.ts";
import { type AsReader, run_reader } from "../../src/reader.ts";
import { type As, define, type Value } from "../../src/trait.ts";
import { Alternative, Applicative, Format, Functor } from "../../src/traits.ts";

export type HttpMethod =
  | "GET"
  | "POST"
  | "PUT"
  | "PATCH"
  | "DELETE"
  | "HEAD"
  | "OPTIONS";

export type RouteContext = {
  readonly request: Request;
  readonly url: URL;
  readonly method: string;
};

export type RouteResult<item> =
  | readonly ["matched", item]
  | readonly ["missed"];

type UrlPatternMatch = NonNullable<ReturnType<URLPattern["exec"]>>;

export type UrlPatternEntry<item> = {
  readonly label: string;
  readonly method: HttpMethod;
  readonly pattern: URLPattern;
  select(
    context: RouteContext,
    match: UrlPatternMatch,
  ): RouteResult<item>;
};

export type UrlPatternList<item> = {
  readonly label: string;
  readonly entries: readonly UrlPatternEntry<item>[];
  match(context: RouteContext): RouteResult<item>;
};

const url_pattern_list_kind = Symbol("CaseStudy.UrlPatternList");

declare module "../../src/trait.ts" {
  interface TraitTypes<dictionary, item> {
    [url_pattern_list_kind]: UrlPatternList<item>;
  }
}

export interface AsUrlPatternList extends As<typeof url_pattern_list_kind> {}

export type UrlPatternListValue<item> = Value<AsUrlPatternList, item>;

export const UrlPatternList = define<AsUrlPatternList>(
  url_pattern_list_kind,
);

Format.implement(UrlPatternList)({
  fmt() {
    return this.value().label;
  },
});

export interface AsUrlPatternList extends Format<AsUrlPatternList> {}

Functor.implement(UrlPatternList)({
  map(fn) {
    const routes = this.value();

    return UrlPatternList({
      label: routes.label,
      entries: routes.entries.map((entry) => {
        return {
          ...entry,
          select(context, match) {
            const result = entry.select(context, match);

            if (result[0] === "missed") {
              return missed;
            }

            return matched(fn(result[1]));
          },
        };
      }),
      match(context) {
        const result = routes.match(context);

        if (result[0] === "missed") {
          return missed;
        }

        return matched(fn(result[1]));
      },
    });
  },
});

export interface AsUrlPatternList extends Functor<AsUrlPatternList> {}

Applicative.implement(UrlPatternList)({
  pure(value) {
    return UrlPatternList({
      label: "pure",
      entries: [],
      match() {
        return matched(value);
      },
    });
  },

  ap(value) {
    const fn_routes = this.value();
    const value_routes = value.value();

    return UrlPatternList({
      label: "(" + fn_routes.label + " <*> " + value_routes.label + ")",
      entries: [],
      match(context) {
        const fn_result = fn_routes.match(context);

        if (fn_result[0] === "missed") {
          return missed;
        }

        const value_result = value_routes.match(context);

        if (value_result[0] === "missed") {
          return missed;
        }

        return matched(fn_result[1](value_result[1]));
      },
    });
  },
});

export interface AsUrlPatternList extends Applicative<AsUrlPatternList> {}

Alternative.implement(UrlPatternList)({
  empty() {
    return UrlPatternList(never_url_pattern_list());
  },

  alt(right) {
    const left_routes = this.value();
    const right_routes = right.value();

    return UrlPatternList({
      label: left_routes.label + " | " + right_routes.label,
      entries: [...left_routes.entries, ...right_routes.entries],
      match(context) {
        const left = left_routes.match(context);

        if (left[0] === "matched") {
          return left;
        }

        return right_routes.match(context);
      },
    });
  },
});

export interface AsUrlPatternList extends Alternative<AsUrlPatternList> {}

export type Parser<item> = {
  parse(value: string): item | undefined;
};

export type QueryParser<item> = {
  parse(params: URLSearchParams, key: string): item | undefined;
};

type ParserOutput<parser> = parser extends Parser<infer item> ? item : never;
type QueryOutput<parser> = parser extends QueryParser<infer item> ? item
  : never;

type PathParamNames<path extends string> = path extends
  `${string}:${infer rest}`
  ? rest extends `${infer name}/${infer tail}` ? name | PathParamNames<tail>
  : rest
  : never;

export type PathParamSpec<path extends string> = Partial<
  Record<PathParamNames<path>, Parser<unknown>>
>;

export type QuerySpec = Readonly<Record<string, QueryParser<unknown>>>;

type PathValues<
  path extends string,
  params extends PathParamSpec<path>,
> = {
  readonly [key in PathParamNames<path>]: key extends keyof params
    ? ParserOutput<params[key]>
    : string;
};

type QueryValues<query extends QuerySpec> = {
  readonly [key in keyof query]: QueryOutput<query[key]>;
};

type RouteOptions<
  path extends string,
  params extends PathParamSpec<path>,
  query extends QuerySpec,
> = {
  readonly params?: params;
  readonly query?: query;
};

export type RouteInput<
  path extends string,
  params extends PathParamSpec<path>,
  query extends QuerySpec,
> = {
  readonly request: Request;
  readonly url: URL;
  readonly params: PathValues<path, params>;
  readonly query: QueryValues<query>;
};

type RoutePage<environment, requirements, item> = EffectValue<
  requirements | Uses<AsReader<environment>>,
  item
>;

type RoutedPage<environment, requirements, item> = EffectValue<
  WithoutLift<
    requirements | Uses<AsReader<environment>>,
    AsReader<environment>
  >,
  item
>;

const missed: RouteResult<never> = ["missed"];

export const integer_param: Parser<number> = {
  parse(value) {
    if (!/^-?[0-9]+$/.test(value)) {
      return undefined;
    }

    return Number.parseInt(value, 10);
  },
};

export const text_query: QueryParser<string> = {
  parse(params, key) {
    return params.get(key) ?? undefined;
  },
};

export const boolean_query: QueryParser<boolean> = {
  parse(params, key) {
    const value = params.get(key);

    if (value === "true") {
      return true;
    }

    if (value === "false") {
      return false;
    }

    return undefined;
  },
};

export function route<
  const path extends string,
  const params extends PathParamSpec<path>,
  const query extends QuerySpec,
  environment,
  requirements,
  item,
>(
  method: HttpMethod,
  path: path,
  options: RouteOptions<path, params, query>,
  page: RouteInput<path, params, query> extends environment
    ? RoutePage<environment, requirements, item>
    : never,
): UrlPatternListValue<RoutedPage<environment, requirements, item>> {
  const pattern = new URLPattern({ pathname: path });
  const params = (options.params ?? {}) as params;
  const query = (options.query ?? {}) as query;
  const label = method + " " + path;

  return url_pattern_list([
    {
      label,
      method,
      pattern,
      select(context, match) {
        const path_values = match_path_params(match, params);

        if (path_values === undefined) {
          return missed;
        }

        const query_values = match_query(context.url.searchParams, query);

        if (query_values === undefined) {
          return missed;
        }

        const input = {
          request: context.request,
          url: context.url,
          params: path_values as PathValues<path, params>,
          query: query_values as QueryValues<query>,
        } as RouteInput<path, params, query>;

        return matched(run_reader(page, input as environment));
      },
    },
  ]);
}

export function url_pattern_list<item>(
  entries: readonly UrlPatternEntry<item>[],
): UrlPatternListValue<item> {
  return UrlPatternList({
    label: entries.map((entry) => entry.label).join(" | ") || "empty",
    entries,
    match(context) {
      return match_entries(entries, context);
    },
  });
}

export function route_all<item>(
  first: UrlPatternListValue<item>,
  ...rest: UrlPatternListValue<item>[]
): UrlPatternListValue<item> {
  let router = first;

  for (const route of rest) {
    router = Alternative.alt(router, route);
  }

  return router;
}

export function route_context(request: Request): RouteContext {
  const url = new URL(request.url);

  return {
    request,
    url,
    method: request.method.toUpperCase(),
  };
}

export function optional_query<item>(
  parser: QueryParser<item>,
  fallback: item,
): QueryParser<item> {
  return {
    parse(params, key) {
      if (!params.has(key)) {
        return fallback;
      }

      return parser.parse(params, key);
    },
  };
}

function match_entries<item>(
  entries: readonly UrlPatternEntry<item>[],
  context: RouteContext,
): RouteResult<item> {
  for (const entry of entries) {
    if (context.method !== entry.method) {
      continue;
    }

    const match = entry.pattern.exec(context.url.href);

    if (match === null) {
      continue;
    }

    const result = entry.select(context, match);

    if (result[0] === "matched") {
      return result;
    }
  }

  return missed;
}

function match_path_params<
  path extends string,
  params extends PathParamSpec<path>,
>(
  match: UrlPatternMatch,
  params: params,
): Record<string, unknown> | undefined {
  const groups = match.pathname.groups as Record<string, string | undefined>;
  const values: Record<string, unknown> = {};

  for (const [name, raw] of Object.entries(groups)) {
    if (raw === undefined) {
      return undefined;
    }

    const decoded = decodeURIComponent(raw);
    const parser = params[name as keyof params] as Parser<unknown> | undefined;
    const value = parser === undefined ? decoded : parser.parse(decoded);

    if (value === undefined) {
      return undefined;
    }

    values[name] = value;
  }

  return values;
}

function match_query<query extends QuerySpec>(
  params: URLSearchParams,
  query: query,
): Record<string, unknown> | undefined {
  const values: Record<string, unknown> = {};

  for (const [key, parser] of Object.entries(query)) {
    const value = parser.parse(params, key);

    if (value === undefined) {
      return undefined;
    }

    values[key] = value;
  }

  return values;
}

function matched<item>(item: item): RouteResult<item> {
  return ["matched", item];
}

function never_url_pattern_list<item = never>(): UrlPatternList<item> {
  return {
    label: "empty",
    entries: [],
    match() {
      return missed;
    },
  };
}
