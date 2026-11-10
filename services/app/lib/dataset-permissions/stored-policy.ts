/**
 * THE STORED POLICY, read: a dataset's version 3 permissions (Hasura metadata shape), or, when none is stored,
 * the default (every rule role reads every table; nobody below editor writes). Every read and write decision
 * reads this (./read, ./write) and so does the policy door (lib/dataset-access/policy).
 *
 * Anything else stored, a retired version 1 or 2 policy or a version 3 one that no longer validates, THROWS
 * naming what it found and how to fix it: no rule is guessed. Owner and editor decisions never read it
 * (admin-equivalent), so an owner can still open the dataset and save a version 3 policy over it.
 */
import { DATASET_RULE_ROLES, type DatasetPermissions, type DatasetTableName } from '@artifactbin/contracts';
import { validateDatasetPermissions } from '@artifactbin/utils/dataset-permissions';

export interface StoredPolicyInput {
  policy: unknown;
  /** The dataset's catalog tables (none: a flat dataset's one `public.rows`): what the default covers. */
  tables: readonly DatasetTableName[];
}
export interface StoredPolicy {
  /** `none`: no policy is stored and `policy` is the default. */
  source: 'none' | 'v3';
  policy: DatasetPermissions;
}

const versionOf = (policy: unknown) =>
  policy && typeof policy === 'object' && !Array.isArray(policy) ? (policy as { version?: unknown }).version : undefined;

/** The stored policy as v3 permissions. Throws for anything that is not null or a valid version 3 policy. */
export function storedPolicy(input: StoredPolicyInput): StoredPolicy {
  if (input.policy === null || input.policy === undefined) {
    const tables = input.tables.length ? input.tables : [{ schema: 'public', name: 'rows' }];
    return {
      source: 'none',
      policy: {
        version: 3,
        tables: tables.map(({ schema, name }) => ({
          table: { schema, name },
          select_permissions: DATASET_RULE_ROLES.map((role) => ({ role, permission: { columns: '*', filter: {}, allow_aggregations: true } })),
        })),
      },
    };
  }
  const version = versionOf(input.policy);
  if (version !== 3)
    throw new Error(`The stored dataset policy is ${version === undefined ? 'not a versioned policy' : `version ${JSON.stringify(version)}`}: only version 3 is read. An owner or editor saves a version 3 policy (PUT /api/artifacts/ID/policy) or clears it with null.`);
  const parsed = validateDatasetPermissions(input.policy);
  if (!parsed.ok)
    throw new Error(`The stored dataset policy is not a valid version 3 policy (${parsed.errors.map((e) => `${e.path}: ${e.message}`).join('; ')}). An owner or editor saves a valid one (PUT /api/artifacts/ID/policy).`);
  return { source: 'v3', policy: parsed.policy };
}
