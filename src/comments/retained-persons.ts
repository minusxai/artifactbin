import { createHash } from "node:crypto";
import { personMentionIds } from "./presentation.ts";
import type {
  RetainedCommentPersonEvidence,
  RetainedCommentPersonPlan,
} from "./retained-person-contracts.ts";
export const commentBodySha256 = (body: string): string =>
  createHash("sha256").update(body).digest("hex");
/** Operator planning only: allocations and archived bytes must be verified before supplying evidence. */
export function planRetainedCommentPersons(
  evidence: readonly RetainedCommentPersonEvidence[],
): RetainedCommentPersonPlan {
  if (evidence.length > 100)
    throw Error("Retained comment person scope is too large");
  const seen = new Set<string>();
  return {
    format: 1,
    entries: evidence.map((value) => {
      if (
        !/^[A-Za-z0-9]{6}$/.test(value.pageId) ||
        !value.commentId ||
        value.commentId.length > 128 ||
        !value.sourceNamespace ||
        value.sourceNamespace.length > 256 ||
        !value.legacyPageId ||
        value.legacyPageId.length > 256 ||
        !(
          /^[a-f0-9]{64}$/.test(value.archiveSha256) &&
          /^[a-f0-9]{64}$/.test(value.receiptSha256)
        )
      )
        throw Error("Invalid retained comment person evidence");
      const key = value.pageId + "\0" + value.commentId;
      if (seen.has(key)) throw Error("Ambiguous retained comment person scope");
      seen.add(key);
      const { body, ...provenance } = value;
      return {
        ...provenance,
        bodySha256: commentBodySha256(body),
        legacyUserIds: personMentionIds(body),
      };
    }),
  };
}
