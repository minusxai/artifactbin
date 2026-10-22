import { parseDatasetPolicy } from "../sql/engine/predicates.ts";
import { translateDataset, permitsDatasetAction } from "./grants.ts";
import type { DatasetReadAuthority } from "../contracts.ts";
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const only = (v: Record<string, unknown>, allowed: string[]) =>
  Object.keys(v).every((k) => allowed.includes(k));
/** Mutation restrictions are validated faithfully but never applied as SELECT row filters. */
function mutationMetadata(tables: unknown, execution: unknown): boolean {
  if (
    execution &&
    typeof execution === "object" &&
    Object.hasOwn(execution, "extensions")
  )
    return false;
  try {
    parseDatasetPolicy({
      version: 1,
      enforcement: "enabled",
      tables,
      ...(execution === undefined ? {} : { execution }),
    });
    return true;
  } catch {
    return false;
  }
}
export function legacyAudienceReadable(
  row: {
    id: string;
    owner: {
      userId: string | null;
      tokenId: string | null;
      groupId?: string | null;
    };
    visibility: string;
  },
  facts: DatasetReadAuthority["facts"],
): boolean {
  if (!["private", "public", "unlisted"].includes(row.visibility)) return false;
  const { owner } = row;
  const caller = facts.caller;
  const group = owner.groupId;
  const role =
    group && Object.hasOwn(facts.groupRoles, group)
      ? facts.groupRoles[group]
      : undefined;
  const owns = group
    ? caller.groupId === group
    : owner.userId
      ? owner.userId === caller.userId
      : !!caller.tokenId && owner.tokenId === caller.tokenId;
  return (
    owns ||
    role === "editor" ||
    role === "viewer" ||
    row.visibility !== "private" ||
    (!!caller.userId && facts.sharedArtifactIds.includes(row.id))
  );
}
export function datasetReadable(authority: DatasetReadAuthority): boolean {
  const { page, dataset, facts } = authority;
  if (
    dataset.deleted ||
    !["private", "public", "unlisted"].includes(dataset.visibility) ||
    page.deleted ||
    page.format !== "markup" ||
    !legacyAudienceReadable(page, facts)
  )
    return false;
  const p = dataset.policy;
  if (p === null) return legacyAudienceReadable(dataset, facts);
  if (
    !object(p) ||
    JSON.stringify(p).length > 64000 ||
    !only(
      p,
      p.version === 1
        ? ["version", "enforcement", "tables", "execution"]
        : ["version", "allow", "tables", "execution"],
    )
  )
    return false;
  if (p.version === 1)
    return (
      p.enforcement === "enabled" &&
      mutationMetadata(p.tables, p.execution) &&
      legacyAudienceReadable(dataset, facts)
    );
  if (p.version !== 2 || !mutationMetadata(p.tables ?? [], p.execution))
    return false;
  const translated = translateDataset({
    ...dataset,
    policy: { version: 2, allow: p.allow },
  });
  return (
    translated.ok &&
    permitsDatasetAction(translated.dataset, {
      action: "read",
      facts,
      currentPolicyRevision: dataset.policyRevision,
      document: page,
    })
  );
}
