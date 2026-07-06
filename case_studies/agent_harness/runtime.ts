import type { LanguageModelRuntime } from "./model.ts";
import type { ModelAction } from "./types.ts";

export function seed_agent_files(): Map<string, string> {
  return new Map([
    [
      "README.md",
      "Typeclasses is a TypeScript library for typeclasses and effects.",
    ],
  ]);
}

export function scripted_language_model(
  actions: readonly ModelAction[],
): LanguageModelRuntime {
  let index = 0;

  return {
    complete() {
      const action = actions[Math.min(index, actions.length - 1)];
      index += 1;
      return Promise.resolve(action);
    },
  };
}

export function default_language_model(): LanguageModelRuntime {
  return scripted_language_model([
    ["read_file", { path: "README.md" }],
    [
      "write_file",
      {
        path: "summary.md",
        text:
          "Summary: this project provides typeclasses and composable effects.",
      },
    ],
    ["final", { answer: "summary.md is ready" }],
  ]);
}
