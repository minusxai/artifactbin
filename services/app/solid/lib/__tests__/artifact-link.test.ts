import { describe, expect, it } from 'vitest';
import { ARTIFACT_FORMATS } from '@artifactbin/contracts';
import { artifactLink, isDocumentFormat, knownFormat } from '@/solid/lib/artifact-link';

/** The ONE rule for how an in-app link to an artifact is drawn: a document crosses to the server, everything else stays in the app. */
describe('artifactLink', () => {
  it.each(['html'])('lets the server draw a %s document: the router must not intercept its link', (format) => {
    expect(artifactLink('/a/doc001', format)).toEqual({ href: '/a/doc001', rel: 'external' });
    expect(artifactLink('/@bob/doc001-hello#edit', format)).toEqual({ href: '/@bob/doc001-hello#edit', rel: 'external' });
  });

  it.each(ARTIFACT_FORMATS.filter((format) => !isDocumentFormat(format)))('keeps a %s in the app and tells the address what it is, so it asks no kind question', (format) => {
    const link = artifactLink('/a/x01', format);
    expect(link.rel).toBeUndefined();
    expect(link.href).toBe('/a/x01');
    expect(knownFormat(JSON.parse(link.state!))).toBe(format);
  });

  it('leaves a link whose kind it does not know to the router and the address to ask', () => {
    expect(artifactLink('/a/x01')).toEqual({ href: '/a/x01' });
    expect(artifactLink('/a/x01', null)).toEqual({ href: '/a/x01' });
    expect(artifactLink('/a/x01', 'hologram')).toEqual({ href: '/a/x01' });
  });

  it('recognizes native HTML as a framed document', () => {
    expect(ARTIFACT_FORMATS.filter(isDocumentFormat)).toEqual(['html']);
    expect(isDocumentFormat(undefined)).toBe(false);
  });
});

describe('knownFormat', () => {
  it('reads the format a link carried, and nothing a person could type into history', () => {
    expect(knownFormat({ format: 'dataset' })).toBe('dataset');
    for (const state of [undefined, null, 'folder', { format: 'nonsense' }, { format: 7 }, {}]) expect(knownFormat(state)).toBeNull();
  });
});
