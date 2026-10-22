import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fixture, binding } from "./dataset-runtime-fixture.ts";
import { createSqlDatabase } from "../src/persistence/sql.ts";
import { registerDatasetAttachments } from "../src/persistence/dataset-attachments.ts";
import { createDatasetRuntime } from "../src/server/dataset-runtime.ts";
import { serveDatasetAttachments } from "../src/server/dataset-attachment-http.ts";
import { imageProcessingListener } from "../src/media/image-processing/listener.ts";
import { createImageJobExecutor } from "../src/media/image-processing/executor.ts";
import { remoteImageProcessor } from "../src/media/image-processing/remote.ts";
import { hash } from "../src/server/text.ts";
const exec = promisify(execFile);
const listen = async (server: ReturnType<typeof createServer>) => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
};
const close = (server: ReturnType<typeof createServer>) =>
  new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
test("raw attachment HTTP uploads through isolated remote processing, exact replay and protected reload revoke", async () => {
  const { env } = await fixture();
  const directory = await mkdtemp(join(tmpdir(), "attachment-binary-"));
  const token = "synthetic-attachment-session";
  const secret = "synthetic-image-controller-secret-123456789";
  const controller = imageProcessingListener(
    createImageJobExecutor({ deploymentNamespace: "attproof" }),
    secret,
  );
  const controllerServer = createServer(controller);
  const endpoint = await listen(controllerServer);
  const runtime = createDatasetRuntime({
    database: createSqlDatabase({
      pool: env.pool,
      initialize: async () => {},
      statementTimeoutMs: 15000,
    }),
    attachmentDirectory: directory,
    imageProcessor: remoteImageProcessor({ endpoint, secret }),
    now: () => 100,
  });
  const app = createServer(async (req, res) => {
    const url = new URL(req.url!, "http://127.0.0.1");
    if (
      !(await serveDatasetAttachments(
        req,
        res,
        url,
        runtime.attachments!,
        req.headers.authorization?.replace(/^Bearer /, "") ?? "",
      ))
    )
      res.writeHead(404).end();
  });
  try {
    await env.pool.query(
      "INSERT INTO sessions(token_hash,actor,expires) VALUES($1,'member',9999999999999)",
      [hash(token)],
    );
    await env.pool.query(
      'UPDATE dataset_resources SET snapshot=jsonb_set(jsonb_set(snapshot,\'{visibility}\',\'"public"\'),\'{policy}\',$1::jsonb),access=\'{"visibility":"public","linkRole":"viewer","shares":{},"version":0}\'',
      [
        JSON.stringify({
          version: 2,
          allow: [
            { actions: ["insert", "read"], from: { user: "*", artifact: "*" } },
          ],
        }),
      ],
    );
    await env.pool.query(
      "INSERT INTO dataset_page_joins(page_id,source_namespace,legacy_user_id) VALUES('Pg0001','legacy','old-owner')",
    );
    await createSqlDatabase({
      pool: env.pool,
      initialize: async () => {},
      statementTimeoutMs: 15000,
    }).transaction((client) =>
      registerDatasetAttachments({
        client,
        registrations: [
          {
            backendNamespace: "bridge",
            sourceNamespace: "legacy",
            binding,
            acceptedTypes: ["image/png"],
          },
        ],
      }),
    );
    const resolved = await runtime.attachments!.resolve(
      {
        pageId: "Pg0001",
        backendNamespace: "bridge",
        bindingName: "sales",
        credential: token,
      },
      new AbortController().signal,
    );
    assert.ok(resolved, "fresh context resolves");
    assert.deepEqual(
      await runtime.attachments!.service.availability(resolved),
      { canAttempt: true },
    );
    const origin = await listen(app),
      route = origin + "/api/files/Pg0001/dataset-attachments/bridge/sales";
    const generated = await exec(
      "docker",
      [
        "run",
        "--rm",
        "--network=none",
        "--entrypoint",
        "node",
        "pagegi-image-processor:local",
        "--input-type=module",
        "-e",
        "import sharp from 'sharp'; process.stdout.write(await sharp({create:{width:8,height:8,channels:3,background:'#336699'}}).png().toBuffer());",
      ],
      { encoding: "buffer", maxBuffer: 1_000_000 },
    );
    const body = generated.stdout;
    const headers = {
      authorization: "Bearer " + token,
      "content-type": "image/png",
      "x-filename": "sample.png",
      "idempotency-key": "binary_request_123",
    };
    const uploaded = await fetch(route, { method: "POST", headers, body });
    assert.equal(uploaded.status, 200, await uploaded.clone().text());
    const receipt = (await uploaded.json()) as {
      ref: string;
      url: string;
      contentType: string;
      size: number;
    };
    assert.match(receipt.ref, /^dfile:[a-f0-9]{32}$/);
    const replay = await fetch(route, { method: "POST", headers, body });
    assert.equal(replay.status, 200);
    assert.deepEqual(await replay.json(), { ...receipt, replayed: true });
    assert.equal((await fetch(origin + receipt.url)).status, 404);
    const download = await fetch(origin + receipt.url, {
      headers: { authorization: "Bearer " + token },
    });
    assert.equal(download.status, 200);
    assert.match(download.headers.get("cache-control")!, /no-store/);
    const bytes = Buffer.from(await download.arrayBuffer());
    assert.equal(bytes.length, receipt.size);
    assert.equal(download.headers.get("content-type"), receipt.contentType);
    assert.equal(receipt.contentType, "image/webp");
    assert.equal(bytes.toString("ascii", 0, 4), "RIFF");
    assert.equal(bytes.toString("ascii", 8, 12), "WEBP");
    assert.equal(
      (
        await env.pool.query(
          "SELECT count(*)::int AS count FROM dataset_attachment_completions",
        )
      ).rows[0]!.count,
      1,
    );
    await env.pool.query(
      "UPDATE dataset_resources SET snapshot=jsonb_set(snapshot,'{policy}',$1::jsonb),generation=generation+1",
      [JSON.stringify({ version: 2, allow: [] })],
    );
    const revoked = await fetch(origin + receipt.url, {
      headers: { authorization: "Bearer " + token },
    });
    assert.equal(revoked.status, 404);
    assert.equal(
      (await fetch(route, { method: "POST", headers, body })).status,
      404,
    );
  } finally {
    await close(app);
    await runtime.close();
    await controller.close();
    await close(controllerServer);
    await env.cleanup();
    await rm(directory, { recursive: true, force: true });
  }
});
