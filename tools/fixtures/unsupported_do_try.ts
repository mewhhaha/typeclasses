import { Do } from "../../src/typeclasses.ts";

const _program = Do(function* () {
  try {
    yield* load();
  } catch (error) {
    yield* recover(error);
  }

  return 1;
});
