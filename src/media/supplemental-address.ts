import type { SupplementalAddress } from "./supplemental-contracts.ts";
const PAGE = "[A-Za-z0-9]{6}",
  ID = "[A-Za-z0-9_-]{1,128}",
  VALUE = "[A-Za-z][A-Za-z0-9_]{0,127}",
  HASH = "[a-f0-9]{64}";
const comment = new RegExp(
  `^/api/files/(${PAGE})/comments/(${ID})/attachments/(${ID})/(original|preview|thumbnail)$`,
);
const person = new RegExp(
  `^/af/v1/ids/(${PAGE})/person-images/(${VALUE})/(${HASH})$`,
);
export function parseSupplementalAddress(
  path: string,
): SupplementalAddress | null {
  const attachment = comment.exec(path);
  if (attachment)
    return {
      kind: "comment",
      pageId: attachment[1]!,
      commentId: attachment[2]!,
      attachmentId: attachment[3]!,
      variant: attachment[4] as "original" | "preview" | "thumbnail",
    };
  const avatar = person.exec(path);
  return avatar
    ? {
        kind: "person",
        pageId: avatar[1]!,
        valueName: avatar[2]!,
        assetId: avatar[3]!,
      }
    : null;
}
export function isSupplementalPath(path: string): boolean {
  return (
    /^\/api\/files\/[^/]+\/comments\/.*\/attachments(?:\/|$)/.test(path) ||
    /^\/af\/v1\/ids\/[^/]+\/person-images(?:\/|$)/.test(path)
  );
}
export function supplementalAddress(address: SupplementalAddress): string {
  const path =
    address.kind === "comment"
      ? `/api/files/${address.pageId}/comments/${address.commentId}/attachments/${address.attachmentId}/${address.variant}`
      : `/af/v1/ids/${address.pageId}/person-images/${address.valueName}/${address.assetId}`;
  const parsed = parseSupplementalAddress(path);
  if (!parsed || parsed.kind !== address.kind)
    throw Error("Invalid supplemental address");
  return path;
}
