import type { SessionResource } from "../../../contracts/src/account-resource";
import type { RemoteSessionInfo } from "../../../contracts/src/remote";
import type { TokenActor } from "../artifacts";
import { remoteAgents } from "./agents";

/**
 * The relay's live session, projected into the editable-resource vocabulary the
 * CLI addresses with `--type session`. The relay protocol keeps its own shape
 * for the browser mirror and the runner; this is the read-only resource view of
 * the same registry entry, so nothing is stored twice.
 */
export function sessionResource(info: RemoteSessionInfo): SessionResource {
  return {
    type: "session",
    ...(info.managed?{managed:true,activity:info.activity,color:info.color}:{}),
    id: info.id,
    name: info.name,
    harness: info.harness,
    machine: info.machine,
    cwd: info.cwd,
    status: info.exitCode !== null ? "exited" : info.online ? "online" : "offline",
    cols: info.cols,
    rows: info.rows,
    controller: info.controller,
    created_at: info.createdAt,
  };
}

/**
 * Authorization for a session operation, answered without consuming the
 * session: a terminate that is retried under the same operation identity must
 * still authorize after the row is gone, so an owned tombstone counts.
 */
export async function sessionOwnedBy(actor: TokenActor, id: string): Promise<boolean> {
  return !!actor.userId && await remoteAgents.owns(actor.userId, id);
}
