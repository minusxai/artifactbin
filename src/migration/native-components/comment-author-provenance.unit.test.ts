import assert from "node:assert/strict";
import test from "node:test";
import { mapNativeCommentAuthorIdentity, mapNativeCommentImageActorIdentity } from "./comment-author-provenance.ts";
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

test('a mapped image owner retains the noncredential blank token required by the image row',()=>{
 assert.deepEqual(mapNativeCommentImageActorIdentity(targets,'source-user-test',''),{tokenId:'',userId:'target-user-test'});
});
test('image ownership never invents a token or an account mapping',()=>{
 for(const user of [null,undefined,'unmapped-user'])assert.throws(()=>mapNativeCommentImageActorIdentity(targets,user,''),/comment_identity_missing/);
 assert.throws(()=>mapNativeCommentImageActorIdentity(targets,'source-user-test',null),/comment_image_token_missing/);
 assert.throws(()=>mapNativeCommentImageActorIdentity(targets,'source-user-test','unmapped-token'),/comment_identity_missing/);
 assert.deepEqual(mapNativeCommentImageActorIdentity(targets,null,'source-token-test'),{tokenId:'target-token-test',userId:null});
 assert.deepEqual(mapNativeCommentImageActorIdentity(targets,'source-user-test','source-token-test'),{tokenId:'target-token-test',userId:'target-user-test'});
});

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
