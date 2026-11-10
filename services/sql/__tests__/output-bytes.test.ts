import { expect, it } from 'vitest';
import { jsonStringBytes } from '../src/sqlite/database';

it('counts a string exactly as JSON.stringify writes it in UTF-8', () => {
  const samples = ['', 'plain', '"quoted"', '\\'.repeat(600), '界'.repeat(600), 'é', '😀 emoji', '\u0000\u0001\u001f', '\b\f\n\r\t', '\ud800 lone', 'lone \udc00', '  ', 'mixed 界 😀 \\ " \n \u0007'];
  for (const s of samples) expect([s, jsonStringBytes(s)]).toEqual([s, Buffer.byteLength(JSON.stringify(s), 'utf8')]);
});
