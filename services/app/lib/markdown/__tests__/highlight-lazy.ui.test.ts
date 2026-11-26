/**
 * The editor's code highlighter is a lazy chunk (../extensions.ts): an editor shows code unhighlighted until it loads,
 * starts loading it for the first code block with a language, then redraws in place without a change or history step.
 * Its own file, so nothing has loaded the highlighter before it runs.
 */
import { expect, it, vi } from 'vitest';
import { Editor, type JSONContent } from '@tiptap/core';
import { loadCodeHighlighting, markdownExtensions, parse } from '../editor';
import { CODE_LANGUAGES } from '../code-language';
import Prism from '../prism-grammars';

it('every language the editor marks has a bundled grammar', () => {
  for (const language of CODE_LANGUAGES) expect(Prism.languages[language], language).toBeDefined();
});

it('shows code plainly until the highlighter loads, then highlights it without a change', async () => {
  const onUpdate = vi.fn();
  const editor = new Editor({ element: document.createElement('div'), extensions: markdownExtensions(), content: parse('```ts\nconst a = 1;\n```') as JSONContent, onUpdate });
  try {
    const code = editor.view.dom.querySelector('pre code')!;
    expect(code.getAttribute('data-language')).toBe('typescript');
    expect(code.querySelector('[class^="mx-code-token-"]')).toBeNull();
    await loadCodeHighlighting();
    expect(editor.view.dom.querySelector('pre code .mx-code-token-keyword')?.textContent).toBe('const');
    expect(onUpdate).not.toHaveBeenCalled();
  } finally { editor.destroy(); }
});
