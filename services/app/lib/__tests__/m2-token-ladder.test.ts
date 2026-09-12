import {readdirSync,readFileSync} from 'node:fs';
import {describe,it,expect} from 'vitest';
describe('no server-side string hands an agent the mint address', () => {
  const ROOT = new URL('../../', import.meta.url);
  const ALLOWED = new Set(['server/routes.generated.ts', 'app/api/tokens/anonymous/route.ts']);
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

  it('not one of them, anywhere under services/app', () => {
    const offenders = walk(ROOT).filter((path) =>
      !ALLOWED.has(path) && stripComments(readFileSync(new URL(path, ROOT), 'utf8')).includes('tokens/anonymous'));
    expect(offenders).toEqual([]);
  });
});
