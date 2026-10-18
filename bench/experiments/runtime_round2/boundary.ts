// Recapture after raw STM ownership protection and weak Reader/State caching.
const root = Deno.args[0];
const stm: typeof import("../../../src/stm.ts") = await import(
  `file://${root}/src/stm.ts`
);
const readers: typeof import("../../../src/reader.ts") = await import(
  `file://${root}/src/reader.ts`
);
const values = Array.from({ length: 1000 }, (_, index) => index);
const variable = stm.new_tvar({ values });
const write = stm.write_tvar(variable, { values });
const exposed = write.bind(() => stm.read_tvar(variable));
const custom = write.bind(() =>
  stm.Stm((journal) => {
    void journal;
  })
);
const pure = stm.Stm.pure(1);
const Reader = readers.Reader.with_environment<number>();
let reader = Reader.pure<number>(0);
for (let index = 0; index < 1000; index += 1) {
  reader = reader.map((value) => value + 1);
}
const workloads = {
  "STM/private-write1000": () => stm.atomically(write),
  "STM/exposed-write1000": () => stm.atomically(exposed),
  "STM/custom-callback1000": () => stm.atomically(custom),
  "STM/pure": () => stm.atomically(pure),
  "Reader/reused1000": () => reader.run(0),
};
let sink: unknown;
const results: Record<string, number[]> = {};
for (const [name, run] of Object.entries(workloads)) {
  for (let index = 0; index < 100; index += 1) sink = run();
  const samples: number[] = [];
  for (let sample = 0; sample < 5; sample += 1) {
    const start = performance.now();
    for (let index = 0; index < 1000; index += 1) sink = run();
    samples.push((performance.now() - start) / 1000);
  }
  results[name] = samples;
}
const files: Record<string, string> = {};
async function fingerprint(dir: string) {
  for await (const entry of Deno.readDir(`${root}/${dir}`)) {
    const file = `${dir}/${entry.name}`;
    if (entry.isDirectory) await fingerprint(file);
    else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
      const hash = await crypto.subtle.digest(
        "SHA-256",
        await Deno.readFile(`${root}/${file}`),
      );
      files[file] = Array.from(
        new Uint8Array(hash),
        (byte) => byte.toString(16).padStart(2, "0"),
      ).join("");
    }
  }
}
await fingerprint("src");
const report = {
  root,
  command: Deno.args,
  version: Deno.version,
  results,
  files,
};
await Deno.writeTextFile(Deno.args[1], JSON.stringify(report, null, 2) + "\n");
for (const [name, samples] of Object.entries(results)) {
  console.log(
    name,
    samples.toSorted((a, b) => a - b)[2],
  );
}
void sink;
