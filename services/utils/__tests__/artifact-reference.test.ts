import {describe, expect, it} from 'vitest';
import {artifactIdFromPath, artifactIdFromPathPrefix, artifactIdFromSegment} from '../src/artifact-reference';

describe('artifactIdFromSegment', () => {
  it('takes the id and drops the title decoration', () => {
    expect(artifactIdFromSegment('Ab3xK9')).toBe('Ab3xK9');
    expect(artifactIdFromSegment('Ab3xK9-eating-healthy')).toBe('Ab3xK9');
    expect(artifactIdFromSegment('Ab3xK9012345')).toBe('Ab3xK9012345');
    expect(artifactIdFromSegment('short')).toBeNull();
  });
});

describe('artifactIdFromPath — a reference the user typed', () => {
  it('reads both canonical shapes', () => {
    expect(artifactIdFromPath('/a/Ab3xK9')).toBe('Ab3xK9');
    expect(artifactIdFromPath('/@owner/Ab3xK9-eating-healthy')).toBe('Ab3xK9');
  });

  it('stays strict: the artifact must be the last segment', () => {
    expect(artifactIdFromPath('/@owner/Ab3xK9-eating-healthy/edit')).toBeNull();
    expect(artifactIdFromPath('/a/Ab3xK9/raw')).toBeNull();
  });
});

/**
 * A browser session reports whatever page it is ON, and an artifact's address is
 * a PREFIX of its sub-routes — `/@owner/<id>-<slug>/edit` is what the app
 * redirects an owned document's edit URL to (server/app.ts). The session page
 * list carries `artifact_id`, so the prefix shapes must resolve too.
 */
describe('artifactIdFromPathPrefix — a page a browser is on', () => {
  it('reads the id when the address continues', () => {
    expect(artifactIdFromPathPrefix('/@owner/Ab3xK9-eating-healthy/edit')).toBe('Ab3xK9');
    expect(artifactIdFromPathPrefix('/a/Ab3xK9/raw')).toBe('Ab3xK9');
    expect(artifactIdFromPathPrefix('/a/Ab3xK9012345/edit')).toBe('Ab3xK9012345');
  });

  it('still reads the canonical shapes, and nothing else', () => {
    expect(artifactIdFromPathPrefix('/a/Ab3xK9')).toBe('Ab3xK9');
    expect(artifactIdFromPathPrefix('/@owner/Ab3xK9-eating-healthy')).toBe('Ab3xK9');
    expect(artifactIdFromPathPrefix('/settings/profile')).toBeNull();
    expect(artifactIdFromPathPrefix('/a/short/edit')).toBeNull();
  });
});
