import type { SqlClient, SqlDatabase } from "./sql.ts";
import type { DatasetReadRepository } from "../datasets/repository-contracts.ts";
import type {
  DatasetBinding,
  DatasetCallContext,
} from "../datasets/contracts.ts";
import type {
  DatasetSnapshot,
  DocumentSnapshot,
  AuthorizationFacts,
} from "../datasets/policy/contracts.ts";
import type { AccessPolicy } from "../contracts.ts";
import { loadDocumentHeader } from "./document-records.ts";
import { loadGroupAuthority } from "./group-memberships.ts";
import { authorizePageRead } from "../server/document-authorization.ts";
import { policyFor } from "../access.ts";
import { decodeDatasetBinding } from "./dataset-records.ts";
async function bound(
  client: SqlClient,
  context: DatasetCallContext,
  name: string,
  locked = false,
) {
  return (
    (
      await client.query(
        `SELECT b.*,v.catalog FROM dataset_bindings b
     JOIN dataset_versions v ON v.source_namespace=b.source_namespace AND v.legacy_id=b.dataset_id AND v.version=b.dataset_version
     JOIN files f ON f.id=b.page_id AND f.head=b.page_version::text
     WHERE b.backend_id=$1 AND b.backend_version=$2 AND b.page_id=$3 AND b.name=$4
     AND EXISTS(SELECT 1 FROM af_page_backends p WHERE p.page_id=b.page_id AND p.page_version=b.page_version AND p.file_id=b.backend_id AND p.version=b.backend_version)${locked ? " FOR SHARE OF f" : ""}`,
        [context.backendId, context.backendVersion, context.pageId, name],
      )
    ).rows[0] ?? null
  );
}
/** Re-read both policies and identity facts for every before/after-I/O authorization. */
export function createDatasetReadRepository(
  database: SqlDatabase,
  now = Date.now,
): DatasetReadRepository {
  return {
    binding: (context, name) =>
      database.transaction(async (client) => {
        const row = await bound(client, context, name);
        return row ? decodeDatasetBinding(row, context, name) : null;
      }),
    authority: (context, binding) =>
      database.transaction((client) => loadDatasetAuthority(client, context, binding, now())),
  };
}
/** Shared-client boundary for transaction-time write validation. Mutators lock
 * group principals before page/resource rows, and use UPDATE on the resource. */
export async function loadDatasetAuthority(
  client: SqlClient,
  context: DatasetCallContext,
  binding: DatasetBinding,
  now: number,
  locked = false,
) {
        const timestamp = now;
        const groupAuthority = context.subject
          ? await loadGroupAuthority(client, context.subject) : undefined;
        const row = await bound(client, context, binding.name, locked);
        const saved = row
          ? decodeDatasetBinding(row, context, binding.name)
          : null;
        if (
          !row ||
          !saved ||
          saved.page.version !== binding.page.version ||
          saved.page.legacyId !== binding.page.legacyId ||
          saved.page.editId !== binding.page.editId ||
          saved.dataset.id !== binding.dataset.id ||
          saved.dataset.version !== binding.dataset.version ||
          saved.dataset.policyRevision !== binding.dataset.policyRevision
        )
          return null;
        const namespace = String(row.source_namespace);
        const page = await loadDocumentHeader(client, context.pageId);
        if (!page) return null;
        const resource = (
          await client.query(
            "SELECT r.*,a.principal_kind FROM dataset_resources r JOIN accounts a ON a.actor=r.owner WHERE r.source_namespace=$1 AND r.legacy_id=$2" + (locked ? " FOR SHARE OF r,a" : ""),
            [namespace, saved.dataset.id],
          )
        ).rows[0];
        if (!resource || resource.deleted) return null;
        const pageRow = (
          await client.query(
            "SELECT snapshot FROM dataset_pages WHERE page_id=$1 AND page_version=$2 AND source_namespace=$3",
            [context.pageId, saved.page.version, namespace],
          )
        ).rows[0];
        if (!pageRow) return null;
        if (
          context.subject &&
          !(
            await client.query(
              "SELECT 1 FROM accounts WHERE actor=$1 AND principal_kind='user'",
              [context.subject],
            )
          ).rows.length
        )
          return null;
        const session = context.subject
          ? {
              actor: context.subject,
              fileId: null,
              generation: null,
              expires: timestamp + 1,
              groupAuthority,
            }
          : null;
        const access = resource.access as AccessPolicy;
        try {
          authorizePageRead({
            fileId: context.pageId,
            document: page,
            session,
            now: timestamp,
          });
          authorizePageRead({
            fileId: saved.dataset.id,
            document: {
              owner: String(resource.owner),
              ownerKind: resource.principal_kind === "group" ? "group" : "user",
              generation: Number(resource.generation),
              shareHash: "",
              access,
            },
            session,
            now: timestamp,
          });
        } catch {
          return null;
        }
        const mappings = context.subject
          ? (
              await client.query(
                "SELECT legacy_id,identity,expires_at FROM dataset_principals WHERE source_namespace=$1 AND actor=$2 AND kind='user' ORDER BY legacy_id" + (locked ? " FOR SHARE" : ""),
                [namespace, context.subject],
              )
            ).rows
          : [];
        // Ownership provenance for legacy tokens is never proof of an authenticated token principal.
        if (mappings.length > 1) return null;
        if (mappings[0]?.expires_at != null) {
          const originalExpiry = mappings[0].expires_at;
          const expiresAt =
            originalExpiry instanceof Date
              ? originalExpiry.getTime()
              : typeof originalExpiry === "string"
                ? Date.parse(originalExpiry)
                : NaN;
          if (!Number.isFinite(expiresAt) || expiresAt <= timestamp)
            return null;
        }
        const facts: AuthorizationFacts = {
          caller: {
            userId: mappings.length ? String(mappings[0]!.legacy_id) : null,
            tokenId: null,
          },
          identity: mappings.length
            ? (mappings[0]!.identity as AuthorizationFacts["identity"])
            : context.subject
              ? "user"
              : "guest",
          groupRoles: Object.create(null),
          sharedArtifactIds: [],
        };
        if (groupAuthority?.memberships.length) {
          const groups = (
            await client.query(
              "SELECT owner,legacy_group_id FROM dataset_groups WHERE source_namespace=$1 AND owner=ANY($2::text[])",
              [namespace, groupAuthority.memberships.map((m) => m.owner)],
            )
          ).rows;
          const roles: Record<string, "viewer" | "editor"> =
            Object.create(null);
          for (const g of groups) {
            const membership = groupAuthority.memberships.find(
              (m) => m.owner === g.owner,
            );
            if (membership) roles[String(g.legacy_group_id)] = membership.role;
          }
          facts.groupRoles = roles;
        }
        const pageAccess = policyFor(page);
        if (context.subject && facts.caller.userId) {
          const shared: string[] = [];
          if (Object.hasOwn(pageAccess.shares, context.subject))
            shared.push(saved.page.legacyId);
          if (Object.hasOwn(access.shares, context.subject))
            shared.push(saved.dataset.id);
          facts.sharedArtifactIds = shared;
        }
        const snapshot = pageRow.snapshot as DocumentSnapshot;
        if (
          snapshot.id !== saved.page.legacyId ||
          snapshot.editId !== saved.page.editId
        )
          return null;
        const joins = (
          await client.query(
            "SELECT legacy_user_id FROM dataset_page_joins WHERE page_id=$1 AND source_namespace=$2 ORDER BY legacy_user_id" + (locked ? " FOR SHARE" : ""),
            [context.pageId, namespace],
          )
        ).rows;
        const dataset = resource.snapshot as DatasetSnapshot;
        if (dataset.id !== saved.dataset.id) return null;
        return {
          page: {
            ...snapshot,
            visibility: pageAccess.visibility,
            acceptedJoinUserIds: joins.map((j) => String(j.legacy_user_id)),
          },
          pageVersion: Number(page.head),
          dataset: {
            ...dataset,
            visibility: access.visibility,
            policyRevision: Number(resource.policy_revision),
            deleted: Boolean(resource.deleted),
          },
          facts,
        };

}
