/**
 * Internal: paste pipe tables as editable Markdown tables and keep HTML table contents that
 * cannot be represented by a Markdown grid. Used by markdown-editor-commands.ts.
 */
import { Slice } from 'prosemirror-model';
import { Plugin } from 'prosemirror-state';
import { editorSchema, parseMarkdown } from './markdown-editor-model';

function normalizeHTMLTables(html: string, document: Document): string {
  if (!/<table[\s>]/i.test(html)) return html;
  const template = document.createElement('template');
  template.innerHTML = html;
  // Visit inner tables first: an enclosing cell can contain their content.
  for (const table of Array.from(template.content.querySelectorAll('table')).reverse()) {
    const rows = Array.from(table.rows);
    const width = rows[0]?.cells.length;
    const rectangular = width && rows.every(row => row.cells.length === width &&
      Array.from(row.cells).every(cell => cell.colSpan === 1 && cell.rowSpan === 1));
    if (!rectangular || table.caption) {
      // GFM has neither merged cells nor captions. Keep the words and original row order.
      const labels = rows.map(row => Array.from(row.cells, cell => cell.textContent).join(' | '));
      if (table.caption) labels.unshift(table.caption.textContent ?? '');
      table.replaceWith(...labels.map(label => {
        const p = document.createElement('p'); p.textContent = label; return p;
      }));
    }
  }
  return template.innerHTML;
}

export const tablePaste = new Plugin({
  props: {
    transformPastedHTML: (html, view) => normalizeHTMLTables(html, view.dom.ownerDocument),
    handlePaste(view, event) {
      const clipboard = event.clipboardData;
      const source = clipboard?.getData('text/plain');
      if (!source?.includes('|') || !source.includes('\n') || clipboard?.getData('text/html')) {
        return false;
      }
      const { $from } = view.state.selection;
      const { paragraph, heading, table } = editorSchema.nodes;
      if ($from.parent.type !== paragraph && $from.parent.type !== heading) return false;
      const doc = parseMarkdown(source);
      if (!doc.content.content.some(node => node.type === table)) return false;
      view.dispatch(view.state.tr.replaceSelection(new Slice(doc.content, 0, 0))
        .setMeta('paste', true).setMeta('uiEvent', 'paste').scrollIntoView());
      return true;
    },
  },
});
