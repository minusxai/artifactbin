/**
 * THE STORED REWRITE OF ONE POLICY: the v3 policy is exactly `toV3`'s (what every door already enforces), v2
 * datasets get `readwrite` access (v2 never read the column; v3 honours it), and people a v2 grant named are
 * shared (editor for a write grant, viewer for a read grant), never the owner.
 */
import { describe, expect, it } from 'vitest';
import { validateDatasetPermissions } from '@artifactbin/utils/dataset-permissions';
import { viewersWritePolicy } from '@artifactbin/utils/dataset-policy';
import { planPolicyMigration } from '../migrate';
import { toV3 } from '../to-v3';

const ROWS = { schema: 'public', name: 'rows' };
const input = (policy: unknown, extra: Partial<Parameters<typeof planPolicyMigration>[0]> = {}) => ({ policy, visibility: 'unlisted' as const, tables: [ROWS], access: 'read', ownerUserId: 'usr_owner', ...extra });
const v2 = (allow: unknown[], extra: object = {}) => ({ version: 2, allow, ...extra });
const READ_ALL = { actions: ['read'], from: { user: '*' } };
const plan = (policy: unknown, extra: Partial<Parameters<typeof planPolicyMigration>[0]> = {}) => {
  const result = planPolicyMigration(input(policy, extra));
  if (result.source === 'v3') throw new Error('expected a rewrite');
  return result;
};
const codes = (result: ReturnType<typeof plan>) => result.report.map((r) => r.code);

describe('planPolicyMigration', () => {
  it('leaves a stored v3 policy alone (idempotent)', () => {
    const stored = toV3({ policy: null, visibility: 'unlisted', tables: [ROWS] }).policy;
    expect(planPolicyMigration(input(stored))).toEqual({ source: 'v3' });
  });

  it.each([
    ['no policy', null, 'none'],
    ['v1 viewer writes', viewersWritePolicy(), 'v1'],
    ['v2 default', v2([READ_ALL, { actions: ['insert', 'update', 'delete'], from: { artifactOwner: '$owner' } }]), 'v2'],
  ])('writes %s as exactly what toV3 reads, a valid v3 policy', (_name, policy, source) => {
    const result = plan(policy);
    expect(result.source).toBe(source);
    expect(result.policy).toEqual(toV3({ policy, visibility: 'unlisted', tables: [ROWS] }).policy);
    expect(validateDatasetPermissions(result.policy).ok).toBe(true);
  });

  it('keeps the access column for none and v1 (it already capped their writes) and opens it for v2 (which never read it)', () => {
    expect(plan(null).access).toBe('read');
    expect(plan(viewersWritePolicy(), { access: 'readwrite' }).access).toBe('readwrite');
    expect(plan(viewersWritePolicy()).access).toBe('read');
    expect(plan(v2([READ_ALL])).access).toBe('readwrite');
    expect(plan(v2([])).access).toBe('readwrite');
  });

  it('shares people named by v2 grants: editor for a write grant, viewer for a read-only grant, one share each', () => {
    const result = plan(v2([
      { actions: ['read'], from: { user: 'usr_reader' } },
      { actions: ['read'], from: { user: 'usr_both' } },
      { actions: ['insert'], from: { user: 'usr_writer' } },
      { actions: ['update', 'delete'], from: { user: 'usr_both' } },
    ]));
    expect(result.shares).toEqual([
      { userId: 'usr_writer', role: 'editor' },
      { userId: 'usr_both', role: 'editor' },
      { userId: 'usr_reader', role: 'viewer' },
    ]);
    expect(result.report).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'read_named_user', subjects: ['usr_reader', 'usr_both'] }),
      expect.objectContaining({ code: 'write_named_user', subjects: ['usr_writer', 'usr_both'] }),
    ]));
  });

  it('never shares the owner, and $owner and * grants add no share', () => {
    const result = plan(v2([{ actions: ['read', 'insert'], from: { user: 'usr_owner' } }, { actions: ['read', 'insert'], from: { user: '$owner' } }, { actions: ['insert'], from: { user: '*' } }]));
    expect(result.shares).toEqual([]);
  });

  it('makes page-scoped writes backend_only entries and names the pages and owners in the report, with no share', () => {
    const result = plan(v2([READ_ALL, { actions: ['insert'], from: { artifact: 'PageAAAA' } }, { actions: ['delete'], from: { artifactOwner: 'usr_other' } }]));
    const rows = result.policy.tables[0]!;
    expect(rows.insert_permissions?.map((e) => [e.role, e.permission.backend_only])).toEqual([['viewer', true], ['signed_in', true]]);
    expect(rows.delete_permissions?.map((e) => [e.role, e.permission.backend_only])).toEqual([['viewer', true], ['signed_in', true]]);
    expect(result.report).toEqual([expect.objectContaining({ code: 'write_page_scoped', subjects: ['PageAAAA', 'usr_other'] })]);
    expect(result.shares).toEqual([]);
  });

  it('reports page-scoped reads with the page', () => {
    expect(plan(v2([{ actions: ['read'], from: { artifact: 'PageBBBB' } }])).report).toEqual([expect.objectContaining({ code: 'read_page_scoped', subjects: ['PageBBBB'] })]);
  });

  it('keeps signed-out v1 writes (flagged) and drops function lists (reported), never carrying execution into v3', () => {
    const result = plan({ ...viewersWritePolicy(), execution: { functions: { deny: ['lower'] } } });
    expect(codes(result)).toEqual(['anonymous_write', 'functions_dropped']);
    expect(result.policy.tables[0]!.insert_permissions?.map((e) => e.role)).toEqual(['viewer', 'signed_in', 'anonymous']);
    expect(JSON.stringify(result.policy)).not.toContain('execution');
    expect(codes(plan(v2([READ_ALL], { execution: { functions: { allow: ['upper'] } } })))).toEqual(['functions_dropped']);
  });

  it('flags private v1 datasets whose writes now apply to shared viewers only, and whose page reads lose the page-owner ceiling', () => {
    const result = plan(viewersWritePolicy(), { visibility: 'private' });
    expect(codes(result)).toEqual(['private_viewer_only', 'private_page_reads']);
    expect(result.policy).toEqual(toV3({ policy: viewersWritePolicy(), visibility: 'private', tables: [ROWS] }).policy);
    expect(codes(plan(null, { visibility: 'private' }))).toEqual(['private_page_reads']);
  });

  it('keeps page readers out of a private v2 dataset, as its grants did: no signed_in or anonymous select entry', () => {
    const result = plan(v2([READ_ALL, { actions: ['insert'], from: { user: '*' } }]), { visibility: 'private' });
    expect(result.policy.tables[0]!.select_permissions?.map((e) => e.role)).toEqual(['viewer']);
    // Writes are toV3's, which the write door already enforces.
    expect(result.policy.tables[0]!.insert_permissions).toEqual(toV3({ policy: v2([READ_ALL, { actions: ['insert'], from: { user: '*' } }]), visibility: 'private', tables: [ROWS] }).policy.tables[0]!.insert_permissions);
    expect(result.report).toEqual([]);
    expect(plan(v2([{ actions: ['read'], from: { artifact: 'PageCCCC' } }]), { visibility: 'private' }).policy.tables[0]!.select_permissions?.map((e) => e.role)).toEqual(['viewer']);
  });

  it('throws on a stored policy that does not parse (the caller reports it and leaves the row)', () => {
    expect(() => planPolicyMigration(input({ version: 2, allow: 'nope' }))).toThrow();
  });
});
