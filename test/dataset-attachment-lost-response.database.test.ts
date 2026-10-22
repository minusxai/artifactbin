import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  fixture,
  binding,
  context as caller,
} from "./dataset-runtime-fixture.ts";
import { createSqlDatabase } from "../src/persistence/sql.ts";
import {
  createDatasetAttachmentRepository,
  registerDatasetAttachments,
} from "../src/persistence/dataset-attachments.ts";
import { createDatasetAttachmentService } from "../src/datasets/attachments/service.ts";
import { createAttachmentHTTP } from "../src/browser/dataset-attachment-http.ts";
import type {
  AttachmentUpload,
  AttachmentReceipt,
} from "../src/browser/dataset-attachment-bridge-contracts.ts";

test("lost committed upload response reconciles its exact asset once through a reconstructed HTTP adapter", async () => {
  const { env } = await fixture();
  try {
    await env.pool.query(
      "INSERT INTO sessions(token_hash,actor,expires) VALUES('session','member',9999999999999)",
    );
    await env.pool.query(
      "UPDATE dataset_resources SET snapshot=jsonb_set(snapshot,'{policy}',$1::jsonb)",
      [
        JSON.stringify({
          version: 2,
          allow: [
            { actions: ["insert", "read"], from: { user: "*", artifact: "*" } },
          ],
        }),
      ],
    );
    await env.pool.query(
      "INSERT INTO dataset_page_joins(page_id,source_namespace,legacy_user_id) VALUES('Pg0001','legacy','old-owner')",
    );
    const database = createSqlDatabase({
      pool: env.pool,
      initialize: async () => {},
      statementTimeoutMs: 15000,
    });
    await database.transaction((client) =>
      registerDatasetAttachments({
        client,
        registrations: [
          {
            backendNamespace: "bridge",
            sourceNamespace: "legacy",
            binding,
            acceptedTypes: ["image/png"],
          },
        ],
      }),
    );
    const context = {
      ...caller,
      credentialHash: "session",
      backendNamespace: "bridge",
      bindingName: "sales",
    };
    let promotions = 0,
      sends = 0,
      lost = true;
    let committedReceipt: AttachmentReceipt | undefined;
    const service = createDatasetAttachmentService({
      repository: createDatasetAttachmentRepository({
        database,
        now: () => 100,
      }),
      storage: {
        async stage(upload) {
          const hash = createHash("sha256");
          for await (const bytes of upload.body) hash.update(bytes);
          return {
            inputSha256: hash.digest("hex"),
            object: {
              sha256: "b".repeat(64),
              storageKey: "b".repeat(64),
              byteLength: 8,
              contentType: "image/png",
              filename: upload.filename,
            },
            publish: async () => {
              promotions++;
            },
            discard: async () => {},
          };
        },
        open: async () => {
          throw Error("No download in this test");
        },
      },
    });
    const retained: AttachmentUpload = {
      backendNamespace: "bridge",
      bindingName: "sales",
      requestId: "lost-upload-response-0001",
      filename: "sample.png",
      contentType: "image/png",
      blob: new Blob(["original image"], { type: "image/png" }),
    };
    const durable = async () => ({
      attachments: (
        await env.pool.query(
          "SELECT count(*)::int AS count, sum(stored_bytes)::int AS bytes FROM dataset_attachments",
        )
      ).rows[0],
      receipts: (
        await env.pool.query(
          "SELECT count(*)::int AS count FROM dataset_attachment_receipts",
        )
      ).rows[0].count,
      completions: (
        await env.pool.query(
          "SELECT count(*)::int AS count FROM dataset_attachment_completions",
        )
      ).rows[0].count,
    });
    const adapter = () =>
      createAttachmentHTTP({
        origin: "https://platform.invalid",
        pageId: () => "Pg0001",
        authority: () => "same-verified-caller",
        headers: () => ({}),
        async fetch(url, init) {
          sends++;
          assert.equal(
            url,
            "https://platform.invalid/api/files/Pg0001/dataset-attachments/bridge/sales",
          );
          assert.equal(init.method, "POST");
          const headers = new Headers(init.headers),
            blob = init.body as Blob;
          const receipt = await service.upload(context, {
            requestId: headers.get("Idempotency-Key")!,
            filename: decodeURIComponent(headers.get("X-Filename")!),
            contentType: headers.get("Content-Type") as "image/png",
            body: (async function* () {
              yield new Uint8Array(await blob.arrayBuffer());
            })(),
          });
          if (lost) {
            lost = false;
            committedReceipt = receipt;
            // Fault is after durable completion, never a pre-dispatch refusal.
            assert.deepEqual(await durable(), {
              attachments: { count: 1, bytes: 8 },
              receipts: 1,
              completions: 1,
            });
            throw new TypeError("Synthetic response lost after durable commit");
          }
          return Response.json(receipt);
        },
      });
    await assert.rejects(adapter().upload(retained), /response lost/);
    assert.equal(sends, 1);
    const afterCommit = await durable(),
      freshAdapter = adapter();
    assert.equal(
      sends,
      1,
      "constructing an adapter never resends an uncertain upload",
    );
    const replay = await freshAdapter.upload(retained);
    assert.deepEqual(replay, { ...committedReceipt, replayed: true });
    assert.equal(sends, 2);
    assert.equal(promotions, 1, "exact replay does not promote another output");
    assert.deepEqual(
      await durable(),
      afterCommit,
      "one asset, charge, receipt and completion after reconciliation",
    );
    await assert.rejects(
      freshAdapter.upload({
        ...retained,
        blob: new Blob(["changed image"], { type: "image/png" }),
      }),
    );
    assert.deepEqual(
      await durable(),
      afterCommit,
      "changed bytes under the retained key cannot add an asset or charge",
    );
    assert.equal(promotions, 1);
  } finally {
    await env.cleanup();
  }
});
