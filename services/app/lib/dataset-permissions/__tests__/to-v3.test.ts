/**
 * DUAL READ: every row of the plan's stored-shape → v3 mapping table, and the report for each case that is
 * not exact. The behaviour equivalence of these mappings (old policy × caller × door × operation) is the
 * write matrix in lib/document-data/__tests__/dataset-write-matrix.test.ts.
 */
import { describe, expect, it } from 'vitest';
import type { DatasetPermissions, DatasetTablePermissions } from '@artifactbin/contracts';
import { validateDatasetPermissions } from '@artifactbin/utils/dataset-permissions';
import { viewersWritePolicy } from '@artifactbin/utils/dataset-policy';
import { toV3 } from '../to-v3';

const ROWS = { schema: 'public', name: 'rows' };
const OTHER = { schema: 'public', name: 'other' };
const READ_ALL = { columns: '*', filter: {}, allow_aggregations: true };
const read = (...roles: string[]) => roles.map((role) => ({ role, permission: READ_ALL }));
const v3 = (policy: unknown, visibility: 'public' | 'unlisted' | 'private' = 'unlisted', tables = [ROWS]) => toV3({ policy, visibility, tables });
const table = (policy: DatasetPermissions, t = ROWS): DatasetTablePermissions => policy.tables.find((x) => x.table.schema === t.schema && x.table.name === t.name)!;
const codes = (result: ReturnType<typeof toV3>) => result.report.map((r) => r.code);
const v2 = (allow: unknown[], extra: object = {}) => ({ version: 2, allow, ...extra });
const all = { insert: { columns: '*', check: {} }, update: { columns: '*', filter: {}, check: {} }, delete: { filter: {} } };

describe('toV3', () => {
  it('reads no policy as read-only for viewer, signed_in and anonymous, with no write entries (exact)', () => {
    const result = v3(null, 'unlisted', [ROWS, OTHER]);
    expect(result).toMatchObject({ source: 'none', report: [] });
    expect(result.policy).toEqual({ version: 3, tables: [ROWS, OTHER].map((t) => ({ table: t, select_permissions: read('viewer', 'signed_in', 'anonymous') })) });
    expect(validateDatasetPermissions(result.policy).ok).toBe(true);
  });

  it('copies each v1 viewer entry to viewer, signed_in and anonymous, and flags the anonymous write', () => {
    const result = v3(viewersWritePolicy());
    expect(result.source).toBe('v1');
    expect(table(result.policy)).toEqual({
      table: ROWS, select_permissions: read('viewer', 'signed_in', 'anonymous'),
      insert_permissions: ['viewer', 'signed_in', 'anonymous'].map((role) => ({ role, permission: all.insert })),
      update_permissions: ['viewer', 'signed_in', 'anonymous'].map((role) => ({ role, permission: all.update })),
      delete_permissions: ['viewer', 'signed_in', 'anonymous'].map((role) => ({ role, permission: { filter: {} } })),
    });
    expect(codes(result)).toEqual(['anonymous_write']);
    expect(validateDatasetPermissions(result.policy).ok).toBe(true);
  });

  it('keeps a v1 entry\'s own columns, filter, check and presets, and leaves unlisted tables read-only', () => {
    const entry = { columns: ['body'], filter: { owner: { _eq: 'X-Hasura-User-Id' } }, check: { body: { _neq: '' } }, set: { owner: 'X-Hasura-User-Id' } };
    const result = v3({ version: 1, enforcement: 'enabled', tables: [{ table: ROWS, update_permissions: [{ role: 'viewer', permission: entry }] }] }, 'unlisted', [ROWS, OTHER]);
    expect(table(result.policy).update_permissions).toEqual(['viewer', 'signed_in', 'anonymous'].map((role) => ({ role, permission: entry })));
    expect(table(result.policy).insert_permissions).toBeUndefined();
    expect(table(result.policy, OTHER)).toEqual({ table: OTHER, select_permissions: read('viewer', 'signed_in', 'anonymous') });
  });

  it('copies v1 entries to viewer only on a private dataset (it has no link audience)', () => {
    const result = v3(viewersWritePolicy(), 'private');
    expect(table(result.policy).insert_permissions?.map((e) => e.role)).toEqual(['viewer']);
    expect(codes(result)).toEqual(['private_viewer_only']);
  });

  it('carries v1 execution.functions to the engine until the stored rewrite, reported as dropped', () => {
    const result = v3({ ...viewersWritePolicy(), execution: { functions: { deny: ['llm'] } } });
    expect(result.execution).toEqual({ functions: { deny: ['llm'] } });
    expect(codes(result)).toContain('functions_dropped');
  });

  it('reads v2 read user:"*" as select for all three roles, and a $owner-only read as no select (exact)', () => {
    expect(table(v3(v2([{ actions: ['read'], from: { user: '*' } }])).policy)).toEqual({ table: ROWS, select_permissions: read('viewer', 'signed_in', 'anonymous') });
    const owner = v3(v2([{ actions: ['read'], from: { user: '$owner' } }]));
    expect(table(owner.policy)).toEqual({ table: ROWS });
    expect(owner.report).toEqual([]);
  });

  it('reports v2 reads by a named user (viewer) and by a page (viewer and signed_in)', () => {
    const named = v3(v2([{ actions: ['read'], from: { user: 'u1' } }]));
    expect(table(named.policy).select_permissions).toEqual(read('viewer'));
    expect(codes(named)).toEqual(['read_named_user']);
    const page = v3(v2([{ actions: ['read'], from: { artifactOwner: '$owner' } }]));
    expect(table(page.policy).select_permissions).toEqual(read('viewer', 'signed_in'));
    expect(codes(page)).toEqual(['read_page_scoped']);
  });

  it('reads the v2 default (owner programs write) as backend_only entries for viewer and signed_in (exact)', () => {
    const result = v3(v2([{ actions: ['read'], from: { user: '*' } }, { actions: ['insert', 'update', 'delete'], from: { artifactOwner: '$owner' } }]));
    const t = table(result.policy);
    for (const op of ['insert', 'update', 'delete'] as const)
      expect(t[`${op}_permissions`]).toEqual(['viewer', 'signed_in'].map((role) => ({ role, permission: { ...all[op], backend_only: true } })));
    expect(result.report).toEqual([]);
    expect(validateDatasetPermissions(result.policy).ok).toBe(true);
  });

  it('copies v2 table restrictions into backend_only entries, and leaves tables the list omits unwritable', () => {
    const restricted = { columns: ['body'], filter: { status: { _eq: 'open' } } };
    const result = v3(v2([{ actions: ['update'], from: { artifactOwner: '$owner' } }], { tables: [{ table: ROWS, update_permissions: [{ role: 'viewer', permission: restricted }] }] }), 'unlisted', [ROWS, OTHER]);
    expect(table(result.policy).update_permissions).toEqual(['viewer', 'signed_in'].map((role) => ({ role, permission: { ...restricted, backend_only: true } })));
    expect(table(result.policy).insert_permissions).toBeUndefined();
    expect(table(result.policy, OTHER)).toEqual({ table: OTHER });
  });

  it('reports v2 writes through another page or owner (backend_only; works only if that owner administers the dataset)', () => {
    for (const from of [{ artifact: 'abcdef123' }, { artifactOwner: 'u2' }]) {
      const result = v3(v2([{ actions: ['insert'], from }]));
      expect(table(result.policy).insert_permissions).toEqual(['viewer', 'signed_in'].map((role) => ({ role, permission: { ...all.insert, backend_only: true } })));
      expect(codes(result)).toEqual(['write_page_scoped']);
    }
  });

  it('reads v2 writes by user:"*" as ordinary entries for viewer and signed_in (exact: v2 writes always needed an identity)', () => {
    const result = v3(v2([{ actions: ['delete'], from: { user: '*' } }]));
    expect(table(result.policy).delete_permissions).toEqual(['viewer', 'signed_in'].map((role) => ({ role, permission: { filter: {} } })));
    expect(result.report).toEqual([]);
  });

  it('lets an ordinary entry win over a backend_only one for the same role and operation', () => {
    const result = v3(v2([{ actions: ['insert'], from: { artifactOwner: '$owner' } }, { actions: ['insert'], from: { user: '*' } }]));
    expect(table(result.policy).insert_permissions).toEqual(['viewer', 'signed_in'].map((role) => ({ role, permission: all.insert })));
  });

  it('reads v2 writes by user:"$owner" as nothing (the owner is implicit) and by a named user as a reported gap', () => {
    expect(table(v3(v2([{ actions: ['insert'], from: { user: '$owner' } }])).policy)).toEqual({ table: ROWS });
    const named = v3(v2([{ actions: ['insert'], from: { user: 'u1' } }]));
    expect(table(named.policy)).toEqual({ table: ROWS });
    expect(codes(named)).toEqual(['write_named_user']);
  });

  it('passes a stored v3 document through and refuses an invalid stored policy', () => {
    const stored = { version: 3, tables: [{ table: ROWS, select_permissions: read('anonymous') }] };
    expect(v3(stored)).toEqual({ source: 'v3', policy: stored, report: [] });
    expect(() => v3({ version: 3, tables: [{ table: ROWS, insert_permissions: [{ role: 'owner', permission: { check: {} } }] }] })).toThrow('Dataset permissions');
    expect(() => v3({ version: 1, tables: 'x' })).toThrow();
  });
});
