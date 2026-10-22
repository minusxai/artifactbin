import type { BoundValueColumnProof } from "./conversion/compiled/bound-value-contracts.ts";
import type { DatasetPersonBinding } from "../datasets/person-contracts.ts";
import type { DatasetImportMetadata } from "../datasets/import-contracts.ts";
/** A person selector cannot publish a new data grant or select a different column than its admitted binding. */
export function validateMigrationPersonBindings(
  metadata: DatasetImportMetadata,
): void {
  for (const person of metadata.personBindings ?? []) {
    const matches = metadata.bindings.filter(
      (b) =>
        person.sourceNamespace === metadata.sourceNamespace &&
        person.backendId === b.backendId &&
        person.backendVersion === b.backendVersion &&
        person.pageId === b.page.id &&
        person.pageVersion === b.page.version &&
        person.bindingName === b.name &&
        b.tables.some(
          (t) =>
            t.schema === person.schema &&
            t.name === person.table &&
            t.columns.some(
              (c) => c.name === person.column && c.type === "user",
            ),
        ),
    );
    if (
      matches.length !== 1 ||
      !/^[A-Za-z][A-Za-z0-9_]*$/.test(person.valueName) ||
      ["__proto__", "constructor", "prototype"].includes(person.valueName)
    )
      throw Error("Person selector requires an exact admitted user column");
  }
}

/** Project exact offline proofs onto already allocated and compiled binding identities. */
export function projectMigrationPersonBindings(
  sourceNamespace: string,
  pageId: string,
  proofs: readonly BoundValueColumnProof[],
  bindings: DatasetImportMetadata["bindings"],
): DatasetPersonBinding[] {
  return proofs.map((proof) => {
    const matches = bindings.filter(
      (b) =>
        b.name === proof.bindingName &&
        b.page.id === pageId &&
        b.dataset.version === proof.version &&
        `ref:${b.dataset.id}` === proof.sourceRef &&
        b.tables.some(
          (t) =>
            t.schema === proof.schema &&
            t.name === proof.table &&
            t.columns.some(
              (c) => c.name === proof.column && c.type === proof.type,
            ),
        ),
    );
    if (matches.length !== 1)
      throw Error("Bound person column provenance mismatch");
    const b = matches[0]!;
    return {
      sourceNamespace: sourceNamespace,
      backendId: b.backendId,
      backendVersion: b.backendVersion,
      pageId: b.page.id,
      pageVersion: b.page.version,
      valueName: proof.valueName,
      bindingName: proof.bindingName,
      schema: proof.schema,
      table: proof.table,
      column: proof.column,
    };
  });
}
