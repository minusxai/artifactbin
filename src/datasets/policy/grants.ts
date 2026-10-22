import type {
  Principal,
  Grant,
  DatasetSnapshot,
  Translation,
  TranslatedDataset,
  Evaluation,
  AuthorizationFacts,
} from "./contracts.ts";
const actions = ["read", "insert", "update", "delete"];
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const keys = (v: Record<string, unknown>, allowed: string[]) =>
  Object.keys(v).every((k) => allowed.includes(k));
/** Deliberately bounded translation: no SQL predicate is silently dropped. */
export function translateDataset(source: DatasetSnapshot): Translation {
  const p = source.policy;
  if (!Number.isSafeInteger(source.policyRevision) || source.policyRevision < 0)
    return { ok: false, reason: "Invalid policy revision" };
  if (
    !object(p) ||
    !keys(p, ["version", "allow"]) ||
    p.version !== 2 ||
    !Array.isArray(p.allow) ||
    p.allow.length > 64
  )
    return {
      ok: false,
      reason: "Unsupported policy; requires manual migration",
    };
  for (const g of p.allow) {
    if (
      !object(g) ||
      !keys(g, ["actions", "from"]) ||
      !Array.isArray(g.actions) ||
      !g.actions.length ||
      new Set(g.actions).size !== g.actions.length ||
      g.actions.some((a) => !actions.includes(a)) ||
      !object(g.from) ||
      !Object.keys(g.from).length ||
      !keys(g.from, ["user", "artifact", "artifactOwner"])
    )
      return { ok: false, reason: "Invalid grant" };
    for (const [field, target] of Object.entries(g.from))
      if (
        typeof target !== "string" ||
        !(
          target === "*" ||
          (target === "$owner" && field !== "artifact") ||
          (field === "artifact"
            ? /^[A-Za-z0-9]{6,128}$/
            : /^[A-Za-z0-9_-]{1,128}$/
          ).test(target)
        )
      )
        return { ok: false, reason: "Invalid selector" };
  }
  return {
    ok: true,
    dataset: {
      id: source.id,
      owner: { ...source.owner },
      visibility: source.visibility,
      policyRevision: source.policyRevision,
      ownerIsTestUser: source.ownerIsTestUser,
      grants: structuredClone(p.allow) as Grant[],
    },
  };
}
function same(a: Principal, b: Principal): boolean {
  if (a.groupId || b.groupId) return !!a.groupId && a.groupId === b.groupId;
  if (a.userId || b.userId) return !!a.userId && a.userId === b.userId;
  return !!a.tokenId && a.tokenId === b.tokenId;
}
function owns(owner: Principal, caller: Principal): boolean {
  return owner.groupId
    ? owner.groupId === caller.groupId
    : owner.userId
      ? owner.userId === caller.userId
      : !!caller.tokenId && owner.tokenId === caller.tokenId;
}
function groupRole(
  facts: AuthorizationFacts,
  groupId: string,
): "viewer" | "editor" | undefined {
  if (!Object.hasOwn(facts.groupRoles, groupId)) return undefined;
  const role = facts.groupRoles[groupId];
  return role === "viewer" || role === "editor" ? role : undefined;
}
function readable(
  row: { id: string; owner: Principal; visibility: string },
  f: AuthorizationFacts,
): boolean {
  return (
    !!(row.owner.groupId && groupRole(f, row.owner.groupId)) ||
    owns(row.owner, f.caller) ||
    row.visibility !== "private" ||
    (!!f.caller.userId && f.sharedArtifactIds.includes(row.id))
  );
}
function person(
  target: string,
  principal: Principal,
  owner: Principal,
): boolean {
  return (
    target === "*" ||
    (target === "$owner"
      ? same(principal, owner)
      : !!principal.userId && target === principal.userId)
  );
}
/** Authorization only. This is not a query engine or a runtime capability. */
export function permitsDatasetAction(
  dataset: TranslatedDataset,
  request: Evaluation,
): boolean {
  const { facts: f, document: doc, requestedDocument: ref, action } = request;
  if (request.currentPolicyRevision !== dataset.policyRevision) return false;
  if (action === "read") {
    if (dataset.visibility === "private" && !readable(dataset, f)) return false;
    if (doc && (!readable(doc, f) || doc.deleted)) return false;
  } else {
    if (f.caller.userId && (!f.identity || f.identity === "guest"))
      return false;
    if (f.identity === "testuser" && !dataset.ownerIsTestUser) return false;
    if (ref || doc) {
      if (
        !ref ||
        !doc ||
        doc.deleted ||
        doc.format !== "markup" ||
        doc.id !== ref.id ||
        doc.editId !== ref.editId ||
        !readable(doc, f)
      )
        return false;
      const tokenCreator =
        !doc.owner.groupId && !doc.owner.userId && owns(doc.owner, f.caller);
      if (
        !tokenCreator &&
        (!f.caller.userId ||
          !f.identity ||
          f.identity === "guest" ||
          (f.identity === "testuser" && !doc.ownerIsTestUser) ||
          !doc.acceptedJoinUserIds.includes(f.caller.userId))
      )
        return false;
    } else if (!f.identity && !owns(dataset.owner, f.caller)) return false;
  }
  return dataset.grants.some(
    (g) =>
      g.actions.includes(action) &&
      Object.entries(g.from).every(([field, target]) => {
        if (field === "user")
          return (
            (target === "$owner" &&
              !!dataset.owner.groupId &&
              groupRole(f, dataset.owner.groupId) === "editor") ||
            person(target, f.caller, dataset.owner)
          );
        if (!doc) return false;
        return field === "artifact"
          ? target === "*" || target === doc.id
          : field === "artifactOwner" &&
              person(target, doc.owner, dataset.owner);
      }),
  );
}
