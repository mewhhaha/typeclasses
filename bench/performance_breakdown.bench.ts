import { type AsMaybe, just, Maybe, nothing } from "../src/maybe.ts";
import type { Data } from "../src/typeclass.ts";
import { Do, Functor, Monad } from "../src/typeclasses.ts";

const iterations = 10_000;
const chain_length = 20;
const do_length = 8;
let _sink = 0;

type RawMaybe<item> = readonly ["just", item] | readonly ["nothing"];

const add_one = (value: number) => value + 1;
const typeclasses_next = (value: number) => just(add_one(value));

const maybe_functor = Functor.instance_for(just(0));
const maybe_monad = Monad.instance_for(just(0));
const maybe_map = maybe_functor.map as (
  this: Data<AsMaybe, number>,
  fn: (value: number) => number,
) => Data<AsMaybe, number>;
const maybe_bind = maybe_monad.bind as (
  this: Data<AsMaybe, number>,
  fn: (value: number) => Data<AsMaybe, number>,
) => Data<AsMaybe, number>;

Deno.bench("breakdown raw tuple just construction", () => {
  let checksum = 0;

  for (let index = 0; index < iterations; index += 1) {
    checksum += consume_raw(raw_just(index));
  }

  _sink = checksum;
});

Deno.bench("breakdown typeclasses just construction", () => {
  let checksum = 0;

  for (let index = 0; index < iterations; index += 1) {
    checksum += consume_typeclasses(just(index));
  }

  _sink = checksum;
});

Deno.bench("breakdown typeclasses direct Maybe construction", () => {
  let checksum = 0;

  for (let index = 0; index < iterations; index += 1) {
    checksum += consume_typeclasses(Maybe(["just", index]));
  }

  _sink = checksum;
});

Deno.bench("breakdown typeclasses nothing reuse", () => {
  let checksum = 0;

  for (let index = 0; index < iterations; index += 1) {
    checksum += consume_typeclasses(nothing<number>());
  }

  _sink = checksum;
});

Deno.bench("breakdown raw tuple value read", () => {
  const value = raw_just(1);
  let checksum = 0;

  for (let index = 0; index < iterations * chain_length; index += 1) {
    checksum += consume_raw(value);
  }

  _sink = checksum;
});

Deno.bench("breakdown typeclasses value() read", () => {
  const value = just(1);
  let checksum = 0;

  for (let index = 0; index < iterations * chain_length; index += 1) {
    checksum += consume_typeclasses(value);
  }

  _sink = checksum;
});

Deno.bench("breakdown raw tuple map chain", () => {
  let checksum = 0;

  for (let index = 0; index < iterations; index += 1) {
    let value = raw_just(index);

    for (let step = 0; step < chain_length; step += 1) {
      value = raw_map(value, add_one);
    }

    checksum += consume_raw(value);
  }

  _sink = checksum;
});

Deno.bench("breakdown typeclasses fluent map chain", () => {
  let checksum = 0;

  for (let index = 0; index < iterations; index += 1) {
    let value = just(index);

    for (let step = 0; step < chain_length; step += 1) {
      value = value.map(add_one);
    }

    checksum += consume_typeclasses(value);
  }

  _sink = checksum;
});

Deno.bench("breakdown typeclasses cached map.call chain", () => {
  let checksum = 0;

  for (let index = 0; index < iterations; index += 1) {
    let value = just(index);

    for (let step = 0; step < chain_length; step += 1) {
      value = maybe_map.call(value, add_one);
    }

    checksum += consume_typeclasses(value);
  }

  _sink = checksum;
});

Deno.bench("breakdown typeclasses Functor.map chain", () => {
  let checksum = 0;

  for (let index = 0; index < iterations; index += 1) {
    let value = just(index);

    for (let step = 0; step < chain_length; step += 1) {
      value = Functor.map(value, add_one);
    }

    checksum += consume_typeclasses(value);
  }

  _sink = checksum;
});

Deno.bench("breakdown raw tuple bind chain", () => {
  let checksum = 0;

  for (let index = 0; index < iterations; index += 1) {
    let value = raw_just(index);

    for (let step = 0; step < chain_length; step += 1) {
      value = raw_bind(value, raw_next);
    }

    checksum += consume_raw(value);
  }

  _sink = checksum;
});

Deno.bench("breakdown typeclasses fluent bind chain", () => {
  let checksum = 0;

  for (let index = 0; index < iterations; index += 1) {
    let value = just(index);

    for (let step = 0; step < chain_length; step += 1) {
      value = value.bind(typeclasses_next);
    }

    checksum += consume_typeclasses(value);
  }

  _sink = checksum;
});

Deno.bench("breakdown typeclasses cached bind.call chain", () => {
  let checksum = 0;

  for (let index = 0; index < iterations; index += 1) {
    let value = just(index);

    for (let step = 0; step < chain_length; step += 1) {
      value = maybe_bind.call(value, typeclasses_next);
    }

    checksum += consume_typeclasses(value);
  }

  _sink = checksum;
});

Deno.bench("breakdown typeclasses Monad.bind chain", () => {
  let checksum = 0;

  for (let index = 0; index < iterations; index += 1) {
    let value = just(index);

    for (let step = 0; step < chain_length; step += 1) {
      value = Monad.bind(value, typeclasses_next);
    }

    checksum += consume_typeclasses(value);
  }

  _sink = checksum;
});

Deno.bench("breakdown typeclasses manual bind do-shape", () => {
  let checksum = 0;

  for (let index = 0; index < iterations; index += 1) {
    let value = just(index);

    for (let step = 0; step < do_length; step += 1) {
      value = value.bind((item) => just(add_one(item)));
    }

    checksum += consume_typeclasses(value.map((item) => item * 2));
  }

  _sink = checksum;
});

Deno.bench("breakdown typeclasses Do generator", () => {
  let checksum = 0;

  for (let index = 0; index < iterations; index += 1) {
    const value = Do(function* () {
      let item = yield* just(index);

      for (let step = 0; step < do_length; step += 1) {
        item = yield* just(add_one(item));
      }

      return item * 2;
    });

    checksum += consume_typeclasses(value);
  }

  _sink = checksum;
});

function raw_just<item>(item: item): RawMaybe<item> {
  return ["just", item];
}

function raw_map<from, to>(
  value: RawMaybe<from>,
  fn: (value: from) => to,
): RawMaybe<to> {
  const [tag, payload] = value;

  switch (tag) {
    case "just":
      return raw_just(fn(payload));
    case "nothing":
      return value;
  }
}

function raw_bind<from, to>(
  value: RawMaybe<from>,
  fn: (value: from) => RawMaybe<to>,
): RawMaybe<to> {
  const [tag, payload] = value;

  switch (tag) {
    case "just":
      return fn(payload);
    case "nothing":
      return value;
  }
}

function raw_next(value: number): RawMaybe<number> {
  return raw_just(add_one(value));
}

function consume_raw(value: RawMaybe<number>): number {
  const [tag, payload] = value;

  switch (tag) {
    case "just":
      return payload;
    case "nothing":
      return 0;
  }
}

function consume_typeclasses(value: Data<AsMaybe, number>): number {
  const [tag, payload] = value.value();

  switch (tag) {
    case "just":
      return payload;
    case "nothing":
      return 0;
  }
}
