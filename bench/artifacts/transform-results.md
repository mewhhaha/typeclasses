# Transform hills 49-56

All optimization decisions are opt-in through `explain: true`, CLI `--explain`
JSONL, or plugin `on_report`. Unsupported syntax diagnostics remain separate
from missed optimization opportunities.

| Hill | Result and boundary                                                                                                                                                                                                                                                                                                                                                                 |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 49   | Counted `for` loops with one discarded yield and an explicit, unshadowed built-in Maybe/Either/Identity/Task dictionary call `tail_rec_m`. Tests complete 100,000 synchronous iterations and preserve cold Task replay. Other loop forms retain recursive continuations and report why iterator closing, mutable captures, control flow, or an unknown dictionary needs more proof. |
| 50   | Reusable, nonescaping top-level const Reader/State Programs fuse when construction stops immediately at zero-argument `ask`/`get` and every use is a same-scope matching terminal call. Eager prefixes, escaping values, TDZ uses and different lexical scopes stay intact. Named Writer construction may evaluate a log argument eagerly; it is preserved.                         |
| 51   | Keyed Reader/State/Writer outer runners specialize to existing terminal runners while retaining the original cell object and runtime identity checks. Same-key cells and mismatching-cell errors are differential tested. Primitive cell operations are not guessed or erased.                                                                                                      |
| 52   | Adjacent lazy maps accept named unary callbacks, block arrows, and immutable iterable roots/intermediate bindings. Shared intermediate wrappers remain when their identity or reuse would otherwise change. Replay, callback failures, captures and early iterator closing are tested.                                                                                              |
| 53   | Source-positioned decisions report successful rewrites and missed generator, loop, iterable and terminal opportunities. Reports describe the proof boundary and do not become unsupported-syntax errors.                                                                                                                                                                            |
| 54   | Each plugin owns an LRU cache keyed by exact source, filename, recognized import configuration, explain setting, transform revision and compiler version. Default bounds: 32 entries and 4 MiB of serialized text accounting. Results are clone-isolated. Zero entries disables caching.                                                                                            |
| 55   | The cheap source filter skips iterable import/binding analysis for generator-only files. Named Programs selected for terminal fusion skip the generic generator pass. Cache hits avoid parsing, AST analysis and printing.                                                                                                                                                          |
| 56   | Thirty-two generated iterable event traces compare construction, callbacks, replay, failures and cleanup; failures shrink by prefix and print the seed plus executable source. Fixed differential tests cover named Programs, keyed handlers, stack-safe loops and semantic barriers, alongside the existing generated Do suite.                                                    |

Cold source measurements use identical literal inputs from
`bench/source_transform_cases.ts` through the permanent
`bench/source_transform_comparison.bench.ts` runner. Baseline is commit
`908d00c`; exact revisions, commands and file fingerprints are in
`transform-metadata.json`. Times below are microseconds per transform.

| Input          | Baseline |  Current |  Change |
| -------------- | -------: | -------: | ------: |
| no target      |     1.95 |     1.94 |   -0.3% |
| 100 yields     | 10845.27 | 11221.87 |   +3.5% |
| named terminal |   369.90 |   361.85 |   -2.2% |
| named iterable |   106.71 |   340.47 | +219.0% |
| counted loop   |   302.46 |   321.80 |   +6.4% |

Cached 100-yield transforms take **18.97 us**, versus **11221.87 us** cold (592x
in this run). Named iterable compilation now emits a helper and source map; its
baseline performed no rewrite. The no-target absolute difference is below one
microsecond. This is one isolated paired run, not a confidence interval.

Final source timings include the imperative style cleanup. The application
timings predate that syntax-only cleanup; reversing `transform-style-only.patch`
reconstructs the exact measured transformer hash recorded in metadata. Both
runners use Deno default benchmark sampling.

The later exported string annotation changes no emitted JavaScript; reversing
`transform-type-only.patch` recovers the exact source-timed file.

The application runner qualifies full observations twice for each
original/transformed variant before timing. Both checkouts passed values,
failures, HTTP responses, logs and write comparisons. Four unsupported source
files are deliberately preserved and named in the corresponding logs. Current
dry-run averages follow, in microseconds.

| Application                 | Original | Transformed | Change | Rewrites / preserved files |
| --------------------------- | -------: | ----------: | -----: | -------------------------- |
| http_router                 |   391.10 |      335.50 | -14.2% | 10 / 0                     |
| io_application              |    38.01 |       30.33 | -20.2% | 1 / 1                      |
| agent_harness               |    47.25 |       37.00 | -21.7% | 1 / 1                      |
| parallel_analyzer           | 57132.65 |    65423.53 | +14.5% | 2 / 1                      |
| programming_language_parser |  1865.88 |     2253.37 | +20.8% | 0 / 1                      |

These application timings do not establish a universal speedup. The parallel
analyzer is slower with transformation in this run. The parser has zero
rewrites, so its difference is a control showing independent module/JIT/GC
variation. Baseline/current raw application observations and timings are
retained in `transform-cases-{baseline,current}.json`; exact preservation
messages are in the matching logs.

Validation: 73 transformer tests passed together, including generated-output
typechecking and esbuild/Rolldown bundles. Two subsequent focused tests cover
package-root loop imports and cached plugin report isolation; both pass. Owned
source, tests and benchmark runners pass lint.
