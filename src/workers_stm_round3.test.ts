import { assert_equals, assert_true } from "./assert.ts";
import { create_worker_pool, serve_worker } from "./parallel.ts";
import {
  atomically,
  new_immutable_tvar,
  new_tvar,
  or_else,
  read_tvar,
  retry,
  StmError,
  update_immutable_path,
  write_tvar,
} from "./stm.ts";
import {
  cached_lookup,
  lookup,
  overlay,
  packed_worker_source,
} from "../bench/experiments/round3_workers_stm.ts";

function worker_script(handler: string, concurrency = 1) {
  const url = URL.createObjectURL(
    new Blob([
      `const serialize_error = error => ({name:error.name, message:error.message, stack:error.stack});
    (${serve_worker.toString()})(${handler}, {concurrency:${concurrency}, cooperative:true, transfer: value => {
      if (value instanceof ArrayBuffer) return [value];
      return [];
    }});`,
    ], { type: "text/javascript" }),
  );
  return {
    url,
    [Symbol.dispose]() {
      URL.revokeObjectURL(url);
    },
  };
}
async function rejection(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    assert_true(error instanceof Error, "expected error");
    return error as Error;
  }
  throw new Error("expected rejection");
}

Deno.test("range batches preserve ordered concurrent replies and failed pool reuse", async () => {
  using script = worker_script(
    `async input => {
    await new Promise(resolve => setTimeout(resolve, Math.max(0, 5 - Math.abs(input))));
    if (input < 0) throw new Error('negative');
    return input + 1;
  }`,
    3,
  );
  using pool = create_worker_pool<number, number>(script.url, {
    workers: 2,
    protocol: "range",
    batch_size: 4,
  });
  assert_equals(await pool.map([0, 1, 2, 3, 4]), [1, 2, 3, 4, 5]);
  assert_true(
    (await rejection(pool.map([0, -1, 2, 3, 4]))).message.includes("negative"),
    "remote failure",
  );
  assert_equals(await pool.map([8, 9]), [9, 10]);
});

Deno.test("range transfers move ownership both ways with concurrent handlers", async () => {
  using script = worker_script(
    `async input => {
    await Promise.resolve();
    new Uint8Array(input)[0] += 1;
    return input;
  }`,
    2,
  );
  using pool = create_worker_pool<ArrayBuffer, ArrayBuffer>(script.url, {
    workers: 1,
    protocol: "range",
    batch_size: 2,
  });
  const buffers = [new Uint8Array([1]).buffer, new Uint8Array([2]).buffer];
  const pending = pool.map(buffers, { transfer: (value) => [value] });
  assert_equals(buffers.map((value) => value.byteLength), [0, 0]);
  assert_equals((await pending).map((value) => new Uint8Array(value)[0]), [
    2,
    3,
  ]);
});

Deno.test("worker streaming reads only its current window and closes the input", async () => {
  using script = worker_script("input => input + 1");
  using pool = create_worker_pool<number, number>(script.url, {
    workers: 1,
    protocol: "range",
  });
  let consumed = 0;
  let closed = false;
  function* input() {
    try {
      for (let index = 0; index < 1000; index += 1) {
        consumed += 1;
        yield index;
      }
    } finally {
      closed = true;
    }
  }
  for await (
    const value of pool.stream(input(), { window_size: 8, batch_size: 8 })
  ) {
    assert_equals(value, 1);
    assert_equals(consumed, 8);
    break;
  }
  assert_true(closed, "early iterator return closes source");
  assert_equals(await pool.map([9]), [10]);
});

Deno.test("worker byte and item admission release capacity on cancellation", async () => {
  using script = worker_script(
    "async input => { await new Promise(resolve => setTimeout(resolve, 25)); return input; }",
  );
  using pool = create_worker_pool<string, string>(script.url, {
    workers: 1,
    max_pending_items: 2,
    max_pending_bytes: 4,
    input_bytes: (input) => String(input).length,
  });
  const controller = new AbortController();
  const active = rejection(
    pool.map(["aa", "bb"], { signal: controller.signal }),
  );
  assert_true(
    await rejection(pool.map(["a"])) instanceof RangeError,
    "item limit",
  );
  controller.abort();
  await active;
  assert_true(
    await rejection(pool.map(["12345"])) instanceof RangeError,
    "byte limit",
  );
  assert_equals(await pool.map(["ok"]), ["ok"]);
});

Deno.test("admission callback abort never posts work or leaks capacity", async () => {
  using script = worker_script("input => input");
  const controller = new AbortController();
  using pool = create_worker_pool<number, number>(script.url, {
    workers: 1,
    max_pending_bytes: 4,
    input_bytes() {
      controller.abort();
      return 1;
    },
  });
  assert_equals(
    (await rejection(pool.map([1], { signal: controller.signal }))).name,
    "AbortError",
  );
  assert_equals(await pool.map([2, 3, 4, 5]), [2, 3, 4, 5]);
});

Deno.test("cooperative abort acknowledges completion and reuses the same worker", async () => {
  using script = worker_script(`async (input, signal) => {
    if (input === 'wait') await new Promise(resolve => signal.addEventListener('abort', resolve, {once:true}));
    return self.identity ??= crypto.randomUUID();
  }`);
  using pool = create_worker_pool<string, string>(script.url, {
    workers: 1,
    abort_grace_ms: 200,
  });
  const before = await pool.map(["id"]);
  const controller = new AbortController();
  const pending = rejection(pool.map(["wait"], { signal: controller.signal }));
  // The prior ready reply ensures worker initialization has completed.
  await new Promise((resolve) => setTimeout(resolve, 5));
  controller.abort();
  assert_equals((await pending).name, "AbortError");
  assert_equals(await pool.map(["id"]), before);
});

Deno.test("cooperative abort replaces a hung worker after the grace deadline", async () => {
  using script = worker_script(`async input => {
    if (input === 'wait') await new Promise(() => {});
    return self.identity ??= crypto.randomUUID();
  }`);
  using pool = create_worker_pool<string, string>(script.url, {
    workers: 1,
    abort_grace_ms: 5,
  });
  const before = await pool.map(["id"]);
  const controller = new AbortController();
  const pending = rejection(pool.map(["wait"], { signal: controller.signal }));
  controller.abort();
  await pending;
  const after = await pool.map(["id"]);
  assert_true(before[0] !== after[0], "unresponsive worker replaced");
});

Deno.test("packed numeric experiment moves buffers and preserves numeric values", async () => {
  const url = URL.createObjectURL(
    new Blob([packed_worker_source], { type: "text/javascript" }),
  );
  const worker = new Worker(url, { type: "module" });
  try {
    const input = new Float64Array([0, -3, Infinity, NaN]);
    const result = new Promise<Float64Array>((resolve) => {
      worker.onmessage = (event) => resolve(event.data);
    });
    worker.postMessage(input, [input.buffer]);
    assert_equals(input.byteLength, 0);
    const output = await result;
    assert_equals(Array.from(output).slice(0, 3), [1, -2, Infinity]);
    assert_true(Number.isNaN(output[3]), "NaN preserved");
  } finally {
    worker.terminate();
    URL.revokeObjectURL(url);
  }
});

Deno.test("shape snapshots clone aliases and fall back safely for unknown values", () => {
  const shape = {
    record: { count: "number", list: { array: "number" } },
  } as const;
  const input = { count: 1, list: [1, 2] };
  const variable = new_tvar(input, { shape });
  input.list[0] = 99;
  const snapshot = atomically(read_tvar(variable));
  snapshot.list[0] = 50;
  assert_equals(atomically(read_tvar(variable)), { count: 1, list: [1, 2] });
  const shared = { count: 1 };
  const alias = new_tvar({ left: shared, right: shared }, {
    shape: {
      record: {
        left: { record: { count: "number" } },
        right: { record: { count: "number" } },
      },
    },
  });
  const read = atomically(read_tvar(alias));
  assert_true(read.left === read.right, "alias preserved");
  const outside = new_tvar<unknown>(new Map([[1, 2]]), { shape });
  assert_equals(
    Array.from(atomically(read_tvar(outside)) as Map<number, number>),
    [[1, 2]],
  );
  let failure: unknown;
  try {
    new_tvar(new SharedArrayBuffer(8), { shape });
  } catch (error) {
    failure = error;
  }
  assert_true(failure instanceof StmError, "fallback rejects shared memory");
});

Deno.test("shape fallback preserves extra keys, array holes, cycles and getters", () => {
  const array: unknown[] = [1, , 3];
  const sparse = new_tvar(array, { shape: { array: "number" } });
  assert_equals(Object.keys(atomically(read_tvar(sparse))), ["0", "2"]);
  const cyclic: { self?: unknown } = {};
  cyclic.self = cyclic;
  const state = new_tvar(cyclic, { shape: { record: { self: "number" } } });
  const snapshot = atomically(read_tvar(state));
  assert_true(snapshot.self === snapshot, "cyclic fallback preserves graph");
  const record = new_tvar({ known: 1, extra: 2 }, {
    shape: { record: { known: "number" } },
  });
  assert_equals(atomically(read_tvar(record)), { known: 1, extra: 2 });
  const accessor = new_tvar({
    get count() {
      return 3;
    },
  }, { shape: { record: { count: "number" } } });
  assert_equals(atomically(read_tvar(accessor)), { count: 3 });
});

Deno.test("private STM commit prepares all exposed clones before publishing", () => {
  const first = new_tvar(1);
  const second = new_tvar<{ bad?: unknown }>({});
  const action = write_tvar(first, 2).bind(() => write_tvar(second, {}))
    .bind(() => read_tvar(second)).map((value) => {
      value.bad = () => 0;
    });
  let failure: unknown;
  try {
    atomically(action);
  } catch (error) {
    failure = error;
  }
  assert_true(failure instanceof StmError, "late clone fails");
  assert_equals(atomically(read_tvar(first)), 1);
});

Deno.test("sound ancestor cache observes parent set, nearer shadow, delete and clear", () => {
  const parent = overlay();
  const child = overlay(parent);
  const leaf = overlay(child);
  assert_equals(cached_lookup(leaf, 1), 0);
  parent.entries.set(1, 7); // The exact stale-miss counterexample from hill 100.
  assert_equals(cached_lookup(leaf, 1), 7);
  child.entries.set(1, 9);
  assert_equals(cached_lookup(leaf, 1), 9);
  child.entries.delete(1);
  assert_equals(cached_lookup(leaf, 1), 7);
  parent.entries.clear();
  assert_equals(cached_lookup(leaf, 1), lookup(leaf, 1));
});

Deno.test("immutable path updates share untouched branches and isolate replacements", () => {
  const variable = new_immutable_tvar({
    left: { count: 1 },
    right: { list: [1, 2] },
  });
  const before = atomically(read_tvar(variable));
  const replacement = [4, 5];
  const after = atomically(
    update_immutable_path(variable, ["right", "list"], () => replacement),
  );
  replacement[0] = 99;
  assert_true(before.left === after.left, "unchanged branch shared");
  assert_true(before.right !== after.right, "changed ancestor copied");
  assert_equals(after.right.list, [4, 5]);
  assert_true(Object.isFrozen(after.right.list), "replacement frozen");
  const reverted = update_immutable_path(variable, ["left", "count"], () => 9)
    .bind(() => retry<typeof after>());
  assert_equals(atomically(or_else(reverted, read_tvar(variable))), after);
  assert_equals(atomically(read_tvar(variable)), after);
});

Deno.test("worker capability handshake negotiates range and explicit legacy remains available", async () => {
  const url = URL.createObjectURL(
    new Blob([`self.postMessage(['ready',{range:true}]);
    self.onmessage = event => {
      const [tag,payload,start,inputs] = event.data;
      if (tag === 'range') self.postMessage(['range-results',payload,start,inputs.map(()=>['done',tag])]);
      else self.postMessage(['results',payload.map(job=>['done',{batch:job.batch,id:job.id,output:tag}])]);
    };`], { type: "text/javascript" }),
  );
  try {
    using automatic = create_worker_pool<number, string>(url, { workers: 1 });
    using legacy = create_worker_pool<number, string>(url, {
      workers: 1,
      protocol: "legacy",
    });
    await Promise.all([automatic.ready, legacy.ready]);
    assert_equals(await automatic.map([1, 2], { batch_size: 2 }), [
      "range",
      "range",
    ]);
    assert_equals(await legacy.map([1, 2], { batch_size: 2 }), [
      "jobs",
      "jobs",
    ]);
  } finally {
    URL.revokeObjectURL(url);
  }
});

Deno.test("invalid compact replies make the pool terminal", async () => {
  const url = URL.createObjectURL(
    new Blob([`self.onmessage=event=> {
    const [,batch,start] = event.data;
    self.postMessage(['range-results',batch,start,[['done',1],['failed',{message:3}]]]);
  };`], { type: "text/javascript" }),
  );
  try {
    using pool = create_worker_pool<number, number>(url, {
      workers: 1,
      protocol: "range",
    });
    const first = await rejection(pool.map([1, 2], { batch_size: 2 }));
    assert_true(
      first.message.includes("invalid reply"),
      "malformed failure payload rejected",
    );
    assert_true(
      await rejection(pool.map([3])) === first,
      "terminal error retained",
    );
  } finally {
    URL.revokeObjectURL(url);
  }
});

Deno.test("versioned overlay cannot expose a Map mutation that bypasses invalidation", () => {
  const parent = overlay();
  const child = overlay(parent);
  cached_lookup(child, 1);
  let error: unknown;
  try {
    Map.prototype.set.call(parent.entries, 1, 7);
  } catch (caught) {
    error = caught;
  }
  assert_true(
    error instanceof TypeError,
    "native Map mutators cannot bypass the facade",
  );
  parent.entries.set(1, 7);
  assert_equals(cached_lookup(child, 1), 7);
});

Deno.test("immutable array path updates preserve custom data properties and no-op identity", () => {
  const values = Object.assign([1, 2], { label: "numbers" });
  const variable = new_immutable_tvar(values);
  const before = atomically(read_tvar(variable));
  const after = atomically(update_immutable_path(variable, [0], () => 3));
  assert_equals(after.label, "numbers");
  assert_equals(Array.from(after), [3, 2]);
  assert_true(
    atomically(update_immutable_path(variable, [0], (value) => value)) ===
      after,
    "no-op preserves root",
  );
  assert_equals(Array.from(before), [1, 2]);
});

Deno.test("immutable sparse array updates preserve an own constructor and custom data keys", () => {
  const values = Object.assign([1, , 3], { label: "sparse" });
  Object.defineProperty(values, "constructor", {
    value: null,
    enumerable: true,
  });
  Object.defineProperty(values, "__proto__", {
    value: { own: true },
    enumerable: true,
  });
  const variable = new_immutable_tvar(values);
  const before = atomically(read_tvar(variable));
  const after = atomically(update_immutable_path(variable, [0], () => 9));
  assert_equals(after[0], 9);
  assert_equals(before[0], 1);
  assert_equals(after.length, 3);
  assert_true(!(1 in after), "array hole remains absent");
  assert_equals(after[2], 3);
  assert_equals(after.label, "sparse");
  assert_equals(
    Object.getOwnPropertyDescriptor(after, "constructor")?.value,
    null,
  );
  assert_equals(Object.getOwnPropertyDescriptor(after, "__proto__")?.value, {
    own: true,
  });
  assert_true(
    Object.getPrototypeOf(after) === Array.prototype,
    "own special keys do not change the array prototype",
  );
  assert_true(Object.isFrozen(after), "updated array remains frozen");
});

async function admitted(pool: {
  map(inputs: readonly string[]): Promise<readonly string[]>;
}): Promise<readonly string[]> {
  const deadline = performance.now() + 2000;
  while (true) {
    try {
      return await pool.map(["next"]);
    } catch (error) {
      if (!(error instanceof RangeError) || performance.now() > deadline) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }
}

Deno.test("cooperative cancellation retains item and byte admission until acknowledgement", async () => {
  using script = worker_script(`async (input,signal)=>{
    if(input==='hold') await new Promise(resolve=>signal.addEventListener('abort',()=>setTimeout(resolve,40),{once:true}));
    return input;
  }`);
  for (const limit of [{ max_pending_items: 1 }, { max_pending_bytes: 4 }]) {
    using pool = create_worker_pool<string, string>(script.url, {
      workers: 2,
      ...limit,
      input_bytes: (value) => String(value).length,
      abort_grace_ms: 200,
    });
    await pool.ready;
    const controller = new AbortController();
    const cancelled = rejection(
      pool.map(["hold"], { signal: controller.signal }),
    );
    controller.abort();
    assert_equals((await cancelled).name, "AbortError");
    assert_true(
      await rejection(pool.map(["next"])) instanceof RangeError,
      "retained input still consumes admission",
    );
    assert_equals(await admitted(pool), ["next"]);
    assert_true(
      await rejection(pool.map(["next", "next"])) instanceof RangeError,
      "admission is released exactly once",
    );
  }
});

Deno.test("hung cooperative cancellation releases admission after worker replacement", async () => {
  using script = worker_script(
    `async input=>{if(input==='hold')await new Promise(()=>{});return input;}`,
  );
  using pool = create_worker_pool<string, string>(script.url, {
    workers: 2,
    max_pending_items: 1,
    max_pending_bytes: 4,
    input_bytes: (value) => String(value).length,
    abort_grace_ms: 20,
  });
  await pool.ready;
  const controller = new AbortController();
  const cancelled = rejection(
    pool.map(["hold"], { signal: controller.signal }),
  );
  controller.abort();
  await cancelled;
  assert_true(
    await rejection(pool.map(["next"])) instanceof RangeError,
    "hung assignment retains admission",
  );
  assert_equals(await admitted(pool), ["next"]);
});

Deno.test("worker stream preserves work and source cleanup failures and closes once", async () => {
  using script = worker_script(`()=>{throw new Error('work failed');}`);
  using pool = create_worker_pool<number, number>(script.url, { workers: 1 });
  const cleanup = new Error("cleanup failed");
  let closed = 0;
  const input: Iterable<number> = {
    [Symbol.iterator]() {
      return {
        next() {
          return { done: false, value: 1 };
        },
        return() {
          closed += 1;
          throw cleanup;
        },
      };
    },
  };
  const pending = async () => {
    for await (const _value of pool.stream(input, { window_size: 1 })) {
      throw new Error("unreachable");
    }
  };
  const error = await rejection(pending());
  assert_true(
    error instanceof AggregateError,
    "both failures remain observable",
  );
  const errors = (error as AggregateError).errors;
  assert_true(
    errors[0] instanceof Error && errors[0].message.includes("work failed"),
    "primary worker failure first",
  );
  assert_true(errors[1] === cleanup, "original cleanup failure second");
  assert_equals(closed, 1);
  assert_true(
    (await rejection(pool.map([1]))).message.includes("work failed"),
    "pool remains reusable",
  );
});

Deno.test("pre-aborted worker stream never acquires or pulls the input", async () => {
  using script = worker_script("input=>input");
  using pool = create_worker_pool<number, number>(script.url, { workers: 1 });
  const controller = new AbortController();
  controller.abort("before iteration");
  let acquired = 0;
  const input: Iterable<number> = {
    [Symbol.iterator]() {
      acquired += 1;
      return {
        next() {
          throw new Error("must not pull");
        },
      };
    },
  };
  const iterator = pool.stream(input, {
    signal: controller.signal,
    window_size: 3,
  })[Symbol.asyncIterator]();
  assert_equals((await rejection(iterator.next())).name, "AbortError");
  assert_equals(acquired, 0);
});
