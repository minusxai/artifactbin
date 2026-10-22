import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { createCapturedFontInspector } from "../src/migration/conversion/compiled/fonts/capture-inspector.ts";
test("aborted font inspection force-kills a TERM-ignoring decoder and settles only after process close", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "font-inspector-"));
  let child: ReturnType<typeof spawn> | undefined;
  try {
    const fixture = path.join(root, "decoder.mjs");
    await writeFile(
      fixture,
      `process.on('SIGTERM',()=>{});process.stdin.resume();process.stdout.write('ready');setInterval(()=>{},1000);`,
    );
    const controller = new AbortController();
    let closed = false;
    const inspect = createCapturedFontInspector(root, {
      spawnProcess: ((_command: any, _args: any, options: any) => {
        assert.equal(options.killSignal, "SIGKILL");
        child = spawn(process.execPath, [fixture], options);
        child.stdout!.once("data", () => controller.abort());
        child.once("close", () => (closed = true));
        return child;
      }) as any,
    });
    const bytes = Buffer.alloc(52);
    bytes.write("wOF2");
    bytes.writeUInt32BE(0x10000, 4);
    bytes.writeUInt32BE(52, 8);
    bytes.writeUInt16BE(1, 12);
    bytes.writeUInt32BE(128, 16);
    bytes.writeUInt32BE(2, 20);
    bytes[49] = 100;
    await assert.rejects(() => inspect(bytes, controller.signal));
    assert(closed);
    assert(child?.pid);
    assert.throws(() => process.kill(child!.pid!, 0));
  } finally {
    child?.kill("SIGKILL");
    await rm(root, { recursive: true, force: true });
  }
});
