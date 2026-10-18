import process from "node:process";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import type { ProfileWorkload } from "../../tools/runtime_profile.ts";

const root = resolve(process.env.TYPECLASSES_PROFILE_ROOT ?? process.cwd());
const { Just }: typeof import("../../src/maybe.ts") = await import(
  pathToFileURL(resolve(root, "src/maybe.ts")).href
);
export default {
  name: "256 Maybe maps and raw boundaries",
  create: () => Array.from({ length: 256 }, (_, index) => Just(index)),
  run(values) {
    let total = 0;
    for (const value of values) {
      total += value.map((n) => n + 1).value()[1] ?? 0;
    }
    return total;
  },
} satisfies ProfileWorkload<ReturnType<typeof Just<number>>[]>;
