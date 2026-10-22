import {
  validDatasetMutationParameterMap,
  validDatasetMutationRowParameters,
  validDatasetMutationValueParameter,
} from "../../../datasets/mutation/parameter-scalars.ts";
import type {
  DatasetMutationParameterType,
  DatasetMutationRowParameter,
  DatasetMutationValueParameter,
} from "../../../datasets/mutation/parameter-contracts.ts";
import type {
  AdmitCompiledDatasetMutationBindings,
  AdmittedCompiledDatasetMutation,
} from "./dataset-mutation-bindings-contracts.ts";
const identifier = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[A-Za-z][A-Za-z0-9_]{0,127}$/.test(value) &&
  !["constructor", "prototype", "__proto__"].includes(value);
const plain = (value: unknown): value is Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return (
    (prototype === Object.prototype || prototype === null) &&
    Object.values(Object.getOwnPropertyDescriptors(value)).every((property) =>
      Object.hasOwn(property, "value"),
    )
  );
};
function refuse(): never {
  throw Error("Invalid registered mutation metadata");
}
/** Publication admission and browser execution share this exact boundary. It
 * validates and copies data only; no fake transport or client is constructed. */
export const admitCompiledDatasetMutationBindings: AdmitCompiledDatasetMutationBindings =
  (bindings) => {
    if (!Array.isArray(bindings) || bindings.length > 64) refuse();
    const names = new Set<string>();
    const admitted: AdmittedCompiledDatasetMutation[] = [];
    for (const binding of bindings) {
      if (
        !plain(binding) ||
        !identifier(binding.name) ||
        names.has(binding.name) ||
        !identifier(binding.backendNamespace) ||
        typeof binding.recoveryScope !== "string" ||
        !/^[a-f0-9]{64}$/.test(binding.recoveryScope) ||
        !validDatasetMutationParameterMap(binding.paramTypes) ||
        Object.keys(binding.paramTypes).some((key) => !identifier(key)) ||
        Object.keys(binding.paramTypes).length > 240
      )
        refuse();
      if (
        binding.reset !== undefined &&
        (!Array.isArray(binding.reset) ||
          binding.reset.length > 240 ||
          Array.from(binding.reset).some((name) => !identifier(name)))
      )
        refuse();
      const paramTypes = Object.freeze({ ...binding.paramTypes });
      const flat: Record<string, DatasetMutationParameterType> = {
        ...paramTypes,
      };
      const rowParams: Record<string, DatasetMutationRowParameter> = {};
      if (binding.rowParams !== undefined) {
        if (
          !plain(binding.rowParams) ||
          Object.keys(binding.rowParams).length > 240
        )
          refuse();
        for (const [field, descriptor] of Object.entries(binding.rowParams)) {
          if (
            !plain(descriptor) ||
            !identifier(descriptor.param) ||
            Object.hasOwn(flat, descriptor.param)
          )
            refuse();
          // The complete row validator below checks field names, exact descriptor
          // keys/types, one-to-one mapping, and excludes trusted system parameters.
          flat[descriptor.param] =
            descriptor.type as DatasetMutationParameterType;
          rowParams[field] = Object.freeze({
            param: descriptor.param,
            type: descriptor.type as DatasetMutationParameterType,
          });
        }
      }
      let valueParam: DatasetMutationValueParameter | undefined;
      if (binding.valueParam !== undefined) {
        if (
          !plain(binding.valueParam) ||
          binding.valueParam.param !== "cell__value" ||
          Object.hasOwn(flat, "cell__value")
        )
          refuse();
        flat.cell__value = binding.valueParam
          .type as DatasetMutationParameterType;
        if (!validDatasetMutationValueParameter(binding.valueParam, flat))
          refuse();
        valueParam = Object.freeze({
          param: "cell__value",
          type: binding.valueParam
            .type as DatasetMutationValueParameter["type"],
        });
      }
      if (
        Object.keys(flat).length > 240 ||
        !validDatasetMutationRowParameters(binding.rowParams, flat)
      )
        refuse();
      names.add(binding.name);
      admitted.push(
        Object.freeze({
          name: binding.name,
          backendNamespace: binding.backendNamespace,
          recoveryScope: binding.recoveryScope,
          paramTypes,
          ...(binding.rowParams === undefined
            ? {}
            : { rowParams: Object.freeze(rowParams) }),
          ...(binding.reset === undefined
            ? {}
            : { reset: Object.freeze([...(binding.reset as string[])]) }),
          ...(valueParam ? { valueParam } : {}),
          flatParamTypes: Object.freeze(flat),
        }),
      );
    }
    return Object.freeze(admitted);
  };
