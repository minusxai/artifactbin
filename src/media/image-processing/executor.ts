import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { Transform, Readable, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { dockerCommand } from "../../backend/reaper.ts";
import { removeBackendContainer } from "../../backend/container-cleanup.ts";
import { deploymentIdentity } from "../../backend/deployment-identity.ts";
import { IMAGE_PROCESS_LIMITS as limits } from "./contracts.ts";
import type { ImageJobExecutor } from "./contracts.ts";
export function imageDockerArguments(
  name: string,
  image: string,
  label: string,
): string[] {
  return [
    "create",
    "--pull=never",
    "--name",
    name,
    "--label",
    label,
    "-i",
    "--memory=512m",
    "--memory-swap=512m",
    "--cpus=1",
    "--pids-limit=32",
    "--network=none",
    "--read-only",
    "--tmpfs",
    "/tmp:rw,noexec,nosuid,nodev,size=128m",
    "--cap-drop=ALL",
    "--security-opt=no-new-privileges",
    "--user=10001:10001",
    image,
  ];
}
export function byteLimit(max: number): Transform {
  let count = 0;
  return new Transform({
    transform(chunk, _encoding, callback) {
      count += chunk.length;
      callback(count > max ? Error("image_byte_limit") : null, chunk);
    },
  });
}
/** Controller-only Docker owner. Admission remains held until container absence is verified after success, abort or failure. */
export function createImageJobExecutor(
  options: { image?: string; deploymentNamespace?: string } = {},
): ImageJobExecutor {
  const deployment = deploymentIdentity(options.deploymentNamespace),
    identity = {
      namePrefix: deployment.namespace + "-image-",
      label: deployment.namespace + ".image-processor=1",
    },
    image = options.image ?? "pagegi-image-processor:local",
    active = new Map<AbortController, Promise<void>>();
  let closed = false,
    cleanupFailed = false;
  return {
    async execute(input, write, signal) {
      if (closed) throw Error("image_unavailable");
      if (active.size) throw Error("image_busy");
      signal?.throwIfAborted();
      const abort = new AbortController(),
        forward = () => abort.abort(signal?.reason),
        name = identity.namePrefix + randomUUID();
      signal?.addEventListener("abort", forward, { once: true });
      let release!: () => void;
      active.set(abort, new Promise<void>((r) => (release = r)));
      const timer = setTimeout(
        () => abort.abort(Error("image_deadline")),
        limits.jobMs,
      );
      let child: ReturnType<typeof spawn> | undefined;
      try {
        const imageId = await dockerCommand(
          ["image", "inspect", "--format", "{{.Id}}", image],
          5000,
        );
        if (!/^sha256:[a-f0-9]{64}$/.test(imageId))
          throw Error("image_unavailable");
        abort.signal.throwIfAborted();
        await dockerCommand(
          imageDockerArguments(name, imageId, identity.label),
          5000,
        );
        abort.signal.throwIfAborted();
        child = spawn("docker", ["start", "-ai", name], {
          stdio: ["pipe", "pipe", "pipe"],
        });
        const running = child;
        const kill = () => running.kill("SIGKILL");
        abort.signal.addEventListener("abort", kill, { once: true });
        const exited = new Promise<void>((resolve, reject) => {
          running.once("error", () => reject(Error("image_unavailable")));
          running.once("close", (code) =>
            code === 0 ? resolve() : reject(Error("image_processing_failed")),
          );
        });
        running.stderr!.on("data", () => {});
        const output = new Writable({
          write(chunk, _encoding, callback) {
            write(chunk).then(() => callback(), callback);
          },
        });
        const tasks = [
          exited,
          pipeline(
            Readable.from(input),
            byteLimit(limits.inputBytes),
            running.stdin!,
            { signal: abort.signal },
          ),
          pipeline(running.stdout!, byteLimit(limits.outputBytes), output, {
            signal: abort.signal,
          }),
        ];
        try {
          await Promise.all(tasks);
        } catch (error) {
          abort.abort(error);
          await Promise.allSettled(tasks);
          throw error;
        } finally {
          abort.signal.removeEventListener("abort", kill);
        }
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", forward);
        child?.kill("SIGKILL");
        try {
          if (!(await removeBackendContainer(dockerCommand, name))) {
            closed = true;
            cleanupFailed = true;
            throw Error("image_cleanup_failed");
          }
        } finally {
          active.delete(abort);
          release();
        }
      }
    },
    async close() {
      closed = true;
      const work = [...active.values()];
      for (const a of active.keys()) a.abort();
      await Promise.all(work);
      if (cleanupFailed) throw Error("image_cleanup_failed");
    },
  };
}
