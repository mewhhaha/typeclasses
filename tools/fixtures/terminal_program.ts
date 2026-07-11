import { Program, run } from "../../src/effects.ts";
import { ask, run_reader } from "../../src/reader.ts";

declare const environment: number;

export const value = run(run_reader(
  Program(function* () {
    return yield* ask<number>();
  }),
  environment,
));
