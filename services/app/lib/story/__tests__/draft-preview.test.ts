import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { compiledDocument } from '@/lib/compiled-page/__tests__/document-helper';
import { renderDraftPreview } from '../prepared/draft-preview.server';

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
      theme: 'volta' as const,
      template: null,
      colorMode: 'light' as const,
      compiledCss: '.sample { color: var(--primary); }',
      refData: {},
    };
    const [preview, reader] = await Promise.all([renderDraftPreview(input), compiledDocument(input)]);
    const parse = (html: string) => new JSDOM(html).window.document;
    const previewStory = parse(preview).querySelector('[data-mx-inline-story]');
    const readerStory = parse(reader).querySelector('[data-mx-inline-story]');
    expect(previewStory?.outerHTML).toBe(readerStory?.outerHTML);
    expect(previewStory?.querySelector('#copy')?.getAttribute('data-mx-ast')).toBe('0.1');
    const draft = parse(preview), saved = parse(reader);
    expect(draft.documentElement.getAttribute('data-theme')).toBe('volta');
    expect(draft.querySelector('style[data-mx-story-css]')).toBeNull();
    for (const attr of ['data-mx-tw', 'data-mx-fonts', 'data-mx-system']) {
      expect(draft.querySelector(`style[${attr}]`)?.textContent).toBe(saved.querySelector(`style[${attr}]`)?.textContent);
      expect(draft.querySelector(`style[${attr}]`)).not.toBeNull();
    }
    expect(preview).not.toContain('story-ssr.cjs');
  });
});
