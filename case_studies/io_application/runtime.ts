import type { FileSystemRuntime } from "./filesystem.ts";

export function seed_files(): Map<string, string> {
  return new Map([
    [
      "notes.txt",
      "traits are values with dictionaries",
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
        return Promise.reject(new Error("missing file: " + path));
      }

      return Promise.resolve(text);
    },

    write_text(path, text) {
      files.set(path, text);
      writes.set(path, text);
      return Promise.resolve();
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
        return Promise.reject(new Error("missing file: " + path));
      }

      return Promise.resolve(text);
    },

    write_text(path, text) {
      writes.set(path, text);
      return Promise.resolve();
    },
  };
}

export function map_to_record(
  map: ReadonlyMap<string, string>,
): Readonly<Record<string, string>> {
  return Object.fromEntries(map);
}
