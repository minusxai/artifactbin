import test from "node:test";
import assert from "node:assert/strict";
import { compileNativeProgramResolver } from "../src/migration/programs/native-compiler.ts";
import { createBackendHost } from "../src/backend/container-host.ts";
import { invokeProgramResolver } from "../src/programs/service.ts";
const definition = (code: string) =>
  JSON.stringify({
    version: 1,
    command: ["node", "-e", code],
    compute: { vcpu: 1, memoryMiB: 2048, ttlSeconds: 60 },
  });
test("native straight-line conversion preserves stdout, JSON environment input and exit termination in a real isolate", async () => {
  const host = createBackendHost({ sandboxNetwork: "none" });
  try {
    for (const [code, expected] of [
      [
        "console.log('hello');console.log(process.env.ARTIFACTBIN_INPUT)",
        { stdout: 'hello\n{"text":"λ"}\n', stderr: "", exitCode: 0 },
      ],
      [
        "process.exit(137);console.log('unreachable')",
        { stdout: "", stderr: "", exitCode: 137 },
      ],
      [
        "console.log('done');process.exit(0)",
        { stdout: "done\n", stderr: "", exitCode: 0 },
      ],
    ] as const) {
      const prepared = await compileNativeProgramResolver(definition(code));
      assert.equal(
        prepared.computeCompatibility,
        "original-reservation-not-provided",
      );
      const backend = await host.compile(prepared.resolver.source);
      const manifest = { values: [], queries: [], mutations: [], defaults: {} };
      const result = await invokeProgramResolver(
        host,
        { backend, manifest, scriptSha256: prepared.resolver.scriptSha256 },
        {
          principal: { tenant: "native", subject: "owner" },
          requestId: "execution",
          transport: {
            authorize: async () => {},
            query: async () => {
              throw Error("unexpected");
            },
            mutate: async () => {
              throw Error("unexpected");
            },
          },
        },
        { text: "λ" },
      );
      assert.deepEqual(result, expected);
    }
  } finally {
    await host.close?.();
  }
});
test("native conversion refuses timers, filesystem, ambient environment, dynamic code and altered argv", async () => {
  for (const code of [
    "setTimeout(()=>{},30000)",
    "require('fs')",
    "console.log(process.env.SECRET)",
    "console.log({})",
    "process['exit'](0)",
    "console.log.constructor('return process')()",
    "process.exit(256)",
  ]) {
    await assert.rejects(compileNativeProgramResolver(definition(code)));
  }
  const source = definition("console.log('ok')");
  const altered = JSON.parse(source);
  altered.command[0] = "bash";
  await assert.rejects(compileNativeProgramResolver(JSON.stringify(altered)));
  const first = await compileNativeProgramResolver(source),
    second = await compileNativeProgramResolver(source);
  assert.deepEqual(first, second);
});
