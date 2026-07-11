import {
  transform_do_program_source,
  type TransformConfig,
  type TransformDiagnostic,
} from "./transform_do_program.ts";
import { readFile } from "node:fs/promises";

export type TransformPluginOptions = TransformConfig & {
  /** Fail the bundler transform when a generator could not be lowered. */
  readonly check?: boolean;
};

type RollupContext = {
  warn(message: string): void;
  error?(message: string): never;
};

type TransformHookResult =
  | { readonly code: string; readonly map: null }
  | null;

type EsbuildBuild = {
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

export type EsbuildTransformPlugin = {
  readonly name: "typeclasses-transform";
  setup(build: EsbuildBuild): void;
};

export type RollupTransformPlugin = {
  readonly name: "typeclasses-transform";
  transform(
    this: RollupContext,
    code: string,
    id: string,
  ): TransformHookResult;
};

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
        report_diagnostics(result.diagnostics, options);
        return {
          contents: result.code,
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

export const esbuild_plugin = typeclasses_esbuild_plugin;
export const vite_plugin = typeclasses_rollup_plugin;
export const rollup_plugin = typeclasses_rollup_plugin;
export const rolldown_plugin = typeclasses_rolldown_plugin;

function transform_rollup_source(
  context: RollupContext,
  code: string,
  id: string,
  options: TransformPluginOptions,
): TransformHookResult {
  if (!is_typescript_file(id) || !might_contain_target(code)) return null;
  const result = transform_do_program_source(code, id, options);
  for (const diagnostic of result.diagnostics) {
    const message = format_diagnostic(diagnostic);
    if (options.check && context.error !== undefined) context.error(message);
    context.warn(message);
  }
  return { code: result.code, map: null };
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
) {
  if (diagnostics.length === 0) return;
  const message = diagnostics.map(format_diagnostic).join("\n");
  if (options.check) throw new Error(message);
  console.warn(message);
}

function format_diagnostic(diagnostic: TransformDiagnostic): string {
  return diagnostic.file_name + ":" + diagnostic.line + ":" +
    diagnostic.column + ": " + diagnostic.message;
}
