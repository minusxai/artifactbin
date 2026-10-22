import test from "node:test";
import assert from "node:assert/strict";
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
import type { DatasetAttachmentStaged } from "../src/datasets/attachments/contracts.ts";
test("concurrent exact replay has one durable receipt, changed input conflicts and revocation denies replay", async () => {
  const { env } = await fixture();
  await env.pool.query(
    "INSERT INTO sessions(token_hash,actor,expires) VALUES('session','member',9999999999999)",
  );
  try {
    const policy = {
      version: 2,
      allow: [
        {
          actions: ["insert", "read"],
          from: { user: "*", artifact: "Legacy12" },
        },
      ],
    };
    // Existing fixture uses a hyphenated archived id; grant selectors require a valid original id.
    await env.pool.query(
      'UPDATE dataset_resources SET snapshot=jsonb_set(jsonb_set(snapshot,\'{visibility}\',\'"public"\'),\'{policy}\',$1::jsonb),access=\'{"visibility":"public","linkRole":"viewer","shares":{},"version":0}\'',
      [JSON.stringify(policy)],
    );
    // Keep original saved identifiers exact; use artifact wildcard, never fabricate another page.
    policy.allow[0]!.from.artifact = "*";
    await env.pool.query(
      "UPDATE dataset_resources SET snapshot=jsonb_set(snapshot,'{policy}',$1::jsonb)",
      [JSON.stringify(policy)],
    );
    const db = createSqlDatabase({
      pool: env.pool,
      initialize: async () => {},
      statementTimeoutMs: 15000,
    });
    const context = {
      ...caller,
      credentialHash: "session",
      backendNamespace: "bridge",
      bindingName: "sales",
    };
    await db.transaction((client) =>
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
    const repo = createDatasetAttachmentRepository({
      database: db,
      now: () => 100,
    });
    await env.pool.query(
      "INSERT INTO dataset_page_joins(page_id,source_namespace,legacy_user_id) VALUES('Pg0001','legacy','old-owner')",
    );
    const initial = await repo.authority(context);
    assert.ok(initial);
    let published = 0;
    const staged: DatasetAttachmentStaged = {
      inputSha256: "a".repeat(64),
      object: {
        sha256: "b".repeat(64),
        storageKey: "b".repeat(64),
        byteLength: 8,
        contentType: "image/png",
        filename: "photo.png",
      },
      publish: async () => {
        published++;
      },
      discard: async () => {},
    };
    const input = {
      context,
      initial,
      staged,
      request: {
        requestId: "request_123",
        filename: "photo.png",
        contentType: "image/png" as const,
      },
    };
    const results = await Promise.all([repo.commit(input), repo.commit(input)]);
    assert.equal(results.filter((r) => r.replayed).length, 1);
    assert.ok(published >= 1 && published <= 2);
    await env.pool.query(
      "INSERT INTO sessions(token_hash,actor,expires) VALUES('owner-session','owner',9999999999999)",
    );
    const otherContext = {
      ...context,
      subject: "owner",
      credentialHash: "owner-session",
    };
    const otherInitial = await repo.authority(otherContext);
    assert.ok(otherInitial);
    const other = await repo.commit({
      ...input,
      context: otherContext,
      initial: otherInitial,
    });
    assert.notEqual(other.record.id, results[0]!.record.id);
    assert.equal(other.replayed, false);
    const promotions = published;
    assert.equal(results[0]!.record.id, results[1]!.record.id);
    await assert.rejects(
      repo.commit({
        ...input,
        staged: { ...staged, inputSha256: "c".repeat(64) },
      }),
      { code: "conflict" },
    );
    assert.equal(
      (await env.pool.query("SELECT * FROM dataset_attachments")).rows.length,
      2,
    );
    await env.pool.query(
      "DELETE FROM dataset_page_joins WHERE page_id='Pg0001'",
    );
    await assert.rejects(repo.commit(input), { code: "denied" });
    assert.equal(published, promotions);
  } finally {
    await env.cleanup();
  }
});
test("quota serializes competing uploads before publishing objects", async () => {
  const { env } = await fixture();
  await env.pool.query(
    "INSERT INTO sessions(token_hash,actor,expires) VALUES('session','member',9999999999999)",
  );
  try {
    await env.pool.query(
      `UPDATE dataset_resources SET snapshot=jsonb_set(snapshot,'{policy}',$1::jsonb)`,
      [
        JSON.stringify({
          version: 2,
          allow: [{ actions: ["insert"], from: { user: "*", artifact: "*" } }],
        }),
      ],
    );
    const db = createSqlDatabase({
      pool: env.pool,
      initialize: async () => {},
      statementTimeoutMs: 15000,
    });
    const context = {
      ...caller,
      credentialHash: "session",
      backendNamespace: "bridge",
      bindingName: "sales",
    };
    await db.transaction((client) =>
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
    const repo = createDatasetAttachmentRepository({
      database: db,
      now: () => 100,
    });
    const initial = await repo.authority(context);
    assert.ok(initial);
    let published = 0;
    const staged: DatasetAttachmentStaged = {
      inputSha256: "a".repeat(64),
      object: {
        sha256: "b".repeat(64),
        storageKey: "b".repeat(64),
        byteLength: 8,
        totalBytes: 250_000_001,
        contentType: "image/png",
        filename: "photo.png",
      },
      publish: async () => {
        published++;
      },
      discard: async () => {},
    };
    const results = await Promise.allSettled(
      ["request_a", "request_b"].map((requestId) =>
        repo.commit({
          context,
          initial,
          staged,
          request: {
            requestId,
            filename: "photo.png",
            contentType: "image/png",
          },
        }),
      ),
    );
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(published, 1);
    const rejected = results.find((r) => r.status === "rejected");
    assert.equal(
      rejected?.status === "rejected" && rejected.reason.code,
      "quota",
    );
  } finally {
    await env.cleanup();
  }
});

test("unknown promotion failure retains charged reservation; exact recovery pins processed output and completed-only reads", async () => {
  const { env } = await fixture();
  await env.pool.query(
    "INSERT INTO sessions(token_hash,actor,expires) VALUES('session','member',9999999999999)",
  );
  try {
    await env.pool.query(
      `UPDATE dataset_resources SET snapshot=jsonb_set(jsonb_set(snapshot,'{visibility}','"public"'),'{policy}',$1::jsonb)`,
      [
        JSON.stringify({
          version: 2,
          allow: [
            { actions: ["insert", "read"], from: { user: "*", artifact: "*" } },
          ],
        }),
      ],
    );
    const db = createSqlDatabase({
      pool: env.pool,
      initialize: async () => {},
      statementTimeoutMs: 15000,
    });
    const context = {
      ...caller,
      credentialHash: "session",
      backendNamespace: "bridge",
      bindingName: "sales",
    };
    await db.transaction((client) =>
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
    const repo = createDatasetAttachmentRepository({
      database: db,
      now: () => 100,
    });
    const initial = await repo.authority(context);
    assert.ok(initial);
    let promoted = 0;
    const staged: DatasetAttachmentStaged = {
      inputSha256: "a".repeat(64),
      object: {
        sha256: "b".repeat(64),
        storageKey: "b".repeat(64),
        byteLength: 8,
        totalBytes: 500_000_000,
        contentType: "image/png",
        filename: "photo.png",
      },
      publish: async () => {
        promoted++;
        throw new Error("unknown after promotion");
      },
      discard: async () => {},
    };
    const input = {
      context,
      initial,
      staged,
      request: {
        requestId: "request_123",
        filename: "photo.png",
        contentType: "image/png" as const,
      },
    };
    await assert.rejects(repo.commit(input));
    const rows = (
      await env.pool.query("SELECT id,stored_bytes FROM dataset_attachments")
    ).rows;
    assert.equal(rows.length, 1);
    assert.equal(Number(rows[0]!.stored_bytes), 500_000_000);
    assert.equal(await repo.read(context, rows[0]!.id), null);
    await assert.rejects(
      repo.commit({
        ...input,
        request: { ...input.request, requestId: "different_key" },
      }),
      { code: "quota" },
    );
    await assert.rejects(
      repo.commit({
        ...input,
        staged: {
          ...staged,
          object: { ...staged.object, sha256: "d".repeat(64) },
        },
      }),
      { code: "conflict" },
    );
    assert.equal(promoted, 1);
    const recovered = await repo.commit({
      ...input,
      staged: {
        ...staged,
        publish: async () => {
          promoted++;
        },
      },
    });
    assert.equal(recovered.replayed, true);
    assert.equal(recovered.record.id, rows[0]!.id);
    assert.ok(await repo.read(context, recovered.record.id));
    assert.equal(
      (await env.pool.query("SELECT * FROM dataset_attachment_completions"))
        .rows.length,
      1,
    );
  } finally {
    await env.cleanup();
  }
});
test("revoked session during object promotion cannot complete or expose a charged reservation", async () => {
  const { env } = await fixture();
  try {
    await env.pool.query(
      "INSERT INTO sessions(token_hash,actor,expires) VALUES('session','member',9999999999999)",
    );
    await env.pool.query(
      `UPDATE dataset_resources SET snapshot=jsonb_set(snapshot,'{policy}',$1::jsonb)`,
      [
        JSON.stringify({
          version: 2,
          allow: [{ actions: ["insert"], from: { user: "*", artifact: "*" } }],
        }),
      ],
    );
    const db = createSqlDatabase({
      pool: env.pool,
      initialize: async () => {},
      statementTimeoutMs: 15000,
    });
    const context = {
      ...caller,
      credentialHash: "session",
      backendNamespace: "bridge",
      bindingName: "sales",
    };
    await db.transaction((client) =>
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
    const repo = createDatasetAttachmentRepository({
      database: db,
      now: () => 100,
    });
    const initial = await repo.authority(context);
    assert.ok(initial);
    const staged: DatasetAttachmentStaged = {
      inputSha256: "a".repeat(64),
      object: {
        sha256: "b".repeat(64),
        storageKey: "b".repeat(64),
        byteLength: 8,
        contentType: "image/png",
        filename: "photo.png",
      },
      publish: async () => {
        await env.pool.query("DELETE FROM sessions WHERE token_hash='session'");
      },
      discard: async () => {},
    };
    await assert.rejects(
      repo.commit({
        context,
        initial,
        staged,
        request: {
          requestId: "request_123",
          filename: "photo.png",
          contentType: "image/png",
        },
      }),
      { code: "denied" },
    );
    assert.equal(
      (await env.pool.query("SELECT * FROM dataset_attachment_completions"))
        .rows.length,
      0,
    );
    assert.equal(
      (await env.pool.query("SELECT * FROM dataset_attachments")).rows.length,
      1,
    );
    assert.equal(await repo.authority(context), null);
  } finally {
    await env.cleanup();
  }
});
