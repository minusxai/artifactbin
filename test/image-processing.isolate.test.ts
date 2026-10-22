import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createServer } from "node:http";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { imageProcessingListener } from "../src/media/image-processing/listener.ts";
import { createImageJobExecutor } from "../src/media/image-processing/executor.ts";
import { remoteImageProcessor } from "../src/media/image-processing/remote.ts";
const exec = promisify(execFile),
  namespace = "imageproof",
  image = "pagegi-image-processor:local";
// Trusted, deterministic synthetic fixtures are generated inside the image, never by an app-native decoder.
const fixturesCode = `import sharp from 'sharp'; const out={};
for(const type of ['png','jpeg','webp'])out[type]=(await sharp({create:{width:3000,height:1000,channels:3,background:'#336699'}})[type]().toBuffer()).toString('base64');
out.pixel=(await sharp({create:{width:5000,height:4000,channels:3,background:'#336699'}}).png().toBuffer()).toString('base64');
out.animated=(await sharp(Buffer.concat([Buffer.alloc(4*4*3,50),Buffer.alloc(4*4*3,200)]),{raw:{width:4,height:8,channels:3,pageHeight:4}}).webp({loop:0}).toBuffer()).toString('base64');
out.frameBudget=(await sharp(Buffer.concat(Array.from({length:6},(_,i)=>Buffer.alloc(3000*1000*3,20+i*30))),{raw:{width:3000,height:6000,channels:3,pageHeight:1000}}).webp({loop:0}).toBuffer()).toString('base64');
console.log(JSON.stringify(out));`;
test("real isolated image processing preserves frozen selection and refuses pixel overflow with clean containers", async () => {
  const generated = await exec(
    "docker",
    [
      "run",
      "--rm",
      "--network=none",
      "--memory=512m",
      "--entrypoint",
      "node",
      image,
      "--input-type=module",
      "-e",
      fixturesCode,
    ],
    { maxBuffer: 5_000_000 },
  );
  const fixtures = JSON.parse(generated.stdout);
  const secret = "image-native-proof-secret-1234567890",
    listener = imageProcessingListener(
      createImageJobExecutor({ deploymentNamespace: namespace }),
      secret,
    ),
    server = createServer(listener);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const address = server.address();
  if (!address || typeof address === "string") throw Error();
  const processor = remoteImageProcessor({
    endpoint: `http://127.0.0.1:${address.port}`,
    secret,
  });
  const directory = await mkdtemp(join(tmpdir(), "image-native-"));
  try {
    for (const format of ["png", "jpeg", "webp"] as const) {
      const input = Buffer.from(fixtures[format], "base64"),
        path = join(directory, format);
      await writeFile(path, input);
      const result = await processor.process({
        path,
        byteLength: input.length,
        contentType: `image/${format}`,
      });
      assert.ok(result.primary.byteLength <= input.length);
      assert.ok(result.totalBytes <= 2 * input.length);
      if (
        result.primary.contentType === "image/webp" &&
        result.primary.path !== path
      ) {
        assert.ok(result.width! <= 2048);
        assert.ok(result.height! <= 2048);
        const bytes = await readFile(result.primary.path);
        assert.equal(bytes.subarray(8, 12).toString(), "WEBP");
      }
      assert.match(result.primary.sha256, /^[a-f0-9]{64}$/);
      await result.dispose();
      assert.deepEqual(await readFile(path), input);
    }
    const animation = Buffer.from(fixtures.animated, "base64"),
      animatedPath = join(directory, "animated");
    await writeFile(animatedPath, animation);
    const unchanged = await processor.process({
      path: animatedPath,
      byteLength: animation.length,
      contentType: "image/webp",
    });
    assert.equal(unchanged.primary.path, animatedPath);
    assert.equal(unchanged.placeholder, null);
    assert.equal(unchanged.small, undefined);
    await unchanged.dispose();
    const frameBudget = Buffer.from(fixtures.frameBudget, "base64");
    const framePath = join(directory, "frames");
    await writeFile(framePath, frameBudget);
    await assert.rejects(
      processor.process({
        path: framePath,
        byteLength: frameBudget.length,
        contentType: "image/webp",
      }),
      /image_pixel_limit/,
    );
    const malformed = Buffer.from([
      137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0,
    ]);
    const malformedPath = join(directory, "malformed");
    await writeFile(malformedPath, malformed);
    const fallback = await processor.process({
      path: malformedPath,
      byteLength: malformed.length,
      contentType: "image/png",
    });
    assert.equal(fallback.primary.path, malformedPath);
    assert.equal(fallback.width, null);
    await fallback.dispose();
    const pixels = Buffer.from(fixtures.pixel, "base64"),
      pixelPath = join(directory, "pixels");
    await writeFile(pixelPath, pixels);
    await assert.rejects(
      processor.process({
        path: pixelPath,
        byteLength: pixels.length,
        contentType: "image/png",
      }),
      /image_pixel_limit/,
    );
  } finally {
    await processor.close();
    await listener.close();
    await new Promise<void>((r, j) => server.close((e) => (e ? j(e) : r())));
    await rm(directory, { recursive: true, force: true });
  }
  const inventory = await exec("docker", [
    "ps",
    "-aq",
    "--filter",
    `label=${namespace}.image-processor=1`,
  ]);
  assert.equal(inventory.stdout.trim(), "");
});

test("real image container is removed when an incomplete upload is cancelled", async () => {
  const { request } = await import("node:http");
  const listener = imageProcessingListener(
    createImageJobExecutor({ deploymentNamespace: namespace }),
    "image-cancel-proof-secret-1234567890",
  );
  const server = createServer(listener);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw Error();
  const req = request({
    host: "127.0.0.1",
    port: addr.port,
    path: "/v1/image-process",
    method: "POST",
    headers: {
      authorization: "Bearer image-cancel-proof-secret-1234567890",
      "content-length": "100000",
    },
  });
  req.on("error", () => {});
  req.write(Buffer.from([137]));
  try {
    const deadline = Date.now() + 5000;
    let found = false;
    while (Date.now() < deadline) {
      const result = await exec("docker", [
        "ps",
        "-aq",
        "--filter",
        `label=${namespace}.image-processor=1`,
      ]);
      if (result.stdout.trim()) {
        found = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 25));
    }
    assert.equal(found, true);
    await listener.close();
    const left = await exec("docker", [
      "ps",
      "-aq",
      "--filter",
      `label=${namespace}.image-processor=1`,
    ]);
    assert.equal(left.stdout.trim(), "");
  } finally {
    req.destroy();
    await listener.close();
    await new Promise<void>((r, j) => server.close((e) => (e ? j(e) : r())));
  }
});
