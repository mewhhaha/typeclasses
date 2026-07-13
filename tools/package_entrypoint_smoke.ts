const package_root = new URL("../", import.meta.url);
const package_manifest = JSON.parse(
  await Deno.readTextFile(new URL("deno.json", package_root)),
) as {
  readonly exports?: Readonly<Record<string, string>>;
};
const expected_entrypoints: Readonly<Record<string, readonly string[]>> = {
  ".": ["Effect", "Just", "Program", "worker_map"],
  "./prelude": ["fmap", "lift_A2", "sequence"],
  "./typeclass": ["data", "typeclass"],
  "./typeclasses": ["Applicative", "Functor", "Monad"],
  "./maybe": ["Just", "Maybe", "Nothing"],
  "./either": ["Either", "Left", "Right"],
  "./validation": ["Invalid", "Valid", "Validation"],
  "./identity": ["Identity", "identity"],
  "./fn": ["Fn", "arr", "fn"],
  "./tuple": ["Tuple", "fst", "tuple"],
  "./array": ["ArrayT", "from_array", "to_array"],
  "./predicate": ["Predicate", "predicate", "test"],
  "./task": ["Task", "from_fn", "succeed"],
  "./effects": ["Effect", "Program", "run"],
  "./parallel": ["create_worker_pool", "worker_map"],
  "./stm": ["Stm", "atomically", "new_tvar"],
  "./reader": ["Reader", "ask", "run_reader"],
  "./state": ["State", "get", "run_state"],
  "./writer": ["Writer", "run_writer", "tell"],
  "./list": ["Cons", "List", "Nil"],
  "./tagged": ["match"],
  "./loop": ["done", "loop", "rec"],
  "./transform": ["transform_do_program_source"],
  "./transform/plugin": [
    "typeclasses_esbuild_plugin",
    "typeclasses_rolldown_plugin",
    "typeclasses_rollup_plugin",
  ],
};
const package_exports = package_manifest.exports;

if (package_exports === undefined) {
  throw new Error("deno.json is missing package exports");
}

for (const specifier of Object.keys(package_exports)) {
  if (expected_entrypoints[specifier] === undefined) {
    throw new Error(`package entrypoint ${specifier} has no smoke expectation`);
  }
}

for (
  const [specifier, expected_names] of Object.entries(expected_entrypoints)
) {
  const target = package_exports[specifier];

  if (target === undefined) {
    throw new Error(`deno.json is missing package entrypoint ${specifier}`);
  }

  const module_exports = await import(new URL(target, package_root).href);

  for (const expected_name of expected_names) {
    if (!(expected_name in module_exports)) {
      throw new Error(
        `package entrypoint ${specifier} (${target}) is missing ${expected_name}`,
      );
    }
  }
}
