import { type AsArray, from_array } from "../../src/array.ts";
import { Program, type Uses } from "../../src/effects.ts";
import { ask, type AsReader } from "../../src/reader.ts";
import { type AsWriter, tell } from "../../src/writer.ts";
import {
  type FileSystem,
  read_file,
  write_file,
} from "../io_application/filesystem.ts";
import { complete, type LanguageModel } from "./model.ts";
import type { AgentInput, AgentMessage, AgentResult } from "./types.ts";

export type AgentStdOut = Uses<AsWriter<AsArray, string>>;

type AgentApp =
  | Uses<AsReader<AgentInput>>
  | AgentStdOut
  | LanguageModel
  | FileSystem;

const AgentApp = Program.scope<AgentApp>();

export const agent_harness = AgentApp(function* () {
  const input = yield* ask<AgentInput>();
  let messages: AgentMessage[] = [["user", input.objective]];

  yield* stdout("user: " + input.objective);

  for (let turn = 1; turn <= input.max_turns; turn += 1) {
    const action = yield* complete(messages);

    if (action[0] === "read_file") {
      const path = action[1].path;
      yield* stdout("assistant tool: read_file " + path);

      const text = yield* read_file(path);
      messages = [
        ...messages,
        ["assistant", "read_file " + path],
        ["tool", "read_file " + path + "\n" + text],
      ];
      continue;
    }

    if (action[0] === "write_file") {
      const path = action[1].path;
      yield* stdout("assistant tool: write_file " + path);

      yield* write_file(path, action[1].text);
      messages = [
        ...messages,
        ["assistant", "write_file " + path],
        ["tool", "wrote " + path],
      ];
      continue;
    }

    yield* stdout("assistant: " + action[1].answer);
    const transcript: AgentMessage[] = [
      ...messages,
      ["assistant", action[1].answer],
    ];

    return {
      status: "completed",
      answer: action[1].answer,
      turns: turn,
      transcript,
    } satisfies AgentResult;
  }

  const answer = "stopped after " + input.max_turns.toString() + " turns";
  yield* stdout("assistant: " + answer);
  const transcript: AgentMessage[] = [
    ...messages,
    ["assistant", answer],
  ];

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
