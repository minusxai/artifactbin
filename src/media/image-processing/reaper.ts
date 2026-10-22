import type { ImageContainerCommands } from "./contracts.ts";
import { deploymentIdentity } from "../../backend/deployment-identity.ts";
/** Dedicated namespace: this cleanup cannot select existing backend/SQL containers. */
export async function reapImageContainers(
  docker: ImageContainerCommands,
  namespace?: string,
  now: () => number = () => performance.now(),
): Promise<void> {
  const deployment = deploymentIdentity(namespace),
    label = deployment.namespace + ".image-processor",
    name = new RegExp(
      "^/" +
        deployment.namespace +
        "-image-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$",
    ),
    deadline = now() + 30_000;
  const command = async (args: readonly string[]) => {
    const remaining = Math.floor(deadline - now());
    if (remaining < 1) throw Error("image_cleanup_failed");
    const result = await docker(args, Math.min(3000, remaining));
    if (now() >= deadline) throw Error("image_cleanup_failed");
    return result;
  };
  const list = async () => {
    const raw = await command([
      "ps",
      "-aq",
      "--filter",
      "label=" + label + "=1",
    ]);
    const ids = raw ? raw.split("\n") : [];
    if (
      ids.length > 128 ||
      new Set(ids).size !== ids.length ||
      ids.some((id) => !/^[a-f0-9]{12,64}$/.test(id))
    )
      throw Error("image_cleanup_failed");
    return ids;
  };
  const ids = await list();
  const proven: string[] = [];
  for (const id of ids) {
    let rows;
    try {
      rows = JSON.parse(await command(["inspect", id]));
    } catch {
      throw Error("image_cleanup_failed");
    }
    if (
      !Array.isArray(rows) ||
      rows.length !== 1 ||
      typeof rows[0]?.Id !== "string" ||
      !rows[0].Id.startsWith(id) ||
      !/^([a-f0-9]{64})$/.test(rows[0].Id) ||
      !name.test(rows[0].Name) ||
      rows[0].Config?.Labels?.[label] !== "1"
    )
      throw Error("image_cleanup_failed");
    if (proven.includes(rows[0].Id)) throw Error("image_cleanup_failed");
    proven.push(rows[0].Id);
  }
  for (const id of proven) await command(["rm", "-f", id]);
  if ((await list()).length) throw Error("image_cleanup_failed");
}
