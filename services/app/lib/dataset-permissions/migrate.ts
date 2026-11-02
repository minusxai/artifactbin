/**
 * THE STORED REWRITE, one dataset at a time (pure): what a stored none/v1/v2 policy becomes when it is written
 * back as v3. The policy is `toV3`'s (./to-v3), the same reading every door already enforces, so the rewrite
 * changes no rule. What `toV3` cannot carry is decided here:
 *
 *  - A v2 grant naming one person (`from:{user:<id>}`) has no v3 rule. That person is SHARED on the dataset:
 *    `editor` for a write grant (v3 has no narrower slot for one writer; an editor is admin-equivalent, a
 *    widening the report names), `viewer` for a read-only grant. The share replaces the named-user
 *    compatibility in ./write and ./read, which can be removed once every stored policy is v3.
 *  - The `access` column: v2 grants never read it (owner and editors wrote whatever it said), and v3 honours
 *    it as a ceiling on every write. A migrated v2 dataset therefore gets `readwrite`, so nobody loses a
 *    write; a v2 dataset was locked by its grants, which carry over as rules. None and v1 policies already
 *    sat under the ceiling and keep their value.
 *  - A PRIVATE dataset: the read door lets signed_in and anonymous page readers past the visibility ceiling
 *    only through a page whose owner administers the dataset (./read), except under stored v2 grants, which
 *    admitted shares only. So a private v2 dataset loses its signed_in and anonymous select entries (exact);
 *    none and v1 keep theirs. Writes need no change (./write's private ceiling applies to every source).
 *  - Page-scoped grants are already `backend_only` entries; signed-out v1 writes are already kept for the
 *    anonymous role (rule-admitted writes are throttled per dataset); function lists are dropped. Each is
 *    a report item for the owner, with its subjects.
 */
import type { DatasetPermissions } from '@artifactbin/contracts';
import { toV3, type ToV3Input, type ToV3ReportItem } from './to-v3';

const PAGE_ROLES = new Set(['signed_in', 'anonymous']);

type MigrationShareRole = 'viewer' | 'editor';

export interface PolicyMigrationInput extends ToV3Input {
  /** The dataset's `access` column. */
  access: string;
  /** The owning account (null for a group or token owner): never shared with itself. */
  ownerUserId: string | null;
}

export type PolicyMigrationPlan =
  | { source: 'v3' }
  | {
      source: 'none' | 'v1' | 'v2';
      policy: DatasetPermissions;
      access: string;
      /** The people a v2 grant named, and the dataset role each needs to keep its access. */
      shares: Array<{ userId: string; role: MigrationShareRole }>;
      report: ToV3ReportItem[];
    };

/** Throws when the stored policy does not parse (the caller reports it and leaves the row alone). */
export function planPolicyMigration(input: PolicyMigrationInput): PolicyMigrationPlan {
  const read = toV3(input);
  if (read.source === 'v3') return { source: 'v3' };
  const roles = new Map<string, MigrationShareRole>();
  const subjects = (code: string) => read.report.find((item) => item.code === code)?.subjects ?? [];
  for (const userId of subjects('write_named_user')) roles.set(userId, 'editor');
  for (const userId of subjects('read_named_user')) if (!roles.has(userId)) roles.set(userId, 'viewer');
  if (input.ownerUserId) roles.delete(input.ownerUserId);
  let policy = read.policy;
  if (input.visibility === 'private' && read.source === 'v2') {
    policy = { ...policy, tables: policy.tables.map(({ select_permissions, ...table }) => {
      const kept = select_permissions?.filter((entry) => !PAGE_ROLES.has(entry.role));
      return kept?.length ? { ...table, select_permissions: kept } : table;
    }) };
  }
  return {
    source: read.source,
    policy,
    access: read.source === 'v2' ? 'readwrite' : input.access,
    shares: [...roles].map(([userId, role]) => ({ userId, role })),
    report: read.report,
  };
}
