# Transformer follow-up: hills 204, 206, 207

`bench/artifacts/round3-transform-followup.json` records seven raw timing
samples, Deno/TypeScript versions, source fingerprints, fixture sizes and
observed outputs. The printer uses npm TypeScript 5.9.3; the embedded Deno
checker is 6.0.3. Measurements ran under
`flock /tmp/typeclasses-round3-bench.lock`.

| Hill | Outcome and evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Limits                                                                                                                                                                                                                                                                                                                                                                                            |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 204  | Production call-head index rejects imported-but-unused transformation targets before lexical analysis and the rewriting visitor. A 5000-function module importing unused Do falls **60.042→46.666ms**. The used 8-yield control is **0.465→0.413ms**. The scanner includes imported aliases, namespace roots and canonical unanchored Do/Program diagnostic targets. A/B fixtures retain diagnostics, reports and output exactly, including Unicode escapes, shadowed calls, scoped Programs and effect aliases. | Conservative: possible iterable fusion bypasses this fast rejection. It still parses the module and collects imports. `optimizations.candidate_scan:false` retains the full visitor for comparison.                                                                                                                                                                                               |
| 206  | Tested changed-statement printer prototype keeps untouched source bytes. For 5000 unrelated functions plus one lowered statement: full printing **46.873ms**, changed printing **0.042ms**. Materializing UTF-8 output, which prevents a lazy-string-only comparison, is **43.693→0.173ms**. Behavior and comment tests pass.                                                                                                                                                                                    | Prototype only; production retains the complete source-map printer and composed map path. Requires identical top-level layout and original-node ancestry. Rejects generated identifiers, inserted/removed statements and comments inside the changed statement. This is printer cost, not complete transform time. Synthetic comment emission is outside this fixture prototype.                  |
| 207  | Typed numeric liveness prototype lowers **1024 dependent yields** into a flat switch using fresh readonly discriminated tuples. Maybe, Identity and branching ArrayT variants execute correctly and generated 1024-stage output typechecks for all three dictionaries, with no any/unknown frame slots. Maybe execution **1.913→0.147ms**;300 stages **0.273→0.029ms**. Live-set sweep cuts1024-stage analysis/emission from the initial **169.727ms** to **15.463ms**.                                          | Explicit experiment, not a production relaxation of the256-dependent-yield guard. Supports qualified imported dictionaries, explicit numeric const yields, pure numeric expressions and direct constructors. Generated1024-stage source is **180873 bytes vs39937** original, a4.53x expansion. Typechecking the three1024-stage variants took about 6s; no checker-speed improvement is claimed. |

The printer's first draft dropped a trailing comment on an unchanged function:
TypeScript treats it differently from the following statement's leading
comments. The qualified prototype now retains the original full trivia and
declines interior comments instead of dropping annotations. Generated aliases
are a separate barrier: printing isolated statements cannot assume the full
printer's consistent name allocation. Those cases, and every mapped build,
retain the existing printer.

The flat prototype carries only values needed by later contexts or the terminal
expression. A distant-use fixture keeps n0 live through 300 stages and reports
max_live = 2; the ordinary dependent chain reports max_live = 1. A single sweep
builds stage live sets, replacing the initial repeated scan of every local
binding. Both initial and final timing artifacts are retained.

A shared mutable frame is unsafe even for simple branching:

- Branch-local captured closures should return **[1,2]**. Reusing one frame
  makes both closures return2, producing **[2,2]**.
- A generator-local counter reset during replay should produce **[2,3]**.
  Incrementing a shared frame across branches produces **[2,4]**.

Executable counterexamples accompany the prototype. It rejects escaping
closures, mutable bindings, effectful constructors, outer reads, forward
references, destructuring and heterogeneous values. Qualified programs create a
fresh tuple for each continuation and restore live locals as const bindings.
Wider live sets increase generated tuple and union sizes; this prototype is
evidence for a narrow flat IR, not a replacement for the general generator
lowering.

Verification: nine new checks in `tools/round3_transform_checks.ts`, including
semantic comparison against ordinary Do for short chains and branching, explicit
1024-stage typechecking, diagnostic parity and mapped production output. The
full existing transformer suite remains the integration gate.

```sh
deno test --allow-env --allow-read --allow-run --allow-write=/tmp tools/round3_transform_checks.ts
flock /tmp/typeclasses-round3-bench.lock deno run --allow-env --allow-read --allow-write=bench/artifacts bench/experiments/round3_transform_measure.ts bench/artifacts/round3-transform-followup.json
```
