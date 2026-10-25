import assert from "node:assert/strict";
import test from "node:test";
import { mapNativeCommentAuthorIdentity } from "./comment-author-provenance.ts";
import type { NativeV3IdentityMaps } from "./v3-publication-contracts.ts";

const targets: NativeV3IdentityMaps = {
  actors: {},
  users: {
    "source-user-test": { userId: "target-user-test", email: null },
  },
  tokens: {
    "source-token-test": { tokenId: "target-token-test" },
  },
};

test("blank legacy comment token is absent when the actual user is mapped", () => {
  assert.deepEqual(
    mapNativeCommentAuthorIdentity(targets, "source-user-test", ""),
    { authorTokenId: null, authorUserId: "target-user-test" },
  );
});

test("blank token with no mapped user refuses a comment without an actual author", () => {
  assert.throws(
    () => mapNativeCommentAuthorIdentity(targets, null, ""),
    /native_publication_comment_identity_missing/,
  );
});

test("unmapped nonempty token is not ignored when a user mapping exists", () => {
  assert.throws(
    () =>
      mapNativeCommentAuthorIdentity(
        targets,
        "source-user-test",
        "unknown-token-test",
      ),
    /native_publication_comment_identity_missing/,
  );
});

test("mapped token and user identities remain attached to the same comment", () => {
  assert.deepEqual(
    mapNativeCommentAuthorIdentity(
      targets,
      "source-user-test",
      "source-token-test",
    ),
    {
      authorTokenId: "target-token-test",
      authorUserId: "target-user-test",
    },
  );
});
