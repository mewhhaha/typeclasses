# 06 — Transformer: safer detection, check mode, and bundler integration

**Impact: Medium · Effort: Medium**

## Current state

Detection is purely syntactic, by identifier text
(`tools/transform_do_program.ts:1822-1841`):

- a call is a `do` site iff the callee is the bare identifier `Do`;
- a call is a `program` site iff the callee is `Program` or a variable
  initialized from `Program.scope(...)` (`collect_program_scopes`);
- `Effect.handle_with` / `Effect.interpret` are likewise matched by
  `Identifier.text`.

Consequences:

1. **False positives.** Any user function named `Do` that takes a generator is
   rewritten into `.bind`/`.map`/`.pure` calls on values that may not have
   them. Same for a local `Effect` object with `handle_with`. Unlikely names,
   but the failure mode is silent misbehavior at runtime, not a build error.
2. **False negatives.** `import { Do as monadDo }`, re-exports, or
   `typeclasses.Do(...)` namespace access are silently left on the runtime
   path (no diagnostic, since the callee isn't recognized at all).
3. **No import verification for `Do`.** `update_imports` only checks that
   *Program* transforms can reach an `Effect` import; `do` transforms never
   verify that `Do` actually comes from this library.

## Proposals

### a. Import-anchored detection (medium)

Resolve names from the file's import declarations instead of raw text: collect
local bindings of `Do`, `Program`, `Effect` from imports whose specifier
matches the library (configurable list, defaulting to
`@mewhhaha/typeclasses` / relative paths inside this repo). Aliased imports
then work, shadowed/user-defined `Do` is ignored, and namespace imports
(`tc.Do`) can be matched as property accesses. This stays a single-file,
type-checker-free transform — cheap enough for bundler loops — while fixing
both false positives and negatives. Emit a diagnostic when an identifier
*looks* like a target but wasn't resolved from a library import, so users
learn why a site was skipped.

### b. `--check` mode for CI (small)

`transform_do_program_source` already returns `{diagnostics, transformed}`.
Add a CLI flag that exits non-zero when diagnostics are non-empty (and
optionally when `transformed === 0` for files that were expected to change),
so projects can enforce "everything lowers" in CI. Today the CLI always exits
0 and prints diagnostics to stderr (`run_cli`,
`tools/transform_do_program.ts:182-212`).

### c. Ship a bundler entrypoint (medium)

The README pitches "a bundler plugin can decide whether to fail the build",
but the package only exports the raw `transform_do_program_source`. Provide
thin adapters so users don't each write the same glue:

- `tools/transform_plugin.ts` exporting an esbuild plugin and a
  Vite/Rollup-shaped `transform(code, id)` hook (both are ~20 lines around
  the existing function);
- filter to `.ts`/`.tsx`, skip files without `Do(`/`Program` fast-path
  substring check before parsing (perf);
- surface diagnostics through the bundler's warning channel with the
  file/line/column already produced.

Publish as a new export (`"./transform/plugin"`) in `deno.json`. Keep the
`typescript` npm dependency isolated to the transform entrypoints (it already
is — `src/` never imports it — worth an explicit test so it stays true).

### d. Source maps (large, optional)

`ts.createPrinter` output loses positions. For debugger fidelity the plugin
adapters could run the printer with a source-map-producing emit (or
`ts.transpileModule` on the transformed AST). Worth doing only after (c)
exists and someone asks; note it in the README's limitations until then.

## Acceptance criteria

- Aliased and namespaced imports of `Do`/`Program` are transformed; a
  user-defined local `Do` is not (tests for both in
  `tools/transform_do_program_checks.ts`).
- `deno task transform -- --check <file>` (or similar) exits 1 on diagnostics.
- An esbuild-based smoke test bundles `examples/monads.ts` with the plugin and
  asserts the output contains no `function*` for transformed sites.
- README Build-Time Transform section documents the plugin usage.
