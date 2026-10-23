import type { DatasetBinding } from "../datasets/contracts.ts";
import type { RegisteredDatasetUserChoiceBinding } from "../datasets/user-choices/contracts.ts";
import type { LegacyMutationDescriptor } from "./conversion/mutation-contracts.ts";
/** Publication consumes authorizer-proven query origins, never public cell routing metadata. */
export function projectMigrationUserChoiceBindings(
  sourceNamespace: string,
  revisions: readonly {
    version: number;
    mutations?: readonly LegacyMutationDescriptor[];
  }[],
  bindings: readonly DatasetBinding[],
): RegisteredDatasetUserChoiceBinding[] {
  const result: RegisteredDatasetUserChoiceBinding[] = [];
  for (const revision of revisions)
    for (const mutation of revision.mutations ?? []) {
      const proof = mutation.cellUserChoice;
      if (!proof) continue;
      const matching = bindings.filter(
        (b) =>
          b.name === proof.bindingName && b.page.version === revision.version,
      );
      if (matching.length !== 1)
        throw Error("User choices require registered source binding");
      const binding = matching[0]!;
      const column = binding.tables
        .find((t) => t.schema === proof.schema && t.name === proof.table)
        ?.columns.find((c) => c.name === proof.sourceColumn);
      if (column?.type !== "user")
        throw Error("User choices require proven user column");
      const registered = {
        ...proof,
        backendId: binding.backendId,
        backendVersion: binding.backendVersion,
        pageId: binding.page.id,
        pageVersion: binding.page.version,
        sourceNamespace,
      };
      const prior = result.find(
        (p) =>
          p.pageVersion === revision.version &&
          p.name === proof.name &&
          p.column === proof.column,
      );
      if (prior && JSON.stringify(prior) !== JSON.stringify(registered))
        throw Error("Conflicting user choice origins");
      if (!prior) result.push(registered);
    }
  return result;
}
/** Refuse metadata with detached or non-user sources before any destination writes. */
export function validateMigrationUserChoiceBindings(
  metadata: import("../datasets/import-contracts.ts").DatasetImportMetadata,
): void {
  const seen = new Set<string>();
  for (const proof of metadata.userChoiceBindings ?? []) {
    const key = JSON.stringify([
      proof.backendId,
      proof.backendVersion,
      proof.pageId,
      proof.pageVersion,
      proof.name,
      proof.column,
    ]);
    if (seen.has(key) || proof.sourceNamespace !== metadata.sourceNamespace)
      throw Error("Invalid user choice registration");
    seen.add(key);
    const binding = metadata.bindings.filter(
      (b) =>
        b.backendId === proof.backendId &&
        b.backendVersion === proof.backendVersion &&
        b.page.id === proof.pageId &&
        b.page.version === proof.pageVersion &&
        b.name === proof.bindingName,
    );
    if (
      binding.length !== 1 ||
      binding[0]!.tables
        .find((t) => t.schema === proof.schema && t.name === proof.table)
        ?.columns.find((c) => c.name === proof.sourceColumn)?.type !== "user"
    )
      throw Error("Invalid user choice registration");
  }
}
