/**
 * Backend files compiled and run by the existing isolated Docker host.
 * Needs `npm run build:backend` (the isolate stage does it). Brief C.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { BackendFilesModule } from "../../../src/backend/af-backend-contracts.ts";
import { verifyDeployment } from "../../../src/backend/deployment.ts";
import { load } from "../support/load.ts";

const PROBE = `import { gql } from '@afbin/apollo';

export const typeDefs = gql\`
  type Probe { subject: String  tenant: String!  hasCaps: Boolean!  fresh: Int! }
  type Query { probe: Probe! }
\`;

let calls = 0;

export default {
  Query: {
    probe(_args, principal, caps) {
      calls++;
      return {
        subject: principal.subject,
        tenant: principal.tenant,
        hasCaps: typeof caps.invoke === "function" && typeof caps.transaction === "function",
        fresh: calls,
      };
    },
  },
};
`;

test("an export-default backend with a gql import compiles and runs; the sandbox stays warm for the next call", async () => {
  const { createBackendFiles } = await load<BackendFilesModule>("src/backend/af-files.ts");
  const { createBackendHost } = await import("../../../src/backend/container-host.ts");
  const host = createBackendHost({});
  try {
    const files = createBackendFiles({ host });
    const compiled = await files.compile({ Pr0be1: PROBE });
    const deployment = compiled.Pr0be1!;
    assert.match(deployment.typeDefs, /type Probe/);
    for (let i = 0; i < 2; i++) {
      const value = await host.invoke({ deployment: deployment, principal: { tenant: "Pg4mQ2", subject: "ann@example.test" }, input: { field: "probe", args: {} }, env: {}, reuse: { kind: "file", scope: { owner: "ann@example.test", fileId: "Pr0be1" } } });
      // The second call lands in the same warm sandbox, so the module counter carries over.
      assert.deepEqual(value, { subject: "ann@example.test", tenant: "Pg4mQ2", hasCaps: true, fresh: i + 1 });
    }
  } finally {
    await host.close?.();
  }
});

test("a backend compiled before the executor image was rebuilt still runs on the current image", async () => {
  const { createBackendFiles } = await load<BackendFilesModule>("src/backend/af-files.ts");
  const { createBackendHost } = await import("../../../src/backend/container-host.ts");
  const host = createBackendHost({});
  try {
    const compiled = (await createBackendFiles({ host }).compile({ Pr0be2: PROBE })).Pr0be2!;
    const recorded = /\/image:(sha256:[a-f0-9]{64})$/.exec(compiled.runtime)?.[1];
    assert.ok(recorded, "the compile records the image it ran on");
    // The image that compiled it is gone: no local image has this ID.
    const stale = { ...compiled, runtime: compiled.runtime.replace(recorded, "sha256:" + "0".repeat(64)) };
    // The version does not name the image, so the stale record still verifies.
    assert.doesNotThrow(() => verifyDeployment(stale));
    const value = await host.invoke({ deployment: stale, principal: { tenant: "Pg4mQ2", subject: null }, input: { field: "probe", args: {} }, env: {}, reuse: { kind: "one-shot" } });
    assert.deepEqual(value, { subject: null, tenant: "Pg4mQ2", hasCaps: true, fresh: 1 });
  } finally {
    await host.close?.();
  }
});

test("imports other than @afbin/apollo, pinned npm packages and built-ins are refused at compile time", async () => {
  const { createBackendFiles } = await load<BackendFilesModule>("src/backend/af-files.ts");
  const { createBackendHost } = await import("../../../src/backend/container-host.ts");
  const host = createBackendHost({});
  try {
    const files = createBackendFiles({ host });
    for (const specifier of ["./helper", "https://example.com/x.js", "pg"])
      await assert.rejects(
        files.compile({ Bad000: `import x from '${specifier}';\nexport const typeDefs = 'type Query { n: Int }';\nexport default { Query: { n: () => x } };\n` }),
        { problem: "import-not-allowed" },
      );
  } finally {
    await host.close?.();
  }
});
