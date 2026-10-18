// Deliberate alternatives retained for the rejected chunk and handler-fusion hills.
export type Link = { readonly previous?: Link; readonly value: number };
export type Chunk = {
  readonly previous?: Chunk;
  readonly values: readonly number[];
};
export function append_chunk(
  previous: Chunk | undefined,
  value: number,
): Chunk {
  if (previous === undefined) return { values: [value] };
  if (previous.values.length === 32) return { previous, values: [value] };
  return { previous: previous.previous, values: [...previous.values, value] };
}
export function sum_chunks(chunk: Chunk | undefined): number {
  let sum = 0;
  while (chunk !== undefined) {
    for (const value of chunk.values) sum += value;
    chunk = chunk.previous;
  }
  return sum;
}
export function sum_links(link: Link | undefined): number {
  let sum = 0;
  while (link !== undefined) {
    sum += link.value;
    link = link.previous;
  }
  return sum;
}
