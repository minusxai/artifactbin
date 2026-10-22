import { selectDatasetMutationPolicy } from "./policy.ts";
import type {
  DatasetMutationAvailabilityPorts,
  DatasetMutationAvailabilityService,
} from "./availability-contracts.ts";
/** Reads current metadata only. Predicates, row effects and user constraints remain write-time checks. */
export function createDatasetMutationAvailabilityService(
  ports: DatasetMutationAvailabilityPorts,
): DatasetMutationAvailabilityService {
  return {
    async mutationAvailability(context, input, signal) {
      const unavailable = { canAttempt: false };
      if (
        signal?.aborted ||
        !input ||
        typeof input !== "object" ||
        Array.isArray(input) ||
        Object.keys(input).join() !== "operation"
      )
        return unavailable;
      const name = (input as { operation: unknown }).operation;
      if (
        typeof name !== "string" ||
        !name ||
        name.length > 128 ||
        ["__proto__", "constructor", "prototype"].includes(name)
      )
        return unavailable;
      try {
        const snapshot = await ports.snapshot(context, name, signal);
        if (signal?.aborted || !snapshot) return unavailable;
        const { operation, head } = snapshot;
        if (
          operation.name !== name ||
          operation.backendId !== context.backendId ||
          operation.backendVersion !== context.backendVersion ||
          operation.page.id !== context.pageId
        )
          return unavailable;
        const analysis = operation.analysis;
        if (
          !analysis ||
          !["insert", "update", "delete"].includes(analysis.operation) ||
          !Array.isArray(analysis.columns) ||
          analysis.columns.some(
            (c) => typeof c !== "string" || !c || c.length > 256,
          ) ||
          (analysis.operation === "update" && analysis.columns.length === 0) ||
          analysis.columns.length > 10000
        )
          return unavailable;
        if (
          context.subject === null &&
          (head.authority.facts.caller.userId ||
            head.authority.facts.caller.tokenId ||
            head.authority.facts.caller.groupId)
        )
          return unavailable;
        const selected = selectDatasetMutationPolicy(head, operation);
        if (!selected.operations.includes(analysis.operation))
          return unavailable;
        if (selected.policy) {
          const entries =
            selected.policy.table[`${analysis.operation}_permissions`];
          const permission = entries?.find(
            (e) => e.role === selected.policy!.role,
          )?.permission;
          if (!permission) return unavailable;
          if (analysis.operation === "update") {
            const columns =
              "columns" in permission ? permission.columns : undefined;
            if (
              columns !== "*" &&
              (!Array.isArray(columns) ||
                analysis.columns.some((c) => !columns.includes(c)))
            )
              return unavailable;
          }
        }
        return { canAttempt: true };
      } catch {
        return unavailable;
      }
    },
  };
}
