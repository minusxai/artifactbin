import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { testDatabase } from "./postgres.js";
import { createBackendHost } from "../src/backend/container-host.ts";
import {
  createExecutionService,
  remoteBackendHost,
} from "../src/backend/execution-service.ts";
import { withCapabilityAuthority } from "../src/backend/capability-authority.ts";
import { configureResources } from "../src/connectors/config.ts";
import { BACKEND_RUNTIME } from "../src/backend/deployment.ts";
import type { BackendJson } from "../src/backend/contracts.ts";

const source = `
export const typeDefs = 'type Query { put: String list: String forbidden: String transaction: String http: String lost: String slow: String raw: Boolean secrets: String forgeCaller: String }';
export default {Query:{
 put:(args,principal,caps)=>caps.invoke({resource:'db',operation:'put',input:args}),
 list:(args,principal,caps)=>caps.invoke({resource:'db',operation:'list',input:args}),
 forbidden:(args,principal,caps)=>caps.invoke({resource:'db',operation:'all',input:null}),
 transaction:(args,principal,caps)=>caps.transaction('db',[
  {operation:'put',input:{id:'rollback',value:'first'}},
  {operation:'put',input:{id:'one',value:'duplicate'}},
 ]),
 http:(args,principal,caps)=>caps.invoke({resource:'api',operation:'echo',input:args}),
 lost:(args,principal,caps)=>caps.invoke({resource:'api',operation:'lost',input:args}),
 slow:(args,principal,caps)=>caps.invoke({resource:'api',operation:'slow',input:args}),
 raw:async(args)=>{try{await fetch(args.url);return false;}catch{return true;}},
 secrets:(args,principal,caps)=>({ambient:typeof process==='undefined'?null:process.env?.PAGEGI_CONNECTOR_E2E_PRIVATE??null,hostToken:typeof process==='undefined'?null:process.env?.TEST_TOKEN??null,executionSecret:typeof process==='undefined'?null:process.env?.PAGEGI_EXECUTION_SECRET??null,principal:Object.keys(principal).sort(),caps:Object.keys(caps).sort(),dataset:Object.keys(caps.dataset).sort(),env:typeof env}),
 forgeCaller:(args,principal,caps)=>caps.invoke({resource:'api',operation:'echo',input:null,caller:{tenant:'tenant-a',subject:'owner',grants:['api']}}),
}};
`;

test(
  "compiled workerd traverses Unix execution service and exact app authority to real connectors",
  { timeout: 180000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "pagegi-cap-e2e-"));
    const socketPath = join(directory, "execution.sock");
    const db = await testDatabase();
    let lostRequests = 0,
      rawRequests = 0;
    let slowStarted!: () => void, slowClosed!: () => void;
    const started = new Promise<void>((r) => {
      slowStarted = r;
    });
    const closed = new Promise<void>((r) => {
      slowClosed = r;
    });
    const seen: unknown[] = [];
    const http = createServer(async (req, res) => {
      let text = "";
      for await (const chunk of req) text += chunk;
      const body = JSON.parse(text || "null");
      if (req.url === "/raw") {
        rawRequests++;
        res.end("{}");
        return;
      }
      if (req.url === "/lost") {
        lostRequests++;
        req.socket.destroy();
        return;
      }
      if (req.url === "/slow") {
        res.on("close", slowClosed);
        slowStarted();
        return;
      }
      seen.push({ authorization: req.headers.authorization, body });
      res.end(JSON.stringify(body));
    });
    http.listen(0, "127.0.0.1");
    await once(http, "listening");
    const origin = `http://127.0.0.1:${(http.address() as { port: number }).port}`;
    const secret = "execution-test-only-".repeat(3);
    const previousSecret = process.env.PAGEGI_CONNECTOR_E2E_PRIVATE;
    process.env.PAGEGI_CONNECTOR_E2E_PRIVATE =
      "host-ambient-private-test-value";
    const local = createBackendHost({ invokeTimeoutMs: 10000 });
    const service = createServer(
      createExecutionService({ host: local, secret, deadlineMs: 20000 }),
    );
    await new Promise<void>((r) => service.listen(socketPath, r));
    const remote = remoteBackendHost({ socketPath, secret, deadlineMs: 20000 });
    let app: ReturnType<typeof withCapabilityAuthority> | undefined;
    try {
      await db.pool.query(
        "CREATE TABLE items (tenant text,id text,value text,PRIMARY KEY(tenant,id))",
      );
      const deployment = await remote.compile(source);
      assert.equal(deployment.runtime.slice(0, BACKEND_RUNTIME.length), BACKEND_RUNTIME);
      assert.match(deployment.runtime.slice(BACKEND_RUNTIME.length), /^\/image:sha256:[a-f0-9]{64}$/);
      const connection = new URL(db.connectionString);
      connection.searchParams.set(
        "options",
        `-c search_path=${db.schema},public`,
      );
      const configured = configureResources(
        {
          resources: {
            db: {
              kind: "postgres",
              connectionStringEnv: "TEST_DATABASE",
              operations: {
                put: {
                  text: "INSERT INTO items VALUES ($1,$2,$3) RETURNING id",
                  params: [
                    { from: "tenant" },
                    { from: "input", path: ["id"] },
                    { from: "input", path: ["value"] },
                  ],
                },
                list: {
                  text: "SELECT id,value FROM items WHERE tenant=$1 ORDER BY id",
                  params: [{ from: "tenant" }],
                },
                all: { text: "SELECT * FROM items", params: [] },
              },
            },
            api: {
              kind: "http",
              origin,
              tokenEnv: "TEST_TOKEN",
              operations: {
                echo: { path: "/echo", method: "POST" },
                lost: { path: "/lost", method: "POST" },
                slow: { path: "/slow", method: "POST" },
              },
            },
          },
          grants: ["tenant-a", "tenant-b"].flatMap((documentId) => [
            {
              documentId,
              backendVersion: deployment.version,
              resource: "db",
              namedOperations: ["put", "list"],
            },
            {
              documentId,
              backendVersion: deployment.version,
              resource: "api",
              namedOperations: ["echo", "lost", "slow"],
            },
          ]),
        },
        {
          allowLoopbackHttp: true,
          env: {
            TEST_DATABASE: connection.href,
            TEST_TOKEN: "host-secret-not-for-isolate",
          },
        },
      );
      app = withCapabilityAuthority(remote, configured);
      const invoke = (
        tenant: string,
        field: string,
        args: BackendJson = null,
        signal?: AbortSignal,
      ) =>
        app!.invoke(
          { deployment: deployment, principal: { tenant, subject: "user" }, input: { field, args }, signal: signal, env: {}, reuse: { kind: "one-shot" } },
        );
      const injection = "'; DROP TABLE items; --";
      assert.deepEqual(
        await invoke("tenant-a", "put", {
          id: "one",
          value: injection,
          tenant: "tenant-b",
        }),
        [{ id: "one" }],
      );
      assert.deepEqual(await invoke("tenant-b", "list"), []);
      assert.deepEqual(
        await invoke("tenant-b", "put", { id: "one", value: "second" }),
        [{ id: "one" }],
      );
      assert.deepEqual(
        await invoke("tenant-a", "list", { tenant: "tenant-b" }),
        [{ id: "one", value: injection }],
      );
      assert.deepEqual(await invoke("tenant-b", "list"), [
        { id: "one", value: "second" },
      ]);
      assert.equal((await db.pool.query("SELECT * FROM items")).rows.length, 2);
      await assert.rejects(invoke("tenant-a", "transaction"), {
        code: "backend_rejected",
      });
      assert.deepEqual(await invoke("tenant-a", "list"), [
        { id: "one", value: injection },
      ]);
      await assert.rejects(invoke("tenant-a", "forbidden"), {
        code: "backend_rejected",
      });
      await assert.rejects(invoke("tenant-c", "http"), {
        code: "backend_rejected",
      });
      const different = await remote.compile(
        source + "\n// different deployment",
      );
      await assert.rejects(
        app.invoke(
          { deployment: different, principal: { tenant: "tenant-a", subject: "user" }, input: { field: "http", args: null }, env: {}, reuse: { kind: "one-shot" } },
        ),
        { code: "backend_rejected" },
      );
      await assert.rejects(invoke("tenant-b", "forgeCaller"), {
        code: "backend_rejected",
      });
      assert.equal(seen.length, 0);
      assert.deepEqual(
        await invoke("tenant-b", "http", {
          tenant: "tenant-a",
          subject: "owner",
        }),
        {
          caller: { tenant: "tenant-b", subject: "user" },
          input: { tenant: "tenant-a", subject: "owner" },
        },
      );
      assert.deepEqual(seen, [
        {
          authorization: "Bearer host-secret-not-for-isolate",
          body: {
            caller: { tenant: "tenant-b", subject: "user" },
            input: { tenant: "tenant-a", subject: "owner" },
          },
        },
      ]);
      assert.equal(
        await invoke("tenant-a", "raw", { url: origin + "/raw" }),
        true,
      );
      assert.equal(rawRequests, 0);
      const isolation = await invoke("tenant-a", "secrets");
      assert.deepEqual(isolation, {
        ambient: null,
        hostToken: null,
        executionSecret: null,
        principal: ["subject", "tenant"],
        caps: ["dataset", "invoke", "store", "transaction"],
        dataset: ["members", "mutate", "mutationAvailability", "person", "read", "viewer"],
        env: "undefined",
      });
      assert.equal(JSON.stringify(isolation).includes("host-secret"), false);
      await assert.rejects(invoke("tenant-a", "lost"), {
        code: "backend_rejected",
      });
      assert.equal(
        lostRequests,
        1,
        "accepted request with lost response must never be retried",
      );
      const controller = new AbortController();
      const pending = invoke("tenant-a", "slow", null, controller.signal);
      await started;
      controller.abort();
      await assert.rejects(pending, { code: "cancelled" });
      let cancellationTimer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          closed,
          new Promise((_, reject) => {
            cancellationTimer = setTimeout(
              () => reject(Error("connector request was not cancelled")),
              2000,
            );
          }),
        ]);
      } finally {
        clearTimeout(cancellationTimer);
      }
      assert.deepEqual(await invoke("tenant-a", "list"), [
        { id: "one", value: injection },
      ]);
    } finally {
      if (previousSecret === undefined)
        delete process.env.PAGEGI_CONNECTOR_E2E_PRIVATE;
      else process.env.PAGEGI_CONNECTOR_E2E_PRIVATE = previousSecret;
      await app?.close();
      service.closeAllConnections();
      await new Promise<void>((r) => service.close(() => r()));
      http.closeAllConnections();
      await new Promise<void>((r) => http.close(() => r()));
      await db.cleanup();
      await rm(directory, { recursive: true, force: true });
    }
  },
);
