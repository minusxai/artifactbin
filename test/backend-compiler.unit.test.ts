import test from "node:test";
import assert from "node:assert/strict";
import { compileBackend } from "../src/backend/compiler.ts";
import {
  BACKEND_RUNTIME,
  verifyDeployment,
} from "../src/backend/deployment.ts";
import type {
  CompileResult,
  SandboxCompilePort,
} from "../src/backend/compiler-contracts.ts";
const reply: CompileResult = {
  bundle: "bundle",
  runtime: BACKEND_RUNTIME,
  metadata: {
    typeDefs: "type Query { n: Int }",
    fields: ["n"],
    roots: { Query: ["n"], Mutation: [] },
  },
};
test("compiler forwards its typed sandbox request and seals a verified deployment", async () => {
  const signal = new AbortController().signal;
  const run: SandboxCompilePort = async (request, receivedSignal) => {
    assert.deepEqual(request, {
      kind: "compile",
      source: "source",
      packages: {},
      modules: {},
    });
    assert.equal(receivedSignal, signal);
    return reply;
  };
  const compiled = await compileBackend("source", run, signal);
  verifyDeployment(compiled);
  assert.equal(compiled.runtime, BACKEND_RUNTIME);
});
test("compiler rejects iterable root impostors rather than accepting a schema-shaped string", async () => {
  await assert.rejects(
    compileBackend("source", async () => ({
      ...reply,
      metadata: { ...reply.metadata, roots: { Query: "n", Mutation: [] } },
    })),
    /schema_rejected/,
  );
});
test("compiler preserves source, build and schema error classifications", async () => {
  await assert.rejects(
    compileBackend("x".repeat(262145), async () => reply),
    /source_quota/,
  );
  for (const value of [null, {}, { bundle: 1 }])
    await assert.rejects(
      compileBackend("source", async () => value),
      /build_rejected/,
    );
  for (const value of [
    { bundle: reply.bundle, metadata: reply.metadata },
    { ...reply, metadata: null },
    { ...reply, metadata: { ...reply.metadata, fields: [1] } },
    {
      ...reply,
      metadata: {
        ...reply.metadata,
        roots: { Query: ["missing"], Mutation: [] },
      },
    },
    { ...reply, runtime: "wrong-generation" },
    { ...reply, bundle: "x".repeat(1048577) },
  ])
    await assert.rejects(
      compileBackend("source", async () => value),
      /schema_rejected/,
    );
});

test("compiler never executes accessors in untrusted metadata", async () => {
  let reads = 0;
  const metadata = Object.defineProperty({}, "typeDefs", {
    enumerable: true,
    get() {
      reads++;
      return reply.metadata.typeDefs;
    },
  });
  await assert.rejects(
    compileBackend("source", async () => ({ ...reply, metadata })),
    /schema_rejected/,
  );
  assert.equal(reads, 0);
});
