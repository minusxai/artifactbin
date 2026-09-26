import { describe, expect, it } from 'vitest';
import { ArtifactFileError, parseArtifactFile } from '../file-format';
import { artifactFile } from './fixture';

describe('parseArtifactFile', () => {
  it('accepts a well-formed file unchanged', () => {
    const file = artifactFile();
    expect(parseArtifactFile(JSON.parse(JSON.stringify(file)))).toEqual(file);
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
  ])('refuses a damaged file: %s', (_label, value) => {
    expect(() => parseArtifactFile(value)).toThrow(ArtifactFileError);
    expect(() => parseArtifactFile(value)).toThrow(/damaged/i);
  });
});
