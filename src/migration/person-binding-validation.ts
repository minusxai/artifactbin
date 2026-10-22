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
