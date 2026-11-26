/**
 * Internal: af-markdown-editor's paste. Plain text reads as Markdown, except in code, in a table
 * cell or with Shift held (Mod-Shift-V); HTML tables a Markdown grid cannot hold (merged cells,
 * captions) become one paragraph per row. Used by markdown-editor-commands.ts.
 */
import { Fragment, Slice, type Schema } from 'prosemirror-model';
import { Plugin } from 'prosemirror-state';
import { parseMarkdown } from './markdown-editor-model';
import { inTable } from './markdown-editor-table-commands';

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

/** A textblock at either end joins the text at the caret, with the spaces Markdown would trim. */
function markdownSlice(text: string, schema: Schema): Slice {
  let { content } = parseMarkdown(text, schema);
  for (const end of [false, true]) {
    const space = (end ? /[ \t]+$/ : /^[ \t]+/).exec(text)?.[0];
    const at = end ? content.childCount - 1 : 0, node = content.child(at);
    const edge = space && node.isTextblock && Fragment.from(schema.text(space));
    if (edge) content = content.replaceChild(at, node.copy(end ? node.content.append(edge)
      : edge.append(node.content)));
  }
  return new Slice(content, +!!content.firstChild?.isTextblock, +!!content.lastChild?.isTextblock);
}

export function markdownPaste(): Plugin {
  let plain = false;
  return new Plugin({
    props: {
      transformPastedHTML: (html, view) => normalizeHTMLTables(html, view.dom.ownerDocument),
      handleDOMEvents: {
        // Shift+Insert is an ordinary paste.
        keydown: (_view, event) => { plain = event.shiftKey && event.keyCode !== 45; },
        keyup: () => { plain = false; },
      },
      handlePaste(view, event) {
        const clipboard = event.clipboardData;
        const text = clipboard?.getData('text/plain');
        if (!text?.trim() || plain || clipboard?.getData('text/html')) return false;
        if (view.state.selection.$from.parent.type.spec.code || inTable(view.state)) return false;
        view.dispatch(view.state.tr.replaceSelection(markdownSlice(text, view.state.schema))
          .setMeta('paste', true).setMeta('uiEvent', 'paste').scrollIntoView());
        return true;
      },
    },
  });
}
