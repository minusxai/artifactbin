/**
 * API tests never pin a literal stored dataset link. They compare stored rows with the pure pipeline that derives them
 * (services/app/__tests__/stored-links.ts), whose shape the fast lib/html-page links test pins: #1014 added `api` to
 * the stored link, updated that fast test, and four API tests that repeated the literal broke only on main.
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(import.meta.dirname, '../..');
const LITERAL_STORED_LINK = /htmlLinks\)\.(?:toEqual|toStrictEqual)\(\[\s*\{\s*kind\s*:/;

describe('stored dataset link pins', () => {
  it('flags a literal stored link and allows the derived oracle', () => {
    expect(LITERAL_STORED_LINK.test("expect(row.meta.htmlLinks).toEqual([{kind:'dataset',name:'a'}])")).toBe(true);
    expect(LITERAL_STORED_LINK.test('expect(row.meta.htmlLinks).toEqual(firstSaveLinks(html))')).toBe(false);
  });
  it('keeps literal stored dataset links out of the API tests', () => {
    const files = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard', 'services/app/__tests__', 'services/app/server'], { cwd: ROOT, encoding: 'utf8' })
      .split('\0').filter(file => /\.test\.tsx?$/.test(file));
    expect(files.length).toBeGreaterThan(50);
    expect(files.filter(file => LITERAL_STORED_LINK.test(readFileSync(path.join(ROOT, file), 'utf8')))).toEqual([]);
  });
});
