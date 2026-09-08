import { hostname } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { pty } from "./pty";
import { api, ApiError } from "./client";
import type { Connection } from "./config";
import type {
  RemoteExchange,
  RemoteExchangeResult,
} from "../../contracts/src/remote";
export interface RunOptions {
  connection: Connection;
  command: string;
  args: string[];
  name?: string;
  cwd?: string;
  interactive?: boolean;
  onOutput?: (data: string) => void;
  onSession?: (url: string) => void;
  signal?: AbortSignal;
}
/** Owns the PTY lifecycle; usable from another CLI without installing global commands. */
export async function runRemote(options: RunOptions): Promise<number> {
  const { connection, command, args, signal } = options;
  const interactive = options.interactive ?? true;
  if (interactive && !process.stdin.isTTY)
    throw new Error("afbin remote requires an interactive terminal.");
  let cols = Math.max(2, Math.min(300, process.stdout.columns || 80));
  let rows = Math.max(2, Math.min(120, process.stdout.rows || 24));
  const cwd = options.cwd ?? process.cwd();
  const register = (signal?: AbortSignal) => api<{ id: string; runnerKey: string }>(
    connection, "", "POST", {
      name: options.name ?? command, harness: command, cwd,
      machine: hostname(), cols, rows,
    }, signal,
  );
  let session = await register(signal);
  let child: import("node-pty").IPty;
  try {
    child = pty.spawn(command, args, {
      cwd,
      cols,
      rows,
      name: "xterm-256color",
      env: { ...process.env },
    });
  } catch (error) {
    await api(connection, `/${session.id}`, "DELETE").catch(() => {});
    throw error;
  }
  options.onSession?.(`${connection.server}/chat?session=${session.id}`);
  let buffer = "",
    ack = 0,
    seq = 0,
    exitCode: number | undefined,
    remote = true;
  let needsRegistration = false;
  let droppedOutput = false;
  let failures = 0;
  let controller: "local" | "web" = "local";
  let batch: RemoteExchange | undefined;
  const out = child.onData((data) => {
    if (options.onOutput) options.onOutput(data);
    else if (interactive) process.stdout.write(data);
    if (remote) {
      buffer += data;
      // Keep local output flowing even during a prolonged outage.
      if (buffer.length > 1024 * 1024) {
        let start = buffer.length - 1024 * 1024;
        if (/[\uDC00-\uDFFF]/.test(buffer[start])) start++;
        buffer = buffer.slice(start);
        droppedOutput = true;
      }
    }
  });
  const shutdown = new AbortController();
  let shutdownTimer: ReturnType<typeof setTimeout> | undefined;
  const exited = child.onExit((event) => {
    exitCode = event.exitCode;
    detachTerminal();
    if (interactive)
      process.stderr.write(`\r\n[afbin: Closing session… sending final output (up to 1 second)]\r\n`);
    // Allow a brief final output/exit flush, including an exchange already in flight.
    shutdownTimer = setTimeout(() => shutdown.abort(), 1000);
  });
  const resizePty = () => {
    if (exitCode !== undefined) return;
    try {
      child.resize(cols, rows);
    } catch (error) {
      // The native descriptor can close just before node-pty emits onExit.
      if (!(error instanceof Error && /EBADF/.test(error.message))) throw error;
    }
  };
  const resize = () => {
    if (exitCode !== undefined) return;
    cols = Math.max(2, Math.min(300, process.stdout.columns || 80));
    rows = Math.max(2, Math.min(120, process.stdout.rows || 24));
    resizePty();
  };
  const input = (data: Buffer) => {
    if (exitCode !== undefined) return;
    // stdin includes automatic terminal replies, not just human typing.
    // Only explicit layout controls may change browser-selected dimensions.
    child.write(data.toString("utf8"));
  };
  const onResize = () => {
    if (controller === "local") resize();
  };
  const abort = () => { if (exitCode === undefined) child.kill(); };
  const wasRaw = process.stdin.isRaw;
  let terminalAttached = false;
  const detachTerminal = () => {
    if (!terminalAttached) return;
    terminalAttached = false;
    process.stdin.off("data", input);
    process.stdout.off("resize", onResize);
    process.stdin.setRawMode(wasRaw ?? false);
    process.stdin.pause();
  };
  if (interactive) {
    terminalAttached = true;
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on("data", input);
    process.stdout.on("resize", onResize);
  }
  signal?.addEventListener("abort", abort, { once: true });
  process.on("SIGTERM", abort);
  process.on("SIGHUP", abort);
  if (signal?.aborted) abort();
  let warned = false;
  try {
    while (!shutdown.signal.aborted) {
      if (remote) {
        try {
          if (needsRegistration) {
            session = await register(shutdown.signal);
            needsRegistration = false;
            ack = 0;
            seq = 0;
            // The old batch may have reached the old server; the new session has no history.
            if (batch) batch = { ...batch, runnerKey: session.runnerKey, ack: 0, outputSeq: ++seq };
            options.onSession?.(`${connection.server}/chat?session=${session.id}`);
            if (interactive)
              process.stderr.write(`\r\n[afbin: Remote session restored with a new link: ${connection.server}/chat?session=${session.id}. Open it in your browser; previous mentions still point to the old session.]\r\n`);
          }
          if (!batch) {
            // Never split a UTF-16 surrogate pair across JSON batches.
            let length = Math.min(60000, buffer.length);
            if (length && /[\uD800-\uDBFF]/.test(buffer[length - 1])) length--;
            batch = {
              runnerKey: session.runnerKey,
              outputSeq: ++seq,
              output: buffer.slice(0, length),
              ack,
              cols,
              rows,
              ...(exitCode !== undefined && length === buffer.length
                ? { exitCode }
                : {}),
            };
            buffer = buffer.slice(length);
          }
          const result = await api<RemoteExchangeResult>(
            connection,
            `/${session.id}/exchange`,
            "POST",
            batch,
            shutdown.signal,
          );
          controller = result.controller;
          if (controller === "local" && interactive) resize();
          for (const item of result.inputs) {
            if (item.id <= ack) continue;
            if (exitCode === undefined) {
              if (item.kind === "resize" && controller === "web") {
                cols = item.cols!;
                rows = item.rows!;
                resizePty();
              } else if (item.kind === "input") {
                const data = item.data!;
                if (data.length > 1 && data.endsWith("\r")) {
                  // TUIs can interpret text plus Enter in one burst as a multiline paste.
                  child.write(data.slice(0, -1));
                  await delay(200);
                  if (exitCode === undefined) child.write("\r");
                } else child.write(data);
              }
            }
            ack = item.id;
          }
          const finished = batch.exitCode !== undefined;
          batch = undefined;
          if (warned && interactive)
            process.stderr.write(`\r\n[afbin: Reconnected.${droppedOutput ? " Some terminal output was skipped during the outage." : ""}]\r\n`);
          warned = false;
          droppedOutput = false;
          failures = 0;
          if (finished) break;
        } catch (error) {
          if (exitCode !== undefined) break;
          const status = error instanceof ApiError ? error.status : undefined;
          if (status === 401 || status === 403) {
            remote = false;
            if (interactive)
              process.stderr.write(`\r\n[afbin: Remote authentication failed (HTTP ${status}). ${command} is still running locally. Run afbin auth --server ${connection.server} in another terminal, then restart afbin remote to reconnect.]\r\n`);
            buffer = "";
            batch = undefined;
          } else {
            if (status === 404) needsRegistration = true;
            failures++;
            if (!warned && interactive)
              process.stderr.write(`\r\n[afbin: Connection lost${status ? ` (HTTP ${status})` : ""}—reconnecting… ${command} is still running locally.]\r\n`);
            warned = true;
          }
        }
      }
      if (exitCode !== undefined && !remote)
        break;
      const wait = remote && failures ? Math.min(10000, 500 * 2 ** Math.min(failures - 1, 5)) : remote ? 200 : 100;
      await delay(wait, undefined, { signal: shutdown.signal }).catch((error) => {
        if (!shutdown.signal.aborted) throw error;
      });
    }
    return exitCode ?? 1;
  } finally {
    clearTimeout(shutdownTimer);
    shutdown.abort();
    if (exitCode === undefined) child.kill();
    out.dispose();
    exited.dispose();
    signal?.removeEventListener("abort", abort);
    process.off("SIGTERM", abort);
    process.off("SIGHUP", abort);
    detachTerminal();
    if (interactive && exitCode !== undefined)
      process.stderr.write(`[afbin: Session closed (exit ${exitCode}).]\r\n`);
  }
}
