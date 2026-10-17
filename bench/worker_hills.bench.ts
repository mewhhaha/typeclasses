import { create_worker_pool, serve_worker } from "../src/parallel.ts";

const source = `
const serialize_error = (error) => ({ name: error.name, message: error.message, stack: error.stack });
(${serve_worker.toString()})((input) => input + 1);
`;
const inputs = Array.from({ length: 4_096 }, (_, index) => index);
let sink: unknown;
for (const batch_size of [1, 8, 32]) {
  Deno.bench({
    name: `Worker/warm4096-batch${batch_size}`,
    group: "worker batching",
    n: 5,
    warmup: 1,
    async fn(bench) {
      const url = URL.createObjectURL(
        new Blob([source], { type: "text/javascript" }),
      );
      try {
        using pool = create_worker_pool<number, number>(url, { workers: 2 });
        await pool.map([0, 1]);
        bench.start();
        const values = await pool.map(inputs, { batch_size });
        bench.end();
        if (values.length !== inputs.length || values[4_095] !== 4_096) {
          throw new Error("Wrong worker map result");
        }
        sink = values;
      } finally {
        URL.revokeObjectURL(url);
      }
    },
  });
}
void sink;
