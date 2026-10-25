import type { NativeV3IdentityMaps } from "./v3-publication-contracts.ts";

export interface NativeCommentAuthorIdentity {
  authorTokenId: string | null;
  authorUserId: string | null;
}

/**
 * Maps comment provenance without treating a blank legacy token sentinel as a
 * credential. Nonempty unmapped tokens and comments with no mapped author fail.
 */
export function mapNativeCommentAuthorIdentity(
  targets: NativeV3IdentityMaps,
  sourceUserId: unknown,
  sourceTokenId: unknown,
): NativeCommentAuthorIdentity {
  const authorUserId =
    sourceUserId === null || sourceUserId === undefined
      ? null
      : (targets.users[String(sourceUserId)]?.userId ?? null);
  if (
    sourceUserId !== null &&
    sourceUserId !== undefined &&
    authorUserId === null
  ) {
    throw new Error("native_publication_comment_identity_missing");
  }

  const authorTokenId =
    sourceTokenId === null ||
    sourceTokenId === undefined ||
    sourceTokenId === ""
      ? null
      : (targets.tokens[String(sourceTokenId)]?.tokenId ?? null);
  if (
    sourceTokenId !== null &&
    sourceTokenId !== undefined &&
    sourceTokenId !== "" &&
    authorTokenId === null
  ) {
    throw new Error("native_publication_comment_identity_missing");
  }
  if (authorUserId === null && authorTokenId === null) {
    throw new Error("native_publication_comment_identity_missing");
  }
  return { authorTokenId, authorUserId };
}
