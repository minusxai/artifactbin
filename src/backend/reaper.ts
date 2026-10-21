/**
 * Startup cleanup for the execution controller: the backend containers a
 * previous controller on this engine left behind. Every check of the
 * uninstalled host script this replaces is kept: a bounded inventory of
 * well-formed IDs, each container proven ours by label and generated name
 * before any is removed, and a final listing that must come back empty.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { DockerCommand, ReapBackendContainers } from "./execution-contracts.ts";

const exec = promisify(execFile);
const LABEL = "label=pagegi.backend=1";
const NAME = /^\/pagegi-backend-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;

/** The real `docker` CLI, as the controller runs it. */
export const dockerCommand: DockerCommand = async (args, timeoutMs = 3000) =>
  (await exec("docker", [...args], { timeout: timeoutMs })).stdout.trim();

export const reapBackendContainers: ReapBackendContainers = async (docker, { now = () => performance.now() } = {}) => {
  const deadline = now() + 30_000;
  /**
   * One bounded docker command. Past the deadline, an inspection or removal
   * that finished is still a failure (nothing may be removed late), but the
   * final listing's answer stands: it is what proves the engine clean.
   */
  async function command(args: readonly string[], limit: number, lateIsFailure = true): Promise<string> {
    const remaining = Math.floor(deadline - now());
    if (remaining < 1) throw Error("container cleanup deadline exceeded");
    const result = await docker(args, Math.min(limit, remaining));
    if (lateIsFailure && now() >= deadline) throw Error("container cleanup deadline exceeded");
    return result;
  }
  const listing = await command(["ps", "-aq", "--filter", LABEL], 3000);
  const ids = listing ? listing.split("\n") : [];
  if (ids.length > 1024 || new Set(ids).size !== ids.length || ids.some((id) => !/^[a-f0-9]{12,64}$/.test(id)))
    throw Error("unexpected container inventory");
  for (let offset = 0; offset < ids.length; offset += 16) {
    const batch = ids.slice(offset, offset + 16);
    const containers: unknown = JSON.parse(await command(["inspect", ...batch], 5000));
    if (!Array.isArray(containers) || containers.length !== batch.length) throw Error("incomplete container inspection");
    const covered = new Set<string>();
    for (const container of containers as Record<string, any>[]) {
      const fullId = container?.Id;
      const matches = typeof fullId === "string" ? ids.filter((id) => fullId.startsWith(id)) : [];
      if (
        typeof fullId !== "string" ||
        !/^[a-f0-9]{64}$/.test(fullId) ||
        matches.length !== 1 ||
        !batch.includes(matches[0]!) ||
        covered.has(matches[0]!) ||
        container?.Config?.Labels?.["pagegi.backend"] !== "1" ||
        typeof container?.Name !== "string" ||
        !NAME.test(container.Name)
      )
        throw Error("container ownership mismatch");
      covered.add(matches[0]!);
    }
    if (covered.size !== batch.length) throw Error("container identity mismatch");
  }
  // No mutation until every candidate, including later batches, is proven ours.
  for (let offset = 0; offset < ids.length; offset += 16) {
    await command(["rm", "-f", ...ids.slice(offset, offset + 16)], 10_000);
  }
  if (await command(["ps", "-aq", "--filter", LABEL], 3000, false)) throw Error("container cleanup incomplete");
  return ids.length;
};
