/**
 * THE EXTENSION MECHANISM. A service is an ordered list of named parts; a
 * downstream replaces, removes or appends BY NAME. `assemble` must never
 * reorder — the default list is the readable truth about middleware order.
 */
import { describe, expect, it } from 'vitest';
import type { Part } from '@artifactbin/contracts';
import { assemble } from '@artifactbin/utils';

const tag = (name: string, text = name): Part => ({
  name,
  mount: (app) => app.use('*', async (c, next) => { c.header('x-trace', `${c.res.headers.get('x-trace') ?? ''}${text}>`); await next(); }),
});
const end = (text: string): Part => ({ name: 'end', mount: (app) => app.get('/', (c) => c.text(text)) });
const trace = async (app: ReturnType<typeof assemble>) => { const r = await app.request('/'); return `${r.headers.get('x-trace')}${await r.text()}`; };

describe('assemble', () => {
  it('mounts the parts in list order', async () => {
    expect(await trace(assemble([tag('a'), tag('b'), end('ok')]))).toBe('a>b>ok');
  });
  it('replaces a part by name, in its original position', async () => {
    expect(await trace(assemble([tag('a'), tag('b'), end('ok')], { a: tag('a', 'A') }))).toBe('A>b>ok');
  });
  it('removes a part with null', async () => {
    expect(await trace(assemble([tag('a'), tag('b'), end('ok')], { a: null }))).toBe('b>ok');
  });
  it('appends when the caller passes a longer list', async () => {
    expect(await trace(assemble([tag('a'), tag('c'), end('ok')]))).toBe('a>c>ok');
  });
  it('refuses two parts with the same name — a silent shadow is the bug this exists to prevent', () => {
    expect(() => assemble([tag('a'), tag('a'), end('ok')])).toThrow(/duplicate part "a"/);
  });
  it('refuses an override for a name that is not in the list', () => {
    expect(() => assemble([tag('a'), end('ok')], { zzz: tag('zzz') })).toThrow(/no part named "zzz"/);
  });
});
