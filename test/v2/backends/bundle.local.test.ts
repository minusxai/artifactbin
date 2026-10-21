/**
 * The sandbox's bundler and import gate (src/backend/container/bundle.mjs),
 * run here with the repository's esbuild: a backend file and the npm modules
 * the host fetched become one module whose only imports are built-ins.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { bundleBackend, checkImports } from "../../../src/backend/container/bundle.mjs";

const PKG = "https://esm.sh/db@1.2.3?target=esnext&bundle&conditions=workerd";
const WIRE = "https://esm.sh/db-wire?target=esnext";
const modules = {
  [PKG]: {
    url: "https://esm.sh/db@1.2.3/X-workerd/esnext/db.bundle.mjs",
    code: 'import { wire } from "/db-wire?target=esnext";\nimport { Buffer } from "node:buffer";\nexport const open = async () => { const { connect } = await import("/cloudflare:sockets?conditions=workerd&target=esnext"); return [wire, typeof connect, Buffer.name]; };',
  },
  [WIRE]: { url: "https://esm.sh/db-wire@0.4.0/esnext/db-wire.mjs", code: "export const wire = 'wire';" },
};
const SOURCE = `import { gql } from '@afbin/apollo';
import { open } from 'db@1.2.3';
import { createHash } from 'node:crypto';
export const typeDefs = gql\`type Query { n: Int }\`;
export default { Query: { n: async () => (await open()).length + createHash('sha256').digest().length } };`;

test("a file with npm packages bundles into one module that imports only built-ins", async () => {
  const bundle: string = await bundleBackend({ source: SOURCE, packages: { "db@1.2.3": PKG }, modules });
  assert.match(bundle, /wire = "wire"/);
  assert.match(bundle, /import\("cloudflare:sockets"\)/);
  const imports = [...bundle.matchAll(/(?:from|import\()\s*"([^"]+)"/g)].map((m) => m[1]).sort();
  assert.deepEqual(imports, ["cloudflare:sockets", "node:buffer", "node:crypto"]);
});

test("an import the host did not fetch is refused", async () => {
  await assert.rejects(bundleBackend({ source: SOURCE }));
  await assert.rejects(bundleBackend({ source: "import x from './helper';\nexport default x;" }));
  const missing = { [PKG]: modules[PKG]! };
  await assert.rejects(bundleBackend({ source: SOURCE, packages: { "db@1.2.3": PKG }, modules: missing }));
});

test("the gate lets a bundle import built-ins by name only", () => {
  for (const ok of ['import "node:buffer";', 'export * from "cloudflare:sockets";', 'const s = () => import("cloudflare:sockets");'])
    assert.doesNotThrow(() => checkImports(ok), ok);
  for (const bad of ['import "./x.js";', 'import "https://esm.sh/x";', "const f = (n) => import(n);", 'export { a } from "x";', 'import("node:" + "fs");'])
    assert.throws(() => checkImports(bad), /Imports unavailable/, bad);
});
