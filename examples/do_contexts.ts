import { from_array, to_array } from "../src/list.ts";
import {
  from_nullable,
  Just,
  type Maybe,
  type MaybeValue,
  Nothing,
} from "../src/maybe.ts";
import { Do } from "../src/typeclasses.ts";

export type Endpoint = {
  readonly host: string;
  readonly port: number;
};

export type Coordinate = {
  readonly row: number;
  readonly column: string;
};

export type DoContextScenario = {
  readonly endpoint: Maybe<Endpoint>;
  readonly missing_endpoint: Maybe<Endpoint>;
  readonly coordinates: readonly Coordinate[];
};

export function resolve_endpoint(
  input: Partial<Record<string, string>>,
): MaybeValue<Endpoint> {
  return Do(function* () {
    const host = yield* from_nullable(input.host);
    const port_text = yield* from_nullable(input.port);
    const port = yield* parse_positive_integer(port_text);

    return { host, port };
  });
}

export function choose_coordinates(): readonly Coordinate[] {
  const coordinates = Do(function* () {
    const row = yield* from_array([1, 2, 3]);
    const column = yield* from_array(columns_for_row(row));

    return { row, column };
  });

  return to_array(coordinates);
}

export function run_do_context_scenario(): DoContextScenario {
  return {
    endpoint: resolve_endpoint({
      host: "localhost",
      port: "8080",
    }).value(),
    missing_endpoint: resolve_endpoint({
      host: "localhost",
    }).value(),
    coordinates: choose_coordinates(),
  };
}

export function run_do_context_examples() {
  console.log(
    "Do across Maybe and List",
    Deno.inspect(run_do_context_scenario()),
  );
}

function parse_positive_integer(text: string): MaybeValue<number> {
  const value = Number(text);

  if (Number.isInteger(value) && value > 0) {
    return Just(value);
  }

  return Nothing<number>();
}

function columns_for_row(row: number): string[] {
  if (row === 1) {
    return ["left", "right"];
  }

  if (row === 2) {
    return ["center"];
  }

  return [];
}
