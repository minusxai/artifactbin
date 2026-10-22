import test from "node:test";
import assert from "node:assert/strict";
import { createServer, request } from "node:http";
import { createExecutionService } from "../src/backend/execution-service.ts";
import { remoteDatasetSqlExecutor } from "../src/backend/dataset-sql-transport.ts";
import type { BackendHost } from "../src/backend/contracts.ts";
const key = "s".repeat(32);
const job = {
  kind: "dataset-sql" as const,
  engineVersion: "sqlite-3.53.4-effect-v1" as const,
  input: {
    table: {
      schema: "main",
      name: "rows",
      columns: [{ name: "value", type: "number" as const }],
      rows: [{ value: 1 }],
    },
    sql: "update rows set value=2",
    params: {},
  },
};
test("same authenticated controller listener admits fixed SQL job without touching backend protocol", async () => {
  let calls = 0;
  const host: BackendHost = {
    async compile() {
      throw Error();
    },
    async invoke() {
      throw Error();
    },
  };
  const service = createExecutionService({
    secret: key,
    host,
    datasetSql: {
      async execute(actual) {
        calls++;
        assert.deepEqual(actual, job);
        return {
          rows: [{ value: 2 }],
          columns: job.input.table.columns,
          affected: 1,
          analysis: { operation: "update", columns: ["value"], functions: [] },
        };
      },
      async close() {},
    },
  });
  const server = createServer(service);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  const remote = remoteDatasetSqlExecutor({
    endpoint: `http://127.0.0.1:${port}/v1/execute`,
    secret: key,
  });
  try {
    const out = await remote.execute(job);
    assert.ok("affected" in out);
    assert.equal(out.affected, 1);
    assert.equal(calls, 1);
    const bad = remoteDatasetSqlExecutor({
      endpoint: `http://127.0.0.1:${port}/v1/execute`,
      secret: "b".repeat(32),
    });
    await assert.rejects(bad.execute(job));
    await bad.close();
    assert.equal(calls, 1);
  } finally {
    await remote.close();
    await service.close();
    await new Promise<void>((r) => server.close(() => r()));
  }
});
test("controller rejects oversized raw frame before execution or JSON parse", async () => {
  let calls = 0;
  const host: BackendHost = {
    async compile() {
      throw Error();
    },
    async invoke() {
      throw Error();
    },
  };
  const service = createExecutionService({
    secret: key,
    host,
    datasetSql: {
      async execute() {
        calls++;
        throw Error();
      },
      async close() {},
    },
  });
  const server = createServer(service);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  try {
    const status = await new Promise<number>((resolve, reject) => {
      const req = request(
        `http://127.0.0.1:${port}/v1/dataset-sql`,
        { method: "POST", headers: { authorization: "Bearer " + key } },
        (res) => {
          res.resume();
          resolve(res.statusCode!);
        },
      );
      req.on("error", reject);
      req.end(" ".repeat(32 * 1024 * 1024 + 1));
    });
    assert.equal(status, 413);
    assert.equal(calls, 0);
  } finally {
    await service.close();
    await new Promise<void>((r) => server.close(() => r()));
  }
});
test("app client caps raw controller output before attempting JSON decode", async () => {
  const server = createServer((_req, res) => {
    res.writeHead(200);
    res.end(" ".repeat(32 * 1024 * 1024 + 1025));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  const remote = remoteDatasetSqlExecutor({
    endpoint: `http://127.0.0.1:${port}/v1/execute`,
    secret: key,
  });
  try {
    await assert.rejects(remote.execute(job), /sql_output_limit/);
  } finally {
    await remote.close();
    await new Promise<void>((r) => server.close(() => r()));
  }
});
test("rejected unfinished chunked input is disposed rather than retaining buffers outside admission", async () => {
  let incoming: import("node:http").IncomingMessage | undefined;
  const service = createExecutionService({
    secret: key,
    host: {
      async compile() {
        throw Error();
      },
      async invoke() {
        throw Error();
      },
    },
    datasetSql: {
      async execute() {
        throw Error();
      },
      async close() {},
    },
  });
  const server = createServer((req, res) => {
    incoming = req;
    service(req, res);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  try {
    await new Promise<void>((resolve, reject) => {
      const req = request(
        `http://127.0.0.1:${port}/v1/dataset-sql`,
        { method: "POST", headers: { authorization: "Bearer " + key } },
        (res) => {
          assert.equal(res.statusCode, 413);
          res.resume();
          res.once("end", resolve);
        },
      );
      req.once("error", reject);
      req.write(" ".repeat(32 * 1024 * 1024 + 1));
    });
    if (!incoming!.destroyed)
      await new Promise<void>((r) => incoming!.once("close", r));
    assert.equal(incoming!.complete, false);
    assert.equal(incoming!.destroyed, true);
  } finally {
    await service.close();
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  }
});
test("controller shutdown aborts SQL immediately while generic backend cleanup remains held", async () => {
  const { remoteBackendHost } = await import(
    "../src/backend/execution-service.ts"
  );
  let genericStarted!: () => void,
    sqlStarted!: () => void,
    sqlAborted!: () => void,
    releaseGeneric!: () => void;
  const genericReady = new Promise<void>((r) => {
      genericStarted = r;
    }),
    sqlReady = new Promise<void>((r) => {
      sqlStarted = r;
    }),
    sqlAbort = new Promise<void>((r) => {
      sqlAborted = r;
    });
  const service = createExecutionService({
    secret: key,
    host: {
      async compile() {
        genericStarted();
        return new Promise((_resolve, reject) => {
          releaseGeneric = () => reject(Error("stopped"));
        });
      },
      async invoke() {
        throw Error();
      },
    },
    datasetSql: {
      async execute(_job, signal) {
        sqlStarted();
        return new Promise((_resolve, reject) =>
          signal!.addEventListener(
            "abort",
            () => {
              sqlAborted();
              reject(Error("cancelled"));
            },
            { once: true },
          ),
        );
      },
      async close() {},
    },
  });
  const server = createServer(service);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port,
    endpoint = `http://127.0.0.1:${port}/v1/execute`;
  const backend = remoteBackendHost({ endpoint, secret: key }),
    sql = remoteDatasetSqlExecutor({ endpoint, secret: key });
  const generic = backend.compile("source").catch(() => {}),
    running = sql.execute(job).catch(() => {});
  try {
    await Promise.all([genericReady, sqlReady]);
    let closed = false;
    const closing = service.close().then(() => {
      closed = true;
    });
    await Promise.race([
      sqlAbort,
      new Promise((_, reject) =>
        setTimeout(
          () => reject(Error("SQL abort delayed by backend drain")),
          500,
        ),
      ),
    ]);
    assert.equal(closed, false);
    releaseGeneric();
    await closing;
    await Promise.all([generic, running]);
  } finally {
    releaseGeneric?.();
    await backend.close();
    await sql.close();
    await service.close();
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  }
});
