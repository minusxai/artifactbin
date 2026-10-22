import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, request } from "node:https";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { createFontCaptureTransport } from "../src/migration/conversion/compiled/fonts/capture-transport.ts";
test("native TLS capture handles Node all-address lookup and retains hostname verification settings", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "font-capture-tls-"));
  let server: ReturnType<typeof createServer> | undefined;
  try {
    const key = path.join(directory, "key.pem"),
      cert = path.join(directory, "cert.pem");
    execFileSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-keyout",
        key,
        "-out",
        cert,
        "-days",
        "1",
        "-subj",
        "/CN=localhost",
      ],
      { stdio: "ignore" },
    );
    server = createServer(
      { key: await readFile(key), cert: await readFile(cert) },
      (_req, res) => {
        res.setHeader("content-type", "text/css");
        res.end("body{}");
      },
    );
    await new Promise<void>((resolve) =>
      server!.listen(0, "127.0.0.1", resolve),
    );
    let all = false;
    const capture = createFontCaptureTransport({
      lookup: async () => [{ address: "142.250.1.1", family: 4 }],
      request: ((url: any, options: any, callback: any) => {
        assert.equal(options.servername, "fonts.googleapis.com");
        assert.equal(options.rejectUnauthorized, undefined);
        const originalLookup = options.lookup;
        const local = new URL(url);
        local.port = String((server!.address() as { port: number }).port);
        return request(
          local,
          {
            ...options,
            rejectUnauthorized: false,
            lookup: ((host: any, opts: any, cb: any) =>
              originalLookup(
                host,
                opts,
                (error: any, result: any, family: any) => {
                  all = Boolean(opts.all);
                  if (opts.all) {
                    assert(Array.isArray(result));
                    assert.equal(result[0].address, "142.250.1.1");
                    cb(
                      error,
                      result.map((entry: any) => ({
                        ...entry,
                        address: "127.0.0.1",
                      })),
                    );
                  } else cb(error, "127.0.0.1", family);
                },
              )) as any,
          },
          callback,
        );
      }) as any,
    });
    const bytes = await capture(
      "https://fonts.googleapis.com/css2?family=Example:wght@400",
      "stylesheet",
      { signal: new AbortController().signal, maxBytes: 100 },
    );
    assert.equal(Buffer.from(bytes).toString(), "body{}");
    assert(all);
  } finally {
    if (server)
      await new Promise<void>((resolve) => server!.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});
