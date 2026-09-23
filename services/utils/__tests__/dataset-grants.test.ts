import { describe, expect, it } from 'vitest';
import type { DatasetGrantContext, DatasetGrantPolicy } from '../../contracts/src/dataset-grants';
import { defaultDatasetGrants, datasetGrantAllows, parseDatasetGrants, grantMutationPolicy, remapDatasetGrants } from '../src/dataset-grants';

const owner = { userId: 'alice', tokenId: 'alice-token' };
const bob = { userId: 'bob', tokenId: 'bob-token' };
const context: DatasetGrantContext = { owner, caller: bob, artifact: { id: 'a1B2c3', owner } };
const policy = (from: DatasetGrantPolicy['allow'][number]['from']): DatasetGrantPolicy => ({ version: 2, allow: [{ actions: ['update'], from }] });

describe('dataset grant contract', () => {
  it('defaults to anonymous reads and writes through the dataset owner’s saved artefacts', () => {
    const p = parseDatasetGrants(defaultDatasetGrants());
    expect(datasetGrantAllows(p, 'read', { owner, caller: { userId: null, tokenId: null } })).toBe(true);
    for (const operation of ['insert', 'update', 'delete'] as const) {
      expect(datasetGrantAllows(p, operation, context)).toBe(true);
      expect(datasetGrantAllows(p, operation, { owner, caller: owner })).toBe(false);
      expect(datasetGrantAllows(p, operation, { ...context, artifact: { id: 'd4E5f6', owner: bob } })).toBe(false);
    }
  });
  it('combines selector fields with AND and grants with OR', () => {
    const p: DatasetGrantPolicy = { version: 2, allow: [
      { actions: ['update'], from: { user: 'bob', artifact: 'a1B2c3' } },
      { actions: ['delete'], from: { user: '$owner' } },
    ] };
    expect(datasetGrantAllows(p, 'update', context)).toBe(true);
    expect(datasetGrantAllows(p, 'delete', context)).toBe(false);
    expect(datasetGrantAllows(p, 'delete', { owner, caller: owner })).toBe(true);
    expect(datasetGrantAllows(p, 'update', { ...context, artifact: undefined })).toBe(false);
    expect(datasetGrantAllows(p, 'update', { ...context, caller: owner })).toBe(false);
  });
  it('matches user and artifact-owner IDs independently and requires an artifact for wildcard artifacts', () => {
    expect(datasetGrantAllows(policy({ user: 'bob' }), 'update', context)).toBe(true);
    expect(datasetGrantAllows(policy({ artifactOwner: 'alice' }), 'update', context)).toBe(true);
    expect(datasetGrantAllows(policy({ artifactOwner: 'bob' }), 'update', context)).toBe(false);
    expect(datasetGrantAllows(policy({ artifact: '*' }), 'update', context)).toBe(true);
    expect(datasetGrantAllows(policy({ artifact: '*' }), 'update', { owner, caller: bob })).toBe(false);
  });
  it('never equates absent owners; token ownership only matches two token-owned resources', () => {
    const none = { userId: null, tokenId: null };
    expect(datasetGrantAllows(policy({ user: '$owner' }), 'update', { owner: none, caller: none })).toBe(false);
    expect(datasetGrantAllows(policy({ artifactOwner: '$owner' }), 'update', { owner: none, caller: bob, artifact: { id: 'a1B2c3', owner: none } })).toBe(false);
    const token = { userId: null, tokenId: 'same-token' };
    expect(datasetGrantAllows(policy({ artifactOwner: '$owner' }), 'update', { owner: token, caller: bob, artifact: { id: 'a1B2c3', owner: token } })).toBe(true);
    expect(datasetGrantAllows(policy({ artifactOwner: '$owner' }), 'update', { owner: { ...token, userId: 'alice' }, caller: bob, artifact: { id: 'a1B2c3', owner: token } })).toBe(false);
  });
  it('preserves omitted versus empty tables and applies row restrictions after grants', () => {
    const table = { schema: 'public', name: 'rows' };
    const session = { 'x-hasura-user-id': 'bob' };
    expect(parseDatasetGrants(policy({ user: '*' }))).not.toHaveProperty('tables');
    expect(grantMutationPolicy(policy({ user: '*' }), context, table, session)?.operations).toEqual(['update']);
    expect(grantMutationPolicy({ ...policy({ user: '*' }), tables: [] }, context, table, session)).toBeUndefined();
    const restricted = { ...policy({ user: '*' }), tables: [{ table, update_permissions: [{ role: 'viewer', permission: { columns: ['status'], filter: { person: { _eq: 'x-hasura-user-id' } }, check: { person: { _eq: 'x-hasura-user-id' } } } }] }] } satisfies DatasetGrantPolicy;
    expect(grantMutationPolicy(parseDatasetGrants(restricted), context, table, session)?.table).toEqual(restricted.tables[0]);
    expect(grantMutationPolicy(restricted, context, { ...table, name: 'secrets' }, session)).toBeUndefined();
    expect(grantMutationPolicy({ version: 2, allow: [] }, context, table, session)).toBeUndefined();
  });
  it.each([
    { version: 2 },
    { version: 2, allow: [{ actions: ['update'], from: {} }] },
    { version: 2, allow: [{ actions: ['select'], from: { user: '*' } }] },
    { version: 2, allow: [{ actions: ['update', 'update'], from: { user: '*' } }] },
    { version: 2, allow: [{ actions: [], from: { user: '*' } }] },
    { version: 2, allow: [{ actions: ['read'], from: { username: '@alice' } }] },
    { version: 2, allow: [{ actions: ['read'], from: { user: '@alice' } }] },
    { version: 2, allow: [{ actions: ['read'], from: { artifact: '$owner' } }] },
    { version: 2, allow: [], tables: null },
    { version: 2, allow: [], ignored: true },
  ])('rejects malformed grants without dropping unsupported fields: %j', input => {
    expect(() => parseDatasetGrants(input)).toThrow();
  });
  it('remaps only copied artifact selectors while preserving stable people and owner binding', () => {
    const p: DatasetGrantPolicy = { version: 2, allow: [
      { actions: ['update'], from: { user: 'bob', artifact: 'a1B2c3' } },
      { actions: ['read'], from: { artifact: 'd4E5f6' } },
      { actions: ['insert'], from: { artifactOwner: '$owner' } },
    ] };
    const remapped = remapDatasetGrants(p, { a1B2c3: 'g7H8i9' });
    expect(remapped.allow[0]?.from).toEqual({ user: 'bob', artifact: 'g7H8i9' });
    expect(remapped.allow.slice(1)).toEqual(p.allow.slice(1));
    expect(p.allow[0]?.from.artifact).toBe('a1B2c3');
  });
});
