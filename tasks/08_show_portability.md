# 08 — Portability: remove `Deno.*` from published library code

**Impact: Medium · Effort: Low**

## Current state

The published library (`src/**`, exported via JSR) calls `Deno.inspect` in at
least 12 places, including hot, non-Show code:

```
src/array.ts:54          Show
src/data_view.ts:41      Show
src/form_data.ts:44      Show
src/identity.ts:46       Show
src/tuple.ts:89          Show
src/iterable.ts:60       Show
src/typed_array.ts:60    Show
src/list.ts:77           Show
src/maybe.ts:75          Show  (Just payload rendering)
src/typeclasses/ord.ts:157  compare_unknown ← Ord fallback, not just display
src/assert.ts:87         test helper (fine to keep Deno-only)
```

JSR packages are consumed from Node, Bun, browsers, and workerd — one of the
repo's own case studies is a **Cloudflare CRUD worker**. On any of those
runtimes, calling `.show()` on most types (or comparing non-primitive payloads
via `Ord`, which routes through `compare_unknown` →
`Deno.inspect(...).localeCompare(...)`) throws `Deno is not defined`.

## Proposal

1. Add `src/inspect.ts` with a single `inspect(value): string`:
   - use `Deno.inspect` when `globalThis.Deno?.inspect` exists;
   - else `node:util`'s `inspect` is *not* importable without a conditional
     import — avoid it; instead ship a small structural fallback
     (JSON-with-cycles-and-specials: strings quoted, `undefined`, `NaN`,
     bigint suffix, arrays/objects one level deep, constructor names beyond).
     ~40 lines, no dependencies, deterministic across runtimes.
2. Replace all `Deno.inspect` call sites in `src/` (leave `src/assert.ts` —
   test-only, excluded from publish? it is currently **included** since only
   `src/*.test.ts` are excluded in `deno.json` publish config — so replace it
   there too or move it under the test exclusion).
3. `compare_unknown` (`src/typeclasses/ord.ts:157`) deserves its own thought:
   ordering by inspect-string is already a documented fallback of last resort,
   but making it runtime-independent matters more than making it pretty —
   the deterministic fallback serializer above is fine.
4. Add a CI-able guard: a test that greps published sources for `Deno.` (or a
   `deno task check:portability` script), so the constraint survives future
   instances. Alternatively run `deno check` with `--no-lock` under
   `deno --unstable-node-globals`? Simplest is the grep test.

## Determinism bonus

`Show` output currently depends on Deno's inspect formatting (colors are
already off in string mode, but quoting/spacing can shift across Deno
versions). A local serializer makes `show` output stable, which the test
suite implicitly depends on (`assert_equals` on shown strings in examples).

## Acceptance criteria

- `grep -rn "Deno\." src/` returns only test files (or nothing, if
  `assert.ts` is moved/excluded).
- A Node smoke test (`node --experimental-strip-types` or a tiny bundle) that
  imports Maybe, calls `.show()`, `.eq()`, `Ord.compare`, and `match` — run
  manually or in CI if Node is available.
- Existing Deno tests pass with unchanged expectations, or expectations
  updated once, deliberately, in the same PR.
