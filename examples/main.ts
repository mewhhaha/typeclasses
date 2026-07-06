import { run_basic_examples } from "./basics.ts";
import { run_builtin_shape_examples } from "./built_in_shapes.ts";
import { run_custom_typeclass_examples } from "./custom_typeclass.ts";
import { run_effect_examples } from "./effects.ts";
import { run_monad_examples } from "./monads.ts";

run_custom_typeclass_examples();
await run_basic_examples();
await run_builtin_shape_examples();
await run_monad_examples();
await run_effect_examples();
