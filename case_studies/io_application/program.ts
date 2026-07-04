import { type AsArray, from_array } from "../../src/array.ts";
import { Program, type Uses } from "../../src/effects.ts";
import { ask, type AsReader } from "../../src/reader.ts";
import { type AsWriter, tell } from "../../src/writer.ts";
import { type FileSystem, read_file, write_file } from "./filesystem.ts";
import { type CliInput, parse_command, usage } from "./types.ts";

export type StdOut = Uses<AsWriter<AsArray, string>>;

type App = FileSystem | Uses<AsReader<CliInput>> | StdOut;

const App = Program.scope<App>();

export const cli_program = App(function* () {
  const input = yield* ask<CliInput>();
  const command = parse_command(input.argv);

  if (command[0] === "echo") {
    yield* stdout(command[1].text);
    return 0;
  }

  if (command[0] === "cat") {
    const text = yield* read_file(command[1].path);
    yield* stdout(text);
    return 0;
  }

  if (command[0] === "write") {
    yield* write_file(command[1].path, command[1].text);
    yield* stdout("wrote " + command[1].path);
    return 0;
  }

  yield* stdout(usage());
  return 2;
});

function stdout(line: string) {
  return tell(from_array([line]));
}
