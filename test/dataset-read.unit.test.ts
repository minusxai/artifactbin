import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createDatasetReadService } from "../src/datasets/service.ts";
import type {
  DatasetResolvedBinding,
  DatasetReadAuthority,
  DatasetReadPorts,
} from "../src/datasets/contracts.ts";
const bytes = Buffer.from('[{"amount":1},{"amount":2}]');
const sha256 = createHash("sha256").update(bytes).digest("hex");
const binding: DatasetResolvedBinding = {
  mode: "live",
  revision: { version: 2, generation: 1, policyRevision: 1 },
  name: "sales",
  backendId: "backend-file",
  backendVersion: "backend",
  page: { id: "document", version: 1, legacyId: "document", editId: "edit" },
  dataset: { id: "dataset", version: 2, policyRevision: 1 },
  tables: [
    {
      schema: "public",
      name: "rows",
      columns: [{ name: "amount", type: "number" }],
      object: {
        key: sha256,
        sha256,
        bytes: bytes.length,
      },
    },
  ],
};
const owner = { userId: "owner", tokenId: null };
const authority: DatasetReadAuthority = {
  pageVersion: 1,
  page: {
    id: "document",
    editId: "edit",
    owner,
    visibility: "public",
    format: "markup",
    deleted: false,
    ownerIsTestUser: false,
    acceptedJoinUserIds: [],
  },
  dataset: {
    id: "dataset",
    version: 2,
    generation: 1,
    deleted: false,
    owner,
    visibility: "public",
    policyRevision: 1,
    ownerIsTestUser: false,
    policy: null,
  },
  facts: {
    caller: { userId: null, tokenId: null },
    identity: null,
    groupRoles: {},
    sharedArtifactIds: [],
  },
};
const context = {
  backendId: "backend-file",
  backendVersion: "backend",
  pageId: "document",
  subject: null,
};
const request = {
  binding: "sales",
  schema: "public",
  table: "rows",
  offset: 0,
  limit: 1,
};
function fixture(overrides: Partial<DatasetReadPorts> = {}) {
  let loads = 0;
  const service = createDatasetReadService({
    binding: async () => binding,
    authority: async () => authority,
    read: async () => {
      loads++;
      return (async function* () {
        yield bytes;
      })();
    },
    ...overrides,
  });
  return { service, loads: () => loads };
}
test("anonymous read is authorized server-side and returns a typed bounded immutable window", async () => {
  const f = fixture();
  const result = await f.service.read(context, request);
  assert.deepEqual(result.rows, [{ amount: 1 }]);
  assert.equal(result.nextOffset, 1);
  assert.equal(result.version, 2);
  assert.equal(JSON.stringify(result).includes("objectKey"), false);
});
test("private denial and wrong backend binding perform no object I/O", async () => {
  const f = fixture({
    authority: async () => ({
      ...authority,
      dataset: { ...authority.dataset, visibility: "private" },
    }),
  });
  await assert.rejects(f.service.read(context, request), { code: "denied" });
  assert.equal(f.loads(), 0);
  const g = fixture();
  await assert.rejects(
    g.service.read({ ...context, backendVersion: "wrong" }, request),
    { code: "denied" },
  );
  assert.equal(g.loads(), 0);
});
test("authorization is refreshed after object I/O and a revoked page produces no result", async () => {
  let checks = 0;
  const f = fixture({
    authority: async () =>
      ++checks === 1
        ? authority
        : { ...authority, page: { ...authority.page, visibility: "private" } },
  });
  await assert.rejects(f.service.read(context, request), { code: "denied" });
  assert.equal(checks, 2);
});
test("unknown fields, caller supplied keys, SQL and invalid windows are refused", async () => {
  const f = fixture();
  for (const r of [
    { ...request, key: "dataset/x" },
    { ...request, sql: "select *" },
    { ...request, offset: -1 },
    { ...request, limit: 10001 },
  ])
    await assert.rejects(f.service.read(context, r), {
      code: "invalid_request",
    });
  assert.equal(f.loads(), 0);
});
test("digest corruption and typed row corruption are refused", async () => {
  const f = fixture({
    read: async () =>
      (async function* () {
        yield Buffer.from("[]");
      })(),
  });
  await assert.rejects(f.service.read(context, request), {
    code: "invalid_dataset",
  });
  const bad = Buffer.from('[{"amount":"wrong"}]');
  const digest = createHash("sha256").update(bad).digest("hex");
  const g = fixture({
    binding: async () => ({
      ...binding,
      tables: [
        {
          ...binding.tables[0]!,
          object: {
            key: digest,
            sha256: digest,
            bytes: bad.length,
          },
        },
      ],
    }),
    read: async () =>
      (async function* () {
        yield bad;
      })(),
  });
  await assert.rejects(g.service.read(context, request), {
    code: "invalid_dataset",
  });
});
test("legacy null and v1 reads use audience while v2 enforces saved original document selectors", async () => {
  const v1 = {
    version: 1,
    enforcement: "enabled",
    tables: [
      {
        table: { schema: "public", name: "rows" },
        update_permissions: [
          {
            role: "viewer",
            permission: {
              columns: "*",
              filter: { owner: { _eq: "x-hasura-user-id" } },
              check: {},
            },
          },
        ],
      },
    ],
  };
  for (const policy of [null, v1]) {
    const f = fixture({
      authority: async () => ({
        ...authority,
        dataset: { ...authority.dataset, policy },
      }),
    });
    assert.equal((await f.service.read(context, request)).rows.length, 1);
  }
  const v2 = {
    version: 2,
    allow: [{ actions: ["read"], from: { artifact: "original" } }],
  };
  const f = fixture({
    binding: async () => ({
      ...binding,
      page: { ...binding.page, legacyId: "original" },
    }),
    authority: async () => ({
      ...authority,
      page: { ...authority.page, id: "original" },
      dataset: { ...authority.dataset, policy: v2 },
    }),
  });
  assert.equal((await f.service.read(context, request)).rows.length, 1);
  const g = fixture({
    authority: async () => ({
      ...authority,
      dataset: { ...authority.dataset, policy: v2 },
    }),
  });
  await assert.rejects(g.service.read(context, request), { code: "denied" });
});
test("unsupported policies, changed revisions and private group prototype properties deny", async () => {
  for (const change of [
    { policy: { version: 3 } },
    {
      policy: {
        version: 1,
        enforcement: "enabled",
        tables: [],
        execution: { extensions: {} },
      },
    },
    {
      visibility: "private",
      owner: { userId: null, tokenId: null, groupId: "constructor" },
    },
  ]) {
    const f = fixture({
      authority: async () => ({
        ...authority,
        dataset: { ...authority.dataset, ...change },
      }),
    });
    await assert.rejects(f.service.read(context, request), { code: "denied" });
    assert.equal(f.loads(), 0);
  }
});
test("payloads larger than bound stop before parsing and oversized cells cannot cross capability frames", async () => {
  const f = fixture({
    binding: async () => ({
      ...binding,
      tables: [
        {
          ...binding.tables[0]!,
          object: { ...binding.tables[0]!.object, bytes: 32 * 1024 * 1024 + 1 },
        },
      ],
    }),
  });
  await assert.rejects(f.service.read(context, request), {
    code: "invalid_dataset",
  });
  assert.equal(f.loads(), 0);
  const data = Buffer.from(JSON.stringify([{ text: "x".repeat(62000) }]));
  const digest = createHash("sha256").update(data).digest("hex");
  const g = fixture({
    binding: async () => ({
      ...binding,
      tables: [
        {
          schema: "public",
          name: "rows",
          columns: [{ name: "text", type: "string" }],
          object: {
            key: digest,
            sha256: digest,
            bytes: data.length,
          },
        },
      ],
    }),
    read: async () =>
      (async function* () {
        yield data;
      })(),
  });
  await assert.rejects(g.service.read(context, request), {
    code: "result_limit",
  });
});
test("typed legacy dates, timestamps, booleans and user IDs retain read semantics", async () => {
  const data = Buffer.from(
    JSON.stringify([
      {
        day: "2024-02-29T12:00:00Z",
        at: "2024-02-29 12:34:56+0530",
        flag: 1,
        person: "stable_user",
      },
    ]),
  );
  const digest = createHash("sha256").update(data).digest("hex");
  const g = fixture({
    binding: async () => ({
      ...binding,
      tables: [
        {
          schema: "public",
          name: "rows",
          columns: [
            { name: "day", type: "date" },
            { name: "at", type: "timestamp" },
            { name: "flag", type: "boolean" },
            { name: "person", type: "user" },
          ],
          object: {
            key: digest,
            sha256: digest,
            bytes: data.length,
          },
        },
      ],
    }),
    read: async () =>
      (async function* () {
        yield data;
      })(),
  });
  assert.deepEqual((await g.service.read(context, request)).rows, [
    {
      day: "2024-02-29",
      at: "2024-02-29T07:04:56.000Z",
      flag: true,
      person: "stable_user",
    },
  ]);
});
test("stream buffers are copied and caller identity cannot be smuggled into anonymous authority", async () => {
  const source = Buffer.from(bytes);
  const f = fixture({
    read: async () =>
      (async function* () {
        yield source;
        source.fill(0);
      })(),
  });
  assert.equal((await f.service.read(context, request)).rows[0]?.amount, 1);
  const g = fixture({
    authority: async () => ({
      ...authority,
      facts: { ...authority.facts, caller: owner },
    }),
  });
  await assert.rejects(g.service.read(context, request), { code: "denied" });
});
test("response pagination reduces the window to fit the capability frame and resumes without dropping rows", async () => {
  const data = Buffer.from(
    JSON.stringify(
      Array.from({ length: 3 }, (_, i) => ({
        text: String(i) + "x".repeat(30000),
      })),
    ),
  );
  const digest = createHash("sha256").update(data).digest("hex");
  const f = fixture({
    binding: async () => ({
      ...binding,
      tables: [
        {
          schema: "public",
          name: "rows",
          columns: [{ name: "text", type: "string" }],
          object: {
            key: digest,
            sha256: digest,
            bytes: data.length,
          },
        },
      ],
    }),
    read: async () =>
      (async function* () {
        yield data;
      })(),
  });
  const first = await f.service.read(context, { ...request, limit: 3 });
  assert.equal(first.rows.length, 2);
  assert.equal(first.nextOffset, 2);
  assert.ok(Buffer.byteLength(JSON.stringify(first)) < 64 * 1024);
  const second = await f.service.read(context, {
    ...request,
    offset: first.nextOffset,
    expectedVersion: first.version,
    expectedGeneration: first.generation,
    limit: 3,
  });
  assert.equal(second.rows.length, 1);
  assert.equal(second.nextOffset, null);
});
test("tiny sparse tables do not expand every row across a wide catalog and excessive row arrays refuse", async () => {
  for (const count of [10000, 100001]) {
    const data = Buffer.from(
      JSON.stringify(Array.from({ length: count }, () => ({}))),
    );
    const digest = createHash("sha256").update(data).digest("hex");
    const f = fixture({
      binding: async () => ({
        ...binding,
        tables: [
          {
            schema: "public",
            name: "rows",
            columns: Array.from({ length: 1024 }, (_, i) => ({
              name: "c" + i,
              type: "string",
            })),
            object: {
              key: digest,
              sha256: digest,
              bytes: data.length,
            },
          },
        ],
      }),
      read: async () =>
        (async function* () {
          yield data;
        })(),
    });
    if (count > 100000)
      await assert.rejects(f.service.read(context, request), {
        code: "invalid_dataset",
      });
    else {
      const result = await f.service.read(context, request);
      assert.equal(result.totalRows, 10000);
      assert.equal(result.rows.length, 1);
      assert.equal(Object.keys(result.rows[0]!).length, 1024);
    }
  }
});
test("runtime object identity uses the full digest and excessive nesting is refused before parsing", async () => {
  const f = fixture({
    binding: async () => ({
      ...binding,
      tables: [
        {
          ...binding.tables[0]!,
          object: {
            ...binding.tables[0]!.object,
            key: "dataset/" + sha256.slice(0, 32),
          },
        },
      ],
    }),
  });
  await assert.rejects(f.service.read(context, request), {
    code: "invalid_dataset",
  });
  assert.equal(f.loads(), 0);
  const data = Buffer.from("[".repeat(40) + "]".repeat(40));
  const digest = createHash("sha256").update(data).digest("hex");
  const g = fixture({
    binding: async () => ({
      ...binding,
      tables: [
        {
          ...binding.tables[0]!,
          object: { key: digest, sha256: digest, bytes: data.length },
        },
      ],
    }),
    read: async () =>
      (async function* () {
        yield data;
      })(),
  });
  await assert.rejects(g.service.read(context, request), {
    code: "invalid_dataset",
  });
});

test("live read refuses changed heads during object I/O and mismatched paginated snapshot tokens", async () => {
  let calls = 0;
  const f = fixture({
    authority: async () => {
      calls++;
      return {
        ...authority,
        dataset: {
          ...authority.dataset,
          version: calls > 1 ? 3 : 2,
          generation: calls > 1 ? 2 : 1,
        },
      };
    },
  });
  await assert.rejects(f.service.read(context, request), {
    code: "dataset_changed",
  });
  const g = fixture();
  await assert.rejects(g.service.read(context, { ...request, offset: 1 }), {
    code: "invalid_request",
  });
  await assert.rejects(
    g.service.read(context, {
      ...request,
      offset: 1,
      expectedVersion: 2,
      expectedGeneration: 2,
    }),
    { code: "dataset_changed" },
  );
  assert.equal(g.loads(), 0);
  const page = await g.service.read(context, {
    ...request,
    offset: 1,
    expectedVersion: 2,
    expectedGeneration: 1,
  });
  assert.deepEqual(page.rows, [{ amount: 2 }]);
  assert.equal(page.generation, 1);
});

test("read accepts supported execution function restrictions without turning them into SELECT restrictions", async () => {
  for (const policy of [
    {
      version: 1,
      enforcement: "enabled",
      tables: [],
      execution: { functions: { allow: ["count"], deny: ["random"] } },
    },
    {
      version: 2,
      allow: [{ actions: ["read"], from: { artifact: "document" } }],
      execution: { functions: { allow: ["count"] } },
    },
  ]) {
    const f = fixture({
      authority: async () => ({
        ...authority,
        dataset: { ...authority.dataset, policy },
      }),
    });
    assert.equal((await f.service.read(context, request)).rows.length, 1);
  }
});

test("explicit pinned reads keep their original catalog version under fresh current authority", async () => {
  const f = fixture({
    binding: async () => ({
      ...binding,
      mode: "pinned",
      revision: { ...binding.revision, generation: 2 },
    }),
    authority: async () => ({
      ...authority,
      dataset: { ...authority.dataset, version: 3, generation: 2 },
    }),
  });
  const result = await f.service.read(context, request);
  assert.equal(result.version, 2);
  assert.equal(result.generation, 2);
  assert.deepEqual(result.rows, [{ amount: 1 }]);
});
