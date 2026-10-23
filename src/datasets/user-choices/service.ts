import { DatasetReadError } from "../contracts.ts";
import type {
  DatasetUserChoicePorts,
  DatasetUserChoiceService,
} from "./contracts.ts";
/** A second complete snapshot prevents any result escaping after a revocation. */
export function createDatasetUserChoiceService(
  ports: DatasetUserChoicePorts,
): DatasetUserChoiceService {
  return {
    async userChoices(context, input, signal) {
      if (
        !input ||
        typeof input !== "object" ||
        Array.isArray(input) ||
        Object.keys(input).sort().join() !== "column,name"
      )
        throw new DatasetReadError("invalid_request");
      const request = input as { name: string; column: string };
      if (
        [request.name, request.column].some(
          (v) =>
            typeof v !== "string" ||
            !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(v) ||
            ["constructor", "prototype", "__proto__"].includes(v),
        )
      )
        throw new DatasetReadError("invalid_request");
      signal?.throwIfAborted();
      const snapshot = await ports.snapshot(context, request, signal);
      if (!snapshot) throw new DatasetReadError("denied");
      const { constraints, callerUserId } = snapshot;
      let choices = constraints.memberOf ? snapshot.members : [];
      if (constraints.self)
        choices =
          callerUserId &&
          (!constraints.memberOf ||
            choices.some((v) => v.value === callerUserId)) &&
          snapshot.self
            ? [snapshot.self]
            : [];
      if (
        choices.length > 1000 ||
        new Set(choices.map((v) => v.value)).size !== choices.length ||
        choices.some(
          (v) =>
            !v.value ||
            v.value.length > 256 ||
            !v.label ||
            v.label.length > 4096,
        )
      )
        throw new DatasetReadError("result_limit");
      const result = choices
        .map((v) => ({ value: v.value, label: v.label }))
        .sort(
          (a, b) =>
            a.label.localeCompare(b.label) || a.value.localeCompare(b.value),
        );
      if (Buffer.byteLength(JSON.stringify(result)) > 60000)
        throw new DatasetReadError("result_limit");
      signal?.throwIfAborted();
      const fresh = await ports.snapshot(context, request, signal);
      signal?.throwIfAborted();
      if (!fresh || JSON.stringify(fresh) !== JSON.stringify(snapshot))
        throw new DatasetReadError("denied");
      return result;
    },
  };
}
