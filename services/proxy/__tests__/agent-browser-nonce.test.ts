import {describe, expect, it} from 'vitest';
import {decodeAgentSession, encodeAgentSession} from '@artifactbin/utils';
describe('signed per-browser agent identity', () => {
  it('preserves a validated nonce without changing legacy cookie decoding', () => {
    const secret='nonce-test-secret';
    const session={tokenIds:['tok_one'], sessionId:'a'.repeat(43)};
    expect(decodeAgentSession(encodeAgentSession(session,secret),secret)).toEqual(session);
    expect(decodeAgentSession(encodeAgentSession({tokenIds:['tok_one']},secret),secret)).toEqual({tokenIds:['tok_one']});
  });
});
