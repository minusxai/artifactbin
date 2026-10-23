import { createHash } from "node:crypto";
import { prepareInactiveServerDocument } from "./server-document.ts";
import type { ArchivedInactiveServerAdmission } from "./server-document-contracts.ts";
const hash = (source: string) =>
  createHash("sha256").update(source).digest("hex");
/** Verify all original and temporary source identities before changing compiler input. */
export function admitInactiveServerDocument(
  source: string,
  admission: ArchivedInactiveServerAdmission,
) {
  const plan = prepareInactiveServerDocument(source, {
    mode: "archived-inactive",
  });
  if (
    admission.mode !== "archived-inactive" ||
    admission.originalSourceSha256 !== plan.originalSourceSha256 ||
    admission.handlerSourceSha256 !== plan.handler.sourceSha256 ||
    admission.renderSourceSha256 !== hash(plan.renderSource)
  )
    throw Error("inactive_server_document_policy_mismatch");
  return {
    source:
      plan.renderSource +
      '<p data-migration-inactive-server role="status">' +
      plan.limitation +
      "</p>",
    receipt: {
      mode: plan.mode,
      originalSourceSha256: plan.originalSourceSha256,
      handlerSourceSha256: plan.handler.sourceSha256,
      renderSourceSha256: hash(plan.renderSource),
      limitation: plan.limitation,
    },
  };
}
