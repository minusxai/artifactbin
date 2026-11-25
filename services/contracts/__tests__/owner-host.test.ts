import { expect, it } from 'vitest';
import { idFromPagesLabel, isOwnerTitlePath, ownerDocumentDoor, ownerFolderId, ownerHandleFromLabel, ownerHostConflicts, ownerSiteAddress, ownerSqlArtifactId, parseDnsHostname } from '@artifactbin/contracts/owner-host';
import { RESERVED_HANDLES } from '../src/handles';

const base = 'u.example.test';
const longHost = [63, 63, 63, 61].map(size => 'a'.repeat(size)).join('.');

it('normalizes DNS names and enforces DNS label and hostname lengths', () => {
  expect(parseDnsHostname(undefined)).toBeNull();
  expect(parseDnsHostname('  ')).toBeNull();
  expect(parseDnsHostname(' U.Example.Test. ')).toBe(base);
  expect(parseDnsHostname('publish')).toBe('publish');
  expect(parseDnsHostname(longHost)).toBe(longHost);
  for (const value of [longHost + 'a', 'a'.repeat(64) + '.test', 'https://u.example.test', 'u.example.test:443', 'user@u.example.test', 'u.example.test/x', '*.example.test', '-a.test', 'a..test', 'a.test..'])
    expect(() => parseDnsHostname(value), value).toThrow();
});

it.each([
  [base, [base], null, true],
  [base, ['app.' + base], null, true],
  [base, ['not-' + base], null, false],
  [base, ['example.test'], null, false],
  [base, [], base, true],
  [base, [], 'pages.' + base, true],
  ['abc.pages.test', [], 'pages.test', true],
  ['abc.nested.pages.test', [], 'pages.test', false],
  ['u.pages.test', [], 'pages.test', false],
  [null, [base], base, false],
] as const)('checks owner-host collisions for %s, own hosts %j and pages %s', (host, own, pages, conflicts) => {
  expect(ownerHostConflicts(host, own, pages)).toBe(conflicts);
});

it('decodes a single owner label and leaves the stricter app alias grammar to the app', () => {
  expect(ownerHandleFromLabel('team-one')).toBe('team_one');
  for (const handle of RESERVED_HANDLES)
    expect(ownerHandleFromLabel(handle.replaceAll('_', '-')), handle).toBeNull();
  for (const label of ['team_one', 'ab', 'a--b', 'Team-One', 'a'.repeat(33)])
    expect(ownerHandleFromLabel(label), label).toBeNull();
  expect(ownerHandleFromLabel('a'.repeat(32))).toBe('a'.repeat(32));
  expect(ownerSiteAddress('Team-One.' + base.toUpperCase() + '.:4100', base)).toEqual({ handle: 'team_one', label: '' });
  expect(ownerSiteAddress('team--release--notes.' + base, base)).toEqual({ handle: 'team', label: 'release--notes' });
  expect(ownerSiteAddress('team--' + 'x'.repeat(57) + '.' + base, base)?.label).toHaveLength(57);
  for (const name of [base, 'notes.team.' + base, 'app.' + base, 'team--.' + base, 'team---notes.' + base, 'team--' + 'x'.repeat(58) + '.' + base])
    expect(ownerSiteAddress(name, base), name).toBeNull();
  const longBase = longHost.slice(4);
  expect(ownerSiteAddress('abc.' + longBase, longBase)).toEqual({ handle: 'abc', label: '' });
  expect(ownerSiteAddress('abcd.' + longBase, longBase)).toBeNull();
});

it('decodes only lowercase hex of an exact published artifact ID', () => {
  expect(idFromPagesLabel('416233784b39')).toBe('Ab3xK9');
  for (const label of ['app', '416233784B39', '416233784b3', '41', 'ff'.repeat(6), '41'.repeat(13)])
    expect(idFromPagesLabel(label), label).toBeNull();
});

it('classifies exact owner doors using the shared alphanumeric shape', () => {
  expect(ownerSqlArtifactId('/api/artifacts/X/sql')).toBe('X');
  expect(ownerFolderId('/folders/Ab123/')).toBe('Ab123');
  expect(ownerFolderId('/folders/Ab123')).toBe('Ab123');
  for (const door of ['raw', 'resolve', 'export', 'events', 'events/frame', 'assets']) {
    expect(ownerDocumentDoor('/a/X/' + door)).toEqual({ id: 'X', door });
    expect(ownerDocumentDoor('/a/X/' + door + '/')).toBeNull();
  }
  for (const path of ['/api/artifacts/X/sql/', '/api/artifacts/X/sql/x', '/api/artifacts/A-B/sql', '/api/artifacts/%58/sql', '/api/artifacts//sql'])
    expect(ownerSqlArtifactId(path), path).toBeNull();
  for (const path of ['/folders/Ab123/extra', '/folders/Ab123//', '/folders/A-B', '/folders', '/folders/%58'])
    expect(ownerFolderId(path), path).toBeNull();
  for (const path of ['/a/X', '/a/X/raw?key=x', '/a/X/events//frame', '/a/X/./raw', '/a/%58/assets', '/a/x_y/export', '/a/X/edit'])
    expect(ownerDocumentDoor(path), path).toBeNull();
});

it('classifies exact title paths with the shared roots and slug grammar', () => {
  for (const path of ['/release-notes', '/release-notes/launch/', '/' + 'x'.repeat(60), '/workspace/notes'])
    expect(isOwnerTitlePath(path), path).toBe(true);
  for (const path of ['/', 'release-notes', '/release--notes', '/Release', '/notes//', '/notes/../latest', '/notes/%61', '/' + 'x'.repeat(61), '/api/notes', '/af', '/a/notes', '/assets/notes', '/folders/notes'])
    expect(isOwnerTitlePath(path), path).toBe(false);
});
