export interface Registry<item> {}

export const kind: unique symbol = Symbol("Trait.kind");

export type TypeId = keyof Registry<unknown>;

export type Kind<type_id extends TypeId, item> = Registry<item>[type_id];
