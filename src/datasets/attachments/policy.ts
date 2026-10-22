import { parseDatasetPolicy } from "../sql/engine/predicates.ts";
import { translateDataset, permitsDatasetAction } from "../policy/grants.ts";
import { datasetReadable } from "../policy/read.ts";
import type {
  DatasetAttachmentAuthority,
  DatasetAttachmentContext,
} from "./contracts.ts";
/** Original imageInsertAllowed: explicit v2 insert selector, independent of SQL row permissions. */
export function datasetAttachmentAllowed(
  context: DatasetAttachmentContext,
  snapshot: DatasetAttachmentAuthority,
  action: "insert" | "read",
): boolean {
  const { binding: b } = snapshot.registration,
    a = snapshot.authority;
  if (
    snapshot.registration.backendNamespace !== context.backendNamespace ||
    b.mode !== "live" ||
    b.name !== context.bindingName ||
    b.backendId !== context.backendId ||
    b.backendVersion !== context.backendVersion ||
    b.page.id !== context.pageId ||
    b.page.version !== a.pageVersion ||
    b.page.legacyId !== a.page.id ||
    b.page.editId !== a.page.editId ||
    b.dataset.id !== a.dataset.id ||
    a.page.deleted ||
    a.dataset.deleted
  )
    return false;
  if (action === "read") return datasetReadable(a);
  if (
    !context.subject ||
    !a.facts.caller.userId ||
    !["user", "testuser"].includes(a.facts.identity ?? "")
  )
    return false;
  const raw = a.dataset.policy;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const p = raw as Record<string, unknown>;
  if (
    p.version !== 2 ||
    Object.keys(p).some(
      (k) => !["version", "allow", "tables", "execution"].includes(k),
    ) ||
    JSON.stringify(p).length > 64000
  )
    return false;
  try {
    const restrictions = parseDatasetPolicy({
      version: 1,
      enforcement: "enabled",
      tables: Object.hasOwn(p, "tables") ? p.tables : [],
      ...(p.execution === undefined ? {} : { execution: p.execution }),
    });
    if (
      restrictions.tables.some((t) =>
        ["insert_permissions", "update_permissions", "delete_permissions"].some(
          (k) =>
            (t[k as "insert_permissions"] ?? []).some(
              (e) => e.role !== "viewer",
            ),
        ),
      )
    )
      return false;
  } catch {
    return false;
  }
  const translated = translateDataset({
    ...a.dataset,
    policy: { version: 2, allow: p.allow },
  });
  return (
    translated.ok &&
    permitsDatasetAction(translated.dataset, {
      action: "insert",
      facts: a.facts,
      currentPolicyRevision: a.dataset.policyRevision,
      document: a.page,
      requestedDocument: { id: b.page.legacyId, editId: b.page.editId },
    })
  );
}
