/** PR fast checks the browser gate's expectations against the actual creation-menu starter. */
import { expect, it } from 'vitest';
import { artifactStarter } from '../../services/app/lib/workspace/artifact-starters';
import { NEW_DOC_KIND, NEW_DOC_REGION, NEW_DOC_HTML } from '../gates/lib/new-doc-contract.mjs';

it('the new-doc gate selects the actual default document and its empty title/body', () => {
  const starter = artifactStarter('doc');
  expect(starter.html).toMatch(NEW_DOC_HTML);
  expect(starter.html).toContain(`<article data-af-editable="${NEW_DOC_KIND}"`);
  expect(NEW_DOC_REGION).toBe(`article[data-af-editable="${NEW_DOC_KIND}"]`);
  expect(starter).toMatchObject({ visibility: 'unlisted', parent_id: null });
});

it('rejects a stale legacy document and a nonempty title or missing body', () => {
  const { html } = artifactStarter('doc');
  expect(NEW_DOC_HTML.test(html.replace('rich-native-v1', 'rich'))).toBe(false);
  expect(NEW_DOC_HTML.test(html.replace('<h1></h1>', '<h1>Title</h1>'))).toBe(false);
  expect(NEW_DOC_HTML.test(html.replace('<p></p>', ''))).toBe(false);
});
