export type AgentInput = {
  readonly objective: string;
  readonly max_turns: number;
};

export type AgentMessage = readonly [
  "user" | "assistant" | "tool",
  string,
];

export type ModelAction =
  | readonly ["read_file", { readonly path: string }]
  | readonly ["write_file", { readonly path: string; readonly text: string }]
  | readonly ["final", { readonly answer: string }];

export type AgentResult = {
  readonly status: "completed" | "stopped";
  readonly answer: string;
  readonly turns: number;
  readonly transcript: readonly AgentMessage[];
};

export type AgentHarnessReport = {
  readonly result: AgentResult;
  readonly stdout: readonly string[];
  readonly files: Readonly<Record<string, string>>;
  readonly writes: Readonly<Record<string, string>>;
};

export function default_agent_input(): AgentInput {
  return {
    objective: "read README.md and write summary.md",
    max_turns: 5,
  };
}
