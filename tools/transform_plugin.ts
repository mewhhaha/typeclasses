import {
  transform_do_program_source,
  type TransformConfig,
  type TransformDiagnostic,
  type TransformSourceMap,
} from "./transform_do_program.ts";
import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";

/** Configuration shared by the esbuild, Rollup, Vite, and Rolldown adapters. */
export type TransformPluginOptions = TransformConfig & {
  /** Action taken when a recognized expression cannot be transformed. */
  readonly on_unsupported?: "error" | "warn" | "preserve";
};

/** @ignore */
export type RollupContext = {
  warn(message: string): void;
  error?(message: string): never;
};

/** @ignore */
export type TransformHookResult =
  | { readonly code: string; readonly map: TransformSourceMap | null }
  | null;

/** @ignore */
export type EsbuildBuild = {
  onLoad(
    options: { readonly filter: RegExp },
    callback: (args: { readonly path: string }) => Promise<
      {
        readonly contents: string;
        readonly loader: "ts" | "tsx";
      } | undefined
    >,
  ): void;
};

/** The subset of the esbuild plugin contract implemented by this adapter. */
export type EsbuildTransformPlugin = {
  readonly name: "typeclasses-transform";
  setup(build: EsbuildBuild): void;
};

/** A Rollup- and Vite-compatible transformer plugin. */
export type RollupTransformPlugin = {
  readonly name: "typeclasses-transform";
  transform(
    this: RollupContext,
    code: string,
    id: string,
  ): TransformHookResult;
};

/** A Rolldown transformer plugin with a native TypeScript hook filter. */
export type RolldownTransformPlugin = {
  readonly name: "typeclasses-transform";
  readonly transform: {
    readonly filter: { readonly id: RegExp };
    handler(
      this: RollupContext,
      code: string,
      id: string,
    ): TransformHookResult;
  };
};

/** A small, dependency-free esbuild adapter for the source transformer. */
export function typeclasses_esbuild_plugin(
  options: TransformPluginOptions = {},
): EsbuildTransformPlugin {
  return {
    name: "typeclasses-transform",
    setup(build: EsbuildBuild) {
      build.onLoad({ filter: /\.tsx?$/ }, async ({ path }) => {
        const code = await readFile(path, "utf8");
        if (!might_contain_target(code)) return undefined;
        const result = transform_do_program_source(code, path, options);
        if (report_diagnostics(result.diagnostics, options)) {
          return {
            contents: code,
            loader: path.endsWith(".tsx") ? "tsx" : "ts",
          };
        }
        return {
          contents: with_inline_source_map(result.code, result.map),
          loader: path.endsWith(".tsx") ? "tsx" : "ts",
        };
      });
    },
  };
}

/** A Vite/Rollup-shaped plugin. It uses the host warning channel when present. */
export function typeclasses_rollup_plugin(
  options: TransformPluginOptions = {},
): RollupTransformPlugin {
  return {
    name: "typeclasses-transform",
    transform(this: RollupContext, code: string, id: string) {
      return transform_rollup_source(this, code, id, options);
    },
  };
}

/** A Rolldown adapter with a native hook filter to avoid needless JS calls. */
export function typeclasses_rolldown_plugin(
  options: TransformPluginOptions = {},
): RolldownTransformPlugin {
  return {
    name: "typeclasses-transform",
    transform: {
      filter: { id: /\.tsx?(?:\?.*)?$/ },
      handler(this: RollupContext, code: string, id: string) {
        return transform_rollup_source(this, code, id, options);
      },
    },
  };
}

function transform_rollup_source(
  context: RollupContext,
  code: string,
  id: string,
  options: TransformPluginOptions,
): TransformHookResult {
  if (!is_typescript_file(id) || !might_contain_target(code)) return null;
  const result = transform_do_program_source(code, id, options);
  const policy = options.on_unsupported ?? "error";

  if (result.diagnostics.length > 0 && policy === "preserve") {
    return { code, map: null };
  }

  for (const diagnostic of result.diagnostics) {
    const message = format_diagnostic(diagnostic);

    if (policy === "error") {
      if (context.error !== undefined) context.error(message);
      throw new Error(message);
    }

    context.warn(message);
  }
  return { code: result.code, map: result.map };
}

function is_typescript_file(id: string): boolean {
  const path = id.split("?", 1)[0];
  return path.endsWith(".ts") || path.endsWith(".tsx");
}

function might_contain_target(code: string): boolean {
  // Imported aliases need not retain either public name at the call site, so
  // include the import declaration itself in this cheap pre-parse filter.
  if (code.includes("\\u")) return true;
  if (code.includes("Do") || code.includes("Program")) return true;
  if (
    code.includes("run_") &&
    (code.includes("run_reader") || code.includes("run_state") ||
      code.includes("run_writer")) &&
    /\brun\b/.test(code)
  ) return true;
  return code.includes("Effect") &&
    (code.includes("interpret") || code.includes("handle_with"));
}

function report_diagnostics(
  diagnostics: readonly TransformDiagnostic[],
  options: TransformPluginOptions,
): boolean {
  if (diagnostics.length === 0) return false;
  const policy = options.on_unsupported ?? "error";

  if (policy === "preserve") return true;

  const message = diagnostics.map(format_diagnostic).join("\n");
  if (policy === "error") throw new Error(message);
  console.warn(message);
  return false;
}

function format_diagnostic(diagnostic: TransformDiagnostic): string {
  return diagnostic.file_name + ":" + diagnostic.line + ":" +
    diagnostic.column + ": " + diagnostic.message;
}

function with_inline_source_map(
  code: string,
  map: TransformSourceMap | null,
): string {
  if (map === null) {
    return code;
  }

  const encoded = Buffer.from(JSON.stringify(map), "utf8").toString("base64");
  return code + "//# sourceMappingURL=data:application/json;base64," + encoded;
}
