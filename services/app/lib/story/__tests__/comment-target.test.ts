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

describe('strict identity boundaries', () => {
  it('rejects unknown fields, excessive nesting and invalid identity characters', () => {
    for (const target of [
      {kind:'table',rowKey:'ok',owner:'forged'},
      {kind:'iframe',node:{kind:'source',id:'x\u0000'}},
      {kind:'iframe',node:{kind:'session',id:'x',generation:''}},
      {kind:'iframe',node:{kind:'key',path:Array(17).fill('x')}},
      {kind:'repeat',templateNodeId:'x',scopes:[{nodeId:'a',key:1},{nodeId:'a',key:2}]},
    ]) expect(parseCommentTarget(target)).toBeNull();
  });
});
