import test from "node:test";
import assert from "node:assert/strict";
import { readBoundValueColumnProofs } from "../src/migration/conversion/compiled/bound-values.ts";
import { readLocalSourceManifest } from "../src/migration/conversion/compiled/source-manifest.ts";
const source =
  '<Import name="tasks" src="ref:Dataset001"/><Value name="assignee" source="ref:Dataset001" column="owner"/>';
const catalog = {
  bindingName: "tasks",
  sourceRef: "ref:Dataset001",
  version: 1,
  tables: [
    {
      schema: "public",
      name: "rows",
      columns: [
        {
          name: "owner",
          type: "user",
          constraints: { self: true, memberOf: ["ref:Scope001"] },
        },
      ],
    },
  ],
};
test("bound Values require exact trusted import-column proof and keep inherited facts offline", () => {
  const proofs = readBoundValueColumnProofs(source, [catalog]);
  assert.deepEqual(proofs, [
    {
      valueName: "assignee",
      sourceRef: "ref:Dataset001",
      version: 1,
      bindingName: "tasks",
      schema: "public",
      table: "rows",
      column: "owner",
      type: "user",
      constraints: { self: true, memberOf: ["ref:Scope001"] },
    },
  ]);
  assert.deepEqual(readLocalSourceManifest(source, proofs).declarations, [
    { name: "assignee", type: "user", default: null },
  ]);
  assert.throws(() => readLocalSourceManifest(source));
  const copy = structuredClone(proofs);
  copy[0]!.constraints!.memberOf!.push("ref:Other001");
  assert.deepEqual(catalog.tables[0]!.columns[0]!.constraints.memberOf, [
    "ref:Scope001",
  ]);
});
test("missing datasets, unreadable columns, type mismatches and ambiguous catalogs refuse", () => {
  for (const catalogs of [
    [],
    [{ ...catalog, bindingName: "other" }],
    [{ ...catalog, sourceRef: "ref:Other001" }],
    [{ ...catalog, tables: [] }],
    [
      {
        ...catalog,
        tables: [
          {
            ...catalog.tables[0]!,
            columns: [{ name: "owner", type: "string" }],
          },
        ],
      },
    ],
    [catalog, catalog],
  ])
    assert.throws(() => readBoundValueColumnProofs(source, catalogs));
  for (const suffix of [
    ' type="user"',
    " constraints={{self:false}}",
    ' column="other"',
    " default={1}",
  ])
    assert.throws(() =>
      readBoundValueColumnProofs(
        source.replace(' column="owner"', ' column="owner"' + suffix),
        [catalog],
      ),
    );
});
test("bound proof validation refuses altered declarations and invalid inherited constraints", () => {
  const proofs = readBoundValueColumnProofs(source, [catalog]);
  for (const patch of [
    { valueName: "other" },
    { sourceRef: "ref:Other001" },
    { column: "other" },
    { type: "string" },
    { table: "other" },
  ])
    assert.throws(() =>
      readLocalSourceManifest(source, [{ ...proofs[0]!, ...patch } as any]),
    );
  for (const constraints of [
    { self: "yes" },
    { memberOf: [] },
    { memberOf: ["bad"] },
    { memberOf: ["ref:Scope001", "ref:Scope001"] },
    { unknown: true },
  ])
    assert.throws(() =>
      readBoundValueColumnProofs(source, [
        {
          ...catalog,
          tables: [
            {
              ...catalog.tables[0]!,
              columns: [
                {
                  name: "owner",
                  type: "user",
                  constraints: constraints as any,
                },
              ],
            },
          ],
        },
      ]),
    );
});

import { boundValueCatalog } from "../src/migration/datasets/bound-value-catalog.ts";
test("offline catalog preserves original constraints without rows or storage identities", () => {
  const tables: any = [
    {
      schema: "public",
      name: "rows",
      columns: [{ name: "owner", type: "user" }],
      object: { key: "private-object" },
    },
  ];
  const row: any = {
    id: "Dataset001",
    version: 1,
    format: "dataset",
    meta: {
      catalog: {
        kind: "stored",
        tables: [
          {
            schema: "public",
            name: "rows",
            columns: [
              {
                name: "owner",
                type: "user",
                constraints: { self: true, memberOf: ["ref:Scope001"] },
              },
            ],
            objectKey: "private-object",
          },
        ],
      },
    },
  };
  const metadata = boundValueCatalog("tasks", row, tables);
  assert.deepEqual(metadata, catalog);
  assert.equal(JSON.stringify(metadata).includes("private-object"), false);
  for (const constraints of [null, { memberOf: [] }, { self: "yes" }])
    assert.throws(() =>
      boundValueCatalog(
        "tasks",
        {
          ...row,
          meta: {
            catalog: {
              kind: "stored",
              tables: [
                {
                  schema: "public",
                  name: "rows",
                  columns: [{ name: "owner", type: "user", constraints }],
                },
              ],
            },
          },
        },
        tables,
      ),
    );
  assert.throws(() =>
    boundValueCatalog(
      "tasks",
      { ...row, meta: { catalog: { kind: "stored", tables: [] } } },
      tables,
    ),
  );
});

test("pinned source versions must match trusted immutable catalog version", () => {
  assert.equal(
    readBoundValueColumnProofs(
      source.replace(
        'src="ref:Dataset001"',
        'src="ref:Dataset001" version={1}',
      ),
      [catalog],
    ).length,
    1,
  );
  for (const version of ["{2}", '"2"', "{getVersion()}"])
    assert.throws(() =>
      readBoundValueColumnProofs(
        source.replace(
          'src="ref:Dataset001"',
          'src="ref:Dataset001" version=' + version,
        ),
        [catalog],
      ),
    );
});

test("offline bound planning ignores unrelated unbound Value expressions", () => {
  assert.deepEqual(
    readBoundValueColumnProofs(
      '<Import name="unrelated" src={dynamicSource}/><Value name="unrelated" default={dynamicValue}/>',
      [],
    ),
    [],
  );
  assert.equal(
    readBoundValueColumnProofs(
      source +
        '<Import name="unrelated" src={dynamicSource}/><Value name="unrelated" default={dynamicValue}/>',
      [catalog],
    ).length,
    1,
  );
});
