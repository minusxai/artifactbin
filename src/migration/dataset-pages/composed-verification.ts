import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { canonicalMigrationValue } from "../verification-values.ts";
import type { AdditiveDatasetBaseApproval } from "./admission-contracts.ts";
import type {
  ComposedAdditiveVerification,
  VerifiedPageScopeProof,
  DatasetAdditiveReceiptProof,
} from "./composed-verification-contracts.ts";
type Facts = AdditiveDatasetBaseApproval["inventory"];
const sha = (v: unknown) =>
  createHash("sha256").update(canonicalMigrationValue(v)).digest("hex");
async function readCompletedReport(
  scope: VerifiedPageScopeProof,
  facts: Facts,
) {
  if (!/^[a-f0-9]{64}$/.test(scope.report.sha256))
    throw Error("Invalid composed report identity");
  const info = await stat(scope.report.path);
  if (!info.isFile() || info.size > 1048576)
    throw Error("Invalid composed report size");
  const bytes = await readFile(scope.report.path);
  if (createHash("sha256").update(bytes).digest("hex") !== scope.report.sha256)
    throw Error("Composed report changed");
  const report = JSON.parse(bytes.toString("utf8"));
  if (
    report.kind !== undefined ||
    report.complete !== true ||
    report.readOnly !== true ||
    typeof report.compilerIdentity !== "string" ||
    !report.compilerIdentity ||
    report.runtime?.pages !== scope.pageIds.length ||
    ![facts.baseManifestSha256, facts.relationManifestSha256].every(
      (h) =>
        Array.isArray(report.archives) &&
        report.archives.some(
          (a: { manifestSha256?: string }) => a.manifestSha256 === h,
        ),
    )
  )
    throw Error(
      "Composed input is not a completed normal read-only verification",
    );
  return report;
}
export async function validateComposedAdditiveVerification(
  proof: ComposedAdditiveVerification,
  facts: Facts,
) {
  if (
    proof.kind !== "verified-additive-composition-v1" ||
    proof.complete !== true ||
    proof.readOnly !== true ||
    proof.sourceNamespace !== facts.sourceNamespace ||
    proof.compilerIdentity !== facts.compilerIdentity ||
    proof.immutableDatasetFingerprint !== facts.datasetFingerprint ||
    proof.currentFactsSha256 !== sha(facts) ||
    proof.runtime?.pages !== facts.pageReceipts.length
  )
    throw Error("Composed current facts changed");
  const sets = [proof.base, proof.addition].map((s) => new Set(s.pageIds));
  if (
    sets.some(
      (set, i) =>
        !set.size ||
        set.size !== [proof.base, proof.addition][i]!.pageIds.length,
    ) ||
    [...sets[0]!].some((id) => sets[1]!.has(id)) ||
    facts.pageReceipts.length !== sets[0]!.size + sets[1]!.size ||
    new Set(facts.pageReceipts.map((r) => r.pageId)).size !==
      facts.pageReceipts.length
  )
    throw Error("Composed page scope overlaps or is incomplete");
  for (const scope of [proof.base, proof.addition]) {
    if (scope.pageIds.some((id) => !/^[A-Za-z0-9]{6}$/.test(id)))
      throw Error("Invalid composed page identity");
    const rows = facts.pageReceipts.filter((r) =>
      scope.pageIds.includes(r.pageId),
    );
    if (
      rows.length !== scope.pageIds.length ||
      rows.some((r) => !r.key.startsWith(facts.sourceNamespace + ":")) ||
      sha(rows) !== scope.pageReceiptsSha256
    )
      throw Error(
        "Composed page receipts changed or destination contains unknown pages",
      );
  }
  const receipt = proof.addition.datasetReceipt;
  if (
    receipt.source_namespace !== facts.sourceNamespace ||
    receipt.base_fingerprint !== facts.datasetFingerprint ||
    ![
      receipt.authority_sha256,
      receipt.fingerprint,
      receipt.base_fingerprint,
    ].every((s) => /^[a-f0-9]{64}$/.test(s)) ||
    facts.datasetAdditiveReceipts?.length !== 1 ||
    sha(facts.datasetAdditiveReceipts[0]) !== sha(receipt)
  )
    throw Error("Composed additive receipt changed");
  const [base, addition] = await Promise.all([
    readCompletedReport(proof.base, facts),
    readCompletedReport(proof.addition, facts),
  ]);
  if (
    addition.compilerIdentity !== facts.compilerIdentity ||
    !base.compilerIdentity ||
    ![facts.baseManifestSha256, facts.relationManifestSha256].every((h) =>
      proof.archives.some((a) => a.manifestSha256 === h),
    )
  )
    throw Error("Composed compiler or archive provenance changed");
}
/** Facts must be freshly captured in the caller's read-only transaction; this never writes a destination. */
export async function composeAdditiveVerification(
  facts: Facts,
  base: VerifiedPageScopeProof,
  addition: VerifiedPageScopeProof & {
    datasetReceipt: DatasetAdditiveReceiptProof;
  },
): Promise<ComposedAdditiveVerification> {
  const proof: ComposedAdditiveVerification = {
    kind: "verified-additive-composition-v1",
    complete: true,
    readOnly: true,
    compilerIdentity: facts.compilerIdentity,
    sourceNamespace: facts.sourceNamespace,
    immutableDatasetFingerprint: facts.datasetFingerprint,
    base,
    addition,
    currentFactsSha256: sha(facts),
    runtime: { pages: facts.pageReceipts.length },
    archives: [
      { manifestSha256: facts.baseManifestSha256 },
      { manifestSha256: facts.relationManifestSha256 },
    ],
  };
  await validateComposedAdditiveVerification(proof, facts);
  return proof;
}
