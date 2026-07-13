import { type AsArray, from_array } from "../../src/array.ts";
import { Program, type Uses } from "../../src/effects.ts";
import { Left } from "../../src/either.ts";
import { ask, type AsReader } from "../../src/reader.ts";
import { type AsState, get, modify, put } from "../../src/state.ts";
import { type AsWriter, tell } from "../../src/writer.ts";
import {
  type FileSystem,
  format_file_system_error,
  read_file,
  write_file,
} from "../io_application/filesystem.ts";
import { complete, type LanguageModel } from "./model.ts";
import type {
  AgentInput,
  AgentMessage,
  AgentResult,
  AgentTranscript,
} from "./types.ts";

export type AgentStdOut = Uses<AsWriter<AsArray, string>>;

type AgentApp =
  | Uses<AsReader<AgentInput>>
  | Uses<AsState<AgentTranscript>>
  | AgentStdOut
  | LanguageModel
  | FileSystem;

const AgentApp = Program.scope<AgentApp>();

export const agent_harness = AgentApp(function* () {
  const input = yield* ask<AgentInput>();

  yield* put<AgentTranscript>([["user", input.objective]]);
  yield* stdout("user: " + input.objective);

  for (let turn = 1; turn <= input.max_turns; turn += 1) {
    const messages = yield* get<AgentTranscript>();
    const [tag, payload] = yield* complete(messages);

    switch (tag) {
      case "read_file": {
        const path = payload.path;
        yield* stdout("assistant tool: read_file " + path);

        const result = yield* read_file(path);
        const result_value = result.value();

        if (Left.is(result_value)) {
          yield* append_messages([
            ["assistant", "read_file " + path],
            ["tool", format_file_system_error(result_value[1])],
          ]);
          continue;
        }

        yield* append_messages([
          ["assistant", "read_file " + path],
          ["tool", "read_file " + path + "\n" + result_value[1]],
        ]);
        continue;
      }

      case "write_file": {
        const path = payload.path;
        yield* stdout("assistant tool: write_file " + path);

        const result = yield* write_file(path, payload.text);
        const result_value = result.value();

        if (Left.is(result_value)) {
          yield* append_messages([
            ["assistant", "write_file " + path],
            ["tool", format_file_system_error(result_value[1])],
          ]);
          continue;
        }

        yield* append_messages([
          ["assistant", "write_file " + path],
          ["tool", "wrote " + path],
        ]);
        continue;
      }

      case "final": {
        yield* stdout("assistant: " + payload.answer);
        yield* append_messages([["assistant", payload.answer]]);
        const transcript = yield* get<AgentTranscript>();

        return {
          status: "completed",
          answer: payload.answer,
          turns: turn,
          transcript,
        } satisfies AgentResult;
      }
    }
  }

  const answer = "stopped after " + input.max_turns.toString() + " turns";
  yield* stdout("assistant: " + answer);
  yield* append_messages([["assistant", answer]]);
  const transcript = yield* get<AgentTranscript>();

  return {
    status: "stopped",
    answer,
    turns: input.max_turns,
    transcript,
  } satisfies AgentResult;
});

function stdout(line: string) {
  return tell(from_array([line]));
}

function append_messages(messages: readonly AgentMessage[]) {
  return modify<AgentTranscript>((transcript) => {
    return [...transcript, ...messages];
  });
}
