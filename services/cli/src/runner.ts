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
  const session = await api<{ id: string; runnerKey: string }>(
    connection,
    "",
    "POST",
    {
      name: options.name ?? command,
      harness: command,
      cwd,
      machine: hostname(),
      cols,
      rows,
    },
  );
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
    remote = true,
    paused = false;
  let controller: "local" | "web" = "local";
  let batch: RemoteExchange | undefined;
  const out = child.onData((data) => {
    if (options.onOutput) options.onOutput(data);
    else if (interactive) process.stdout.write(data);
    if (remote) {
      buffer += data;
      if (buffer.length > 1024 * 1024 && !paused) {
        child.pause();
        paused = true;
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
        try {
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
          warned = false;
          if (exitCode === undefined && paused && buffer.length < 512000) {
            child.resume();
            paused = false;
          }
          if (finished) break;
        } catch (error) {
          if (exitCode !== undefined) break;
          if (!warned && interactive)
            process.stderr.write(
              `\r\n[afbin: remote access interrupted; ${command} is still running locally. Exit the agent to end this session]\r\n`,
            );
          warned = true;
          if (
            error instanceof ApiError &&
            [401, 403, 404].includes(error.status)
          )
            remote = false;
          // A prolonged relay outage must not freeze the local harness or retain unbounded output.
          if (paused) {
            remote = false;
            child.resume();
            paused = false;
          }
          if (!remote) {
            buffer = "";
            batch = undefined;
          }
        }
      }
      if (exitCode !== undefined && !remote)
        break;
      await delay(remote ? 200 : 100);
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
