import test from "node:test";
import assert from "node:assert/strict";
import { authorizeDocument } from "../src/server/document-authorization.ts";
import { createIdentityAuthority } from "../src/server/identity.ts";
import { hash } from "../src/document.js";
import type { AccessPolicy } from "../src/contracts.ts";
import type { SessionGrant } from "../src/identity-data-contracts.ts";
import type { DocumentAuthorizationInput } from "../src/server/document-authorization-contracts.ts";
const header = {
  owner: "owner",
  shareHash: hash("link"),
  generation: 2,
  head: "head",
};
const session: SessionGrant = {
  actor: "owner",
  fileId: null,
  generation: null,
  expires: 101,
};
const base: DocumentAuthorizationInput = {
  fileId: "file",
  document: header,
  session,
  credentialHash: hash("account"),
  now: 100,
};
test("pure document policy and identity authority agree across credentials, scope and permissions", () => {
  for (const visibility of ["public", "unlisted", "private"] as const)
    for (const actor of ["owner", "editor", "commenter", "viewer"])
      for (const scoped of [false, true]) {
        const access: AccessPolicy = {
          visibility,
          linkRole: "viewer",
          shares: {
            editor: "editor",
            commenter: "commenter",
            viewer: "viewer",
          },
          version: 0,
        };
        const grant = {
          ...session,
          actor,
          ...(scoped
            ? { fileId: "file", generation: 2, purpose: "document" as const }
            : {}),
        };
        const document = { ...header, access };
        const input = { ...base, document, session: grant };
        const expected = authorizeDocument(input);
        assert.equal(
          expected.owner,
          !scoped && ["owner", "editor"].includes(actor),
        );
        const { file, ...decision } = createIdentityAuthority({
          now: () => 100,
        }).document({ document, session: grant }, "account", "file");
        assert.equal(file, document);
        assert.deepEqual(decision, expected);
      }
});
test("authorization preserves absence, expiry, purpose, generation and revoked credential errors", () => {
  const denied: Array<[Partial<DocumentAuthorizationInput>, string]> = [
    [
      { document: null, session: { ...session, purpose: "backend" } },
      "File not found",
    ],
    [{ session: { ...session, purpose: "backend" } }, "Backend grants"],
    [{ session: { ...session, expires: 100 } }, "expired or revoked"],
    [
      { session: { ...session, fileId: "other", generation: 2 } },
      "expired or revoked",
    ],
    [
      { session: { ...session, fileId: "file", generation: 1 } },
      "expired or revoked",
    ],
    [{ session: null }, "expired or revoked"],
    [
      {
        session: null,
        credentialHash: null,
        document: {
          ...header,
          access: {
            visibility: "private",
            linkRole: "viewer",
            shares: {},
            version: 0,
          },
        },
      },
      "do not have access",
    ],
  ];
  for (const [change, message] of denied) {
    const input = { ...base, ...change };
    for (const authorize of [
      () => authorizeDocument(input),
      () =>
        createIdentityAuthority({ now: () => input.now }).document(
          { document: input.document, session: input.session },
          input.credentialHash === null ? "" : "account",
          input.fileId,
        ),
    ])
      assert.throws(authorize, (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, new RegExp(message));
        assert.equal(
          (error as Error & { status: number }).status,
          change.document === null ? 404 : 403,
        );
        return true;
      });
  }
  assert.equal(
    authorizeDocument({ ...base, session: null, credentialHash: hash("link") })
      .permissions.read,
    true,
  );
  assert.equal(
    authorizeDocument({
      ...base,
      session: null,
      credentialHash: null,
      document: {
        ...header,
        access: {
          visibility: "public",
          linkRole: "viewer",
          shares: {},
          version: 0,
        },
      },
    }).permissions.read,
    true,
  );
});

test("scoped document grants retain app editing without source or sharing authority", () => {
  const document = {
    ...header,
    access: {
      visibility: "private" as const,
      linkRole: "viewer" as const,
      shares: { editor: "editor" as const, viewer: "viewer" as const },
      version: 0,
    },
  };
  for (const actor of ["owner", "editor", "viewer"])
    for (const purpose of [undefined, "document"] as const) {
      const decision = authorizeDocument({
        ...base,
        document,
        session: {
          ...session,
          actor,
          fileId: "file",
          generation: 2,
          ...(purpose ? { purpose } : {}),
        },
      });
      const editor = actor === "owner" || actor === "editor";
      assert.deepEqual(decision, {
        actor,
        owner: false,
        permissions: {
          role: actor === "owner" ? "owner" : actor,
          read: true,
          comment: editor,
          edit: false,
          manage: false,
        },
        appEdit: purpose === "document" && editor,
      });
    }
  for (const actor of ["owner", "editor", "viewer"]) {
    const decision = authorizeDocument({
      ...base,
      document,
      session: { ...session, actor },
    });
    const editor = actor !== "viewer";
    assert.deepEqual(decision, {
      actor,
      owner: editor,
      permissions: {
        role: actor,
        read: true,
        comment: editor,
        edit: editor,
        manage: editor,
      },
      appEdit: editor,
    });
  }
});
