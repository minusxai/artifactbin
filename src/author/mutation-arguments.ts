import type { Row } from "./contracts.ts";
import { AF_STATE_URL_LIMIT } from "../apollo/apollo-contracts.ts";
/** Snapshot the frozen page ABI without invoking authored accessors. _row is
 * data only; the registered adapter still chooses which row fields may bind. */
export function authorMutationArguments(input: unknown): {
  args: Readonly<Row>;
  row?: Readonly<Row>;
} {
  function record(
    value: unknown,
    allowRow: boolean,
  ): { args: Readonly<Row>; row?: Readonly<Row> } {
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))
    )
      throw Error("Invalid author mutation arguments");
    const properties = Object.getOwnPropertyDescriptors(value);
    if (
      Reflect.ownKeys(value).length !== Object.keys(properties).length ||
      Object.keys(properties).length > 256
    )
      throw Error("Invalid author mutation arguments");
    const args: Row = Object.create(null);
    let row: Readonly<Row> | undefined;
    for (const [key, property] of Object.entries(properties)) {
      if (!Object.hasOwn(property, "value") || !property.enumerable)
        throw Error("Invalid author mutation arguments");
      const next = property.value;
      if (allowRow && key === "_row") {
        if (next !== undefined) row = record(next, false).args;
        continue;
      }
      if (
        !(
          next === null ||
          typeof next === "string" ||
          typeof next === "boolean" ||
          (typeof next === "number" && Number.isFinite(next))
        )
      )
        throw Error("Author mutation arguments must be scalars");
      args[key] = next;
    }
    return { args: Object.freeze(args), ...(row ? { row } : {}) };
  }
  const result = record(input === undefined ? {} : input, true);
  if (
    new TextEncoder().encode(JSON.stringify(result)).byteLength >
    AF_STATE_URL_LIMIT
  )
    throw Error("Author mutation arguments exceed size limit");
  return result;
}
