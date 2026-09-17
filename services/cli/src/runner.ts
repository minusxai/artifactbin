import { randomBytes } from "node:crypto";
import headless from "@xterm/headless";
import serialize from "@xterm/addon-serialize";
import { hostname } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { pty } from "./pty";
import { httpStatus, type HttpClient } from "./http";
import type {
  RemoteExchange,
  RemoteExchangeResult,
} from "../../contracts/src/remote";
export interface RunOptions {
  /** The shared client: every session request rides its refresh-and-sign-in ladder. */
  client: HttpClient;
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
  const { client, command, args, signal } = options;
  const interactive = options.interactive ?? true;
  if (interactive && !process.stdin.isTTY)
    throw new Error("afbin remote requires an interactive terminal.");
  let cols = Math.max(2, Math.min(300, process.stdout.columns || 80));
  let rows = Math.max(2, Math.min(120, process.stdout.rows || 24));
  const cwd = options.cwd ?? process.cwd();
  const recoveryKey = randomBytes(32).toString("hex");
  const register = (signal?: AbortSignal) => client.request<{ id: string; runnerKey: string }>(
    "/remote/sessions", "POST", {
      name: options.name ?? command, harness: command, cwd,
      machine: hostname(), cols, rows, recoveryKey,
    }, {}, { signal, timeoutMs: 10000 },
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
    await client.request(`/remote/sessions/${session.id}`, "DELETE", undefined, {}, { timeoutMs: 10000 }).catch(() => {});
    throw error;
  }
  const history = new headless.Terminal({ cols, rows, scrollback: 1000, allowProposedApi: true });
  const serializer = new serialize.SerializeAddon();
  history.loadAddon(serializer);
  options.onSession?.(`${client.connection.server}/chat?session=${session.id}`);
  let replay = "";
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
            // Restore acknowledged terminal state, then retry pending and unsent output.
            // Do not include new PTY bytes in the snapshot: they are already in buffer.
            replay = serializer.serialize() + (batch?.output ?? "") + replay;
            batch = undefined;
            history.reset();
            options.onSession?.(`${client.connection.server}/chat?session=${session.id}`);
            if (interactive)
              process.stderr.write(`\r\n[afbin: Restoring remote session at ${client.connection.server}/chat?session=${session.id}]\r\n`);
          }
          if (!batch) {
            // Never split a UTF-16 surrogate pair across JSON batches.
            const source = replay || buffer;
            let length = Math.min(60000, source.length);
            if (length && /[\uD800-\uDBFF]/.test(source[length - 1])) length--;
            batch = {
              runnerKey: session.runnerKey,
              outputSeq: ++seq,
              output: source.slice(0, length),
              ack,
              cols,
              rows,
              ...(exitCode !== undefined && !replay && length === buffer.length
                ? { exitCode }
                : {}),
            };
            if (replay) replay = replay.slice(length);
            else buffer = buffer.slice(length);
          }
          const result = await client.request<RemoteExchangeResult>(
            `/remote/sessions/${session.id}/exchange`,
            "POST",
            batch,
            {},
            { signal: shutdown.signal, timeoutMs: 10000 },
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
          history.resize(batch.cols, batch.rows);
          if (batch.output) await new Promise<void>(resolve => history.write(batch!.output, resolve));
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
          const status = httpStatus(error);
          if (status === 410) {
            remote = false;
            buffer = "";
            replay = "";
            batch = undefined;
            if (interactive) process.stderr.write("\r\n[afbin: Remote session disconnected. Your command is still running locally.]\r\n");
          } else if (status === 401 || status === 403) {
            remote = false;
            if (interactive)
              process.stderr.write(`\r\n[afbin: Remote authentication failed (HTTP ${status}). ${command} is still running locally. Start afbin remote --server ${client.connection.server} in another terminal to sign in and launch a new remote session.]\r\n`);
            buffer = "";
            replay = "";
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
    history.dispose();
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
