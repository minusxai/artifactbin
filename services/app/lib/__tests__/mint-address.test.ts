/**
 * THE MINT HAS ONE ADDRESS AND IT IS INTERNAL.
 *
 * `/api/tokens/anonymous` is gone: no public route mints, and no string under
 * services/app names it any more. What replaced it is `/api/internal/tokens`,
 * which the proxy refuses at the edge — so the ONLY place that address may
 * appear is the route that serves it, the generated route table, and the
 * contract that spells it for both sides.
 */
import {readdirSync,readFileSync} from 'node:fs';
import {describe,it,expect} from 'vitest';
import {INTERNAL_MINT_PATH} from '@artifactbin/contracts';

describe('no server-side string hands an agent a mint address', () => {
  const ROOT = new URL('../../', import.meta.url);
  const ALLOWED = new Set(['server/routes.generated.ts', 'app/api/internal/tokens/route.ts']);
  const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

  const walk = (dir: URL, rel = ''): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      return ['node_modules', '__tests__', 'web', 'components', 'skills'].includes(entry.name)
        ? []
        : walk(new URL(`${entry.name}/`, dir), path);
    }
    return /\.tsx?$/.test(entry.name) && !/\.test\./.test(entry.name) ? [path] : [];
  });

  const sources = () => walk(ROOT).map((path) => [path, stripComments(readFileSync(new URL(path, ROOT), 'utf8'))] as const);

  it('the retired public mint is named nowhere at all', () => {
    expect(sources().filter(([, src]) => src.includes('tokens/anonymous')).map(([path]) => path)).toEqual([]);
  });

  it('the internal mint is named only where it is served', () => {
    expect(sources().filter(([path, src]) => !ALLOWED.has(path) && src.includes(INTERNAL_MINT_PATH)).map(([path]) => path)).toEqual([]);
  });
});
