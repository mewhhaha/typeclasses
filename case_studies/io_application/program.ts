import { type AsArray, from_array } from "../../src/array.ts";
import { Program, type Uses } from "../../src/effects.ts";
import { Right } from "../../src/either.ts";
import { ask, type AsReader } from "../../src/reader.ts";
import { type AsWriter, tell } from "../../src/writer.ts";
import {
  type FileSystem,
  format_file_system_error,
  read_file,
  write_file,
} from "./filesystem.ts";
import { type CliInput, parse_command, usage } from "./types.ts";

export type StdOut = Uses<AsWriter<AsArray, string>>;

type App = FileSystem | Uses<AsReader<CliInput>> | StdOut;

const App = Program.scope<App>();

export const cli_program = App(function* () {
  const input = yield* ask<CliInput>();
  const [tag, payload] = parse_command(input.argv);

  switch (tag) {
    case "echo": {
      yield* stdout(payload.text);
      return 0;
    }

    case "cat": {
      const result = yield* read_file(payload.path);
      const result_value = result.value();

      if (Right.is(result_value)) {
        yield* stdout(result_value[1]);
        return 0;
      }

      yield* stdout(format_file_system_error(result_value[1]));
      return 1;
    }

    case "write": {
      const result = yield* write_file(payload.path, payload.text);
      const result_value = result.value();

      if (Right.is(result_value)) {
        yield* stdout("wrote " + payload.path);
        return 0;
      }

      yield* stdout(format_file_system_error(result_value[1]));
      return 1;
    }

    case "help": {
      yield* stdout(usage());
      return 2;
    }
  }
});

function stdout(line: string) {
  return tell(from_array([line]));
}
