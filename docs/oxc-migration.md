# Oxc transformer migration

Released in 0.17.0. The manifest version was bumped after measurement; recorded
snapshots and their fingerprints retain 0.16.0.

The production transformer now uses `oxc-parser@0.154.0` directly. Its lowering
passes consume and construct native TS-ESTree nodes; there is no TypeScript
Compiler API adapter. `esrap@2.4.0` prints TypeScript/TSX and source maps.
`oxc-transform@0.154.0` erases types when executing verification fixtures.

The public `transform_do_program_source`, plugin, cache and result APIs remain
available. Generator lowering, terminal and iterable fusion, unsupported-pattern
diagnostics, comment retention, source maps and explicit optimization controls
remain covered. Malformed targeted input is preserved with parser diagnostics.
Generated formatting changes because the printer changed.

Production transformer sources shrink from 6,670 to 4,549 lines across the main
entrypoint, lexical analysis, iterable fusion and extracted AST, context,
import, generator and terminal modules. This comparison excludes tests and
benchmark drivers in both variants.

The portability scanner and benchmark import rewriting also use Oxc. TypeScript
remains in checker-backed compiler budgets and historical experiments. Oxc does
not typecheck, so Deno's checks still qualify the library and generated output.
The core library and its dependencies are unchanged.

Deno callers grant `--allow-env --allow-read --allow-ffi` for Oxc's native
loader. The repository tasks include these flags; the core library needs no
permissions. The staged package consumer checks all 64 exports outside the
repo's configuration and verifies that every new production module is published.

## Measurement

The baseline is commit `62e17ab23359d95f6097be19594cee600dd4ea70`, version
0.16.0. The driver is [bench/oxc_migration.ts](../bench/oxc_migration.ts). It
records source, workload, driver and dependency fingerprints, generated-code
sizes and call counts, raw paired samples and whole-block bootstrap intervals.
Before timing, original, old-generated and new-generated numeric workloads must
agree; TSX must parse, and unsupported and malformed inputs must stay intact
with diagnostics.

Each transform row uses eight ABBA blocks with default source maps enabled.
Separate controls measure the candidate's source-map opt-out and cache hits.
Fresh-process imports use four ABBA blocks after warming filesystem/package
caches; dynamic-import and whole-process times are reported separately. Runs
serialize through `/tmp/typeclasses-round3-bench.lock`.

The [final artifact](../bench/artifacts/oxc-migration.json) records Deno 2.9.7,
V8 15.0.245.2-rusty and Linux x86_64 with 16 reported hardware threads. The
sandbox does not expose the CPU model. No snapshot files changed during timing.

| Workload                                   | Old median, ms | Oxc median, ms | Paired speedup [95% interval] |
| ------------------------------------------ | -------------: | -------------: | ----------------------------- |
| No target, 5,000 unique functions          |          0.349 |          0.354 | 0.95 [0.82, 1.04]             |
| Unused imported Do, 5,000 unique functions |         65.388 |         97.321 | 0.69 [0.66, 0.71]             |
| 100 yields                                 |          4.566 |          5.110 | 0.88 [0.86, 0.91]             |
| 1,000 independent Maybe yields             |         41.625 |         60.087 | 0.72 [0.68, 0.76]             |
| Named terminal                             |          0.430 |          0.348 | 1.19 [1.08, 1.31]             |
| Named iterable                             |          0.389 |          0.460 | 0.80 [0.76, 0.85]             |
| Counted loop                               |          0.428 |          0.490 | 0.86 [0.81, 0.91]             |
| TSX                                        |          0.275 |          0.394 | 0.76 [0.67, 0.85]             |
| Unicode comments                           |          0.221 |          0.305 | 0.72 [0.65, 0.80]             |
| Fresh-process dynamic import               |        248.418 |         55.252 | 4.40 [3.91, 4.68]             |
| Whole fresh process                        |        438.221 |        237.642 | 1.84 [1.77, 1.89]             |

Startup and the named-terminal fixture improve; several warmed rewrites regress.
The no-target confidence interval includes parity. Source-map opt-out is 1.13×
[1.06, 1.23] in this run; a warm cache hit takes 0.003ms versus 5.051ms uncached
on the 100-yield fixture. Cache hits avoid transformation and are not an Oxc
parser speedup. Paired speedups use within-block ratios, so they need not equal
the ratio of the two marginal medians.

The [initial artifact](../bench/artifacts/oxc-migration-initial.json) exposed a
no-target source-prefilter regression. Restoring cheap string guards before
regular expressions brings that control back to parity. The final artifact
supersedes the initial timings and uses 100 iterations per no-target observation
instead of 1,000 to shorten iteration time; other workloads keep their counts.

Reproduce with separate frozen snapshots:

```sh
deno run --allow-env --allow-ffi --allow-read --allow-run \
  --allow-write=/tmp,bench/artifacts bench/oxc_migration.ts \
  BASELINE CANDIDATE bench/artifacts/oxc-migration.json
```

The driver takes its own lock. `--preflight-only` as a fourth argument runs only
the semantic controls. Shared-host noise, JIT and GC remain; these are results
for the recorded workloads, not a universal throughput guarantee.

## Verification

`deno task verify` passed, including package exports, bundlers, three valid
mutation kills, Node, Bun, browser and Workerd checks. After the final
line-terminator fix, `deno task check`, `deno lint`, `deno test` (401 passed,
one ignored), `deno task test:transformer` (122 passed) and the publish dry-run
passed again. The new tests cover lexical bindings, generator/terminal lowering,
10,000 yields, portability scanning, malformed input, comment retention and
UTF-16 mappings across all ECMAScript line terminators.

Pinned toolchains pass verification. Compiler and bundle budgets remain at
250,695 instantiations, 53,817B for the namespace, 14,542B for root Just and
14,396B for granular Just. Final production and verification source fingerprints
match the measured candidate snapshot.
