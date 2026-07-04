import { from_array, to_array } from "../../src/array.ts";
import { Effect } from "../../src/effects.ts";
import { run_reader } from "../../src/reader.ts";
import { run_task } from "../../src/task.ts";
import { run_writer } from "../../src/writer.ts";
import { io_file_system, map_to_record } from "../io_application/runtime.ts";
import { run_file_system } from "../io_application/filesystem.ts";
import { run_language_model } from "./model.ts";
import { agent_harness } from "./program.ts";
import { type AgentHarnessReport, default_agent_input } from "./types.ts";
import { default_language_model, seed_agent_files } from "./runtime.ts";

export async function run_agent_harness_case_study() {
  const report = await run_agent_harness();

  console.log(
    "agent harness result",
    report.result.status,
    report.result.answer,
    report.result.turns,
  );
  console.log("agent harness stdout", Deno.inspect(report.stdout));
  console.log(
    "agent harness transcript",
    Deno.inspect(report.result.transcript),
  );
  console.log("agent harness files", Deno.inspect(report.files));
  console.log("agent harness writes", Deno.inspect(report.writes));
}

export async function run_agent_harness(): Promise<AgentHarnessReport> {
  const files = seed_agent_files();
  const writes = new Map<string, string>();
  const file_system = io_file_system(files, writes);
  const model = default_language_model();
  const [result, stdout] = await Effect.handle_with(agent_harness, [
    (effect) => run_reader(effect, default_agent_input()),
    (effect) => run_writer(effect, from_array<string>([])),
    (effect) => run_language_model(effect, model),
    (effect) => run_file_system(effect, file_system),
    run_task,
  ]);

  return {
    result,
    stdout: to_array(stdout),
    files: map_to_record(files),
    writes: map_to_record(writes),
  };
}
