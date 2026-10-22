import type { DatasetMutationParameterType, DatasetMutationRowParameters } from "./parameter-contracts.ts";
/** Public scalar inputs only. Null metadata means an untyped scalar, never an
 * implicit string conversion and never an object/array/caller fact. */
export function validDatasetMutationParameterType(
  value: unknown,
): value is DatasetMutationParameterType {
  return (
    value === null ||
    ["string", "number", "boolean", "date", "timestamp", "user"].includes(
      value as string,
    )
  );
}
export function datasetMutationScalar(
  value: unknown,
): value is string | number | boolean | null {
  return (
    value === null ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value)) ||
    (typeof value === "string" &&
      new TextEncoder().encode(value).length <= 65536)
  );
}
export function matchesDatasetMutationScalar(
  type: DatasetMutationParameterType,
  value: unknown,
): value is string | number | boolean | null {
  if (!datasetMutationScalar(value)) return false;
  return (
    value === null ||
    type === null ||
    (type === "number"
      ? typeof value === "number"
      : type === "boolean"
        ? typeof value === "boolean"
        : typeof value === "string")
  );
}
const safeRecord = (value: unknown): value is Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return (
    (proto === Object.prototype || proto === null) &&
    Object.values(Object.getOwnPropertyDescriptors(value)).every((property) =>
      Object.hasOwn(property, "value"),
    )
  );
};
const name = (value: string) =>
  /^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(value) &&
  !["constructor", "prototype", "__proto__"].includes(value);
export function validDatasetMutationParameterMap(
  value: unknown,
): value is Record<string, DatasetMutationParameterType> {
  return (
    safeRecord(value) &&
    Object.keys(value).length <= 256 &&
    Object.entries(value).every(
      ([key, type]) => name(key) && validDatasetMutationParameterType(type),
    )
  );
}
export function validDatasetMutationRowParameters(
  value: unknown,
  flat: Readonly<Record<string, DatasetMutationParameterType>>,
): boolean {
  if (value === undefined) return true;
  if (!safeRecord(value) || Object.keys(value).length > 240) return false;
  const params = new Set<string>();
  return Object.entries(value).every(([field, descriptor]) => {
    if (
      !name(field) ||
      !safeRecord(descriptor) ||
      Object.keys(descriptor).sort().join() !== "param,type" ||
      typeof descriptor.param !== "string" ||
      !name(descriptor.param) ||
      datasetMutationSystemParameter(descriptor.param) ||
      params.has(descriptor.param) ||
      !validDatasetMutationParameterType(descriptor.type) ||
      !Object.hasOwn(flat, descriptor.param) ||
      flat[descriptor.param] !== descriptor.type
    )
      return false;
    params.add(descriptor.param);
    return true;
  });
}

export const datasetMutationSystemParameter = (name: string) =>
  name === "_now" || name.startsWith("_me__") || name.startsWith("__policy_");
/** Exact generated edited-value slot; the flattened SQL map remains immutable authority metadata. */
export function validDatasetMutationValueParameter(
  value: unknown,
  flat: Readonly<Record<string, DatasetMutationParameterType>>,
  rows?: unknown,
): boolean {
  if (value === undefined) return true;
  return (
    safeRecord(value) &&
    Object.keys(value).sort().join() === "param,type" &&
    value.param === "cell__value" &&
    value.type !== null &&
    validDatasetMutationParameterType(value.type) &&
    Object.hasOwn(flat, value.param) &&
    flat[value.param] === value.type &&
    validDatasetMutationRowParameters(rows, flat) &&
    (rows === undefined || !Object.values(rows as DatasetMutationRowParameters).some((row) => row.param === value.param))
  );
}
