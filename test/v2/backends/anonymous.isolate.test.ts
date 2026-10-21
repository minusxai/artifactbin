/**
 * Anonymous viewers reach the real isolate with a null subject and no
 * capability grants. Needs `npm run build:backend`. Brief C.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { BackendFilesModule } from "../../../src/backend/af-backend-contracts.ts";
import { load } from "../support/load.ts";

const WHO = `import { gql } from '@afbin/apollo';
export const typeDefs = gql\`
  type Query { who: String  caps: String }
\`;
export default {
  Query: {
    who: (_args: unknown, principal: { subject: string | null }) => principal.subject,
    async caps(_args: unknown, _principal: unknown, caps: { invoke(request: unknown): Promise<unknown> }) {
      try {
        await caps.invoke({ resource: 'records', operation: 'list', input: null });
        return 'allowed';
      } catch {
        return 'denied';
      }
    },
  },
};
`;

test("an anonymous call runs with a null subject, and its capability calls are refused", async () => {
  const { createBackendFiles } = await load<BackendFilesModule>(
    "src/backend/af-files.ts",
  );
  const { createBackendHost } = await import(
    "../../../src/backend/container-host.ts"
  );
  const { withCapabilityAuthority } = await import(
    "../../../src/backend/capability-authority.ts"
  );
  const handled: unknown[] = [];
  const host = withCapabilityAuthority(createBackendHost({}), {
    host: {
      invoke: async (caller: unknown) => (handled.push(caller), []),
      transaction: async () => [],
      close: async () => {},
    },
    grants: [],
  } as never);
  try {
    const { Anon01: deployment } = await createBackendFiles({ host }).compile({
      Anon01: WHO,
    });
    assert.ok(deployment);
    const principal = { tenant: "Pg4mQ2", subject: null };
    assert.equal(
      await host.invoke({ deployment: deployment, principal: principal, input: { field: "who", args: {} }, env: {}, reuse: { kind: "one-shot" } }),
      null,
    );
    assert.equal(
      await host.invoke({ deployment: deployment, principal: principal, input: { field: "caps", args: {} }, env: {}, reuse: { kind: "one-shot" } }),
      "denied",
    );
    assert.deepEqual(handled, []);
  } finally {
    await host.close();
  }
});
