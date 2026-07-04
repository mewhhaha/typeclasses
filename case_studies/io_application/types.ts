export type CliInput = {
  readonly argv: readonly string[];
};

export type Command =
  | readonly ["echo", { readonly text: string }]
  | readonly ["cat", { readonly path: string }]
  | readonly ["write", { readonly path: string; readonly text: string }]
  | readonly ["help"];

export type CommandReport = {
  readonly mode: "io" | "dry-run";
  readonly command: string;
  readonly exit_code: number;
  readonly stdout: readonly string[];
  readonly files: Readonly<Record<string, string>>;
  readonly writes: Readonly<Record<string, string>>;
};

export function parse_command(argv: readonly string[]): Command {
  const [command, ...args] = argv;

  if (command === "echo") {
    return ["echo", { text: args.join(" ") }];
  }

  if (command === "cat" && args.length === 1) {
    return ["cat", { path: args[0] }];
  }

  if (command === "write" && args.length >= 2) {
    const [path, ...text] = args;
    return ["write", { path, text: text.join(" ") }];
  }

  return ["help"];
}

export function usage() {
  return [
    "usage:",
    "  echo <text>",
    "  cat <path>",
    "  write <path> <text>",
  ].join("\n");
}
