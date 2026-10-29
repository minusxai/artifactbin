import { afterEach, expect, it } from 'vitest';
import { markdownEditorFor, mountMarkdownEditor } from '../editor';

afterEach(() => { document.body.innerHTML = ''; });

it('finds the mounted editor from any element inside its region, and forgets it once destroyed', () => {
  const region = document.createElement('div');
  region.setAttribute('data-mx-markdown', '');
  document.body.append(region);
  const view = mountMarkdownEditor(region, { source: 'Hello **world**', onChange() {} });
  const inner = region.querySelector('strong') ?? region.firstElementChild!;
  expect(markdownEditorFor(region)).toBe(view);
  expect(markdownEditorFor(inner)).toBe(view);
  view.destroy();
  expect(markdownEditorFor(region)).toBeUndefined();
});

it('answers undefined outside a Markdown region and for a region with no editor mounted', () => {
  const outside = document.createElement('p');
  const region = document.createElement('div');
  region.setAttribute('data-mx-markdown', '');
  region.append(outside);
  document.body.append(region);
  expect(markdownEditorFor(document.createElement('span'))).toBeUndefined();
  expect(markdownEditorFor(outside)).toBeUndefined();
});
