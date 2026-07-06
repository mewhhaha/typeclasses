import {
  file_system_err,
  file_system_ok,
  type FileSystemRuntime,
  missing_file,
} from "./filesystem.ts";

export function seed_files(): Map<string, string> {
  return new Map([
    [
      "notes.txt",
      "typeclasses are values with dictionaries",
    ],
  ]);
}

export function io_file_system(
  files: Map<string, string>,
  writes: Map<string, string>,
): FileSystemRuntime {
  return {
    read_text(path) {
      const text = files.get(path);

      if (text === undefined) {
        return Promise.resolve(file_system_err(missing_file(path)));
      }

      return Promise.resolve(file_system_ok(text));
    },

    write_text(path, text) {
      files.set(path, text);
      writes.set(path, text);
      return Promise.resolve(file_system_ok(undefined));
    },
  };
}

export function dry_run_file_system(
  files: ReadonlyMap<string, string>,
  writes: Map<string, string>,
): FileSystemRuntime {
  return {
    read_text(path) {
      const text = files.get(path);

      if (text === undefined) {
        return Promise.resolve(file_system_err(missing_file(path)));
      }

      return Promise.resolve(file_system_ok(text));
    },

    write_text(path, text) {
      writes.set(path, text);
      return Promise.resolve(file_system_ok(undefined));
    },
  };
}

export function map_to_record(
  map: ReadonlyMap<string, string>,
): Readonly<Record<string, string>> {
  return Object.fromEntries(map);
}
