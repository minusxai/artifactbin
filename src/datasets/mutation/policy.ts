import { legacyAudienceReadable } from "../policy/read.ts";
import { translateDataset, permitsDatasetAction } from "../policy/grants.ts";
import {
  parseDatasetPolicy,
  viewersWritePolicy,
} from "../sql/engine/predicates.ts";
import {
  DatasetMutationError,
  type DatasetMutationHead,
  type DatasetMutationOperation,
  type DatasetPolicySelection,
} from "./contracts.ts";
/** Pure selection; transaction adapter must repeat against locked current facts at commit. */
export function selectDatasetMutationPolicy(
  head: DatasetMutationHead,
  operation: DatasetMutationOperation,
): DatasetPolicySelection {
  const a = head.authority,
    d = a.dataset,
    p = d.policy;
  if (
    d.deleted ||
    a.page.deleted ||
    a.page.format !== "markup" ||
    a.pageVersion !== operation.page.version ||
    a.page.id !== operation.page.legacyId ||
    a.page.editId !== operation.page.editId ||
    d.id !== operation.datasetId ||
    d.policyRevision !== head.policyRevision ||
    !head.documentWriterCanRead ||
    !legacyAudienceReadable(a.page, a.facts) ||
    !legacyAudienceReadable(d, a.facts)
  )
    throw new DatasetMutationError("denied");
  const all = ["insert", "update", "delete"] as const;
  if (p === null) {
    if (!head.writable || !head.callerCanEdit)
      throw new DatasetMutationError("denied");
    return { operations: all };
  }
  if (!p || typeof p !== "object" || Array.isArray(p))
    throw new DatasetMutationError("unsupported_policy");
  const raw = p as Record<string, unknown>;
  let operations: ("insert" | "update" | "delete")[];
  if (raw.version === 2) {
    if (
      Object.keys(raw).some(
        (k) => !["version", "allow", "tables", "execution"].includes(k),
      )
    )
      throw new DatasetMutationError("unsupported_policy");
    const translated = translateDataset({
      ...d,
      policy: { version: 2, allow: raw.allow },
    });
    if (!translated.ok) throw new DatasetMutationError("unsupported_policy");
    operations = all.filter((action) =>
      permitsDatasetAction(translated.dataset, {
        action,
        facts: a.facts,
        currentPolicyRevision: head.policyRevision,
        document: a.page,
        requestedDocument: {
          id: operation.page.legacyId,
          editId: operation.page.editId,
        },
      }),
    );
  } else if (raw.version === 1) {
    if (!head.writable) throw new DatasetMutationError("denied");
    operations = [...all];
  } else throw new DatasetMutationError("unsupported_policy");
  if (!operations.length) throw new DatasetMutationError("denied");
  let policy;
  try {
    policy = parseDatasetPolicy(
      raw.version === 2
        ? {
            version: 1,
            enforcement: "enabled",
            tables:
              raw.tables ??
              viewersWritePolicy({
                schema: operation.target.schema,
                name: operation.target.table,
              }).tables,
            ...(raw.execution === undefined
              ? {}
              : { execution: raw.execution }),
          }
        : raw,
    );
  } catch {
    throw new DatasetMutationError("unsupported_policy");
  }
  // Extensions require a separately implemented trusted capability and must not silently disappear.
  if (
    policy.execution?.extensions &&
    Object.keys(policy.execution.extensions).length
  )
    throw new DatasetMutationError("unsupported_policy");
  const table = policy.tables.find(
    (t) =>
      t.table.schema === operation.target.schema &&
      t.table.name === operation.target.table,
  );
  if (!table) throw new DatasetMutationError("denied");
  return {
    operations,
    policy: {
      table,
      role: "viewer",
      session: {
        "x-hasura-role": "viewer",
        ...(a.facts.caller.userId
          ? { "x-hasura-user-id": a.facts.caller.userId }
          : {}),
      },
      operations,
      execution: policy.execution,
    },
  };
}
