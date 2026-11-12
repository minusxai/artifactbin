/** SQL bindings retain logical-name escaping, nulls and builtin parameter types. */
import { expect, it } from 'vitest';
import { bindParams, bindTypes } from '..';

it('binds only requested logical names by SQL name, preserving false, zero and empty strings', () => {
  expect(bindParams(['n', '_me.id', '_row.id', 'flag', 'text'], { n: 0, '_me.id': 'u1', flag: false, text: '', extra: 42 }))
    .toEqual({ n: 0, _me__id: 'u1', _row__id: null, flag: false, text: '' });
});

it('uses declared types and builtin types, without inventing types for unknown fields', () => {
  expect(bindTypes(['n', '_me.id', '_row.id', '_now', 'unknown'], { n: 'number' }))
    .toEqual({ n: 'number', _me__id: 'user', _now: 'timestamp' });
});
