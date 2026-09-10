import { describe, expect, it } from 'vitest';
import { parseCommentTarget } from '../comment-target';

describe('durable comment refinements', () => {
  it('preserves typed table keys and scoped iframe keys', () => {
    for (const target of [
      {kind:'table',rowKey:1,columnKey:'customer'},
      {kind:'table',rowKey:'1',columnKey:'customer'},
      {kind:'iframe',node:{kind:'key',path:['order:123','customer']}},
      {kind:'repeat',scopes:[{nodeId:'orders',key:'123'}],templateNodeId:'customer'},
    ]) expect(parseCommentTarget(target)).toEqual(target);
  });
  it('rejects malformed, unbounded and ambiguous identities', () => {
    for (const target of [null, {}, {kind:'table',rowKey:Infinity}, {kind:'table',rowKey:{}},
      {kind:'iframe',node:{kind:'key',path:[]}},
      {kind:'iframe',node:{kind:'key',path:['x'.repeat(10000)]}},
      {kind:'repeat',scopes:[],templateNodeId:'cell'},
    ]) expect(parseCommentTarget(target)).toBeNull();
  });
});
