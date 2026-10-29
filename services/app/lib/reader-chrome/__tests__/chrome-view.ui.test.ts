import { afterEach, describe, expect, it } from 'vitest';
import type { JsxNode } from '@/lib/jsx';
import { parseJsxOrThrow } from '@/test/helpers/jsx';
import { syncDocumentOutline } from '../outline-view';
import { MOUNT_ATTR, isScriptComponent } from '../script-mount';

const nodes = (source: string): JsxNode[] => parseJsxOrThrow(source).nodes;
const first = (source: string): JsxNode => nodes(source)[0]!;

function page(): { root: HTMLElement; rail: HTMLElement } {
  const root = document.createElement('div');
  root.innerHTML = '<div class="mx-reader"><nav class="mx-outline" hidden></nav><div class="mx-doc--document"></div></div>';
  document.body.append(root);
  return { root, rail: root.querySelector<HTMLElement>('.mx-outline')! };
}
afterEach(() => { document.body.innerHTML = ''; });

describe('syncDocumentOutline', () => {
  it('draws numbered section rows and sub rows with the heading paths a click navigates to', () => {
    const { root, rail } = page();
    syncDocumentOutline(root, nodes('<article><h1>Title</h1><h2>Intro</h2><h3>Detail</h3><h2>Plan</h2></article>'));
    expect(rail.hidden).toBe(false);
    const rows = [...rail.querySelectorAll('button')];
    expect(rows.map(row => row.textContent)).toEqual(['Title', 'Intro', 'Detail', 'Plan']);
    expect(rows.map(row => row.getAttribute('aria-label'))).toEqual(['Go to Title', 'Go to section 1: Intro', 'Go to Detail', 'Go to section 2: Plan']);
    expect(rows[2]!.className).toBe('mx-outline-row mx-outline-sub');
    expect(rows[1]!.dataset.mxTarget).toBe('0.1');
    expect(rail.querySelector('.mx-outline-label')?.textContent).toBe('Contents');
  });

  it('escapes heading text and hides the rail when the document has no headings', () => {
    const { root, rail } = page();
    syncDocumentOutline(root, nodes('<article><h2>{"<img src=x onerror=alert(1)> & ü"}</h2></article>'));
    expect(rail.querySelector('img')).toBeNull();
    expect(rail.querySelector('button')!.textContent).toBe('<img src=x onerror=alert(1)> & ü');
    syncDocumentOutline(root, nodes('<article><p>No headings</p></article>'));
    expect(rail.hidden).toBe(true);
    expect(rail.querySelectorAll('button')).toHaveLength(0);
  });

  it('leaves an unchanged outline untouched (no remount) and redraws when headings change', () => {
    const { root, rail } = page();
    const doc = nodes('<article><h2>One</h2></article>');
    syncDocumentOutline(root, doc);
    const row = rail.querySelector('button');
    syncDocumentOutline(root, nodes('<article><h2>One</h2></article>'));
    expect(rail.querySelector('button')).toBe(row);
    syncDocumentOutline(root, nodes('<article><h2>Two</h2></article>'));
    expect(rail.querySelector('button')).not.toBe(row);
    expect(rail.textContent).toContain('Two');
  });

  it('does nothing when the page has no document column or no rail beside it', () => {
    const bare = document.createElement('div');
    expect(() => syncDocumentOutline(bare, nodes('<h2>One</h2>'))).not.toThrow();
    bare.innerHTML = '<div class="mx-doc--document"></div>';
    syncDocumentOutline(bare, nodes('<h2>One</h2>'));
    expect(bare.querySelector('button')).toBeNull();
  });
});

describe('isScriptComponent', () => {
  it('is true only for a capitalized tag outside the kit and declaration vocabularies', () => {
    expect(isScriptComponent(first('<Counter start={1} />'))).toBe(true);
    expect(isScriptComponent(first('<Chart />'))).toBe(false);
    for (const tag of ['Helmet', 'Query', 'Mutation', 'Param', 'Value']) expect(isScriptComponent(first(`<${tag} />`))).toBe(false);
    expect(isScriptComponent(first('<div />'))).toBe(false);
    expect(isScriptComponent({ type: 'text', value: 'Counter' } as JsxNode)).toBe(false);
  });

  it('names the mount attribute as a data attribute', () => {
    expect(MOUNT_ATTR).toBe('data-mx-mount');
  });
});
