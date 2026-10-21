import type { CollaborationCatalog } from "./document-catalog-contracts.ts";
import type {
  CollaborationRepository,
  CollaborationMutation,
} from "../server/collaboration-contracts.ts";
import { lockDocumentHeader, loadSession } from "./document-records.ts";
import type { SqlDatabase, SqlClient } from "./sql.ts";

async function stage<T>(
  client: SqlClient,
  id: string,
  mutation: CollaborationMutation<T>,
) {
  const changes = mutation.documentChanges;
  if (changes) {
    // Fixed columns only: no domain input can become an SQL identifier.
    for (const [property, column] of [
      ["access", "access"],
      ["share", "share"],
      ["shareHash", "share_hash"],
      ["generation", "generation"],
    ] as const) {
      if (!Object.hasOwn(changes, property)) continue;
      await client.query(
        `UPDATE files SET ${column}=$2${property === "access" ? "::jsonb" : ""} WHERE id=$1`,
        [
          id,
          property === "access"
            ? JSON.stringify(changes.access)
            : changes[property],
        ],
      );
    }
  }
}
/** One document-row lock serializes sharing and presence commands. */
export function createCollaborationRepository(
  database: SqlDatabase,
  catalog: CollaborationCatalog,
): CollaborationRepository {
  return {
    authorize(id, credentialHash, operation) {
      return database.transaction(async (client) => {
        const session = await loadSession(client, credentialHash);
        const document = await lockDocumentHeader(client, id);
        return operation({
          document,
          session,
          sourceExists: async (revision) =>
            (
              await client.query(
                "SELECT 1 FROM sources WHERE file_id=$1 AND (revision=$2 OR digest=$2)",
                [id, revision],
              )
            ).rows.length > 0,
        });
      });
    },
    run(id, credentialHash, operation) {
      return database.transaction(async (client) => {
        const session = await loadSession(client, credentialHash);
        const document = await lockDocumentHeader(client, id);
        const mutation = await operation({
          document,
          session,
          sourceExists: async (revision) =>
            (
              await client.query(
                "SELECT 1 FROM sources WHERE file_id=$1 AND (revision=$2 OR digest=$2)",
                [id, revision],
              )
            ).rows.length > 0,
        });
        await stage(client, id, mutation);
        return mutation.value;
      });
    },
    sharedLink: catalog.sharedLink,
    profiles: catalog.profiles,
  };
}
