/**
 * The policy AS THE ENGINE READS IT — pure, DB-free, and shared by the two
 * doors that must agree: a click (mutationPolicy, next door) and a publish
 * (lib/story/data-checks, which may not reach the database layer at all).
 *
 * One role writes under a data policy: `viewer`. Everything else about the
 * grant is the policy document's own.
 */
import type {
  DatasetMutationPolicy,
  DatasetPolicy,
  Scalar,
} from '@artifactbin/contracts';

export const POLICY_ROLE = 'viewer';

/** The session a WRITE runs under: the role, plus who is writing when known. */
export function policySession(userId: string | null): Record<string, Scalar> {
  return {
    'x-hasura-role': POLICY_ROLE,
    ...(userId ? { 'x-hasura-user-id': userId } : {}),
  };
}

/**
 * The session a PUBLISH-TIME analysis runs under. There is no viewer yet, so
 * every `x-hasura-*` the policy names gets a placeholder: a session-scoped
 * filter then COMPILES (its values are bound parameters, and the analysis
 * reads the statement's shape, not its values) instead of refusing a document
 * no viewer would have been refused.
 */
export function placeholderSession(
  policy: DatasetPolicy,
): Record<string, Scalar> {
  const session = policySession(null);
  const visit = (value: unknown): void => {
    if (typeof value === 'string') {
      if (/^x-hasura-/i.test(value)) session[value.toLowerCase()] ??= '';
      return;
    }
    if (Array.isArray(value)) return value.forEach(visit);
    if (value && typeof value === 'object') Object.values(value).forEach(visit);
  };
  visit(policy.tables);
  return session;
}

/** The grant for ONE table, or undefined when the policy names no such table. */
export function viewerMutationPolicy(
  policy: DatasetPolicy,
  table: { schema: string; name: string },
  session: Record<string, Scalar>,
): DatasetMutationPolicy | undefined {
  const selected = policy.tables.find(
    (t) => t.table.schema === table.schema && t.table.name === table.name,
  );
  if (!selected) return undefined;
  return {
    table: selected,
    role: POLICY_ROLE,
    session,
    operations: ['insert', 'update', 'delete'],
    execution: policy.execution,
  };
}
