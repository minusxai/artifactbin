import test from "node:test";
import assert from "node:assert/strict";
import {
  readLocalSourceManifest,
  reconcileLocalDeclarations,
} from "../src/migration/conversion/compiled/source-manifest.ts";
import { validLocalValue } from "../src/migration/conversion/compiled/local-state.ts";
import type {
  LocalScalarDeclaration,
  LocalColumnType,
} from "../src/migration/conversion/compiled/local-contracts.ts";

test("omitted string, date, user and timestamp defaults preserve archived scalar meaning", () => {
  const manifest = readLocalSourceManifest(
    `<Helmet><Value name="search" default="001"/><Value name="day" type="date" default="2026-01-02"/><Value name="owner" type="user"/><Value name="instant" type="timestamp" default="2026-01-02 03:04:05+0530"/><Value name="epoch" type="timestamp" default={1700000000000}/></Helmet>`,
  );
  assert.deepEqual(manifest.declarations, [
    { name: "search", type: "string", default: "001" },
    { name: "day", type: "date", default: "2026-01-02" },
    { name: "owner", type: "user", default: null },
    { name: "instant", type: "timestamp", default: "2026-01-01T21:34:05.000Z" },
    { name: "epoch", type: "timestamp", default: "2023-11-14T22:13:20.000Z" },
  ]);
  assert.equal(
    reconcileLocalDeclarations(manifest, manifest.declarations),
    true,
  );
  assert.equal(
    reconcileLocalDeclarations(
      manifest,
      manifest.declarations.map((d) =>
        d.name === "instant"
          ? { ...d, default: "2026-01-02 03:04:05+0530" }
          : d,
      ),
    ),
    false,
  );
});

test("scalar validation accepts null and preserves archived date shape while timestamps validate instants", () => {
  const declaration = (type: LocalColumnType): LocalScalarDeclaration => ({
    name: "value",
    type,
    default: null,
  });
  for (const type of [
    "string",
    "number",
    "boolean",
    "date",
    "timestamp",
    "user",
  ] as const)
    assert.equal(validLocalValue(declaration(type), null), true);
  for (const value of ["2026-01-02", "2026-01-02T03:04:05Z", "2026-02-31"])
    assert.equal(validLocalValue(declaration("date"), value), true);
  for (const value of ["not-a-date", "2026-1-2", 2, {}, []])
    assert.equal(validLocalValue(declaration("date"), value), false);
  for (const value of [
    "2024-02-29",
    "2026-01-02T03:04:05+05:30",
    1700000000000,
  ])
    assert.equal(validLocalValue(declaration("timestamp"), value), true);
  for (const value of [
    "2026-02-29",
    "2026-01",
    "2026-01-02T25:00Z",
    "2026-01-02T03:61Z",
    "2026-01-02T00:00+99:00",
    Infinity,
    {},
    [],
  ])
    assert.equal(validLocalValue(declaration("timestamp"), value), false);
  assert.equal(validLocalValue(declaration("user"), "001"), true);
  assert.equal(validLocalValue(declaration("user"), 1), false);
  assert.equal(validLocalValue(declaration("number"), "001"), false);
});

test("temporal table inference follows archived grammar and keeps exact row values and schema order", () => {
  const declarations = readLocalSourceManifest(
    `<Value name="rows" type="table" value={[{period:"2026-01",day:"2026-01-02",instant:"2026-01-02 03:04+0530",owner:"001",n:2,empty:null}]} columns={[{name:"owner",type:"user"},{name:"day",type:"date"}]}/>`,
  ).declarations;
  assert.deepEqual(declarations, [
    {
      name: "rows",
      type: "table",
      default: [
        {
          period: "2026-01",
          day: "2026-01-02",
          instant: "2026-01-02 03:04+0530",
          owner: "001",
          n: 2,
          empty: null,
        },
      ],
      columns: [
        { name: "owner", type: "user" },
        { name: "day", type: "date" },
        { name: "period", type: "string" },
        { name: "instant", type: "timestamp" },
        { name: "n", type: "number" },
        { name: "empty", type: "string" },
      ],
    },
  ]);
  assert.equal(
    validLocalValue(declarations[0]!, declarations[0]!.default),
    true,
  );
  assert.deepEqual(
    readLocalSourceManifest(
      '<Value name="rows" type="table" value={[]} columns={[{name:"instant",type:"timestamp"}]}/>',
    ).declarations,
    [
      {
        name: "rows",
        type: "table",
        default: [],
        columns: [{ name: "instant", type: "timestamp" }],
      },
    ],
  );
});

test("invalid typed defaults, invented JSON scalars and protected schema attributes still refuse", () => {
  for (const source of [
    '<Value name="day" type="date" default="wrong"/>',
    '<Value name="instant" type="timestamp" default="2026-02-29"/>',
    '<Value name="owner" type="user" default={2}/>',
    '<Value name="search" default={2}/>',
    '<Value name="object" type="json" default={{a:1}}/>',
    '<Value name="owner" type="user" constraints={{self:true}}/>',
    '<Value name="rows" type="table" value={[]} columns={[{name:"x",type:"date",extra:true}]}/>',
    '<Value name="rows" type="table" value={[{instant:"2026-02-29"}]} columns={[{name:"instant",type:"timestamp"}]}/>',
  ])
    assert.throws(() => readLocalSourceManifest(source));
});
