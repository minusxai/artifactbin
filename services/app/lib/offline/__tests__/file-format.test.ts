import { describe, expect, it } from 'vitest';
import { ArtifactFileError, parseArtifactFile } from '../file-format';
import { artifactFile } from './fixture';

describe('parseArtifactFile', () => {
  it('accepts a well-formed file unchanged', () => {
    const file = artifactFile();
    expect(parseArtifactFile(JSON.parse(JSON.stringify(file)))).toEqual(file);
  });

  it('round trips local workspace provenance and rejects unsafe embedded asset paths', () => {
    const localWorkspace = { documentId: 'Local1', baseDigest: 'baseline', assets: {
      'plot.png': { path: 'assets/plot.png', contentType: 'image/png', base64: 'QUJD' },
    } };
    const file = { ...artifactFile(), localWorkspace };
    expect(parseArtifactFile(file)).toEqual(file);
    for (const path of ['../outside', '/absolute', 'C:\\outside', 'assets/../outside', 'assets/./plot.png']) {
      expect(() => parseArtifactFile({ ...file, localWorkspace: { ...localWorkspace, assets: {
        x: { ...localWorkspace.assets['plot.png'], path },
      } } })).toThrow(ArtifactFileError);
    }
    expect(() => parseArtifactFile({ ...file, localWorkspace: { ...localWorkspace, assets: {
      x: { path: 'assets/x', contentType: 'image/png', base64: '<script>' },
    } } })).toThrow(ArtifactFileError);
  });

  it('refuses a newer format with a message that says to update, not that the file is broken', () => {
    const newer = { ...artifactFile(), format: 2 };
    expect(() => parseArtifactFile(newer)).toThrow(ArtifactFileError);
    expect(() => parseArtifactFile(newer)).toThrow(/newer/i);
  });

  it.each([
    ['not an object', 'x'],
    ['no source', { ...artifactFile(), source: undefined }],
    ['threads not a list', { ...artifactFile(), threads: {} }],
    ['snapshot without state', { ...artifactFile(), snapshot: { at: 'x', variants: [], frozen: [] } }],
    ['base without version', { ...artifactFile(), base: { editId: 'e', source: '' } }],
    ['css as one string (the shape before it was split)', { ...artifactFile(), css: '.p-7{padding:1.75rem}' }],
    ['css without its base sheet', { ...artifactFile(), css: { compiled: null, author: null } }],
  ])('refuses a damaged file: %s', (_label, value) => {
    expect(() => parseArtifactFile(value)).toThrow(ArtifactFileError);
    expect(() => parseArtifactFile(value)).toThrow(/damaged/i);
  });
});
