/** caps.query's host port: validation, the caller as the only identity, and refusals as resolver error codes. */
import { describe, expect, it, vi } from 'vitest';
import { createResolverQuery, type ResolverQueryPorts } from '../query';

const links = [{ kind: 'dataset' as const, name: 'staff', datasetId: 'ds1', mode: 'live' as const }];
const port = (reply: Awaited<ReturnType<ResolverQueryPorts['execute']>> | Error) => {
  const execute = vi.fn<ResolverQueryPorts['execute']>(async () => { if (reply instanceof Error) throw reply; return reply; });
  return { execute, query: createResolverQuery({ links: async (pageId) => (pageId === 'page1' ? links : []), execute }) };
};
const call = (caller: { subject: string | null; role: 'viewer' | 'anonymous' } | null, args: unknown, operation: 'query' | 'mutation' = 'query') => ({ pageId: 'page1', caller, operation, args: args as never });

describe('createResolverQuery', () => {
  it('runs as the caller\'s bare account over the page\'s links, with the resolver result cap', async () => {
    const { execute, query } = port({ data: { staff: [] } });
    expect(await query(call({ subject: 'u1', role: 'viewer' }, { query: '{ staff { name } }', variables: { a: 1 }, operationName: 'Q' }))).toEqual({ staff: [] });
    expect(execute).toHaveBeenCalledWith({ userId: 'u1', tokenId: null, email: null, documentEditor: false }, links, { query: '{ staff { name } }', variables: { a: 1 }, operationName: 'Q' }, { operation: 'query', resultBytes: 1024 * 1024, pageId: 'page1' }, expect.any(AbortSignal));
    // The page names itself to the dataset rules (X-Hasura-Page-Id); a mutation's Idempotency-Key reaches the receipt.
    await query(call({ subject: null, role: 'anonymous' }, { query: '{ x }', idempotencyKey: 'resolver_key_0001' }, 'mutation'));
    expect(execute).toHaveBeenLastCalledWith({ userId: null, tokenId: null, email: null, documentEditor: false }, links, { query: '{ x }', idempotencyKey: 'resolver_key_0001' }, { operation: 'mutation', resultBytes: 1024 * 1024, pageId: 'page1' }, expect.any(AbortSignal));
  });
  it('refuses a run without an attested caller and malformed arguments before reaching a dataset', async () => {
    const { execute, query } = port({ data: {} });
    await expect(query(call(null, { query: '{ x }' }))).rejects.toMatchObject({ code: 'caller_unavailable' });
    for (const args of [null, 'q', { query: 7 }, { query: '{ x }', variables: [1] }, { query: '{ x }', operationName: 3 }, { query: 'x'.repeat(16 * 1024 + 1) }])
      await expect(query(call({ subject: 'u1', role: 'viewer' }, args)), JSON.stringify(args).slice(0, 40)).rejects.toMatchObject({ code: 'validation_failed' });
    expect(execute).not.toHaveBeenCalled();
  });
  it('throws the first GraphQL error as a code with a one-line printable detail', async () => {
    const refused = async (reply: Parameters<typeof port>[0]) => port(reply).query(call({ subject: 'u1', role: 'viewer' }, { query: '{ x }' })).then(() => null, (e: Error & { code: string }) => [e.code, e.message]);
    expect(await refused({ errors: [{ message: 'Cannot query field "x"\non type Query', extensions: { code: 'validation_failed' } }] })).toEqual(['validation_failed', 'validation_failed: Cannot query field "x"']);
    expect(await refused({ errors: [{ message: 'retry', extensions: { code: 'dataset_changed' } }] })).toEqual(['conflict', 'conflict: retry']);
    expect(await refused({ errors: [{ message: 'none', extensions: { code: 'dataset_not_found' } }] })).toEqual(['unavailable', 'unavailable: none']);
    expect(await refused({ errors: [{ message: 'later', extensions: { code: 'one_dataset_per_mutation' } }] })).toEqual(['one_dataset_per_mutation', 'one_dataset_per_mutation: later']);
    expect(await refused(new Error('dataset_changed'))).toEqual(['conflict', 'conflict']);
    expect(await refused(new Error('connection reset with row data'))).toEqual(['unavailable', 'unavailable']);
  });
});
