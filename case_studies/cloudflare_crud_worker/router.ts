import {
  Effect,
  type Operation,
  type TaggedOperation,
  type Uses,
} from "../../src/effects.ts";
import { ask, type AsReader } from "../../src/reader.ts";
import type { TraceScope } from "./trace.ts";
import type { RequestContext } from "./types.ts";

export type Route =
  | readonly ["/todos", { readonly method: "GET" | "POST" }]
  | readonly [
    "/todos/:id",
    {
      readonly method: "GET" | "PATCH" | "PUT" | "DELETE";
      readonly id: string;
    },
  ]
  | readonly ["missing", { readonly path: string }]
  | readonly ["method_not_allowed", { readonly method: string }];

type ParseRoute =
  & Operation<Route>
  & readonly ["router.parse_route"];

export type Router = ParseRoute;

type WithoutRouter<requirements> = requirements extends Router ? never
  : requirements;

export function parse_route(): Effect<ParseRoute, Route> {
  return Effect.send(["router.parse_route"] as ParseRoute);
}

export function router_trace_scope(
  operation: unknown,
): TraceScope | undefined {
  const tagged = operation as TaggedOperation;

  if (tagged[0] !== "router.parse_route") {
    return undefined;
  }

  return {
    name: "http.route",
    finish_attributes(value) {
      const [pattern] = value as Route;

      return { route: pattern };
    },
  };
}

export function run_router<requirements, item>(
  effect: Effect<requirements, item>,
): Effect<
  WithoutRouter<requirements> | Uses<AsReader<RequestContext>>,
  item
> {
  if (effect[0] === "pure") {
    return Effect.pure(effect[1]);
  }

  const operation = effect[1] as TaggedOperation;

  if (operation[0] === "router.parse_route") {
    return Effect.bind(
      Effect.lift(ask<RequestContext>()),
      (context) => run_router(effect[2](match_route(context.request))),
    );
  }

  return Effect.suspend(
    effect[1] as WithoutRouter<requirements>,
    (value) => run_router(effect[2](value)),
  );
}

function match_route(request: Request): Route {
  const url = new URL(request.url);
  const parts = url.pathname.split("/").filter((part) => part.length > 0);

  if (parts[0] !== "todos") {
    return ["missing", { path: url.pathname }];
  }

  if (parts.length === 1) {
    switch (request.method) {
      case "GET":
      case "POST":
        return ["/todos", { method: request.method }];
      default:
        return ["method_not_allowed", { method: request.method }];
    }
  }

  if (parts.length === 2) {
    const id = decodeURIComponent(parts[1]);

    switch (request.method) {
      case "GET":
      case "PATCH":
      case "PUT":
      case "DELETE":
        return ["/todos/:id", { method: request.method, id }];
      default:
        return ["method_not_allowed", { method: request.method }];
    }
  }

  return ["missing", { path: url.pathname }];
}
