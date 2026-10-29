import { describe, expect, it } from 'vitest';
import { nativeIdentityDigest, nativeIdentityTimestamp, verifyNativeIdentityInput } from '..';
import { storedUser } from '../model';
import type { NativeIdentityImport } from '../contracts';

describe('nativeIdentityDigest', () => {
  it('is a sha256 hex digest independent of object key order, at every depth', () => {
    const digest = nativeIdentityDigest({ b: 1, a: { d: [1, { y: 2, x: 1 }], c: 'ü' } });
    expect(digest).toMatch(/^[a-f0-9]{64}$/);
    expect(nativeIdentityDigest({ a: { c: 'ü', d: [1, { x: 1, y: 2 }] }, b: 1 })).toBe(digest);
  });

  it('distinguishes array order, values and types', () => {
    expect(nativeIdentityDigest([1, 2])).not.toBe(nativeIdentityDigest([2, 1]));
    expect(nativeIdentityDigest({ a: 1 })).not.toBe(nativeIdentityDigest({ a: '1' }));
    expect(nativeIdentityDigest(null)).not.toBe(nativeIdentityDigest({}));
  });
});

describe('nativeIdentityTimestamp', () => {
  it('normalizes offsets to UTC and keeps microseconds exactly', () => {
    expect(nativeIdentityTimestamp('2020-01-02T03:04:05.123456Z')).toBe('2020-01-02T03:04:05.123456Z');
    expect(nativeIdentityTimestamp('2020-01-02 03:04:05.1+02:00')).toBe('2020-01-02T01:04:05.100000Z');
    expect(nativeIdentityTimestamp('2020-01-02T03:04:05Z')).toBe('2020-01-02T03:04:05.000000Z');
    expect(nativeIdentityTimestamp('2019-12-31T23:30:00-01:00')).toBe('2020-01-01T00:30:00.000000Z');
  });

  it('refuses ambiguous or invalid timestamps', () => {
    for (const value of ['2020-01-02T03:04:05', '2020-01-02T03:04:05.1234567Z', '2020-13-02T03:04:05Z', 'yesterday', '', '2020-01-02T03:04:05+0200'])
      expect(() => nativeIdentityTimestamp(value)).toThrow('native_identity_timestamp_invalid');
  });
});

describe('storedUser', () => {
  it('projects a user row to stored columns with nulls for absent fields and normalized times', () => {
    expect(storedUser({ id: 'u1', email: 'a@b.c', kind: 'account', created_at: '2020-01-02T03:04:05Z' } as never)).toEqual({
      id: 'u1', email: 'a@b.c', kind: 'account', parent_user_id: null, merged_into_user_id: null, expires_at: null,
      created_at: '2020-01-02T03:04:05.000000Z', name: null, username: null, image_key: null,
    });
  });
});

describe('verifyNativeIdentityInput', () => {
  const source = { id: 'src_user', email: 'Person@Example.com', kind: 'account', created_at: '2020-01-02T03:04:05Z' };
  function input(mutate: (plan: Record<string, any>, value: Record<string, any>) => void = () => {}): NativeIdentityImport {
    const sourceInventory = { users: [source], tokens: [] }, targetInventory = { users: [] };
    const plan: Record<string, any> = {
      sourceNamespace: 'synthetic', blockers: [], sourceInventorySha256: nativeIdentityDigest(sourceInventory), targetInventorySha256: nativeIdentityDigest(targetInventory),
      users: [{ sourceId: 'src_user', targetId: 'src_user', action: 'create-preserved', sourceRowSha256: nativeIdentityDigest(source) }],
      createUsers: [{ ...source, email: 'person@example.com', sourceId: 'src_user', sourceRowSha256: nativeIdentityDigest(source) }],
      tokens: [], targets: { users: { src_user: { userId: 'src_user', email: 'person@example.com' } }, tokens: {}, actors: {} },
    };
    const value: Record<string, any> = { plan, sourceInventory, targetInventory, revokedAt: '2026-01-01T00:00:00Z' };
    mutate(plan, value);
    plan.sha256 = nativeIdentityDigest(Object.fromEntries(Object.entries(plan).filter(([key]) => key !== 'sha256')));
    value.approvedPlanSha256 ??= plan.sha256;
    return value as NativeIdentityImport;
  }

  it('accepts an approved plan whose proofs match and answers the inventories keyed by id', () => {
    const verified = verifyNativeIdentityInput(input());
    expect([...verified.users.keys()]).toEqual(['src_user']);
    expect(verified.tokens.size).toBe(0);
    expect(verified.targets.size).toBe(0);
  });

  it('refuses an unapproved, tampered, blocked or namespace-less plan and an invalid revocation time', () => {
    expect(() => verifyNativeIdentityInput(input((_, value) => { value.approvedPlanSha256 = 'f'.repeat(64); }))).toThrow('native_identity_plan_invalid');
    const tampered = input(); tampered.plan.sourceNamespace = 'other';
    expect(() => verifyNativeIdentityInput(tampered)).toThrow('native_identity_plan_invalid');
    expect(() => verifyNativeIdentityInput(input(plan => { plan.blockers = ['blocked']; }))).toThrow('native_identity_plan_invalid');
    expect(() => verifyNativeIdentityInput(input(plan => { plan.sourceNamespace = ''; }))).toThrow('native_identity_plan_invalid');
    expect(() => verifyNativeIdentityInput(input((_, value) => { value.revokedAt = 'never'; }))).toThrow('native_identity_plan_invalid');
  });

  it('refuses inventories that drifted from the plan, or that repeat an id', () => {
    expect(() => verifyNativeIdentityInput(input((_, value) => { value.sourceInventory = { users: [source], tokens: [{ id: 't' }] }; }))).toThrow('native_identity_inventory_invalid');
    expect(() => verifyNativeIdentityInput(input((plan, value) => { value.sourceInventory = { users: [source, source], tokens: [] }; plan.sourceInventorySha256 = nativeIdentityDigest(value.sourceInventory); }))).toThrow('native_identity_inventory_ambiguous');
  });

  it('refuses user mappings that are duplicated, unproven, renamed or of an unknown kind', () => {
    expect(() => verifyNativeIdentityInput(input(plan => { plan.users = [plan.users[0], plan.users[0]]; }))).toThrow('native_identity_duplicate');
    expect(() => verifyNativeIdentityInput(input(plan => { plan.users[0].sourceRowSha256 = 'a'.repeat(64); }))).toThrow('native_identity_user_proof_invalid');
    expect(() => verifyNativeIdentityInput(input(plan => { plan.users[0].targetId = 'renamed'; plan.targets.users.src_user.userId = 'renamed'; }))).toThrow('native_identity_user_id_changed');
    expect(() => verifyNativeIdentityInput(input((plan, value) => { const robot = { ...source, kind: 'robot' }; value.sourceInventory = { users: [robot], tokens: [] }; plan.sourceInventorySha256 = nativeIdentityDigest(value.sourceInventory); }))).toThrow('native_identity_source_kind_invalid');
  });

  it('refuses a created user whose stored row differs from its source, or a missing creation', () => {
    expect(() => verifyNativeIdentityInput(input(plan => { plan.createUsers[0].name = 'Changed'; }))).toThrow('native_identity_create_changed');
    expect(() => verifyNativeIdentityInput(input(plan => { plan.createUsers = []; }))).toThrow('native_identity_create_missing');
    expect(() => verifyNativeIdentityInput(input(plan => { plan.createUsers[0].id = 'other'; }))).toThrow('native_identity_create_invalid');
  });

  it('refuses reusing a target account unless its email matches and it is live', () => {
    const target = { id: 'tgt_user', email: 'person@example.com', kind: 'account', created_at: '2021-01-01T00:00:00Z' };
    const reuse = (patch: Record<string, unknown> = {}) => input((plan, value) => {
      const row = { ...target, ...patch };
      value.targetInventory = { users: [row] };
      plan.targetInventorySha256 = nativeIdentityDigest(value.targetInventory);
      plan.users = [{ sourceId: 'src_user', targetId: 'tgt_user', action: 'reuse-verified-email', sourceRowSha256: nativeIdentityDigest(source), targetRowSha256: nativeIdentityDigest(row) }];
      plan.createUsers = [];
      plan.targets.users.src_user = { userId: 'tgt_user', email: row.email };
    });
    expect(verifyNativeIdentityInput(reuse()).targets.has('tgt_user')).toBe(true);
    expect(() => verifyNativeIdentityInput(reuse({ email: 'someone@example.com' }))).toThrow('native_identity_reuse_invalid');
    expect(() => verifyNativeIdentityInput(reuse({ kind: 'guest' }))).toThrow('native_identity_reuse_invalid');
    expect(() => verifyNativeIdentityInput(reuse({ merged_into_user_id: 'x' }))).toThrow('native_identity_reuse_invalid');
    expect(() => verifyNativeIdentityInput(reuse({ expires_at: '2025-01-01T00:00:00Z' }))).toThrow('native_identity_reuse_invalid');
  });
});
