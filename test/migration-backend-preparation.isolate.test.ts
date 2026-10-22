import test from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { testDatabase } from "./postgres.js";
import { createBackendHost } from "../src/backend/container-host.ts";
import {
  prepareMigrationBackends,
  registerMigrationBackends,
} from "../src/migration/backend-preparation.ts";
import { registerDatasetMutationOperations } from "../src/persistence/dataset-mutations.ts";
import { createBackendRoutes } from "../src/backend/af-files.ts";
import { createSqlDatabase } from "../src/persistence/sql.ts";
import { createDatasetReadRepository } from "../src/persistence/datasets.ts";
import { createReadonlyDatasetObjectStore } from "../src/datasets/object-store.ts";
import { createDatasetReadService } from "../src/datasets/service.ts";
import { createPageCaller } from "../src/server/af-caller.ts";
import { hash } from "../src/server/text.ts";
import type { DatasetBinding } from "../src/datasets/contracts.ts";
test(
  "actual compiled migration backend saves canonical revision links and reads trusted dataset through GraphQL",
  { timeout: 90000 },
  async () => {
    const host = createBackendHost({
      deploymentNamespace: "afmigration",
      sandboxNetwork: "none",
    });
    const env = await testDatabase();
    const directory = await mkdtemp(join(tmpdir(), "migration-backend-"));
    try {
      const prepared = await prepareMigrationBackends(
        {
          sourceNamespace: "fixture",
          origin: "https://example.test",
          allocatedIds: ["Page12"],
          pages: [
            {
              legacyId: "OldPg1",
              pageId: "Page12",
              owner: { kind: "user", id: "owner" },
              revisions: [1, 2, 3].map((version) => ({
                version,
                editId: "old-edit",
                mutations:
                  version === 2
                    ? [
                        {
                          name: "remove",
                          bindingName: "sales",
                          datasetLegacyId: "ds",
                          target: { schema: "public", table: "rows" },
                          sqlSchema: "sales",
                          sql: "delete from sales.rows where value=$value",
                          paramTypes: { value: "number" as const },
                          conflictMode: "refuse" as const,
                        },
                      ]
                    : [],
                imports:
                  version !== 2
                    ? []
                    : [
                        {
                          name: "sales",
                          legacyRef: "ds:1",
                          datasetLegacyId: "ds",
                          datasetVersion: 1,
                        },
                      ],
              })),
            },
          ],
        },
        { host },
      );
      assert.equal(prepared.receipts.length, 3);
      const receipt = prepared.receipts[1]!;
      assert.match(receipt.deployment.runtime, /\/image:sha256:/);
      assert.deepEqual(receipt.deployment.lockfile, {});
      for (const path of [
        "schema.sql",
        "backend/af-schema.sql",
        "datasets/schema.sql",
      ])
        await env.pool.query(
          await readFile(new URL("../src/" + path, import.meta.url), "utf8"),
        );
      await env.pool.query(
        "INSERT INTO accounts(actor) VALUES('owner'),('member')",
      );
      await env.pool.query(
        "INSERT INTO file_ids(id,owner,kind,published,created_at) VALUES('Page12','owner','page',true,0)",
      );
      const pageAccess = {
        visibility: "public",
        linkRole: "viewer",
        shares: { member: "viewer" },
        version: 0,
      };
      const datasetAccess = { ...pageAccess, visibility: "private" };
      await env.pool.query(
        "INSERT INTO files(id,owner,share_hash,generation,head,access) VALUES('Page12','owner','hash',1,'2',$1)",
        [pageAccess],
      );
      const database = createSqlDatabase({
        pool: env.pool,
        initialize: async () => {},
        statementTimeoutMs: 15000,
      });
      await database.transaction((client) =>
        registerMigrationBackends(
          client,
          prepared.receipts.filter((r) => r.pageVersion <= 2),
        ),
      );
      const links = (
        await env.pool.query(
          "SELECT page_version,name,file_id,version FROM af_page_backends ORDER BY page_version",
        )
      ).rows;
      assert.deepEqual(
        links.map((r: Record<string, unknown>) => [
          r.page_version,
          r.name,
          r.file_id,
          r.version,
        ]),
        [[2, "legacyData", receipt.backendId, receipt.deployment.version]],
      );
      assert.equal(
        (
          await env.pool.query(
            "SELECT count(*)::int AS count FROM af_backend_versions",
          )
        ).rows[0].count,
        1,
      );
      assert.deepEqual(
        (
          await env.pool.query(
            "SELECT owner,kind,published FROM file_ids WHERE id=$1",
            [receipt.backendId],
          )
        ).rows,
        [{ owner: "owner", kind: "backend", published: true }],
      );
      const bytes = Buffer.from('[{"value":7},{"value":8}]');
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      await writeFile(join(directory, sha256), bytes);
      const binding: DatasetBinding = {
        mode: "live",
        name: "sales",
        backendId: receipt.backendId,
        backendVersion: receipt.deployment.version,
        page: {
          id: "Page12",
          version: 2,
          legacyId: "OldPg1",
          editId: "old-edit",
        },
        dataset: { id: "ds", version: 1, policyRevision: 0 },
        tables: [
          {
            schema: "public",
            name: "rows",
            columns: [{ name: "value", type: "number" }],
            object: { key: sha256, sha256, bytes: bytes.length },
          },
        ],
      };
      const originalOwner = { userId: "old-owner", tokenId: null };
      await env.pool.query(
        "INSERT INTO dataset_resources(source_namespace,legacy_id,current_version,policy_revision,owner,generation,access,deleted,snapshot) VALUES('fixture','ds',1,0,'owner',1,$1,false,$2)",
        [
          datasetAccess,
          {
            id: "ds",
            owner: originalOwner,
            visibility: "private",
            policyRevision: 0,
            ownerIsTestUser: false,
            policy: null,
          },
        ],
      );
      await env.pool.query(
        "INSERT INTO dataset_versions VALUES('fixture','ds',1,$1,'{}','[]')",
        [JSON.stringify(binding.tables)],
      );
      await env.pool.query(
        "INSERT INTO dataset_pages VALUES('Page12',2,'fixture',$1)",
        [
          {
            id: "OldPg1",
            editId: "old-edit",
            owner: originalOwner,
            visibility: "public",
            format: "markup",
            deleted: false,
            ownerIsTestUser: false,
            acceptedJoinUserIds: [],
          },
        ],
      );
      const { tables: _, ...descriptor } = binding;
      await env.pool.query(
        "INSERT INTO dataset_bindings VALUES($1,$2,'Page12',2,'sales','fixture','ds',1,$3)",
        [receipt.backendId, receipt.deployment.version, descriptor],
      );
      await database.transaction(async (client) => {
        await registerDatasetMutationOperations(client, prepared.operations);
        await registerDatasetMutationOperations(client, prepared.operations);
      });
      assert.deepEqual(
        (
          await env.pool.query(
            "SELECT source_namespace,binding_name,operation FROM dataset_mutation_operations",
          )
        ).rows,
        prepared.operations.map((r) => ({
          source_namespace: r.sourceNamespace,
          binding_name: r.bindingName,
          operation: r.operation,
        })),
      );
      await assert.rejects(
        database.transaction((client) =>
          registerDatasetMutationOperations(
            client,
            prepared.operations.map((r) => ({
              ...r,
              operation: { ...r.operation, sql: "delete from sales.rows" },
            })),
          ),
        ),
      );
      await env.pool.query(
        "INSERT INTO dataset_principals VALUES('fixture','member','user','old-member','user',NULL)",
      );
      await env.pool.query(
        "INSERT INTO sessions(token_hash,actor,expires) VALUES($1,'member',$2)",
        [hash("fixture-member"), Date.now() + 60000],
      );
      const routes = createBackendRoutes({
        database,
        host,
        caller: createPageCaller(),
        datasets: createDatasetReadService({
          ...createDatasetReadRepository(database),
          read: createReadonlyDatasetObjectStore(directory).read,
        }),
        log: () => {},
      });
      const read = async (credential: string) => {
        const response = await routes.handle({
          method: "POST",
          url: new URL("https://example.test/api/files/Page12/graphql"),
          credential,
          signal: new AbortController().signal,
          body: {
            query:
              '{ legacyData { read(binding:"sales",schema:"public",table:"rows",offset:0,limit:1) { version rows totalRows nextOffset } } }',
          },
        });
        assert.equal(response?.status, 200);
        return response!.body as {
          data?: {
            legacyData?: {
              read?: { rows: unknown; totalRows: number; nextOffset: number };
            };
          };
          errors?: unknown[];
        };
      };
      const member = await read("fixture-member");
      assert.equal(member.errors, undefined);
      assert.deepEqual(member.data?.legacyData?.read, {
        version: 1,
        rows: [{ value: 7 }],
        totalRows: 2,
        nextOffset: 1,
      });
      assert.ok((await read("")).errors?.length);
      await env.pool.query(
        "UPDATE dataset_resources SET access=jsonb_set(access,'{visibility}','\"public\"')",
      );
      assert.deepEqual((await read("")).data?.legacyData?.read?.rows, [
        { value: 7 },
      ]);
      // Exact legacy semantics: explicit source-artifact read grants permit guests
      // for public/unlisted audiences, while private remains an audience ceiling.
      const sourceGrant = {
        version: 2,
        allow: [{ actions: ["read"], from: { artifact: "OldPg1" } }],
      };
      await env.pool.query(
        "UPDATE dataset_resources SET policy_revision=1,snapshot=jsonb_set(snapshot,'{policy}',$1::jsonb)",
        [JSON.stringify(sourceGrant)],
      );
      await env.pool.query("UPDATE files SET share_hash=$1", [
        hash("fixture-share"),
      ]);
      for (const pageVisibility of ["public", "unlisted"]) {
        await env.pool.query(
          "UPDATE files SET access=jsonb_set(access,'{visibility}',$1::jsonb)",
          [JSON.stringify(pageVisibility)],
        );
        for (const datasetVisibility of ["public", "unlisted"]) {
          await env.pool.query(
            "UPDATE dataset_resources SET access=jsonb_set(access,'{visibility}',$1::jsonb)",
            [JSON.stringify(datasetVisibility)],
          );
          const guest = await read(
            pageVisibility === "unlisted" ? "fixture-share" : "",
          );
          assert.equal(guest.errors, undefined);
          assert.deepEqual(guest.data?.legacyData?.read?.rows, [{ value: 7 }]);
        }
      }
      await env.pool.query(
        "UPDATE files SET access=jsonb_set(access,'{visibility}','\"public\"')",
      );
      await env.pool.query(
        "UPDATE dataset_resources SET access=jsonb_set(access,'{visibility}','\"private\"')",
      );
      assert.ok((await read("")).errors?.length);
      await env.pool.query(
        "UPDATE dataset_resources SET access=jsonb_set(access,'{visibility}','\"public\"'),snapshot=jsonb_set(snapshot,'{policy}',$1::jsonb)",
        [
          JSON.stringify({
            version: 2,
            allow: [{ actions: ["read"], from: { artifact: "Other1" } }],
          }),
        ],
      );
      assert.ok((await read("")).errors?.length);
      await env.pool.query(
        "UPDATE dataset_resources SET policy_revision=2,snapshot=jsonb_set(snapshot,'{policy}',$1::jsonb)",
        [JSON.stringify({ version: 2, allow: [] })],
      );
      assert.ok((await read("")).errors?.length);
      await env.pool.query(
        "UPDATE dataset_resources SET snapshot=jsonb_set(snapshot,'{policy}',$1::jsonb)",
        [JSON.stringify(sourceGrant)],
      );
      await env.pool.query(
        "UPDATE files SET access=jsonb_set(access,'{visibility}','\"private\"')",
      );
      await assert.rejects(read(""), /access to this document/);
      await env.pool.query(
        "UPDATE files SET access=jsonb_set(access,'{visibility}','\"public\"')",
      );
      await env.pool.query("UPDATE dataset_resources SET deleted=true");
      assert.ok((await read("fixture-member")).errors?.length);
      await env.pool.query("UPDATE files SET head='3'");
      await database.transaction((client) =>
        registerMigrationBackends(client, [prepared.receipts[2]!]),
      );
      assert.equal(
        (
          await env.pool.query(
            "SELECT page_version FROM af_backend_pages WHERE page_id='Page12'",
          )
        ).rows[0].page_version,
        3,
      );
      assert.equal(
        (
          await env.pool.query(
            "SELECT count(*)::int AS count FROM af_page_backends WHERE page_id='Page12' AND page_version=3",
          )
        ).rows[0].count,
        0,
      );
      assert.equal(
        (
          await env.pool.query(
            "SELECT count(*)::int AS count FROM af_page_backends WHERE page_id='Page12' AND page_version=2",
          )
        ).rows[0].count,
        1,
      );
    } finally {
      await host.close?.();
      await env.cleanup();
      await rm(directory, { recursive: true, force: true });
    }
  },
);
