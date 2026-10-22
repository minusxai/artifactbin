import type {
  DatasetAttachmentAuthority,
  DatasetAttachmentContext,
} from "../../src/datasets/attachments/contracts.ts";
const context: DatasetAttachmentContext = {
  backendId: "Back12",
  backendVersion: "a".repeat(64),
  pageId: "Page12",
  subject: "actor",
  credentialHash: "session",
  backendNamespace: "legacyData",
  bindingName: "images",
};
export function attachmentSnapshot(): DatasetAttachmentAuthority {
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
