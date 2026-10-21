import { spawn, execFile, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { debuglog, promisify } from "node:util";
import { jsonCopy } from "../json.ts";
import { compileBackend } from "./compiler.ts";
import type { CompileRequest } from "./compiler-contracts.ts";
import {
  BACKEND_RUNTIME,
  digest,
  recordedImage,
  verifyDeployment,
} from "./deployment.ts";
import { createEsmFetcher } from "./packages.ts";
import { createSandboxCall, sandboxFailure } from "./sandbox-protocol.ts";
import { createBackendWork } from "./work.ts";
import { createSandboxPool, sandboxIdentityKey } from "./sandbox-pool.ts";
import type { SandboxLease, SandboxCallProtocol } from "./runtime-contracts.ts";
import { checkedBackendEnv } from "./container/env-policy.mjs";
import {
  BackendHostError,
  boundedDetail,
  checkedBackendReuse,
  type BackendExecutionScope,
  type BackendHost,
  type BackendHostOptions,
  type BackendCapabilityHandler,
  type BackendEnv,
  type BackendJson,
  type BackendPrincipal,
  type ModuleFetcher,
} from "./contracts.ts";
const exec = promisify(execFile);
/** Debug level: printed only with NODE_DEBUG=pagegi. */
const debug = debuglog("pagegi");
const FRAME_BYTES = 1500000;
type FailureCode = ConstructorParameters<typeof BackendHostError>[0];
const LABEL = "label=pagegi.backend=1";
/** The names this host gives its containers, as `docker ps --format {{.Names}}` lists them. */
const NAME = /^pagegi-backend-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
/** The sandbox bridge's default name; its Linux interface is `pagegi-sbx` (deploy/receive.sh filters it). */
const SANDBOX_NETWORK = "pagegi-sandbox";
/**
 * Every sandbox container, one-shot or warm, is created with exactly these
 * limits. Compilation gets no network; an invocation gets the sandbox bridge,
 * where workerd lets the lambda reach public addresses only.
 */
const containerArguments = (name: string, imageId: string, network: string) => [
  "create",
  "--pull=never",
  "--name",
  name,
  "--label",
  "pagegi.backend=1",
  "-i",
  "--memory=256m",
  "--memory-swap=256m",
  "--cpus=0.5",
  "--pids-limit=64",
  "--network=" + network,
  "--read-only",
  "--tmpfs",
  "/tmp:rw,noexec,nosuid,nodev,size=16m",
  "--cap-drop=ALL",
  "--security-opt=no-new-privileges",
  "--user=10001:10001",
  imageId,
];
const missing = (e: any) =>
  /No such container|No such object/i.test(e?.stderr ?? "");
/** The owner's secrets as the sandbox takes them: names that fit the workerd config, bounded values. */
function checkedEnv(env: BackendEnv): Record<string, string> {
  try {
    return checkedBackendEnv(env);
  } catch {
    throw new BackendHostError("input_quota");
  }
}
/** Force-remove a container and prove it is gone. */
async function removeContainer(name: string): Promise<boolean> {
  try {
    try {
      await exec("docker", ["rm", "-f", name], { timeout: 5000 });
    } catch (e: any) {
      if (!missing(e)) throw e;
    }
    try {
      await exec("docker", ["inspect", name], { timeout: 5000 });
      return false;
    } catch (e: any) {
      return missing(e);
    }
  } catch {
    return false;
  }
}
/** A sandbox kept running for the next call of the same backend version. */
interface Sandbox {
  name: string;
  child: ChildProcess;
  ended: Promise<void>;
  /** The call in flight owns the frames; between calls any frame is a fault. */
  onFrame: ((raw: Buffer) => void) | null;
  buffered: Buffer;
  gone: boolean;
}
export function createBackendHost(
  options: BackendHostOptions = {},
): BackendHost {
  const image =
    options.image ?? process.env.PAGEGI_BACKEND_IMAGE ?? "pagegi-backend:local";
  const network = options.sandboxNetwork ?? SANDBOX_NETWORK;
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(network))
    throw Error("Invalid sandbox network");
  // The host owns its package client, and close() drains it through the client's own close().
  const packageClient = options.fetchModule ?? createEsmFetcher();
  const fetchModule: ModuleFetcher = (url, signal) => {
    if (work.closed)
      return Promise.reject(new BackendHostError("backend_unavailable"));
    if (signal?.aborted) return Promise.reject(new BackendHostError("cancelled"));
    return packageClient(url, signal);
  };
  const compileMs = options.compileTimeoutMs ?? 10000,
    invokeMs = options.invokeTimeoutMs ?? 10000,
    max = options.maxConcurrent ?? 8,
    admitWaitMs = options.admitWaitMs ?? 2000,
    warmIdleMs = options.warmIdleMs ?? 60000,
    maxWarm = options.maxWarm ?? Math.max(16, max),
    recoveryRetryMs = options.recoveryRetryMs ?? 5000;
  for (const n of [compileMs, invokeMs, max, warmIdleMs, maxWarm])
    if (!Number.isSafeInteger(n) || n < 1)
      throw Error("Invalid backend host limits");
  for (const n of [admitWaitMs, recoveryRetryMs])
    if (!Number.isSafeInteger(n) || n < 0)
      throw Error("Invalid backend host limits");
  if (maxWarm < max) throw Error("Invalid backend host limits");
  const log = options.log ?? ((line: string) => console.error(line));
  const work = createBackendWork({ max, waitMs: admitWaitMs });
  const pool = createSandboxPool<Sandbox>({
    max: maxWarm,
    idleMs: warmIdleMs,
    healthy: (sandbox) => !sandbox.gone && !sandbox.buffered.length,
    async dispose(sandbox) {
      sandbox.child.kill("SIGKILL");
      await sandbox.ended;
      const clean = await removeContainer(sandbox.name);
      if (!clean) suspect(sandbox.name);
      return clean;
    },
  });
  let imageCache: { id: string; at: number } | undefined;

  /**
   * Containers of this host whose removal could not be verified. While any is
   * listed, no call is admitted: the host first proves them gone (removes each
   * again, checks it absent, and lists its own containers to confirm). A failed
   * proof is retried on the next call after recoveryRetryMs.
   */
  const suspects = new Set<string>();
  let verifying: Promise<void> | undefined;
  let retryAt = 0;
  function suspect(name: string) {
    if (!suspects.has(name)) {
      if (!suspects.size)
        log(
          `backend host closed: container ${name} was not verifiably removed; calls resume once it is proven gone`,
        );
      suspects.add(name);
    }
    if (!work.closed) void verify();
  }
  function verify(): Promise<void> {
    if (verifying) return verifying;
    const names = [...suspects];
    verifying = (async () => {
      const gone = await Promise.all(names.map(removeContainer));
      if (gone.includes(false)) throw Error("a container could not be removed");
      const listing = await exec(
        "docker",
        ["ps", "-a", "--filter", LABEL, "--format", "{{.Names}}"],
        { timeout: 5000 },
      );
      const listed = listing.stdout.split("\n").filter(Boolean);
      if (listed.length > 1024 || listed.some((name) => !NAME.test(name)))
        throw Error("unexpected container inventory");
      if (names.some((name) => listed.includes(name)))
        throw Error("a container remains");
      // After close() the verdict is whatever close saw; nothing reopens.
      if (work.closed) return;
      for (const name of names) suspects.delete(name);
      if (!suspects.size) pool.recovered();
      if (!suspects.size)
        log(`backend host reopened: ${names.join(", ")} proven gone`);
    })();
    const attempt = verifying;
    attempt
      .catch((error: unknown) => {
        retryAt = Date.now() + recoveryRetryMs;
        debug(
          "backend host stays closed: %s",
          error instanceof Error ? error.message : error,
        );
      })
      .finally(() => {
        if (verifying === attempt) verifying = undefined;
      });
    return attempt;
  }
  /** Throws backend_unavailable unless the host is open, or can be proven clean now. */
  async function ensureOpen(): Promise<void> {
    if (work.closed) throw new BackendHostError("backend_unavailable");
    if (!suspects.size) return;
    if (!verifying && Date.now() < retryAt)
      throw new BackendHostError("backend_unavailable");
    try {
      await verify();
    } catch {
      throw new BackendHostError("backend_unavailable");
    }
    if (work.closed || suspects.size)
      throw new BackendHostError("backend_unavailable");
  }
  /** Always the configured image: a deployment of the current runtime generation runs on whatever the tag names now (deployment.ts). */
  async function currentImage(recorded?: string): Promise<string> {
    if (!imageCache || Date.now() - imageCache.at > 5000) {
      const inspected = await exec(
        "docker",
        ["image", "inspect", "--format", "{{.Id}}", image],
        { timeout: 5000 },
      );
      const id = inspected.stdout.trim();
      if (!/^sha256:[a-f0-9]{64}$/.test(id))
        throw new BackendHostError("backend_unavailable");
      imageCache = { id, at: Date.now() };
    }
    if (recorded && recorded !== imageCache.id)
      debug(
        "backend compiled on image %s runs on %s: the image was rebuilt",
        recorded,
        imageCache.id,
      );
    return imageCache.id;
  }
  /**
   * The sandbox bridge, checked (and created if missing) once when the host is
   * built, so a call does no setup work. A network of that name that is not
   * an IPv4-only bridge without inter-container traffic is refused: sandboxes
   * are never attached to it.
   */
  async function prepareNetwork(): Promise<void> {
    const inspect = async () =>
      JSON.parse(
        (
          await exec(
            "docker",
            ["network", "inspect", "--format", "{{json .}}", network],
            { timeout: 5000 },
          )
        ).stdout,
      );
    let found: any;
    try {
      found = await inspect();
    } catch (e: any) {
      if (!/not found|No such network/i.test(e?.stderr ?? "")) throw e;
      try {
        await exec(
          "docker",
          [
            "network",
            "create",
            "--driver=bridge",
            "--ipv6=false",
            "--label=pagegi.sandbox=1",
            "--opt=com.docker.network.bridge.enable_icc=false",
            ...(network === SANDBOX_NETWORK
              ? ["--opt=com.docker.network.bridge.name=pagegi-sbx"]
              : []),
            network,
          ],
          { timeout: 10000 },
        );
      } catch {
        // Another host may have created it first; the inspection below decides.
      }
      found = await inspect();
    }
    const options = found?.Options ?? {};
    if (
      found?.Driver !== "bridge" ||
      found?.EnableIPv6 !== false ||
      options["com.docker.network.bridge.enable_icc"] !== "false" ||
      (network === SANDBOX_NETWORK &&
        options["com.docker.network.bridge.name"] !== "pagegi-sbx")
    ) {
      log(
        `sandbox network ${network} is not an IPv4-only bridge without inter-container traffic` +
          (network === SANDBOX_NETWORK ? " on interface pagegi-sbx" : "") +
          "; lambdas stay unavailable until it is removed or fixed",
      );
      throw Error("sandbox network mismatch");
    }
  }
  let networkReady: Promise<void> | undefined;
  /** The verified network; a failed check is tried again on the next call, never trusted. */
  function ensureNetwork(): Promise<void> {
    if (network === "none") return Promise.resolve();
    networkReady ??= prepareNetwork().catch(() => {
      networkReady = undefined;
      throw new BackendHostError("backend_unavailable");
    });
    return networkReady;
  }
  void ensureNetwork().catch(() => {});
  /** One container for one compile: always without a network. */
  async function run(
    request: CompileRequest,
    signal?: AbortSignal,
  ): Promise<unknown> {
    if (signal?.aborted) throw new BackendHostError("cancelled");
    await ensureOpen();
    const payload = JSON.stringify(jsonCopy(request));
    if (Buffer.byteLength(payload) > FRAME_BYTES)
      throw new BackendHostError("input_quota");
    const release = await work.admit(signal);
    if (work.closed || suspects.size) {
      // A container became suspect while this call waited for its slot.
      release();
      throw new BackendHostError("backend_unavailable");
    }
    const name = "pagegi-backend-" + randomUUID();
    let createAttempted = false,
      createAcknowledged = false;
    let child: ChildProcess | undefined;
    let ended: Promise<void> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failure: BackendHostError | undefined;
    let rejectRun: ((error: Error) => void) | undefined;
    const fail = (code: FailureCode, detail?: string) => {
      failure ??= new BackendHostError(code, detail);
      rejectRun?.(failure);
    };
    const abort = () => fail("cancelled");
    signal?.addEventListener("abort", abort, { once: true });
    try {
      if (signal?.aborted) throw new BackendHostError("cancelled");
      timer = setTimeout(() => fail("deadline"), compileMs);
      const imageId = await currentImage();
      if (failure) throw failure;
      createAttempted = true;
      await exec("docker", containerArguments(name, imageId, "none"), {
        timeout: 5000,
      });
      createAcknowledged = true;
      if (failure) throw failure;
      child = spawn("docker", ["start", "-ai", name], {
        stdio: ["pipe", "pipe", "pipe"],
      });
      ended = new Promise<void>((resolve) => {
        child!.once("close", () => resolve());
        child!.once("error", () => resolve());
      });
      return await new Promise((resolve, reject) => {
        rejectRun = reject;
        if (failure) return reject(failure);
        let buffered = Buffer.alloc(0),
          bytes = 0;
        let final: any,
          finalSeen = false;
        const frame = (raw: Buffer) => {
          const result = jsonCopy(
            JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw)),
          );
          if (finalSeen) throw Error();
          if (result?.kind === "capability" || typeof result?.ok !== "boolean")
            throw Error();
          finalSeen = true;
          final = result;
          child!.stdin!.end();
        };
        child!.stdout!.on("data", (chunk: Buffer) => {
          try {
            bytes += chunk.length;
            if (bytes > FRAME_BYTES * 2) return fail("output_quota");
            buffered = Buffer.concat([buffered, chunk]);
            let newline;
            while ((newline = buffered.indexOf(10)) >= 0) {
              if (newline > FRAME_BYTES) throw Error();
              frame(buffered.subarray(0, newline));
              buffered = buffered.subarray(newline + 1);
            }
            if (buffered.length > FRAME_BYTES) fail("output_quota");
          } catch {
            fail("backend_rejected");
          }
        });
        child!.stderr!.on("data", () => {}); // Never expose untrusted runtime diagnostics or source.
        child!.stdin!.on("error", () => {});
        child!.once("error", () => fail("backend_unavailable"));
        child!.once("close", (code) => {
          if (failure) return reject(failure);
          if (code !== 0)
            return fail(code === 137 ? "memory_limit" : "backend_unavailable");
          try {
            if (buffered.length) frame(buffered);
            const result = final;
            if (!finalSeen) throw Error();
            if (result?.ok !== true)
              return fail(
                sandboxFailure(result),
                boundedDetail(result?.message),
              );
            resolve({
              ...result.value,
              runtime: BACKEND_RUNTIME + "/image:" + imageId,
            });
          } catch {
            fail("backend_rejected");
          }
        });
        child!.stdin!.write(payload + "\n");
        child!.stdin!.end();
      });
    } catch (error) {
      if (error instanceof BackendHostError) throw error;
      throw new BackendHostError("backend_unavailable");
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      // docker create is awaited before cleanup; cancellation cannot lose a late-created container.
      child?.kill("SIGKILL");
      let cleanupOk = !createAttempted;
      try {
        if (ended) await ended;
        if (createAttempted) cleanupOk = await removeContainer(name);
      } catch {
        cleanupOk = false;
      } finally {
        release();
      }
      const clean = cleanupOk && !(createAttempted && !createAcknowledged);
      if (!clean) suspect(name);
      if (!clean) throw new BackendHostError("cleanup_failed");
    }
  }
  /** OS/protocol creation only; the pool owns capacity, reuse and retirement. */
  async function startSandbox(
    imageId: string,
    serve: unknown,
  ): Promise<Sandbox> {
    await ensureNetwork();
    let name = "pagegi-backend-" + randomUUID();
    let acknowledged = false;
    try {
      await exec("docker", containerArguments(name, imageId, network), {
        timeout: 5000,
      });
      acknowledged = true;
    } catch (e: any) {
      // The network was removed under the host (docker network prune): once proven that
      // nothing was created, check (or recreate) it and try once more.
      if (
        network !== "none" &&
        /network .* not found|No such network/i.test(e?.stderr ?? "") &&
        (await removeContainer(name))
      ) {
        networkReady = undefined;
        await ensureNetwork();
        name = "pagegi-backend-" + randomUUID();
        try {
          await exec("docker", containerArguments(name, imageId, network), {
            timeout: 5000,
          });
          acknowledged = true;
        } catch {}
      }
      // Otherwise the daemon's answer was lost: remove whatever it made, but never trust that cleanup.
    }
    if (!acknowledged) {
      await removeContainer(name);
      suspect(name);
      throw new BackendHostError("cleanup_failed");
    }
    const child = spawn("docker", ["start", "-ai", name], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    const sandbox: Sandbox = {
      name,
      child,
      ended: new Promise<void>((resolve) => {
        child.once("close", () => resolve());
        child.once("error", () => resolve());
      }),
      onFrame: null,
      buffered: Buffer.alloc(0),
      gone: false,
    };
    child.stdout!.on("data", (chunk: Buffer) => {
      try {
        sandbox.buffered = Buffer.concat([sandbox.buffered, chunk]);
        let newline;
        while ((newline = sandbox.buffered.indexOf(10)) >= 0) {
          if (newline > FRAME_BYTES || !sandbox.onFrame) throw Error();
          const raw = sandbox.buffered.subarray(0, newline);
          sandbox.buffered = sandbox.buffered.subarray(newline + 1);
          sandbox.onFrame(raw);
        }
        if (
          sandbox.buffered.length > FRAME_BYTES ||
          (!sandbox.onFrame && sandbox.buffered.length)
        )
          throw Error();
      } catch {
        // Output outside a call, or a frame the call refused: the sandbox is not trusted any further.
        sandbox.gone = true;
        void pool.retire(sandbox);
      }
    });
    child.stderr!.on("data", () => {}); // Never expose untrusted runtime diagnostics or source.
    child.stdin!.on("error", () => {});
    child.once("error", () => {
      sandbox.gone = true;
      void pool.retire(sandbox);
    });
    child.once("close", () => {
      sandbox.gone = true;
      void pool.retire(sandbox);
    });
    child.stdin!.write(JSON.stringify(serve) + "\n");
    return sandbox;
  }
  /** One call on a warm sandbox: the container start is paid once per backend version, not per call. */
  async function invokeWarm(
    deployment: { bundle: string; bundleHash: string; version: string },
    duplex: boolean,
    principal: BackendPrincipal,
    input: unknown,
    signal: AbortSignal | undefined,
    handler: BackendCapabilityHandler | undefined,
    env: Record<string, string>,
    scope: BackendExecutionScope | undefined,
    recorded?: string,
  ): Promise<BackendJson> {
    if (signal?.aborted) throw new BackendHostError("cancelled");
    await ensureOpen();
    const payload = JSON.stringify({ kind: "invoke", principal, input });
    if (Buffer.byteLength(payload) > FRAME_BYTES)
      throw new BackendHostError("input_quota");
    const release = await work.admit(signal);
    if (work.closed || suspects.size) {
      release();
      throw new BackendHostError("backend_unavailable");
    }
    let sandbox: Sandbox | undefined;
    let protocol: SandboxCallProtocol | undefined;
    let lease: SandboxLease<Sandbox> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failure: BackendHostError | undefined;
    let rejectRun: ((error: Error) => void) | undefined;
    const capabilityAbort = new AbortController();
    const fail = (code: FailureCode, detail?: string) => {
      failure ??= new BackendHostError(code, detail);
      capabilityAbort.abort();
      rejectRun?.(failure);
    };
    const abort = () => fail("cancelled");
    signal?.addEventListener("abort", abort, { once: true });
    let onClose: ((code: number | null) => void) | undefined;
    try {
      if (signal?.aborted) throw new BackendHostError("cancelled");
      timer = setTimeout(() => fail("deadline"), invokeMs);
      const imageId = await currentImage(recorded);
      if (failure) throw failure;
      // Module state belongs to one stored backend file and owner, shared across its viewers.
      // Code, runtime and secret changes each start a separate sandbox. Explicit one-shot calls
      // get a one-use sandbox; neither the calling page nor resolver arguments name its scope.
      lease = await pool.acquire(
        scope
          ? sandboxIdentityKey({
              ...scope,
              version: deployment.version,
              bundleHash: deployment.bundleHash,
              imageId,
              duplex,
              env,
            })
          : null,
        () =>
          startSandbox(imageId, {
            kind: "serve",
            bundle: deployment.bundle,
            duplex,
            env,
          }),
        signal,
      );
      sandbox = lease.value;
      if (failure) throw failure;
      return await new Promise<BackendJson>((resolve, reject) => {
        rejectRun = reject;
        if (sandbox!.gone) return fail("backend_rejected");
        protocol = createSandboxCall({
          principal,
          handler: duplex ? handler : undefined,
          signal: capabilityAbort.signal,
          reply: (reply) => {
            if (!failure && sandbox!.onFrame)
              sandbox!.child.stdin!.write(JSON.stringify(reply) + "\n");
          },
          result: (value) => {
            sandbox!.onFrame = null;
            resolve(value);
          },
          failure: (error) => fail(error.code, error.detail),
        });
        sandbox!.onFrame = (raw) => protocol!.receive(raw);
        onClose = (code) => {
          if (failure) return reject(failure);
          fail(code === 137 ? "memory_limit" : "backend_unavailable");
        };
        sandbox!.child.once("close", onClose);
        sandbox!.child.stdin!.write(payload + "\n");
      });
    } catch (error) {
      if (error instanceof BackendHostError) throw error;
      throw new BackendHostError("backend_unavailable");
    } finally {
      const drained = protocol?.close();
      capabilityAbort.abort();
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      let clean = true;
      if (sandbox) {
        sandbox.onFrame = null;
        if (onClose) sandbox.child.off("close", onClose);
        clean = await lease!.release(
          Boolean(
            scope &&
              !failure &&
              !sandbox.gone &&
              !sandbox.buffered.length &&
              !work.closed,
          ),
        );
      }
      await drained;
      release();
      if (!clean) throw new BackendHostError("cleanup_failed");
    }
  }
  return {
    close: () =>
      work.close(
        async () => {
          const results = await Promise.allSettled([
            pool.close(),
            Promise.allSettled([packageClient.close()]),
            verifying?.catch(() => undefined) ?? Promise.resolve(),
          ]);
          if (results.some((result) => result.status === "rejected"))
            throw new BackendHostError("cleanup_failed");
        },
        () => {
          if (suspects.size) throw new BackendHostError("cleanup_failed");
        },
      ),
    compile: (source, signal) =>
      work.own(signal, (ownedSignal) =>
        compileBackend(source, run, ownedSignal, fetchModule),
      ),
    invoke({
      deployment,
      principal,
      input,
      signal,
      capabilityHandler,
      env,
      reuse,
    }) {
      return work.own(signal, async (ownedSignal) => {
        const artifact = jsonCopy(deployment);
        verifyDeployment(artifact);
        const handler = capabilityHandler ?? options.capabilityHandler;
        // The resolver's fourth argument, as workerd text bindings (never process.env).
        const secrets = checkedEnv(env);
        const disposition = checkedBackendReuse(reuse);
        const executionScope =
          disposition.kind === "file" ? disposition.scope : undefined;
        const actor = jsonCopy(principal),
          invocation = jsonCopy(input);
        if (
          typeof actor.tenant !== "string" ||
          !actor.tenant ||
          (actor.subject !== null &&
            (typeof actor.subject !== "string" || !actor.subject))
        )
          throw new BackendHostError("input_quota");
        if (!artifact.fields.includes(invocation.field))
          throw new BackendHostError("field_rejected");
        if (
          Buffer.byteLength(
            JSON.stringify({ principal: actor, input: invocation }),
          ) > 65536
        )
          throw new BackendHostError("input_quota");
        return invokeWarm(
          artifact,
          Boolean(handler),
          Object.freeze({ tenant: actor.tenant, subject: actor.subject }),
          invocation,
          ownedSignal,
          handler,
          secrets,
          executionScope,
          recordedImage(artifact.runtime),
        );
      });
    },
  };
}
