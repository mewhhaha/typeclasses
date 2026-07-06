import { from_array, to_array } from "../../src/array.ts";
import { Effect } from "../../src/effects.ts";
import { run_reader } from "../../src/reader.ts";
import { run_task } from "../../src/task.ts";
import { run_writer } from "../../src/writer.ts";
import { type FileSystemRuntime, run_file_system } from "./filesystem.ts";
import { cli_program } from "./program.ts";
import {
  dry_run_file_system,
  io_file_system,
  map_to_record,
  seed_files,
} from "./runtime.ts";
import type { CliInput, CommandReport } from "./types.ts";

export async function run_io_application_case_study() {
  for (
    const scenario of [
      { argv: ["echo", "hello", "typeclasses"], dry_run: false },
      { argv: ["cat", "notes.txt"], dry_run: false },
      { argv: ["cat", "missing.txt"], dry_run: false },
      { argv: ["write", "out.txt", "generated summary"], dry_run: false },
      { argv: ["write", "out.txt", "preview only"], dry_run: true },
      { argv: ["unknown"], dry_run: false },
    ]
  ) {
    const report = await run_cli(scenario.argv, scenario.dry_run);

    console.log("io cli", report.mode, report.command, report.exit_code);
    console.log("io cli stdout", Deno.inspect(report.stdout));
    console.log("io cli files", Deno.inspect(report.files));
    console.log("io cli writes", Deno.inspect(report.writes));
  }
}

export async function run_cli(
  argv: readonly string[],
  dry_run: boolean,
): Promise<CommandReport> {
  const files = seed_files();
  const writes = new Map<string, string>();
  const input: CliInput = { argv };
  let file_system: FileSystemRuntime;
  let mode: CommandReport["mode"];

  if (dry_run) {
    file_system = dry_run_file_system(files, writes);
    mode = "dry-run";
  } else {
    file_system = io_file_system(files, writes);
    mode = "io";
  }

  const [exit_code, stdout] = await Effect.interpret(cli_program)
    .handle((effect) => run_reader(effect, input))
    .handle((effect) => run_writer(effect, from_array<string>([])))
    .handle((effect) => run_file_system(effect, file_system))
    .run(run_task);

  return {
    mode,
    command: argv.join(" "),
    exit_code,
    stdout: to_array(stdout),
    files: map_to_record(files),
    writes: map_to_record(writes),
  };
}
