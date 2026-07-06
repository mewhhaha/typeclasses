import { Either as EffectEither } from "effect";
import * as FpEither from "fp-ts/Either";
import { pipe as fp_pipe } from "fp-ts/function";
import { Left, Right } from "purify-ts/Either";
import * as TrueResult from "true-myth/result";

import { left as traits_left, right as traits_right } from "../src/either.ts";
import { Applicative, Do } from "../src/typeclasses.ts";

const passes = 25;
const inputs = route_inputs();
let _sink = 0;

type Method = "GET" | "POST";

type RequestLine = {
  method: string;
  target: string;
};

type Target = {
  path: string;
  query: string;
};

type UserPath = {
  resource: "users";
  id: number;
};

type Pagination = {
  limit: number;
  offset: number;
};

type ParsedRoute = {
  method: Method;
  resource: "users";
  id: number;
  limit: number;
  offset: number;
  active: boolean;
  cache_key: string;
  score: number;
};

type PlainResult<item> =
  | readonly ["ok", item]
  | readonly ["err", string];

function plain_parse_request(input: string): PlainResult<ParsedRoute> {
  const line = plain_split_request_line(input);
  const [line_tag, line_payload] = line;

  switch (line_tag) {
    case "err":
      return line;
    case "ok":
      break;
  }

  const method = plain_parse_method(line_payload);
  const [method_tag, method_payload] = method;

  switch (method_tag) {
    case "err":
      return method;
    case "ok":
      break;
  }

  const target = plain_split_target(line_payload.target);
  const [target_tag, target_payload] = target;

  switch (target_tag) {
    case "err":
      return target;
    case "ok":
      break;
  }

  const path = plain_parse_user_path(target_payload.path);
  const [path_tag, path_payload] = path;

  switch (path_tag) {
    case "err":
      return path;
    case "ok":
      break;
  }

  const query = plain_parse_query(target_payload.query);
  const [query_tag, query_payload] = query;

  switch (query_tag) {
    case "err":
      return query;
    case "ok":
      break;
  }

  const limit = plain_query_int(query_payload, "limit", 1, 100);
  const [limit_tag, limit_payload] = limit;

  switch (limit_tag) {
    case "err":
      return limit;
    case "ok":
      break;
  }

  const offset = plain_query_int(query_payload, "offset", 0, 10_000);
  const [offset_tag, offset_payload] = offset;

  switch (offset_tag) {
    case "err":
      return offset;
    case "ok":
      break;
  }

  const pagination = plain_validate_pagination(limit_payload, offset_payload);
  const [pagination_tag, pagination_payload] = pagination;

  switch (pagination_tag) {
    case "err":
      return pagination;
    case "ok":
      break;
  }

  const active = plain_query_bool(query_payload, "active");
  const [active_tag, active_payload] = active;

  switch (active_tag) {
    case "err":
      return active;
    case "ok":
      break;
  }

  return plain_ok(
    build_route(
      method_payload,
      path_payload,
      pagination_payload,
      active_payload,
    ),
  );
}

function traits_parse_request(input: string) {
  return Do(function* () {
    const line = yield* traits_split_request_line(input);
    const method = yield* traits_parse_method(line);
    const target = yield* traits_split_target(line.target);
    const path = yield* traits_parse_user_path(target.path);
    const query = yield* traits_parse_query(target.query);
    const fields = yield* Applicative.lift(
      (limit, offset, active) => ({ limit, offset, active }),
      traits_query_int(query, "limit", 1, 100),
      traits_query_int(query, "offset", 0, 10_000),
      traits_query_bool(query, "active"),
    );
    const pagination = yield* traits_validate_pagination(
      fields.limit,
      fields.offset,
    );

    return build_route(method, path, pagination, fields.active);
  });
}

function fp_parse_request(input: string): FpEither.Either<string, ParsedRoute> {
  return fp_pipe(
    FpEither.Do,
    FpEither.bind("line", () => fp_split_request_line(input)),
    FpEither.bind("method", (state: { line: RequestLine }) => {
      return fp_parse_method(state.line);
    }),
    FpEither.bind("target", (state: { line: RequestLine }) => {
      return fp_split_target(state.line.target);
    }),
    FpEither.bind("path", (state: { target: Target }) => {
      return fp_parse_user_path(state.target.path);
    }),
    FpEither.bind("query", (state: { target: Target }) => {
      return fp_parse_query(state.target.query);
    }),
    FpEither.bind("limit", (state: { query: Record<string, string> }) => {
      return fp_query_int(state.query, "limit", 1, 100);
    }),
    FpEither.bind("offset", (state: { query: Record<string, string> }) => {
      return fp_query_int(state.query, "offset", 0, 10_000);
    }),
    FpEither.bind("pagination", (state: { limit: number; offset: number }) => {
      return fp_validate_pagination(state.limit, state.offset);
    }),
    FpEither.bind("active", (state: { query: Record<string, string> }) => {
      return fp_query_bool(state.query, "active");
    }),
    FpEither.map((state: {
      method: Method;
      path: UserPath;
      pagination: Pagination;
      active: boolean;
    }) => {
      return build_route(
        state.method,
        state.path,
        state.pagination,
        state.active,
      );
    }),
  ) as FpEither.Either<string, ParsedRoute>;
}

function effect_parse_request(input: string) {
  return EffectEither.gen(function* (resume) {
    const line = yield* resume(effect_split_request_line(input));
    const method = yield* resume(effect_parse_method(line));
    const target = yield* resume(effect_split_target(line.target));
    const path = yield* resume(effect_parse_user_path(target.path));
    const query = yield* resume(effect_parse_query(target.query));
    const limit = yield* resume(effect_query_int(query, "limit", 1, 100));
    const offset = yield* resume(effect_query_int(query, "offset", 0, 10_000));
    const pagination = yield* resume(
      effect_validate_pagination(limit, offset),
    );
    const active = yield* resume(effect_query_bool(query, "active"));

    return build_route(method, path, pagination, active);
  });
}

function purify_parse_request(input: string) {
  return purify_split_request_line(input)
    .chain((line) => {
      return purify_parse_method(line)
        .chain((method) => {
          return purify_split_target(line.target)
            .chain((target) => {
              return purify_parse_user_path(target.path)
                .chain((path) => {
                  return purify_parse_query(target.query)
                    .chain((query) => {
                      return purify_query_int(query, "limit", 1, 100)
                        .chain((limit) => {
                          return purify_query_int(query, "offset", 0, 10_000)
                            .chain((offset) => {
                              return purify_validate_pagination(limit, offset)
                                .chain((pagination) => {
                                  return purify_query_bool(query, "active")
                                    .map((active) => {
                                      return build_route(
                                        method,
                                        path,
                                        pagination,
                                        active,
                                      );
                                    });
                                });
                            });
                        });
                    });
                });
            });
        });
    });
}

function true_parse_request(input: string) {
  return true_split_request_line(input)
    .andThen((line) => {
      return true_parse_method(line)
        .andThen((method) => {
          return true_split_target(line.target)
            .andThen((target) => {
              return true_parse_user_path(target.path)
                .andThen((path) => {
                  return true_parse_query(target.query)
                    .andThen((query) => {
                      return true_query_int(query, "limit", 1, 100)
                        .andThen((limit) => {
                          return true_query_int(query, "offset", 0, 10_000)
                            .andThen((offset) => {
                              return true_validate_pagination(limit, offset)
                                .andThen((pagination) => {
                                  return true_query_bool(query, "active")
                                    .map((active) => {
                                      return build_route(
                                        method,
                                        path,
                                        pagination,
                                        active,
                                      );
                                    });
                                });
                            });
                        });
                    });
                });
            });
        });
    });
}

Deno.bench("native route parser", () => {
  let checksum = 0;

  for (let pass = 0; pass < passes; pass += 1) {
    for (const input of inputs) {
      checksum += consume_plain(plain_parse_request(input));
    }
  }

  _sink = checksum;
});

Deno.bench("traits Either Do+lift route parser", () => {
  let checksum = 0;

  for (let pass = 0; pass < passes; pass += 1) {
    for (const input of inputs) {
      checksum += consume_traits(traits_parse_request(input));
    }
  }

  _sink = checksum;
});

Deno.bench("fp-ts Either Do route parser", () => {
  let checksum = 0;

  for (let pass = 0; pass < passes; pass += 1) {
    for (const input of inputs) {
      checksum += consume_fp(fp_parse_request(input));
    }
  }

  _sink = checksum;
});

Deno.bench("effect Either gen route parser", () => {
  let checksum = 0;

  for (let pass = 0; pass < passes; pass += 1) {
    for (const input of inputs) {
      checksum += consume_effect(effect_parse_request(input));
    }
  }

  _sink = checksum;
});

Deno.bench("purify Either route parser", () => {
  let checksum = 0;

  for (let pass = 0; pass < passes; pass += 1) {
    for (const input of inputs) {
      checksum += consume_purify(purify_parse_request(input));
    }
  }

  _sink = checksum;
});

Deno.bench("true-myth Result route parser", () => {
  let checksum = 0;

  for (let pass = 0; pass < passes; pass += 1) {
    for (const input of inputs) {
      checksum += consume_true(true_parse_request(input));
    }
  }

  _sink = checksum;
});

function plain_split_request_line(input: string): PlainResult<RequestLine> {
  const separator = input.indexOf(" ");

  if (separator <= 0) {
    return plain_err("expected request method");
  }

  if (input.indexOf(" ", separator + 1) !== -1) {
    return plain_err("expected one request target");
  }

  return plain_ok({
    method: input.slice(0, separator),
    target: input.slice(separator + 1),
  });
}

function plain_parse_method(line: RequestLine): PlainResult<Method> {
  if (line.method === "GET" || line.method === "POST") {
    return plain_ok(line.method);
  }

  return plain_err("unsupported method " + line.method);
}

function plain_split_target(target: string): PlainResult<Target> {
  const separator = target.indexOf("?");

  if (separator <= 0) {
    return plain_err("expected query string");
  }

  if (target.indexOf("?", separator + 1) !== -1) {
    return plain_err("expected one query string");
  }

  return plain_ok({
    path: target.slice(0, separator),
    query: target.slice(separator + 1),
  });
}

function plain_parse_user_path(path: string): PlainResult<UserPath> {
  const parts = path.split("/");

  if (parts.length !== 3 || parts[0] !== "" || parts[1] !== "users") {
    return plain_err("expected /users/:id path");
  }

  const id = parse_int(parts[2]);

  if (id === undefined || id <= 0) {
    return plain_err("expected positive user id");
  }

  return plain_ok({
    resource: "users",
    id,
  });
}

function plain_parse_query(
  query_text: string,
): PlainResult<Record<string, string>> {
  const query: Record<string, string> = {};

  if (query_text.length === 0) {
    return plain_err("expected query fields");
  }

  for (const field of query_text.split("&")) {
    const separator = field.indexOf("=");

    if (separator <= 0) {
      return plain_err("expected key=value query field");
    }

    const key = field.slice(0, separator);
    const value = field.slice(separator + 1);

    if (key in query) {
      return plain_err("duplicate query field " + key);
    }

    query[key] = value;
  }

  return plain_ok(query);
}

function plain_query_int(
  query: Record<string, string>,
  key: string,
  min: number,
  max: number,
): PlainResult<number> {
  const text = query[key];

  if (text === undefined) {
    return plain_err("missing query field " + key);
  }

  const value = parse_int(text);

  if (value === undefined) {
    return plain_err("expected integer query field " + key);
  }

  if (value < min || value > max) {
    return plain_err("query field out of range " + key);
  }

  return plain_ok(value);
}

function plain_validate_pagination(
  limit: number,
  offset: number,
): PlainResult<Pagination> {
  if (offset > 0 && offset % limit !== 0) {
    return plain_err("offset must align to limit");
  }

  return plain_ok({ limit, offset });
}

function plain_query_bool(
  query: Record<string, string>,
  key: string,
): PlainResult<boolean> {
  const text = query[key];

  if (text === "true") {
    return plain_ok(true);
  }

  if (text === "false") {
    return plain_ok(false);
  }

  return plain_err("expected boolean query field " + key);
}

function build_route(
  method: Method,
  path: UserPath,
  pagination: Pagination,
  active: boolean,
): ParsedRoute {
  let active_score = 3;

  if (active) {
    active_score = 17;
  }

  let method_score = 11;

  if (method === "GET") {
    method_score = 5;
  }

  const score = path.id + pagination.limit - pagination.offset + active_score +
    method_score;

  return {
    method,
    resource: path.resource,
    id: path.id,
    limit: pagination.limit,
    offset: pagination.offset,
    active,
    cache_key: method + ":" + path.resource + ":" + path.id,
    score,
  };
}

function parse_int(text: string): number | undefined {
  if (text.length === 0) {
    return undefined;
  }

  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);

    if (code < 48 || code > 57) {
      return undefined;
    }
  }

  const value = Number(text);

  if (!Number.isSafeInteger(value)) {
    return undefined;
  }

  return value;
}

function traits_from_plain<item>(result: PlainResult<item>) {
  const [tag, payload] = result;

  switch (tag) {
    case "err":
      return traits_left<string, item>(payload);
    case "ok":
      return traits_right(payload);
  }
}

function traits_split_request_line(input: string) {
  return traits_from_plain(plain_split_request_line(input));
}

function traits_parse_method(line: RequestLine) {
  return traits_from_plain(plain_parse_method(line));
}

function traits_split_target(target: string) {
  return traits_from_plain(plain_split_target(target));
}

function traits_parse_user_path(path: string) {
  return traits_from_plain(plain_parse_user_path(path));
}

function traits_parse_query(query: string) {
  return traits_from_plain(plain_parse_query(query));
}

function traits_query_int(
  query: Record<string, string>,
  key: string,
  min: number,
  max: number,
) {
  return traits_from_plain(plain_query_int(query, key, min, max));
}

function traits_validate_pagination(limit: number, offset: number) {
  return traits_from_plain(plain_validate_pagination(limit, offset));
}

function traits_query_bool(query: Record<string, string>, key: string) {
  return traits_from_plain(plain_query_bool(query, key));
}

function fp_from_plain<item>(
  result: PlainResult<item>,
): FpEither.Either<string, item> {
  const [tag, payload] = result;

  switch (tag) {
    case "err":
      return FpEither.left(payload);
    case "ok":
      return FpEither.right(payload);
  }
}

function fp_split_request_line(input: string) {
  return fp_from_plain(plain_split_request_line(input));
}

function fp_parse_method(line: RequestLine) {
  return fp_from_plain(plain_parse_method(line));
}

function fp_split_target(target: string) {
  return fp_from_plain(plain_split_target(target));
}

function fp_parse_user_path(path: string) {
  return fp_from_plain(plain_parse_user_path(path));
}

function fp_parse_query(query: string) {
  return fp_from_plain(plain_parse_query(query));
}

function fp_query_int(
  query: Record<string, string>,
  key: string,
  min: number,
  max: number,
) {
  return fp_from_plain(plain_query_int(query, key, min, max));
}

function fp_validate_pagination(limit: number, offset: number) {
  return fp_from_plain(plain_validate_pagination(limit, offset));
}

function fp_query_bool(query: Record<string, string>, key: string) {
  return fp_from_plain(plain_query_bool(query, key));
}

function effect_from_plain<item>(result: PlainResult<item>) {
  const [tag, payload] = result;

  switch (tag) {
    case "err":
      return EffectEither.left(payload);
    case "ok":
      return EffectEither.right(payload);
  }
}

function effect_split_request_line(input: string) {
  return effect_from_plain(plain_split_request_line(input));
}

function effect_parse_method(line: RequestLine) {
  return effect_from_plain(plain_parse_method(line));
}

function effect_split_target(target: string) {
  return effect_from_plain(plain_split_target(target));
}

function effect_parse_user_path(path: string) {
  return effect_from_plain(plain_parse_user_path(path));
}

function effect_parse_query(query: string) {
  return effect_from_plain(plain_parse_query(query));
}

function effect_query_int(
  query: Record<string, string>,
  key: string,
  min: number,
  max: number,
) {
  return effect_from_plain(plain_query_int(query, key, min, max));
}

function effect_validate_pagination(limit: number, offset: number) {
  return effect_from_plain(plain_validate_pagination(limit, offset));
}

function effect_query_bool(query: Record<string, string>, key: string) {
  return effect_from_plain(plain_query_bool(query, key));
}

function purify_from_plain<item>(result: PlainResult<item>) {
  const [tag, payload] = result;

  switch (tag) {
    case "err":
      return Left<string, item>(payload);
    case "ok":
      return Right<item, string>(payload);
  }
}

function purify_split_request_line(input: string) {
  return purify_from_plain(plain_split_request_line(input));
}

function purify_parse_method(line: RequestLine) {
  return purify_from_plain(plain_parse_method(line));
}

function purify_split_target(target: string) {
  return purify_from_plain(plain_split_target(target));
}

function purify_parse_user_path(path: string) {
  return purify_from_plain(plain_parse_user_path(path));
}

function purify_parse_query(query: string) {
  return purify_from_plain(plain_parse_query(query));
}

function purify_query_int(
  query: Record<string, string>,
  key: string,
  min: number,
  max: number,
) {
  return purify_from_plain(plain_query_int(query, key, min, max));
}

function purify_validate_pagination(limit: number, offset: number) {
  return purify_from_plain(plain_validate_pagination(limit, offset));
}

function purify_query_bool(query: Record<string, string>, key: string) {
  return purify_from_plain(plain_query_bool(query, key));
}

function true_from_plain<item>(result: PlainResult<item>) {
  const [tag, payload] = result;

  switch (tag) {
    case "err":
      return TrueResult.err<item, string>(payload);
    case "ok":
      return TrueResult.ok<item, string>(payload);
  }
}

function true_split_request_line(input: string) {
  return true_from_plain(plain_split_request_line(input));
}

function true_parse_method(line: RequestLine) {
  return true_from_plain(plain_parse_method(line));
}

function true_split_target(target: string) {
  return true_from_plain(plain_split_target(target));
}

function true_parse_user_path(path: string) {
  return true_from_plain(plain_parse_user_path(path));
}

function true_parse_query(query: string) {
  return true_from_plain(plain_parse_query(query));
}

function true_query_int(
  query: Record<string, string>,
  key: string,
  min: number,
  max: number,
) {
  return true_from_plain(plain_query_int(query, key, min, max));
}

function true_validate_pagination(limit: number, offset: number) {
  return true_from_plain(plain_validate_pagination(limit, offset));
}

function true_query_bool(query: Record<string, string>, key: string) {
  return true_from_plain(plain_query_bool(query, key));
}

function consume_plain(result: PlainResult<ParsedRoute>): number {
  const [tag, payload] = result;

  switch (tag) {
    case "err":
      return -payload.length;
    case "ok":
      return payload.score;
  }
}

function consume_traits(
  result: ReturnType<typeof traits_parse_request>,
): number {
  const value = result.value();
  const [tag, payload] = value;

  switch (tag) {
    case "left":
      return -String(payload).length;
    case "right":
      return payload.score;
  }
}

function consume_fp(result: FpEither.Either<string, ParsedRoute>): number {
  if (result._tag === "Left") {
    return -result.left.length;
  }

  return result.right.score;
}

function consume_effect(
  result: ReturnType<typeof effect_parse_request>,
): number {
  if (result._tag === "Left") {
    return -result.left.length;
  }

  return result.right.score;
}

function consume_purify(
  result: ReturnType<typeof purify_parse_request>,
): number {
  return result.caseOf({
    Left: (error) => -error.length,
    Right: (value) => value.score,
  });
}

function consume_true(result: ReturnType<typeof true_parse_request>): number {
  return result.match({
    Err: (error) => -error.length,
    Ok: (value) => value.score,
  });
}

function plain_ok<item>(value: item): PlainResult<item> {
  return ["ok", value];
}

function plain_err<item = never>(error: string): PlainResult<item> {
  return ["err", error];
}

function route_inputs(): string[] {
  const out: string[] = [];

  for (let index = 0; index < 128; index += 1) {
    const id = index + 1;
    let method: Method = "GET";

    if (index % 4 === 0) {
      method = "POST";
    }

    const limit = [5, 10, 20, 25][index % 4];
    const offset = limit * (index % 6);
    let active = "false";

    if (index % 3 === 0) {
      active = "true";
    }

    if (index % 17 === 0) {
      out.push(
        "DELETE /users/" + id + "?limit=" + limit + "&offset=" +
          offset + "&active=" + active,
      );
      continue;
    }

    if (index % 19 === 0) {
      out.push(
        method + " /teams/" + id + "?limit=" + limit + "&offset=" +
          offset + "&active=" + active,
      );
      continue;
    }

    if (index % 23 === 0) {
      out.push(
        method + " /users/" + id + "?limit=200&offset=" + offset +
          "&active=" + active,
      );
      continue;
    }

    if (index % 29 === 0) {
      out.push(
        method + " /users/" + id + "?limit=" + limit + "&offset=" +
          (offset + 1) + "&active=" + active,
      );
      continue;
    }

    if (index % 31 === 0) {
      out.push(
        method + " /users/" + id + "?limit=" + limit + "&offset=" +
          offset + "&active=maybe",
      );
      continue;
    }

    out.push(
      method + " /users/" + id + "?limit=" + limit + "&offset=" +
        offset + "&active=" + active,
    );
  }

  return out;
}
