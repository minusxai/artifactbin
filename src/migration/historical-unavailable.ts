import { createHash } from "node:crypto";
import { canonicalMigrationValue } from "./verification-values.ts";
import type { ConversionOutput, LegacyRow } from "./contracts.ts";
import type { HistoricalUnavailableReceipt } from "./historical-unavailable-contracts.ts";
const sha256 = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
/** Static, inert historical representation. Original author content is never embedded or executed. */
export function preserveUnavailableHistoricalRevision(
  original: LegacyRow,
  failed: ConversionOutput,
  coreUrl: string,
): ConversionOutput {
  const version = Number(original.version);
  if (!Number.isSafeInteger(version) || version < 1)
    throw Error("Invalid historical revision");
  const originalRecordSha256 = sha256(canonicalMigrationValue(original));
  const receipt: HistoricalUnavailableReceipt = {
    kind: "historical-conversion-unavailable",
    policyVersion: 1,
    version,
    originalFormat: String(original.format),
    originalRecordSha256,
    ...(typeof original.source === "string"
      ? { originalSourceSha256: sha256(original.source) }
      : {}),
    ...(original.document !== undefined && original.document !== null
      ? {
          originalDocumentSha256: sha256(
            canonicalMigrationValue(original.document),
          ),
        }
      : {}),
    reasonCodes: [
      ...new Set(
        failed.issues.map((issue) =>
          typeof issue === "object" &&
          issue !== null &&
          "code" in issue &&
          typeof issue.code === "string" &&
          /^[a-z][a-z0-9-]{0,63}$/.test(issue.code)
            ? issue.code
            : typeof issue === "string" &&
                issue.startsWith("Unsupported format:")
              ? "unsupported-format"
              : "conversion-unavailable",
        ),
      ),
    ].sort(),
    ...(failed.receipt
      ? { failedConversionReceipt: { ...failed.receipt } }
      : {}),
  };
  const prefix = "history-unavailable-" + originalRecordSha256.slice(0, 16);
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Historical version ${version} unavailable</title><script data-af="core" src="${escape(coreUrl)}"></script></head><body data-af-id="${prefix}-body"><main data-af-id="${prefix}-notice"><h1 data-af-id="${prefix}-heading">Historical version ${version} unavailable</h1><p data-af-id="${prefix}-status">This saved version is read-only. Its original behavior could not be converted, so it is not executable here.</p><p data-af-id="${prefix}-archive">The complete original version and its source remain preserved in the immutable migration archive. This notice does not replace the current page.</p><p data-af-id="${prefix}-provenance">Original revision record SHA-256: <code data-af-id="${prefix}-hash">${originalRecordSha256}</code></p></main></body></html>`;
  return {
    classification: "historical-unavailable",
    html,
    outputBytes: Buffer.byteLength(html),
    issues: [
      {
        code: "historical-conversion-unavailable",
        message:
          "Original historical behavior unavailable; complete source retained in immutable migration archive",
      },
    ],
    identities: {},
    strategy: "historical-unavailable",
    provenance: {
      compiler: "migration-history-preservation",
      build: "1",
      mode: "read-only-unavailable",
    },
    historicalUnavailable: receipt,
  };
}
