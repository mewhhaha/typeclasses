import {
  Effect,
  type Operation,
  type TaggedOperation,
  type Uses,
} from "../../src/effects.ts";
import { type EitherValue, left, right } from "../../src/either.ts";
import { type AsTask, from_fn } from "../../src/task.ts";

export type FileSystemError =
  | readonly ["missing_file", { readonly path: string }]
  | readonly [
    "read_failed",
    { readonly path: string; readonly message: string },
  ]
  | readonly [
    "write_failed",
    { readonly path: string; readonly message: string },
  ];

export type FileSystemResult<item> = EitherValue<FileSystemError, item>;

export type ReadFile =
  & Operation<FileSystemResult<string>>
  & readonly ["fs.read_file", { readonly path: string }];

export type WriteFile =
  & Operation<FileSystemResult<void>>
  & readonly [
    "fs.write_file",
    { readonly path: string; readonly text: string },
  ];

export type FileSystem = ReadFile | WriteFile;

export type FileSystemRuntime = {
  read_text(path: string): Promise<FileSystemResult<string>>;
  write_text(path: string, text: string): Promise<FileSystemResult<void>>;
};

type WithoutFileSystem<requirements> = requirements extends FileSystem ? never
  : requirements;

export function read_file(
  path: string,
): Effect<ReadFile, FileSystemResult<string>> {
  return Effect.send(["fs.read_file", { path }] as ReadFile);
}

export function write_file(
  path: string,
  text: string,
): Effect<WriteFile, FileSystemResult<void>> {
  return Effect.send(["fs.write_file", { path, text }] as WriteFile);
}

export function run_file_system<requirements, item>(
  effect: Effect<requirements, item>,
  runtime: FileSystemRuntime,
): Effect<WithoutFileSystem<requirements> | Uses<AsTask>, item> {
  if (effect[0] === "pure") {
    return Effect.pure(effect[1]);
  }

  const operation = effect[1] as TaggedOperation;

  if (operation[0] === "fs.read_file") {
    const [, read] = effect[1] as ReadFile;

    return Effect.bind(
      Effect.lift(from_fn(() => runtime.read_text(read.path))),
      (result) => run_file_system(effect[2](result), runtime),
    );
  }

  if (operation[0] === "fs.write_file") {
    const [, write] = effect[1] as WriteFile;

    return Effect.bind(
      Effect.lift(from_fn(() => runtime.write_text(write.path, write.text))),
      (result) => run_file_system(effect[2](result), runtime),
    );
  }

  return Effect.suspend(
    effect[1] as WithoutFileSystem<requirements>,
    (value) => run_file_system(effect[2](value), runtime),
  );
}

export function file_system_ok<item>(value: item): FileSystemResult<item> {
  return right(value) as FileSystemResult<item>;
}

export function file_system_err<item = never>(
  error: FileSystemError,
): FileSystemResult<item> {
  return left<FileSystemError, item>(error);
}

export function missing_file(path: string): FileSystemError {
  return ["missing_file", { path }];
}

export function format_file_system_error(error: FileSystemError): string {
  const [tag, payload] = error;

  switch (tag) {
    case "missing_file":
      return "missing file: " + payload.path;
    case "read_failed":
      return "could not read " + payload.path + ": " + payload.message;
    case "write_failed":
      return "could not write " + payload.path + ": " + payload.message;
  }
}
