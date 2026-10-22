import type { DatasetBinding } from "../datasets/contracts.ts";
import type { DatasetAttachmentRegistration } from "../datasets/attachments/contracts.ts";
import { readLegacyFileUploadSites } from "./conversion/compiled/file-upload-source.ts";
import { extractLegacyImports } from "./conversion/imports.ts";
/** Publication derives attachment capabilities only from exact current source Import+FileUpload declarations. */
export function projectMigrationAttachmentBindings(input: {
  source: string;
  sourceNamespace: string;
  pageId: string;
  pageVersion: number;
  bindings: readonly DatasetBinding[];
}): DatasetAttachmentRegistration[] {
  const sites = readLegacyFileUploadSites(input.source);
  if (!sites.length) return [];
  const extracted = extractLegacyImports(input.source);
  if (extracted.issues.length)
    throw Error("Invalid attachment Import provenance");
  const grouped = new Map<string, DatasetAttachmentRegistration>();
  for (const site of sites) {
    const source = extracted.imports.find((i) => i.name === site.bindingName);
    const matches = input.bindings.filter(
      (b) =>
        b.mode === "live" &&
        b.name === site.bindingName &&
        b.page.id === input.pageId &&
        b.page.version === input.pageVersion &&
        b.dataset.id === source?.datasetLegacyId,
    );
    if (!source || matches.length !== 1)
      throw Error("Attachment requires exact current Import binding");
    const prior = grouped.get(site.bindingName);
    if (prior)
      prior.acceptedTypes = [
        ...new Set([...prior.acceptedTypes, ...site.acceptedTypes]),
      ].sort();
    else
      grouped.set(site.bindingName, {
        backendNamespace: "legacyData",
        sourceNamespace: input.sourceNamespace,
        binding: matches[0]!,
        acceptedTypes: [...site.acceptedTypes].sort(),
      });
  }
  return [...grouped.values()].sort((a, b) =>
    a.binding.name.localeCompare(b.binding.name),
  );
}
