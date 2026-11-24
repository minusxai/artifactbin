/**
 * Internal: the Markdown vocabulary of af-markdown-editor: its schema, parser and serializer.
 * CommonMark plus strikethrough and pipe tables. HTML and images stay literal text.
 * Used by: markdown-editor.ts, markdown-editor-commands.ts.
 */
import MarkdownIt from 'markdown-it';
import { MarkdownParser, MarkdownSerializer, defaultMarkdownParser, defaultMarkdownSerializer,
  schema as base, type ParseSpec } from 'prosemirror-markdown';
import { Fragment, Schema, type MarkSpec, type NodeSpec, type Node as ProseNode }
  from 'prosemirror-model';

/** Relative links and http(s), mailto and tel only: anything else is drawn without an href. */
function safeLink(href: string): boolean {
  const clean = href.replace(/[\x00-\x20]/g, '');
  return !/^[a-z][a-z\d+.-]*:/i.test(clean) || /^(https?|mailto|tel):/i.test(clean);
}

const link = base.spec.marks.get('link')!;
const safeLinkSpec: MarkSpec = {
  ...link,
  parseDOM: [{ tag: 'a[href]', getAttrs: node => {
    const href = (node as HTMLElement).getAttribute('href') ?? '';
    return safeLink(href) ? { href, title: (node as HTMLElement).getAttribute('title') } : false;
  } }],
  toDOM: mark => ['a', { href: safeLink(mark.attrs.href) ? mark.attrs.href : null,
    title: mark.attrs.title, rel: 'noopener noreferrer' }, 0],
};
const strike: MarkSpec = {
  parseDOM: [{ tag: 's' }, { tag: 'del' }, { tag: 'strike' },
    { style: 'text-decoration', getAttrs: value => value.includes('line-through') && null }],
  toDOM: () => ['s', 0],
};

// A list made in the editor is tight (no blank line between items); parsed ones keep theirs.
const tight = (name: string) => {
  const spec = base.spec.nodes.get(name)!;
  return { ...spec, attrs: { ...spec.attrs, tight: { default: true } } };
};
// GFM cells contain one line of marked text. Keeping them isolating protects their boundaries.
function cellSpec(tag: 'th' | 'td'): NodeSpec {
  return {
    content: 'text*', isolating: true, attrs: { align: { default: null } },
    parseDOM: [{ tag, getAttrs: cell => {
      const align = cell.dataset.align || cell.style.textAlign || cell.getAttribute('align');
      return { align: align && ['left', 'center', 'right'].includes(align) ? align : null };
    } }],
    toDOM: cell => [tag, { 'data-align': cell.attrs.align, scope: tag === 'th' ? 'col' : null }, 0],
  };
}
const tableNodes: Record<string, NodeSpec> = {
  table: {
    group: 'block', content: 'table_row+', isolating: true, parseDOM: [{ tag: 'table' }],
    toDOM: () => ['div', { class: 'af-md-table-wrap' }, ['table', ['tbody', 0]]],
  },
  table_row: {
    content: '(table_header | table_cell)+', parseDOM: [{ tag: 'tr' }], toDOM: () => ['tr', 0],
  },
  table_header: cellSpec('th'), table_cell: cellSpec('td'),
};
export const editorSchema = new Schema({
  nodes: base.spec.nodes.remove('image').update('heading',
    { ...base.spec.nodes.get('heading')!, content: 'text*' })
    .update('bullet_list', tight('bullet_list')).update('ordered_list', tight('ordered_list'))
    .append(tableNodes),
  marks: base.spec.marks.update('link', safeLinkSpec).addToEnd('strike', strike),
});

/** Preserve all cells after a paste or cross-cell edit while restoring GFM's rectangular shape. */
export function rectangularizeTable(table: ProseNode): ProseNode {
  const head = table.firstChild!;
  let width = head.childCount;
  table.forEach(row => { width = Math.max(width, row.childCount); });
  const columnAlign = (column: number) => head.maybeChild(column)?.attrs.align ?? null;
  const rows = table.content.content.map((row, index) => {
    const type = index === 0 ? editorSchema.nodes.table_header! : editorSchema.nodes.table_cell!;
    if (row.childCount === width && row.content.content.every((cell, column) =>
      cell.type === type && cell.attrs.align === columnAlign(column))) return row;
    const cells = Array.from({ length: width }, (_, column) => {
      const cell = row.maybeChild(column);
      return type.create({ align: columnAlign(column) }, cell?.content);
    });
    return row.copy(Fragment.fromArray(cells));
  });
  return rows.every((row, index) => row === table.child(index))
    ? table : table.copy(Fragment.fromArray(rows));
}

const tokenizer = MarkdownIt('commonmark', { html: false }).enable(['strikethrough', 'table'])
  .disable('image');
// Older rich-text saves placed each pipe row in its own paragraph. Recover only explicit
// rectangular tables; leave code blocks, nested prose and unrelated paragraphs as parsed.
tokenizer.core.ruler.after('block', 'spaced_tables', state => {
  if (!/\|[ \t]*:?-+:?[ \t]*\|/.test(state.src)) return;
  const tokens = state.tokens;
  const result: typeof tokens = [];
  function rowAt(i: number) {
    if (tokens[i]?.type !== 'paragraph_open' || tokens[i]!.level !== 0) return;
    const text = tokens[i + 1]?.content.trim();
    if (text && /^\|[^\n]*\|$/.test(text)) return text;
  }
  const divider = (row?: string) => !!row && /^\|(?:[ \t]*:?-+:?[ \t]*\|)+$/.test(row);
  const width = (row: string) => row.slice(1, -1).split(/(?<!\\)\|/).length;
  for (let i = 0; i < tokens.length; i++) {
    const header = rowAt(i), rule = rowAt(i + 3);
    if (!header || !rule || !divider(rule) || width(header) !== width(rule)) {
      result.push(tokens[i]!); continue;
    }
    const rows = [header, rule];
    let end = i + 6;
    for (let row = rowAt(end); row && width(row) === width(rule); row = rowAt(end)) {
      if (divider(row) || divider(rowAt(end + 3))) break;
      rows.push(row);
      end += 3;
    }
    const parsed: typeof tokens = [];
    state.md.block.parse(rows.join('\n'), state.md, state.env, parsed);
    if (parsed[0]?.type !== 'table_open') { result.push(tokens[i]!); continue; }
    for (const token of parsed) result.push(token);
    i = end - 1;
  }
  state.tokens = result;
});
const { image: _image, ...tokens } = defaultMarkdownParser.tokens;
// markdown-it puts each column's alignment on its cells and emits thead/tbody wrappers.
const tableCellToken = (block: string): ParseSpec => ({
  block, getAttrs: token =>
    ({ align: token.attrGet('style')?.replace('text-align:', '') ?? null }),
});
const parser = new MarkdownParser(editorSchema, tokenizer, {
  ...tokens, s: { mark: 'strike' }, table: { block: 'table' }, tr: { block: 'table_row' },
  thead: { ignore: true }, tbody: { ignore: true },
  th: tableCellToken('table_header'), td: tableCellToken('table_cell'),
});
// Bullets are written `- `, the spelling most hand-written Markdown uses.
const serializer: MarkdownSerializer = new MarkdownSerializer({ ...defaultMarkdownSerializer.nodes,
  table(state, table) {
    const line = (cells: string[]) => state.write('| ' + cells.join(' | ') + ' |');
    rectangularizeTable(table).forEach((row, _, rowIndex) => {
      if (rowIndex) state.ensureNewLine();
      line(row.content.content.map(cell => {
        const paragraph = editorSchema.nodes.paragraph!.create(null, cell.content);
        const markdown = serializer.serialize(editorSchema.nodes.doc!.create(null, paragraph));
        // Table tokenization consumes one backslash before each pipe, even inside code spans.
        return markdown.replace(/\|/g, '\\|');
      }));
      if (rowIndex === 0) {
        state.ensureNewLine();
        line(row.content.content.map(cell => {
          const align = cell.attrs.align;
          return (align === 'left' || align === 'center' ? ':' : '') + '---' +
            (align === 'right' || align === 'center' ? ':' : '');
        }));
      }
    });
    state.closeBlock(table);
  },
  bullet_list: (state, node) => state.renderList(node, '  ', () => '- ') }, {
  ...defaultMarkdownSerializer.marks,
  strike: { open: '~~', close: '~~', mixable: true, expelEnclosingWhitespace: true },
});

/** Markdown source to a document; empty or missing source is one empty paragraph. */
export function parseMarkdown(source: string | null | undefined): ProseNode {
  return parser.parse(source ?? '') ?? editorSchema.node('doc', null,
    [editorSchema.node('paragraph')]);
}
/** A document back to Markdown source: '' when it holds no text. */
export const serializeMarkdown = (doc: ProseNode): string => serializer.serialize(doc);
/** The source as the editor would write it back, so equal content compares equal. */
export const normalizeMarkdown = (source: string | null | undefined): string =>
  serializeMarkdown(parseMarkdown(source));
