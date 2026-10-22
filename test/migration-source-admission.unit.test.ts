import test from "node:test";
import assert from "node:assert/strict";
import {
  readLocalSourceManifest,
  reconcileLocalDeclarations,
} from "../src/migration/conversion/compiled/source-manifest.ts";

test("source manifest owns exact scalar types and defaults, including omitted nullable defaults", () => {
  const manifest = readLocalSourceManifest(
    '<Helmet><Value name="count" type="number" default={-2}/><Value name="label" type="string"/><Value name="enabled" type="boolean" default={false}/></Helmet>',
  );
  assert.deepEqual(manifest.declarations, [
    { name: "count", type: "number", default: -2 },
    { name: "label", type: "string", default: null },
    { name: "enabled", type: "boolean", default: false },
  ]);
  assert.equal(
    reconcileLocalDeclarations(
      manifest,
      structuredClone(manifest.declarations),
    ),
    true,
  );
  for (const changed of [
    [
      { name: "count", type: "string", default: "-2" },
      ...manifest.declarations.slice(1),
    ],
    [
      { name: "count", type: "number", default: 7 },
      ...manifest.declarations.slice(1),
    ],
    manifest.declarations.slice(1),
    [...manifest.declarations, manifest.declarations[0]],
    [null],
    {},
    null,
  ])
    assert.equal(reconcileLocalDeclarations(manifest, changed), false);
});
test("table manifest preserves inferred column order, declared overrides, null cells and exact rows", () => {
  const manifest = readLocalSourceManifest(
    '<Helmet><Value name="rows" type="table" value={[{amount:2,label:null},{label:"x",extra:true}]} columns={[{name:"label",type:"string"}]}/></Helmet>',
  );
  assert.deepEqual(manifest.declarations, [
    {
      name: "rows",
      type: "table",
      default: [
        { amount: 2, label: null },
        { label: "x", extra: true },
      ],
      columns: [
        { name: "label", type: "string" },
        { name: "amount", type: "number" },
        { name: "extra", type: "boolean" },
      ],
    },
  ]);
  assert.equal(
    reconcileLocalDeclarations(manifest, manifest.declarations),
    true,
  );
  const declaration = manifest.declarations[0]!;
  for (const change of [
    { default: [] },
    { columns: [{ name: "amount", type: "string" }] },
    { columns: [] },
    {
      default: [
        { amount: 3, label: null },
        { label: "x", extra: true },
      ],
    },
  ])
    assert.equal(
      reconcileLocalDeclarations(manifest, [{ ...declaration, ...change }]),
      false,
    );
});
test("literal admission never executes source and rejects ambiguous or unsupported declarations", () => {
  for (const source of [
    '<Value name="count" type="number" default={globalThis.sideEffect()}/>',
    '<Value name="count" type="number" default={1/0}/>',
    '<Value name="count" type="number" default={1} default={2}/>',
    '<Value name="count" type="number"/><Value name="count" type="number"/>',
    '<Value name="rows" type="table" value={[{__proto__:1}]}/>',
    '<Value name="rows" type="table" value={[]}/>',
    '<Value name="rows" type="table" value={[{a:{nested:1}}]}/>',
    '<Value name="count" type="number" default="wrong"/>',
  ])
    assert.throws(() => readLocalSourceManifest(source));
  assert.deepEqual(
    readLocalSourceManifest(
      '<Value name="empty" type="table" value={[]} columns={[{name:"x",type:"number"}]}/>',
    ).declarations,
    [
      {
        name: "empty",
        type: "table",
        default: [],
        columns: [{ name: "x", type: "number" }],
      },
    ],
  );
});

test("admission returns one complete source plan before compilation and rejects undeclared capabilities", async () => {
  const { admitLocalSource } = await import(
    "../src/migration/conversion/compiled/source-admission.ts"
  );
  const source =
    '<Helmet><Value name="n" type="number" default={2}/><Value name="rows" type="table" value={[{amount:3}]}/><Query name="total">{`select $n + amount as total from rows`}</Query></Helmet><Number data="$total"/>';
  const admitted = admitLocalSource({ source, coreUrl: "/af/v1/core.js" });
  assert.equal(admitted.ok, true);
  if (!admitted.ok) throw Error();
  assert.deepEqual(admitted.plan.manifest, readLocalSourceManifest(source));
  assert.deepEqual([...admitted.plan.queryNames], ["total"]);
  assert.equal(admitted.plan.datasetNames.size, 0);
  assert.equal(admitted.plan.mutationNames.size, 0);
  for (const changed of [
    source.replace('data="$total"', 'data="$missing"'),
    source + '<Button run="$unregistered">Save</Button>',
    source.replace("{$n + amount}", "{globalThis.sideEffect()}"),
  ]) {
    if (changed === source) continue;
    assert.equal(
      admitLocalSource({ source: changed, coreUrl: "/af/v1/core.js" }).ok,
      false,
    );
  }
});

test("output admission treats compiler JSON as unknown and reconciles against the admitted source", async () => {
  const { admitLocalSource } = await import(
    "../src/migration/conversion/compiled/source-admission.ts"
  );
  const { admitLocalOutput } = await import(
    "../src/migration/conversion/compiled/local-output.ts"
  );
  const admission = admitLocalSource({
    source:
      '<Helmet><Value name="n" type="number" default={2}/></Helmet><p>{$n}</p>',
    coreUrl: "/af/v1/core.js",
  });
  assert.ok(admission.ok);
  const output = {
    html: '<p id="result">2</p>',
    css: "",
    title: "Example",
    build: "synthetic",
    rootAttributes: { class: "light" },
    modules: [],
    javascript: "void 0;",
    declarations: [{ name: "n", type: "number", default: 2 }],
    capabilities: [],
  };
  const accepted = admitLocalOutput(admission.plan, output);
  assert.ok(accepted.ok);
  assert.deepEqual({ ...accepted.value.state }, { n: 2 });
  assert.match(accepted.value.body, /data-af-id="result"/);
  for (const candidate of [
    null,
    {},
    { ...output, rootAttributes: { class: 7 } },
    { ...output, declarations: [null] },
    { ...output, declarations: [{ name: "n", type: "string", default: "2" }] },
    { ...output, declarations: [{ name: "n", type: "number", default: 3 }] },
    { ...output, queryNames: "a" },
    { ...output, modules: [null] },
  ])
    assert.equal(admitLocalOutput(admission.plan, candidate).ok, false);
});

test("Mutation expectedAffected admits only the trusted extractor's literal shape and never augments browser authority", async () => {
  const { admitLocalSource } = await import(
    "../src/migration/conversion/compiled/source-admission.ts"
  );
  const metadata = {
    name: "save",
    backendNamespace: "legacyData",
    recoveryScope: "a".repeat(64),
    paramTypes: { amount: "number" as const },
  };
  const base = {
    coreUrl: "/af/v1/core.js",
    datasetBindings: [
      {
        name: "items",
        legacyRef: "ref:Abcd12",
        backendNamespace: "legacyData",
        backendHref: "/af/v1/ids/Bac123",
        version: 1,
        mode: "live" as const,
        tables: [
          {
            schema: "public",
            table: "rows",
            columns: [{ name: "amount", type: "number" }],
          },
        ],
      },
    ],
    datasetMutations: [metadata],
  };
  const source = (flag: string) =>
    '<Helmet><Import name="items" src="ref:Abcd12"/><Value name="amount" type="number" default={2}/><Query name="rows">{`select amount from items.rows`}</Query><Mutation name="save" ' +
    flag +
    '>{`insert into items.rows(amount) values($amount)`}</Mutation></Helmet><Button run="$save">Save</Button>';
  for (const number of [0, 1, Number.MAX_SAFE_INTEGER]) {
    const accepted = admitLocalSource({
      ...base,
      source: source("expectedAffected={" + number + "}"),
    });
    assert.ok(accepted.ok);
    assert.deepEqual(accepted.plan.input.datasetMutations, [metadata]);
  }
  for (const recoveryScope of [
    undefined,
    "",
    "A".repeat(64),
    "a".repeat(63),
    "not-a-scope",
  ]) {
    const candidate = {
      ...base,
      datasetMutations: [{ ...metadata, recoveryScope }],
    };
    assert.equal(
      admitLocalSource({
        ...candidate,
        source: source("expectedAffected={1}"),
      } as import("../src/migration/conversion/compiled/contracts.ts").CompiledMigrationInput)
        .ok,
      false,
    );
  }
  for (const backendNamespace of [
    "compiledPage",
    "authorSignals",
    "datasetMutationIntents",
  ]) {
    assert.equal(
      admitLocalSource({
        ...base,
        datasetBindings: [{ ...base.datasetBindings[0]!, backendNamespace }],
        datasetMutations: [{ ...metadata, backendNamespace }],
        source: source("expectedAffected={1}"),
      }).ok,
      false,
    );
  }
  for (const flag of [
    "expectedAffected={-1}",
    "expectedAffected={1.5}",
    "expectedAffected={9007199254740992}",
    'expectedAffected="1"',
    "expectedAffected={null}",
    "expectedAffected={+1}",
    "expectedAffected={globalThis.sideEffect()}",
    "expectedAffected={1} expectedAffected={2}",
    "unexpectedFlag={1}",
  ])
    assert.equal(admitLocalSource({ ...base, source: source(flag) }).ok, false);
});


test("native default chart visualizations do not require a Vega result", async () => {
  const {admitLocalSource} = await import("../src/migration/conversion/compiled/source-admission.ts");
  for (const viz of ['"table"', '{{}}', '{{kind:"table"}}']) {
    const result = admitLocalSource({
      source: '<Value name="rows" type="table" value={[{n:1}]}/><Chart data="$rows" viz=' + viz + '/>',
      coreUrl: '/af/v1/core.js',
    });
    assert.ok(result.ok);
    assert.equal(result.plan.chartCount, 1);
    assert.equal(result.plan.vegaCount, 0);
  }
});
