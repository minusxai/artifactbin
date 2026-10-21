/**
 * A screenshot through the Chrome DevTools Protocol over
 * `--remote-debugging-pipe` (file descriptors 3 and 4, NUL-separated JSON),
 * so it needs no WebSocket and no npm package. The viewport is set with
 * Emulation.setDeviceMetricsOverride, so the PNG is exactly the requested
 * width even where headless Chrome clamps its window (macOS: 500px).
 */
import { spawn } from "node:child_process";
import type { Readable, Writable } from "node:stream";

export interface ScreenshotOptions {
  chrome: string;
  url: string;
  width: number;
  height: number;
  profile: string;
  /** Stop waiting for the page after this long (ms). */
  timeout?: number;
}

export async function screenshot(options: ScreenshotOptions): Promise<{ png: Buffer; output: string }> {
  const child = spawn(
    options.chrome,
    [
      "--headless=new",
      "--remote-debugging-pipe",
      "--disable-gpu",
      "--hide-scrollbars",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      "--use-mock-keychain",
      "--password-store=basic",
      "--force-device-scale-factor=1",
      "--allow-file-access-from-files",
      // Chrome refuses to run as root with its sandbox (CI containers); Playwright drops it the same way.
      ...(process.getuid?.() === 0 ? ["--no-sandbox"] : []),
      `--user-data-dir=${options.profile}`,
      "about:blank",
    ],
    { stdio: ["ignore", "pipe", "pipe", "pipe", "pipe"] },
  );
  let output = "";
  child.stdout?.on("data", (chunk: Buffer) => (output += chunk));
  child.stderr?.on("data", (chunk: Buffer) => (output += chunk));
  const toChrome = child.stdio[3] as Writable;
  const fromChrome = child.stdio[4] as Readable;
  let nextId = 0;
  const waiting = new Map<number, { resolve(value: any): void; reject(error: Error): void }>();
  const listeners = new Set<(message: any) => void>();
  let buffer = Buffer.alloc(0);
  let exited: Error | null = null;
  const fail = (error: Error) => {
    exited ??= error;
    for (const pending of waiting.values()) pending.reject(error);
    waiting.clear();
  };
  const exit = new Promise<void>((resolve) => {
    child.once("exit", () => resolve());
    child.once("error", () => resolve());
  });
  let closing = false;
  child.on("error", (error) => fail(error));
  child.on("close", (code) => fail(Error(`Chrome exited (${code}) before the screenshot was taken.\n${output.trim()}`)));
  // A Chrome that dies at once resets both pipes; the close handler above then reports why.
  toChrome.on("error", () => {});
  fromChrome.on("error", () => {});
  fromChrome.on("data", (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    let end: number;
    while ((end = buffer.indexOf(0)) >= 0) {
      const message = JSON.parse(buffer.subarray(0, end).toString("utf8"));
      buffer = buffer.subarray(end + 1);
      if (typeof message.id === "number" && waiting.has(message.id)) {
        const pending = waiting.get(message.id)!;
        waiting.delete(message.id);
        if (message.error) pending.reject(Error(`${message.error.message}`));
        else pending.resolve(message.result);
      } else for (const listener of listeners) listener(message);
    }
  });
  const send = (method: string, params: object = {}, sessionId?: string): Promise<any> =>
    new Promise((resolve, reject) => {
      if (exited) return reject(exited);
      const id = ++nextId;
      waiting.set(id, { resolve, reject });
      toChrome.write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + "\0");
    });
  const timeout = options.timeout ?? 30_000;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      (async () => {
        const { targetId } = await send("Target.createTarget", { url: "about:blank" });
        const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
        await send(
          "Emulation.setDeviceMetricsOverride",
          { width: options.width, height: options.height, deviceScaleFactor: 1, mobile: false },
          sessionId,
        );
        await send("Page.enable", {}, sessionId);
        const loaded = new Promise<void>((resolve) => {
          const listener = (message: any) => {
            if (message.sessionId === sessionId && message.method === "Page.loadEventFired") {
              listeners.delete(listener);
              resolve();
            }
          };
          listeners.add(listener);
        });
        const navigated = await send("Page.navigate", { url: options.url }, sessionId);
        if (navigated.errorText) throw Error(`Chrome could not open the page: ${navigated.errorText}`);
        await loaded;
        // Let fonts, module scripts and the first renders settle.
        await send(
          "Runtime.evaluate",
          {
            expression:
              "document.fonts.ready.then(() => new Promise((r) => setTimeout(() => requestAnimationFrame(() => r(true)), 400)))",
            awaitPromise: true,
          },
          sessionId,
        );
        const { data } = await send("Page.captureScreenshot", { format: "png" }, sessionId);
        closing = await send("Browser.close").then(
          () => true,
          () => false,
        );
        return { png: Buffer.from(data, "base64"), output };
      })(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(Error(`The page did not finish loading within ${timeout / 1000}s.`)), timeout);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    // Wait for Chrome to exit, so the caller can delete its profile folder.
    if (child.exitCode === null && child.signalCode === null) {
      const terminate = setTimeout(() => child.kill("SIGTERM"), closing ? 3_000 : 0);
      const kill = setTimeout(() => child.kill("SIGKILL"), closing ? 5_000 : 2_000);
      await exit;
      clearTimeout(terminate);
      clearTimeout(kill);
    }
  }
}
