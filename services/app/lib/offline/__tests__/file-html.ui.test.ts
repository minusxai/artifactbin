import { describe, expect, it } from 'vitest';
import { ARTIFACT_FILE_CSP, readArtifactFileParts, renderArtifactFileHtml } from '../file-html';
import { artifactFile } from './fixture';

const parse = (html: string) => new DOMParser().parseFromString(html, 'text/html');

describe('renderArtifactFileHtml', () => {
  const file = artifactFile();
  const html = renderArtifactFileHtml({ file, code: 'H4sIAAAAAAAAA0tMTgYAQGCRmgQAAAA=' });

  it('round-trips the file and the code through a parsed document', () => {
    expect(readArtifactFileParts(parse(html))).toEqual({ file, code: 'H4sIAAAAAAAAA0tMTgYAQGCRmgQAAAA=' });
  });

  it('cannot be broken out of by document content', () => {
    const doc = parse(html);
    // the title contains `</script><script>alert(1)</script>`: it must stay data
    expect(doc.querySelectorAll('script:not([type])').length).toBe(1);
    expect(html).not.toContain('</script><script>alert(1)');
  });

  it('locks the network with the CSP and names the document', () => {
    const doc = parse(html);
    expect(doc.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content')).toBe(ARTIFACT_FILE_CSP);
    expect(ARTIFACT_FILE_CSP).toMatch(/default-src 'none'/);
    expect(doc.title).toBe(file.metadata.title);
  });

  it('references nothing outside the file', () => {
    expect(html).not.toMatch(/\s(src|href)="(https?:|\/\/|\/)/);
    expect(html).not.toMatch(/type="module"/);
  });
});
