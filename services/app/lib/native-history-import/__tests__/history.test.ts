import { it, expect } from "vitest";
import { useAppHarness, mintAccountToken } from "@/__tests__/harness";
import { getDb } from "@/lib/platform";
import { identityForUser } from "@/lib/accounts";
import { readHtmlPage } from "@/lib/html-publication";
import { canonicalizeHtmlPage } from "@/lib/html-page";
import { getHtmlBackendVersion } from "@/lib/html-backends";
import {
  prepareRegisteredQueryBackend,
  pageSourceDigest,
  registeredPlan,
} from "@/lib/registered-page-queries/registry";
import {
  prepareRegisteredMutationBackend,
  registeredMutationPlan,
} from "@/lib/registered-page-mutations";
import type { NativeHistoryImport, NativeHistoryRevision } from "../contracts";
import { importNativeHistory, writeNativeHistory } from "../index";
useAppHarness();
async function fixture() {
  const owner = await mintAccountToken("synthetic_history_owner"),
    db = await getDb();
  const revisions: NativeHistoryRevision[] = [1, 3].map((version) => {
    const canonical = canonicalizeHtmlPage(
      `<html><head></head><body><p data-af-id="stable">Version ${version}</p></body></html>`,
    );
    const page = {
      pageId: "TestHistory",
      version,
      revision: String(version),
      html: canonical.html,
      nextNodeId: canonical.ledger.nextNodeId,
      links: [] as NativeHistoryRevision["page"]["links"],
    };
    const provenance = {
      compilerSha256: "a".repeat(64),
      sourceSha256: "b".repeat(64),
      sqlEngineSha256: "c".repeat(64),
    };
    const query = prepareRegisteredQueryBackend(
      "queries",
      "history_queries",
      page,
      {
        scalars: {},
        queries: [
          { name: "result", sql: "SELECT 1 AS value", dependencies: [] },
        ],
        imports: [],
      },
      provenance,
    );
    const mutation = prepareRegisteredMutationBackend(
      "actions",
      "history_actions",
      page,
      {
        name: "save",
        kind: "insert",
        sql: "INSERT INTO forms.rows(body) VALUES ($body)",
        target: {
          datasetId: "SyntheticDataset",
          schema: "forms",
          table: "rows",
        },
        values: {
          body: { type: "string", nullable: false, parameter: "body" },
        },
        builtins: [],
        expectedAffected: 1,
        reset: ["body"],
      },
      provenance,
    );
    page.links = [query.link, mutation.link];
    return {
      page,
      ledger: canonical.ledger,
      sourceSha256: pageSourceDigest(page.html),
      title: `Revision ${version}`,
      description: null,
      createdAt: `2020-01-0${version}T00:00:00.000Z`,
      actorUserId: owner.userId,
      actorTokenId: owner.id,
      queries: [query],
      mutations: [mutation],
    };
  });
  const input: NativeHistoryImport = {
    sourceNamespace: "synthetic-selection",
    sourceId: "old-source",
    selectionSha256: "d".repeat(64),
    projectionSha256: "e".repeat(64),
    pageId: "TestHistory",
    owner: { userId: owner.userId!, tokenId: owner.id },
    visibility: "private",
    linkRole: "viewer",
    shares: [],
    headVersion: 3,
    revisions,
  };
  return { db, input, actor: identityForUser(owner.userId, owner.id) };
}
it("publishes sparse immutable histories with real registry helpers and replays only identical imports", async () => {
  const { db, input, actor } = await fixture();
  expect(await importNativeHistory(db, input)).toBe("created");
  for (const revision of input.revisions) {
    const saved = await readHtmlPage(
      actor,
      input.pageId,
      String(revision.page.version),
    );
    expect(saved).toEqual(revision.page);
    for (const [prepared, validate] of [
      [revision.queries[0]!, registeredPlan],
      [revision.mutations[0]!, registeredMutationPlan],
    ] as const) {
      const backend = (await getHtmlBackendVersion(
        prepared.link.backendId,
        prepared.link.version,
      ))!;
      expect(
        validate(saved, prepared.link, backend)?.registration.pageVersion,
      ).toBe(revision.page.version);
    }
  }
  expect(
    (
      await db.query(
        "SELECT version FROM artifact_versions WHERE artifact_id=$1 ORDER BY version",
        [input.pageId],
      )
    ).rows,
  ).toEqual([{ version: 1 }, { version: 3 }]);
  expect(await importNativeHistory(db, input)).toBe("unchanged");
  await expect(
    db.transaction((tx) =>
      writeNativeHistory(tx, { ...input, projectionSha256: "f".repeat(64) }),
    ),
  ).rejects.toThrow("native_import_collision");
});
it("rejects changed source and incomplete head selection without leaving rows", async () => {
  const { db, input } = await fixture();
  for (const bad of [
    { ...input, headVersion: 2 },
    {
      ...input,
      revisions: input.revisions.map((r, i) =>
        i ? { ...r, page: { ...r.page, html: r.page.html + "changed" } } : r,
      ),
    },
  ])
    await expect(
      db.transaction((tx) => writeNativeHistory(tx, bad)),
    ).rejects.toThrow();
  expect(
    (await db.query("SELECT id FROM artifacts WHERE id=$1", [input.pageId]))
      .rows,
  ).toHaveLength(0);
  expect(
    (await db.query("SELECT backend_id FROM html_backend_versions")).rows,
  ).toHaveLength(0);
});
it("rolls back page, sparse history and earlier programs when a later registration fails", async () => {
  const { db, input } = await fixture();
  const changed = structuredClone(input);
  changed.revisions[1]!.mutations[0]!.backend.compiled += "tampered";
  await expect(
    db.transaction((tx) => writeNativeHistory(tx, changed)),
  ).rejects.toThrow();
  for (const table of [
    "artifacts",
    "artifact_versions",
    "html_backend_versions",
    "artifact_id_registry",
  ])
    expect((await db.query(`SELECT * FROM ${table}`)).rows).toHaveLength(0);
});

it("never consumes an existing reservation and requires declared relation projection in the same transaction", async () => {
  const { db, input } = await fixture();
  await db.query("INSERT INTO artifact_id_registry(id,owner) VALUES($1,$2)", [
    input.pageId,
    "different-owner",
  ]);
  await expect(
    db.transaction((tx) => writeNativeHistory(tx, input)),
  ).rejects.toThrow("native_import_collision");
  expect(
    (await db.query("SELECT consumed,owner FROM artifact_id_registry")).rows,
  ).toEqual([{ consumed: false, owner: "different-owner" }]);
  await db.query("DELETE FROM artifact_id_registry WHERE id=$1", [
    input.pageId,
  ]);
  const projected = { ...input, relationSha256: "f".repeat(64) };
  await expect(
    db.transaction((tx) => writeNativeHistory(tx, projected)),
  ).rejects.toThrow("native_import_invalid");
  let reached = false;
  await expect(
    db.transaction((tx) =>
      writeNativeHistory(tx, projected, {
        sourceSha256: projected.relationSha256,
        apply: async (tx) => {
          reached = true;
          expect(
            (
              await tx.query(
                "SELECT version FROM artifact_versions ORDER BY version",
              )
            ).rows,
          ).toEqual([{ version: 1 }, { version: 3 }]);
        },
        verify: async () => {
          throw Error("relation_projection_changed");
        },
      }),
    ),
  ).rejects.toThrow("relation_projection_changed");
  expect(reached).toBe(true);
  for (const table of [
    "artifacts",
    "artifact_versions",
    "html_backend_versions",
    "artifact_id_registry",
  ])
    expect((await db.query(`SELECT * FROM ${table}`)).rows).toHaveLength(0);
});

it("preserves private reach and fails replay after destination sharing changes", async () => {
  const { db, input, actor } = await fixture();
  const reader = await mintAccountToken("synthetic_history_reader");
  const shared = {
    ...input,
    shares: [{ email: reader.email!, role: "viewer" as const }],
  };
  await db.transaction((tx) => writeNativeHistory(tx, shared));
  await expect(
    readHtmlPage(
      { userId: null, tokenId: null, email: null, documentEditor: false },
      input.pageId,
    ),
  ).rejects.toThrow();
  expect(
    (
      await readHtmlPage(
        { ...identityForUser(reader.userId, reader.id), email: reader.email },
        input.pageId,
      )
    ).version,
  ).toBe(3);
  await db.query("UPDATE artifacts SET visibility='public' WHERE id=$1", [
    input.pageId,
  ]);
  await expect(
    db.transaction((tx) => writeNativeHistory(tx, shared)),
  ).rejects.toThrow("native_import_collision");
  expect((await readHtmlPage(actor, input.pageId)).version).toBe(3);
});
