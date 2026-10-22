import test from "node:test";
import assert from "node:assert/strict";
import { projectSupplementalAssets } from "../src/migration/assets/projection.ts";
import type { VerifiedSupplementalObject } from "../src/migration/assets/supplemental-contracts.ts";
const proof = (
  objectKey: string,
  kind: VerifiedSupplementalObject["kind"],
): VerifiedSupplementalObject => ({
  objectKey,
  kind,
  sha256: "a".repeat(64),
  storageKey: "a".repeat(64),
  byteLength: 20,
  width: 10,
  height: 5,
  contentType: "image/webp",
});
test("supplemental projection binds original rows rather than receipt reference claims", () => {
  const result = projectSupplementalAssets(
    "fixture",
    [{ id: "user", image_key: "avatar/user/" + "a".repeat(32) }],
    [
      {
        id: "image",
        artifact_id: "page",
        annotation_id: 7,
        ready: true,
        bytes: "60",
      },
    ],
    [
      proof("avatar/user/" + "a".repeat(32), "avatar"),
      ...(["original", "preview", "thumbnail"] as const).map((v) =>
        proof(`comment-images/image/${v}.webp`, "comment-image"),
      ),
    ],
  );
  assert.equal(result.profiles.length, 1);
  assert.match(result.profiles[0]!.assetId, /^[a-f0-9]{64}$/);
  assert.equal(result.comments.length, 3);
  assert.equal(result.comments[0]!.commentId, "7");
  assert.equal(result.unavailableAttachments, 0);
  assert.equal(
    projectSupplementalAssets(
      "fixture",
      [{ id: "other", image_key: "avatar/other/" + "b".repeat(32) }],
      [],
      [proof("avatar/user/" + "a".repeat(32), "avatar")],
    ).unavailableAvatars,
    1,
  );
});
test("incomplete attachments are explicit unavailable and inconsistent source totals refuse", () => {
  const row = {
    id: "image",
    artifact_id: "page",
    annotation_id: 7,
    ready: true,
    bytes: "60",
  };
  assert.equal(
    projectSupplementalAssets(
      "fixture",
      [],
      [row],
      [proof("comment-images/image/original.webp", "comment-image")],
    ).unavailableAttachments,
    1,
  );
  assert.throws(
    () =>
      projectSupplementalAssets(
        "fixture",
        [],
        [{ ...row, bytes: "61" }],
        (["original", "preview", "thumbnail"] as const).map((v) =>
          proof(`comment-images/image/${v}.webp`, "comment-image"),
        ),
      ),
    /byte total/,
  );
});
