/**
 * Internal: the Markdown vocabulary of af-markdown-editor: its schema, parser and serializer.
 * CommonMark plus ~~strikethrough~~; no HTML and no images (an image stays its literal text).
 * Used by: markdown-editor.ts, markdown-editor-commands.ts.
 */
import MarkdownIt from 'markdown-it';
import { MarkdownParser, MarkdownSerializer, defaultMarkdownParser, defaultMarkdownSerializer,
  schema as base } from 'prosemirror-markdown';
import { Schema, type MarkSpec, type Node as ProseNode } from 'prosemirror-model';

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
export const editorSchema = new Schema({
  nodes: base.spec.nodes.remove('image').update('heading',
    { ...base.spec.nodes.get('heading')!, content: 'text*' })
    .update('bullet_list', tight('bullet_list')).update('ordered_list', tight('ordered_list')),
  marks: base.spec.marks.update('link', safeLinkSpec).addToEnd('strike', strike),
});

const tokenizer = MarkdownIt('commonmark', { html: false }).enable('strikethrough')
  .disable('image');
const { image: _image, ...tokens } = defaultMarkdownParser.tokens;
const parser = new MarkdownParser(editorSchema, tokenizer, { ...tokens, s: { mark: 'strike' } });
// Bullets are written `- `, the spelling most hand-written Markdown uses.
const serializer = new MarkdownSerializer({ ...defaultMarkdownSerializer.nodes,
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
