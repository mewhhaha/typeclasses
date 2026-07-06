import { type AsArray, from_array as array_from_array } from "../src/array.ts";
import {
  type AsIterable,
  from_factory as iterable_from_factory,
  to_array as iterable_to_array,
} from "../src/iterable.ts";
import { type AsList, from_array as list_from_array } from "../src/list.ts";
import { from_entries as map_from_entries } from "../src/map.ts";
import { type AsMaybe, just } from "../src/maybe.ts";
import { from_entries as record_from_entries } from "../src/record.ts";
import { type AsEither, right } from "../src/either.ts";
import { from_iterable as set_from_iterable } from "../src/set.ts";
import type { Data } from "../src/typeclass.ts";
import {
  Applicative,
  type Applicative as ApplicativeDictionary,
  Functor,
  type Functor as FunctorDictionary,
  Monad,
  type Monad as MonadDictionary,
} from "../src/typeclasses.ts";
import { invalid, valid } from "../src/validation.ts";

const iterations = 10_000;
let _sink: unknown;

type Event = {
  readonly id: number;
  readonly base: number;
  readonly multiplier: number;
  readonly enabled: boolean;
};

type Feature = {
  readonly id: number;
  readonly weight: number;
  readonly active: boolean;
};

const events: readonly Event[] = [
  { id: 1, base: 10, multiplier: 2, enabled: true },
  { id: 2, base: 12, multiplier: 3, enabled: false },
  { id: 3, base: 14, multiplier: 4, enabled: true },
  { id: 4, base: 16, multiplier: 5, enabled: true },
  { id: 5, base: 18, multiplier: 6, enabled: false },
  { id: 6, base: 20, multiplier: 7, enabled: true },
];

const ids = [1, 2, 3, 4] as const;
const weights = [10, 20] as const;
const active_flags = [true, false] as const;

const array_events = array_from_array(events);
const array_ids = array_from_array(ids);
const array_weights = array_from_array(weights);
const array_active_flags = array_from_array(active_flags);

const list_events = list_from_array([...events]);
const list_ids = list_from_array([...ids]);
const list_weights = list_from_array([...weights]);
const list_active_flags = list_from_array([...active_flags]);

const iterable_events = iterable_from_factory(function* () {
  yield* events;
});
const iterable_ids = iterable_from_factory(function* () {
  yield* ids;
});
const iterable_weights = iterable_from_factory(function* () {
  yield* weights;
});
const iterable_active_flags = iterable_from_factory(function* () {
  yield* active_flags;
});

const map_events = map_from_entries(
  events.map((event) => [event.id.toString(), event] as const),
);
const record_events = record_from_entries(
  events.map((event) => [event.id.toString(), event] as const),
);
const set_events = set_from_iterable(events);

const maybe_event = just(events[0]);
const maybe_id = just(1);
const maybe_weight = just(10);
const maybe_active = just(true);

const either_event = right(events[0]);
const either_id = right(1);
const either_weight = right(10);
const either_active = right(true);

const validation_event = valid(events[0]);
const validation_id = valid(1);
const validation_weight = valid(10);
const validation_active = valid(true);
const validation_invalid_id = invalid<number>("missing id");
const validation_invalid_weight = invalid<number>("missing weight");

Deno.bench("algorithm functor native Array", () => {
  let current: unknown;

  for (let index = 0; index < iterations; index += 1) {
    current = events.map(score_event);
  }

  _sink = current;
});

Deno.bench("algorithm functor traits ArrayT", () => {
  let current: unknown;

  for (let index = 0; index < iterations; index += 1) {
    current = score_events(array_events);
  }

  _sink = current;
});

Deno.bench("algorithm functor traits List", () => {
  let current: unknown;

  for (let index = 0; index < iterations; index += 1) {
    current = score_events(list_events);
  }

  _sink = current;
});

Deno.bench("algorithm functor native generator forced", () => {
  let current: unknown;

  for (let index = 0; index < iterations; index += 1) {
    current = [...iterator_score_events(events)];
  }

  _sink = current;
});

Deno.bench("algorithm functor traits IterableT forced", () => {
  let current: unknown;

  for (let index = 0; index < iterations; index += 1) {
    current = iterable_to_array(score_events(iterable_events));
  }

  _sink = current;
});

Deno.bench("algorithm functor traits MapT", () => {
  let current: unknown;

  for (let index = 0; index < iterations; index += 1) {
    current = score_events(map_events);
  }

  _sink = current;
});

Deno.bench("algorithm functor traits RecordT", () => {
  let current: unknown;

  for (let index = 0; index < iterations; index += 1) {
    current = score_events(record_events);
  }

  _sink = current;
});

Deno.bench("algorithm functor traits SetT", () => {
  let current: unknown;

  for (let index = 0; index < iterations; index += 1) {
    current = score_events(set_events);
  }

  _sink = current;
});

Deno.bench("algorithm functor traits Maybe", () => {
  let current: unknown;

  for (let index = 0; index < iterations; index += 1) {
    current = score_events(maybe_event);
  }

  _sink = current;
});

Deno.bench("algorithm functor traits Either", () => {
  let current: unknown;

  for (let index = 0; index < iterations; index += 1) {
    current = score_events(either_event);
  }

  _sink = current;
});

Deno.bench("algorithm functor traits Validation", () => {
  let current: unknown;

  for (let index = 0; index < iterations; index += 1) {
    current = score_events(validation_event);
  }

  _sink = current;
});

Deno.bench("algorithm applicative native Array product", () => {
  let current: unknown;

  for (let index = 0; index < iterations; index += 1) {
    current = native_feature_product(ids, weights, active_flags);
  }

  _sink = current;
});

Deno.bench("algorithm applicative traits ArrayT product", () => {
  let current: unknown;

  for (let index = 0; index < iterations; index += 1) {
    current = build_features(
      array_ids,
      array_weights,
      array_active_flags,
    );
  }

  _sink = current;
});

Deno.bench("algorithm applicative traits List product", () => {
  let current: unknown;

  for (let index = 0; index < iterations; index += 1) {
    current = build_features(
      list_ids,
      list_weights,
      list_active_flags,
    );
  }

  _sink = current;
});

Deno.bench("algorithm applicative native generator product forced", () => {
  let current: unknown;

  for (let index = 0; index < iterations; index += 1) {
    current = [...iterator_feature_product(ids, weights, active_flags)];
  }

  _sink = current;
});

Deno.bench("algorithm applicative traits IterableT product forced", () => {
  let current: unknown;

  for (let index = 0; index < iterations; index += 1) {
    current = iterable_to_array(
      build_features(
        iterable_ids,
        iterable_weights,
        iterable_active_flags,
      ),
    );
  }

  _sink = current;
});

Deno.bench("algorithm applicative traits Maybe", () => {
  let current: unknown;

  for (let index = 0; index < iterations; index += 1) {
    current = build_features(maybe_id, maybe_weight, maybe_active);
  }

  _sink = current;
});

Deno.bench("algorithm applicative traits Either", () => {
  let current: unknown;

  for (let index = 0; index < iterations; index += 1) {
    current = build_features(either_id, either_weight, either_active);
  }

  _sink = current;
});

Deno.bench("algorithm applicative traits Validation valid", () => {
  let current: unknown;

  for (let index = 0; index < iterations; index += 1) {
    current = build_features(
      validation_id,
      validation_weight,
      validation_active,
    );
  }

  _sink = current;
});

Deno.bench("algorithm applicative traits Validation invalid", () => {
  let current: unknown;

  for (let index = 0; index < iterations; index += 1) {
    current = build_features(
      validation_invalid_id,
      validation_invalid_weight,
      validation_active,
    );
  }

  _sink = current;
});

Deno.bench("algorithm monad native Array dependent product", () => {
  let current: unknown;

  for (let index = 0; index < iterations; index += 1) {
    current = native_dependent_features(ids);
  }

  _sink = current;
});

Deno.bench("algorithm monad traits ArrayT dependent product", () => {
  let current: unknown;

  for (let index = 0; index < iterations; index += 1) {
    current = dependent_features(
      array_ids,
      array_weights_for,
      array_active_for,
    );
  }

  _sink = current;
});

Deno.bench("algorithm monad traits List dependent product", () => {
  let current: unknown;

  for (let index = 0; index < iterations; index += 1) {
    current = dependent_features(
      list_ids,
      list_weights_for,
      list_active_for,
    );
  }

  _sink = current;
});

Deno.bench("algorithm monad native generator dependent product forced", () => {
  let current: unknown;

  for (let index = 0; index < iterations; index += 1) {
    current = [...iterator_dependent_features(ids)];
  }

  _sink = current;
});

Deno.bench("algorithm monad traits IterableT dependent product forced", () => {
  let current: unknown;

  for (let index = 0; index < iterations; index += 1) {
    current = iterable_to_array(
      dependent_features(
        iterable_ids,
        iterable_weights_for,
        iterable_active_for,
      ),
    );
  }

  _sink = current;
});

Deno.bench("algorithm monad traits Maybe", () => {
  let current: unknown;

  for (let index = 0; index < iterations; index += 1) {
    current = dependent_features(
      maybe_id,
      maybe_weight_for,
      maybe_active_for,
    );
  }

  _sink = current;
});

Deno.bench("algorithm monad traits Either", () => {
  let current: unknown;

  for (let index = 0; index < iterations; index += 1) {
    current = dependent_features(
      either_id,
      either_weight_for,
      either_active_for,
    );
  }

  _sink = current;
});

function score_events<dictionary extends FunctorDictionary<dictionary>>(
  input: Data<dictionary, Event>,
): Data<dictionary, number> {
  return Functor.map(input, score_event);
}

function build_features<
  dictionary extends ApplicativeDictionary<dictionary>,
>(
  id: Data<dictionary, number>,
  weight: Data<dictionary, number>,
  active: Data<dictionary, boolean>,
): Data<dictionary, Feature> {
  return Applicative.lift(build_feature, id, weight, active);
}

function dependent_features<dictionary extends MonadDictionary<dictionary>>(
  id: Data<dictionary, number>,
  weight_for: (id: number) => Data<dictionary, number>,
  active_for: (id: number, weight: number) => Data<dictionary, boolean>,
): Data<dictionary, Feature> {
  return Monad.bind(id, (id) => {
    return Monad.bind(weight_for(id), (weight) => {
      return Functor.map(active_for(id, weight), (active) => {
        return build_feature(id, weight, active);
      });
    });
  });
}

function score_event(event: Event): number {
  if (!event.enabled) {
    return 0;
  }

  return event.base * event.multiplier + event.id;
}

function build_feature(
  id: number,
  weight: number,
  active: boolean,
): Feature {
  return { id, weight, active };
}

function native_feature_product(
  ids: readonly number[],
  weights: readonly number[],
  active_flags: readonly boolean[],
): Feature[] {
  const out: Feature[] = [];

  for (const id of ids) {
    for (const weight of weights) {
      for (const active of active_flags) {
        out.push(build_feature(id, weight, active));
      }
    }
  }

  return out;
}

function native_dependent_features(ids: readonly number[]): Feature[] {
  const out: Feature[] = [];

  for (const id of ids) {
    for (const weight of native_weights_for(id)) {
      for (const active of native_active_for(id, weight)) {
        out.push(build_feature(id, weight, active));
      }
    }
  }

  return out;
}

function* iterator_score_events(events: Iterable<Event>): Iterable<number> {
  for (const event of events) {
    yield score_event(event);
  }
}

function* iterator_feature_product(
  ids: Iterable<number>,
  weights: Iterable<number>,
  active_flags: Iterable<boolean>,
): Iterable<Feature> {
  for (const id of ids) {
    for (const weight of weights) {
      for (const active of active_flags) {
        yield build_feature(id, weight, active);
      }
    }
  }
}

function* iterator_dependent_features(
  ids: Iterable<number>,
): Iterable<Feature> {
  for (const id of ids) {
    for (const weight of native_weights_for(id)) {
      for (const active of native_active_for(id, weight)) {
        yield build_feature(id, weight, active);
      }
    }
  }
}

function native_weights_for(id: number): readonly number[] {
  return [id * 10, id * 10 + 5];
}

function native_active_for(id: number, weight: number): readonly boolean[] {
  return [weight % 2 === 0, id % 2 === 0];
}

function array_weights_for(id: number): Data<AsArray, number> {
  return array_from_array(native_weights_for(id));
}

function array_active_for(
  id: number,
  weight: number,
): Data<AsArray, boolean> {
  return array_from_array(native_active_for(id, weight));
}

function list_weights_for(id: number): Data<AsList, number> {
  return list_from_array([...native_weights_for(id)]);
}

function list_active_for(
  id: number,
  weight: number,
): Data<AsList, boolean> {
  return list_from_array([...native_active_for(id, weight)]);
}

function iterable_weights_for(id: number): Data<AsIterable, number> {
  return iterable_from_factory(function* () {
    yield* native_weights_for(id);
  });
}

function iterable_active_for(
  id: number,
  weight: number,
): Data<AsIterable, boolean> {
  return iterable_from_factory(function* () {
    yield* native_active_for(id, weight);
  });
}

function maybe_weight_for(id: number): Data<AsMaybe, number> {
  return just(id * 10);
}

function maybe_active_for(
  id: number,
  weight: number,
): Data<AsMaybe, boolean> {
  return just(weight % 2 === 0 && id % 2 === 1);
}

function either_weight_for(id: number): Data<AsEither, number> {
  return right(id * 10);
}

function either_active_for(
  id: number,
  weight: number,
): Data<AsEither, boolean> {
  return right(weight % 2 === 0 && id % 2 === 1);
}
