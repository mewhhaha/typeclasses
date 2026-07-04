import {
  Effect,
  type Effect as AlgebraicEffect,
  type Operation,
  type TaggedOperation,
  type Uses,
} from "../../src/effects.ts";
import { type AsTask, from_fn } from "../../src/task.ts";

export type ReadFile =
  & Operation<string>
  & {
    readonly tag: "fs.read_file";
    readonly path: string;
  };

export type WriteFile =
  & Operation<void>
  & {
    readonly tag: "fs.write_file";
    readonly path: string;
    readonly text: string;
  };

export type FileSystem = ReadFile | WriteFile;

export type FileSystemRuntime = {
  read_text(path: string): Promise<string>;
  write_text(path: string, text: string): Promise<void>;
};

type WithoutFileSystem<requirements> = requirements extends FileSystem ? never
  : requirements;

export function read_file(path: string): AlgebraicEffect<ReadFile, string> {
  return Effect.send({
    tag: "fs.read_file",
    path,
  } as ReadFile);
}

export function write_file(
  path: string,
  text: string,
): AlgebraicEffect<WriteFile, void> {
  return Effect.send({
    tag: "fs.write_file",
    path,
    text,
  } as WriteFile);
}

export function run_file_system<requirements, item>(
  effect: AlgebraicEffect<requirements, item>,
  runtime: FileSystemRuntime,
): AlgebraicEffect<WithoutFileSystem<requirements> | Uses<AsTask>, item> {
  if (effect.tag === "pure") {
    return Effect.pure(effect.value);
  }

  const operation = effect.operation as TaggedOperation;

  if (operation.tag === "fs.read_file") {
    const read = effect.operation as ReadFile;

    return Effect.bind(
      Effect.lift(from_fn(() => runtime.read_text(read.path))),
      (text) => run_file_system(effect.resume(text), runtime),
    );
  }

  if (operation.tag === "fs.write_file") {
    const write = effect.operation as WriteFile;

    return Effect.bind(
      Effect.lift(from_fn(() => runtime.write_text(write.path, write.text))),
      () => run_file_system(effect.resume(undefined), runtime),
    );
  }

  return Effect.suspend(
    effect.operation as WithoutFileSystem<requirements>,
    (value) => run_file_system(effect.resume(value), runtime),
  );
}
