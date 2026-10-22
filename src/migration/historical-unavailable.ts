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
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Historical version ${version} unavailable</title><style>body{margin:0;background:#f5f5f4;color:#1c1917;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;line-height:1.6}main{box-sizing:border-box;max-width:44rem;margin:clamp(1rem,8vh,6rem) auto;padding:clamp(1.25rem,4vw,2.5rem);background:#fff;border:1px solid #e7e5e4;border-radius:.75rem}h1{font-size:clamp(1.5rem,4vw,2rem);line-height:1.25;margin:0 0 1.25rem}p{margin:1rem 0}.provenance{margin-top:2rem;padding-top:1rem;border-top:1px solid #e7e5e4;font-size:.875rem;color:#57534e}code{display:block;margin-top:.5rem;font-size:.8rem;overflow-wrap:anywhere}@media(prefers-color-scheme:dark){body{background:#1c1917;color:#f5f5f4}main{background:#292524;border-color:#44403c}.provenance{color:#d6d3d1;border-color:#44403c}}</style><script data-af="core" src="${escape(coreUrl)}"></script></head><body data-af-id="${prefix}-body"><main aria-label="Preserved historical version" data-af-id="${prefix}-notice"><h1 data-af-id="${prefix}-heading">Historical version ${version} unavailable</h1><p data-af-id="${prefix}-status">This saved version is read-only. Its original behavior could not be converted, so it is not executable here.</p><p data-af-id="${prefix}-archive">The complete original version and its source remain preserved in the immutable migration archive. This notice does not replace the current page.</p><p class="provenance" data-af-id="${prefix}-provenance">Original revision record SHA-256: <code data-af-id="${prefix}-hash">${originalRecordSha256}</code></p></main></body></html>`;
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
