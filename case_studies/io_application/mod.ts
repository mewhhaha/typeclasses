import { from_array, to_array } from "../../src/array.ts";
import { Effect } from "../../src/effects.ts";
import { run_reader } from "../../src/reader.ts";
import { run_task } from "../../src/task.ts";
import { run_writer } from "../../src/writer.ts";
import { run_file_system } from "./filesystem.ts";
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
      { argv: ["echo", "hello", "traits"], dry_run: false },
      { argv: ["cat", "notes.txt"], dry_run: false },
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
  const file_system = dry_run
    ? dry_run_file_system(files, writes)
    : io_file_system(files, writes);
  const [exit_code, stdout] = await Effect.handle_with(cli_program, [
    (effect) => run_reader(effect, input),
    (effect) => run_writer(effect, from_array<string>([])),
    (effect) => run_file_system(effect, file_system),
    run_task,
  ]);

  return {
    mode: dry_run ? "dry-run" : "io",
    command: argv.join(" "),
    exit_code,
    stdout: to_array(stdout),
    files: map_to_record(files),
    writes: map_to_record(writes),
  };
}
