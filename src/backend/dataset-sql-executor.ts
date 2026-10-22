import { SERVER_QUERY_LIMITS as queryLimits } from "../datasets/query/contracts.ts";
import {
  validateDatasetQueryJob,
  decodeDatasetQueryAnswer,
} from "../datasets/sql/read-job.ts";
import type {
  DatasetQueryJob,
  ServerQueryAnswer,
} from "../datasets/query/contracts.ts";
import type { DatasetSqlJob } from "../datasets/mutation/contracts.ts";
import { decodeDatasetSqlOutcome } from "../datasets/sql/outcome.ts";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { dockerCommand } from "./reaper.ts";
import { removeBackendContainer } from "./container-cleanup.ts";
import { deploymentIdentity } from "./deployment-identity.ts";
import { DATASET_SQL_LIMITS as limits } from "../datasets/mutation/contracts.ts";
import { validateDatasetSqlJob } from "../datasets/sql/job.ts";
import type {
  DatasetSqlExecutor,
  DatasetSqlExecutorOptions,
} from "./dataset-sql-contracts.ts";
import type { MutationOutcome } from "../datasets/sql/engine/sql-contracts.ts";
/** Fixed controller-owned entrypoint; no caller code, Docker flags, mounts, environment or networking. */
export const datasetSqlDockerArguments = (
  name: string,
  image: string,
  label: string,
) => [
  "create",
  "--pull=never",
  "--name",
  name,
  "--label",
  label,
  "-i",
  "--memory=256m",
  "--memory-swap=256m",
  "--cpus=1",
  "--pids-limit=32",
  "--network=none",
  "--read-only",
  "--tmpfs",
  "/tmp:rw,noexec,nosuid,nodev,size=8m",
  "--cap-drop=ALL",
  "--security-opt=no-new-privileges",
  "--user=10001:10001",
  image,
];
export function createDatasetSqlExecutor(
  options: DatasetSqlExecutorOptions = {},
): DatasetSqlExecutor {
  const identity = deploymentIdentity(options.deploymentNamespace),
    image = options.image ?? "pagegi-dataset-sql:local",
    max = options.maxConcurrent ?? 2;
  if (!Number.isSafeInteger(max) || max < 1 || max > 16)
    throw Error("Invalid SQL concurrency");
  let closed = false,
    cleanupFailed = false;
  const active = new Map<AbortController, Promise<unknown>>();
  async function executeJob(
    job: DatasetSqlJob | DatasetQueryJob,
    signal?: AbortSignal,
  ): Promise<MutationOutcome | ServerQueryAnswer> {
    if (job.kind === "dataset-query") validateDatasetQueryJob(job);
    else validateDatasetSqlJob(job);
    if (closed) throw Error("sql_unavailable");
    if (signal?.aborted) throw Error("cancelled");
    if (active.size >= max) throw Error("sql_busy");
    const abort = new AbortController(),
      forward = () => abort.abort();
    signal?.addEventListener("abort", forward, { once: true });
    const name = identity.namePrefix + randomUUID();
    let done!: () => void;
    const completion = new Promise<void>((r) => {
      done = r;
    });
    active.set(abort, completion);
    try {
      const imageId = await dockerCommand(
        ["image", "inspect", "--format", "{{.Id}}", image],
        5000,
      );
      if (!/^sha256:[a-f0-9]{64}$/.test(imageId))
        throw Error("sql_image_invalid");
      if (abort.signal.aborted) throw Error("cancelled");
      await dockerCommand(
        datasetSqlDockerArguments(name, imageId, identity.label),
        5000,
      );
      if (abort.signal.aborted) throw Error("cancelled");
      return await new Promise<MutationOutcome | ServerQueryAnswer>(
        (resolve, reject) => {
          const child = spawn("docker", ["start", "-ai", name], {
            stdio: ["pipe", "pipe", "pipe"],
          });
          let total = 0,
            settled = false;
          const chunks: Buffer[] = [];
          const finish = (
            error?: Error,
            value?: MutationOutcome | ServerQueryAnswer,
          ) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            abort.signal.removeEventListener("abort", cancel);
            if (error) {
              child.kill("SIGKILL");
              reject(error);
            } else resolve(value!);
          };
          const cancel = () => finish(Error("cancelled"));
          const timer = setTimeout(
            () => finish(Error("sql_deadline")),
            limits.wallMs,
          );
          abort.signal.addEventListener("abort", cancel, { once: true });
          child.stdout.on("data", (chunk: Buffer) => {
            total += chunk.length;
            if (
              total >
              (job.kind === "dataset-query"
                ? queryLimits.outputBytes
                : limits.outputBytes)
            )
              finish(Error("sql_output_limit"));
            else chunks.push(chunk);
          });
          child.stderr.on("data", () => {});
          child.stdin.on("error", () => {});
          child.on("error", () => finish(Error("sql_unavailable")));
          child.on("close", (code) => {
            if (settled) return;
            if (code !== 0) return finish(Error("sql_failed"));
            try {
              const value: unknown = JSON.parse(
                Buffer.concat(chunks, total).toString("utf8"),
              );
              if (!value || typeof value !== "object" || Array.isArray(value))
                throw Error();
              finish(
                undefined,
                job.kind === "dataset-query"
                  ? decodeDatasetQueryAnswer(job, value)
                  : decodeDatasetSqlOutcome(job, value),
              );
            } catch {
              finish(Error("sql_invalid_result"));
            }
          });
          child.stdin.end(JSON.stringify(job));
        },
      );
    } finally {
      signal?.removeEventListener("abort", forward);
      try {
        if (!(await removeBackendContainer(dockerCommand, name))) {
          closed = true;
          cleanupFailed = true;
          throw Error("sql_cleanup_failed");
        }
      } finally {
        active.delete(abort);
        done();
      }
    }
  }
  return {
    async execute(job, signal) {
      return (await executeJob(job, signal)) as MutationOutcome;
    },
    async query(job, signal) {
      return (await executeJob(job, signal)) as ServerQueryAnswer;
    },
    async close() {
      closed = true;
      const work = [...active.values()];
      for (const c of active.keys()) c.abort();
      await Promise.all(work);
      if (cleanupFailed) throw Error("sql_cleanup_failed");
    },
  };
}
