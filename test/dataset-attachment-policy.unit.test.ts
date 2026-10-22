import test from "node:test";
import assert from "node:assert/strict";
import { datasetAttachmentAllowed } from "../src/datasets/attachments/policy.ts";
import type {
  DatasetAttachmentAuthority,
  DatasetAttachmentContext,
} from "../src/datasets/attachments/contracts.ts";
const context: DatasetAttachmentContext = {
  backendId: "Back12",
  backendVersion: "a".repeat(64),
  pageId: "Page12",
  subject: "actor",
  credentialHash: "session",
  backendNamespace: "legacyData",
  bindingName: "images",
};
function snapshot(): DatasetAttachmentAuthority {
  return {
    generation: "1",
    registration: {
      backendNamespace: "legacyData",
      sourceNamespace: "original",
      acceptedTypes: ["image/png"],
      binding: {
        mode: "live",
        name: "images",
        backendId: context.backendId,
        backendVersion: context.backendVersion,
        page: {
          id: "Page12",
          version: 1,
          legacyId: "Legacy12",
          editId: "edit",
        },
        dataset: { id: "data", version: 1, policyRevision: 1 },
        tables: [],
      },
    },
    authority: {
      pageVersion: 1,
      page: {
        id: "Legacy12",
        editId: "edit",
        owner: { userId: "owner", tokenId: null },
        visibility: "public",
        format: "markup",
        deleted: false,
        ownerIsTestUser: false,
        acceptedJoinUserIds: ["viewer"],
      },
      dataset: {
        id: "data",
        version: 1,
        generation: 1,
        owner: { userId: "owner", tokenId: null },
        visibility: "public",
        policyRevision: 1,
        ownerIsTestUser: false,
        deleted: false,
        policy: {
          version: 2,
          allow: [
            {
              actions: ["insert", "read"],
              from: { user: "*", artifact: "Legacy12" },
            },
          ],
        },
      },
      facts: {
        caller: { userId: "viewer", tokenId: null },
        identity: "user",
        groupRoles: {},
        sharedArtifactIds: [],
      },
    },
  };
}
test("explicit insert grant authorizes upload independently of SQL row restrictions", () => {
  const s = snapshot();
  assert.equal(datasetAttachmentAllowed(context, s, "insert"), true);
  (s.authority.dataset.policy as Record<string, unknown>).tables = [
    {
      table: { schema: "public", name: "rows" },
      insert_permissions: [
        {
          role: "viewer",
          permission: { check: { id: { _eq: "never" } }, columns: ["id"] },
        },
      ],
    },
  ];
  assert.equal(datasetAttachmentAllowed(context, s, "insert"), true);
});
test("namespace, saved document identity and declared import remain exact", () => {
  for (const alter of [
    (s: DatasetAttachmentAuthority) => {
      s.registration.backendNamespace = "other";
    },
    (s: DatasetAttachmentAuthority) => {
      s.registration.binding.page.version = 2;
    },
    (s: DatasetAttachmentAuthority) => {
      s.registration.binding.mode = "pinned";
    },
  ]) {
    const s = snapshot();
    alter(s);
    assert.equal(datasetAttachmentAllowed(context, s, "insert"), false);
  }
});
test("upload grants never follow edit privileges or another mutation action", () => {
  const s = snapshot();
  s.authority.dataset.policy = {
    version: 2,
    allow: [{ actions: ["update"], from: { user: "*", artifact: "Legacy12" } }],
  };
  assert.equal(datasetAttachmentAllowed(context, s, "insert"), false);
  s.authority.dataset.policy = null;
  assert.equal(datasetAttachmentAllowed(context, s, "insert"), false);
});
test("write-only audience is allowed for insert while private download remains denied", () => {
  const s = snapshot();
  s.authority.dataset.visibility = "private";
  assert.equal(datasetAttachmentAllowed(context, s, "insert"), true);
  assert.equal(datasetAttachmentAllowed(context, s, "read"), false);
});
test("removed join, guests and unmapped identities cannot upload", () => {
  const s = snapshot();
  s.authority.page.acceptedJoinUserIds = [];
  assert.equal(datasetAttachmentAllowed(context, s, "insert"), false);
  const unmapped = snapshot();
  unmapped.authority.facts.caller.userId = null;
  assert.equal(datasetAttachmentAllowed(context, unmapped, "insert"), false);
  assert.equal(
    datasetAttachmentAllowed(
      { ...context, subject: null },
      snapshot(),
      "insert",
    ),
    false,
  );
});

test("explicit malformed table metadata is not treated as an omitted restriction", () => {
  const s = snapshot();
  (s.authority.dataset.policy as Record<string, unknown>).tables = null;
  assert.equal(datasetAttachmentAllowed(context, s, "insert"), false);
});
