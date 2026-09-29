import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { compiledDocument } from '@/lib/compiled-page/__tests__/document-helper';
import { renderDraftPreview } from '../draft-preview.server';

describe('compiled editor draft preview', () => {
  it('refuses incomplete source instead of replacing the visible draft with an empty page', async () => {
    await expect(renderDraftPreview({
      source: '<div><p>unfinished', title: 'Draft', theme: null, colorMode: 'light',
      compiledCss: null, refData: {},
    })).rejects.toThrow('draft source is incomplete');
  });

  it('renders the same compiled story and AST anchors as the reader', async () => {
    const input = {
      source: '<div id="root"><h1 id="heading">Draft</h1><p id="copy">Editable prose</p></div>',
      title: 'Draft',
      theme: null,
      template: null,
      colorMode: 'light' as const,
      compiledCss: null,
      refData: {},
    };
    const [preview, reader] = await Promise.all([renderDraftPreview(input), compiledDocument(input)]);
    const parse = (html: string) => new JSDOM(html).window.document;
    const previewStory = parse(preview).querySelector('[data-mx-inline-story]');
    const readerStory = parse(reader).querySelector('[data-mx-inline-story]');
    expect(previewStory?.outerHTML).toBe(readerStory?.outerHTML);
    expect(previewStory?.querySelector('#copy')?.getAttribute('data-mx-ast')).toBe('0.1');
    expect(parse(preview).querySelector('style[data-mx-story-css]')).not.toBeNull();
    expect(parse(preview).querySelector('style[data-mx-tw]')).toBeNull();
    expect(preview).not.toContain('story-ssr.cjs');
  });
});
