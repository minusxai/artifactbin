import test from "node:test";
import assert from "node:assert/strict";
import {
  inspectSources,
  checkBoundaries,
  checkBuiltApp,
  productPolicy,
  readSources,
} from "../scripts/check-boundaries.ts";

test("isolated runner cannot import host storage/connection adapters, including through emitted bundles", () => {
  const sources = {
    "src/browser/runner.js": 'export { host } from "./connection-coordinator.ts";',
    "src/browser/runtime.js": 'export { host } from "./connection-coordinator.ts";',
    "src/browser/connection-coordinator.ts": 'export const host = 1;',
  };
  const failures = checkBoundaries(inspectSources(sources));
  assert.equal(failures.length, 1);
  assert.equal(failures[0]?.path[0], "src/browser/runner.js");
  assert.equal(failures[0]?.rule, "app-authority");
  const bundle = { inputs: {
    "src/browser/runner.js": { imports: [{ path: "src/browser/connection-coordinator.ts" }] },
    "src/browser/connection-coordinator.ts": { imports: [] },
  }};
  assert.equal(checkBuiltApp(bundle, "src/browser/runner.js").length, 1);
});

test("pure policies may compose pure modules and approved parsers, without pinning filenames", () => {
  const sources = {
    "src/domain/comments.ts":
      'import { copy } from "../json.js"; export const accept = copy;',
    "src/json.ts":
      "export const copy = (value: unknown) => structuredClone(value);",
    "src/page/codec.js":
      'import { parse } from "parse5"; export const decode = parse;',
  };
  assert.deepEqual(checkBoundaries(inspectSources(sources), productPolicy), []);
});

test("a pure policy cannot hide I/O behind a local adapter or a type-only back-reference", () => {
  const sources = {
    "src/domain/comments.ts": 'export { load } from "../io.js";',
    "src/io.js":
      'import { readFile } from "node:fs/promises"; export const load = readFile;',
    "src/domain/other.ts":
      'import type { Row } from "../database.js"; export type Value = Row;',
    "src/database.js": "export class Row {}",
  };
  const failures = checkBoundaries(inspectSources(sources), productPolicy);
  assert.ok(
    failures.some(
      (v) =>
        v.rule === "pure-dependency" &&
        v.path.join(" → ").includes("src/io.js"),
    ),
  );
  assert.ok(
    failures.some(
      (v) => v.rule === "pure-dependency" && v.path.includes("src/database.js"),
    ),
  );
});

test("ambient I/O is rejected while an injected port and ordinary property names are allowed", () => {
  const sources = {
    "src/domain/bad.ts":
      'export const read = () => globalThis.fetch("/"); export const env = () => process.env;',
    "src/domain/injected.ts":
      'export function run(fetch: (s:string)=>unknown, document: {body:string}) { return fetch(document.body); } export const metadata = {window: "label"};',
  };
  const failures = checkBoundaries(inspectSources(sources), productPolicy);
  assert.ok(
    failures.some(
      (v) => v.rule === "pure-effect" && v.path[0] === "src/domain/bad.ts",
    ),
  );
  assert.ok(!failures.some((v) => v.path[0] === "src/domain/injected.ts"));
});

test("pure policies take time, identity and scheduling from explicit inputs", () => {
  const sources = {
    "src/domain/implicit.ts":
      "export const now=()=>Date.now(); export const id=()=>crypto.randomUUID(); export const later=()=>setTimeout(()=>{},1);",
    "src/domain/explicit.ts":
      "export const time=(now:number)=>new Date(now).toISOString(); export const id=(random:()=>string)=>random();",
  };
  const failures = checkBoundaries(inspectSources(sources));
  for (const effect of ["Date.now", "crypto.randomUUID", "setTimeout"])
    assert.ok(
      failures.some(
        (v) => v.rule === "pure-effect" && v.path.at(-1) === effect,
      ),
    );
  assert.ok(!failures.some((v) => v.path[0] === "src/domain/explicit.ts"));
});

test("untrusted entry closure rejects credential and server code through reexports and dynamic imports", () => {
  const sources = {
    "src/browser/runtime.js":
      'export { secret } from "./proxy.js"; import("../backend/host.js");',
    "src/browser/proxy.js": 'export { secret } from "./platform-frame.ts";',
    "src/browser/platform-frame.ts": "export const secret = 'fixture';",
    "src/backend/host.js":
      'import { spawn } from "node:child_process"; export { spawn };',
  };
  const failures = checkBoundaries(inspectSources(sources), productPolicy);
  assert.ok(
    failures.some(
      (v) =>
        v.rule === "app-authority" &&
        v.path.at(-1) === "src/browser/platform-frame.ts",
    ),
  );
  assert.ok(
    failures.some(
      (v) =>
        v.rule === "app-authority" && v.path.includes("src/backend/host.js"),
    ),
  );
});

test("a credential-free proxy is allowed; erased protocol type imports do not enter an app bundle", () => {
  const sources = {
    "src/browser/runtime.js": 'export { connect } from "./platform-client.ts";',
    "src/browser/platform-client.ts":
      'import type { Message } from "./platform-frame.ts"; export const connect = (message: Message) => message;',
    "src/browser/platform-frame.ts":
      'import pg from "pg"; export type Message = {kind:string};',
  };
  assert.deepEqual(checkBoundaries(inspectSources(sources), productPolicy), []);
});

test("cycles, unresolved imports and opaque loaders cannot evade the graph", () => {
  const sources = {
    "src/domain/a.ts": 'export * from "./b.js"; import("./missing.js");',
    "src/domain/b.ts":
      'export * from "./a.js"; const name="pg"; export const load=()=>import(name);',
  };
  const rules = new Set(
    checkBoundaries(inspectSources(sources), productPolicy).map((v) => v.rule),
  );
  for (const rule of ["cycle", "unresolved-import", "opaque-load"])
    assert.ok(rules.has(rule as never));
});

test("CommonJS and type-query syntax cannot bypass dependency classification", () => {
  const sources = {
    "src/domain/a.ts":
      'const fs = require("node:fs"); type Db = import("../database.js").Db; export { fs };',
    "src/database.js": "export class Db {}",
  };
  const failures = checkBoundaries(inspectSources(sources), productPolicy);
  assert.ok(
    failures.some(
      (v) => v.rule === "pure-dependency" && v.path.includes("node:fs"),
    ),
  );
  assert.ok(
    failures.some(
      (v) => v.rule === "pure-dependency" && v.path.includes("src/database.js"),
    ),
  );
});

test("the emitted app closure also checks third-party transitive authority", () => {
  const inputs = {
    "src/browser/runtime.js": {
      imports: [{ path: "node_modules/wrapper/index.js" }],
    },
    "node_modules/wrapper/index.js": {
      imports: [
        { path: "node_modules/pg/lib/index.js" },
        { path: "node:fs", external: true },
      ],
    },
    "node_modules/pg/lib/index.js": { imports: [] },
    "src/browser/platform-frame.ts": { imports: [] },
  };
  const failures = checkBuiltApp({ inputs }, "src/browser/runtime.js");
  assert.ok(
    failures.some((v) => v.path.includes("node_modules/pg/lib/index.js")),
  );
  assert.ok(failures.some((v) => v.path.includes("node:fs")));
  assert.ok(
    !failures.some((v) => v.path.includes("src/browser/platform-frame.ts")),
    "an unrelated trusted entry is not in this app closure",
  );
  assert.deepEqual(
    checkBuiltApp(
      {
        inputs: {
          "src/browser/runtime.js": {
            imports: [{ path: "node_modules/parse5/index.js" }],
          },
          "node_modules/parse5/index.js": { imports: [] },
        },
      },
      "src/browser/runtime.js",
    ),
    [],
  );
});

test("shipping sources satisfy the architectural role policy", async () => {
  const failures = checkBoundaries(
    inspectSources(await readSources(process.cwd())),
    productPolicy,
  );
  assert.deepEqual(failures, [], failures.map((v) => v.message).join("\n"));
});

test("backend grant implementation is privileged and guest injection is recognized only at its compiler binding", () => {
  const guest = "src/backend/container/entry.mjs";
  assert.deepEqual(
    checkBoundaries(
      inspectSources({
        [guest]:
          'import * as backend from "./backend.js"; export default backend;',
      }),
    ),
    [],
  );
  const wrong = checkBoundaries(
    inspectSources({
      "src/backend/container/other.mjs": 'import backend from "./backend.js";',
    }),
  );
  assert.ok(wrong.some((v) => v.rule === "unresolved-import"));
  const sources = {
    "src/browser/runner.js": 'import "./relay.js";',
    "src/browser/relay.js": 'export * from "./platform-frame.ts";',
    "src/browser/platform-frame.ts":
      'export const credential = "not a real credential";',
  };
  assert.ok(
    checkBoundaries(inspectSources(sources)).some(
      (v) =>
        v.rule === "app-authority" &&
        v.path.includes("src/browser/platform-frame.ts"),
    ),
  );
  const reachesGuest = {
    "src/browser/runner.js": 'import "../backend/container/entry.mjs";',
    [guest]: 'import * as backend from "./backend.js";',
  };
  assert.ok(
    checkBoundaries(inspectSources(reachesGuest)).some(
      (v) => v.rule === "app-authority",
    ),
  );
});

test("trusted connection and private pairing exchange cannot enter local app code", () => {
  for (const name of ["trusted-connection", "pairing-exchange"]) {
    const id = `src/browser/${name}.ts`;
    const sources = {
      "src/browser/runtime.js": 'import "./relay.js";',
      "src/browser/relay.js": `export * from "./${name}.ts";`,
      [id]: "export const connect = () => null;",
    };
    assert.ok(
      checkBoundaries(inspectSources(sources)).some(
        (v) => v.rule === "app-authority" && v.path.includes(id),
      ),
    );
    assert.ok(
      checkBuiltApp(
        {
          inputs: {
            "src/browser/runtime.js": { imports: [{ path: id }] },
            [id]: { imports: [] },
          },
        },
        "src/browser/runtime.js",
      ).some((v) => v.rule === "app-authority"),
    );
  }
});
