/**
 * The editor entry in a real Tiptap editor (jsdom): its on-screen markup is the display writer's for every sample,
 * with only EDITOR_ONLY_MARKUP removed; mounting and focusing changes nothing; documents built with commands save
 * and read back unchanged; task items toggle; images take an asynchronous address. One editor serves the samples.
 */
import { afterAll, describe, expect, it, vi } from 'vitest';
import { Editor, type JSONContent } from '@tiptap/core';
import { Fragment } from 'prosemirror-model';
import { renderHtml, type MarkdownDoc } from '../display';
import { EDITOR_ONLY_MARKUP, markdownExtensions, markdownSchema, parse, serialize } from '../editor';
import { MARK_ORDER } from '../types';
import { SAMPLES } from './samples';

const classifyLink = (href: string) => (href.startsWith('/api/people/') ? 'person' : null);
const imageAddress = (src: string) => `/a/doc/assets?u=${encodeURIComponent(src)}`;
const options = { images: true, classifyLink, imageAddress };
const extensions = () => markdownExtensions(options);
const editor = new Editor({ element: document.createElement('div'), extensions: extensions() });
afterAll(() => editor.destroy());

const VOID = new Set(['BR', 'HR', 'IMG']);
const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/ /g, '&nbsp;');
/** Highlighted code as runs of text with their token classes, outermost first: the one structural normalization. */
function codeRuns(code: Element): string {
  const runs: Array<[string, string]> = [];
  const walk = (node: Node, classes: string[]) => {
    if (node.nodeType === 3) {
      const key = classes.join(' ');
      if (runs.at(-1)?.[0] === key) runs.at(-1)![1] += node.textContent; else runs.push([key, node.textContent ?? '']);
      return;
    }
    const own = node instanceof Element ? [...node.classList].filter(name => name.startsWith(EDITOR_ONLY_MARKUP.codeTokenClassPrefix)) : [];
    node.childNodes.forEach(child => walk(child, [...classes, ...own]));
  };
  code.childNodes.forEach(child => walk(child, []));
  return runs.map(([classes, text]) => `[${classes}]${escape(text)}`).join('');
}
/** Markup with attributes sorted and EDITOR_ONLY_MARKUP (and nothing else) removed. */
function canonical(html: string): string {
  const template = document.createElement('template');
  template.innerHTML = html;
  for (const selector of EDITOR_ONLY_MARKUP.elements) template.content.querySelectorAll(selector).forEach(element => element.remove());
  for (const name of EDITOR_ONLY_MARKUP.classes) template.content.querySelectorAll(`.${name}`).forEach(element => { element.classList.remove(name); if (!element.classList.length) element.removeAttribute('class'); });
  const write = (node: Node): string => {
    if (node.nodeType === 3) return escape(node.textContent ?? '');
    if (!(node instanceof Element)) return '';
    const attributes = [...node.attributes].filter(attribute => !EDITOR_ONLY_MARKUP.attributes.includes(attribute.name) && !EDITOR_ONLY_MARKUP.displayAttributes.includes(attribute.name))
      .map(attribute => ` ${attribute.name}="${escape(EDITOR_ONLY_MARKUP.declarations.includes(attribute.name) ? (node as HTMLElement).style.cssText : attribute.value).replace(/"/g, '&quot;')}"`).sort().join('');
    const open = `<${node.tagName.toLowerCase()}${attributes}>`;
    if (VOID.has(node.tagName)) return open;
    const inner = node.tagName === 'CODE' && node.parentElement?.tagName === 'PRE' ? codeRuns(node) : [...node.childNodes].map(write).join('');
    return `${open}${inner}</${node.tagName.toLowerCase()}>`;
  };
  return [...template.content.childNodes].map(write).join('');
}
const show = (doc: MarkdownDoc) => { editor.commands.setContent(doc as JSONContent, { emitUpdate: false }); return editor.view.dom.innerHTML; };

describe('the editor shows the display markup', () => {
  it.each(SAMPLES)('%s', (_name, markdown) => {
    const doc = parse(markdown, { images: true });
    const display = renderHtml(doc, { classifyLink, imageAddress });
    expect(canonical(show(doc))).toBe(canonical(display));
    editor.state.doc.check();
  });
  it('removes only what EDITOR_ONLY_MARKUP lists, and the display carries none of the editor-only attributes', () => {
    const all = SAMPLES.map(([, markdown]) => renderHtml(parse(markdown, { images: true }), { classifyLink, imageAddress })).join('');
    for (const name of EDITOR_ONLY_MARKUP.attributes) expect(all).not.toContain(` ${name}=`);
    expect(all).toContain('aria-disabled="true"');
    expect(EDITOR_ONLY_MARKUP).toEqual({ attributes: ['contenteditable', 'draggable', 'translate', 'spellcheck', 'tabindex'], displayAttributes: ['aria-disabled'], elements: ['br.ProseMirror-trailingBreak', 'img.ProseMirror-separator'], classes: ['ProseMirror-selectednode'], codeTokenClassPrefix: 'mx-code-token-', declarations: ['style'] });
  });
  it('orders marks as the module does', () => {
    expect(Object.keys(markdownSchema({ images: true }).marks)).toEqual(MARK_ORDER);
  });
});

describe('mounting', () => {
  it.each(SAMPLES)('emits no change for %s, even when focused', (_name, markdown) => {
    const doc = parse(markdown, { images: true });
    const onUpdate = vi.fn();
    const mounted = new Editor({ element: document.createElement('div'), extensions: extensions(), content: doc as JSONContent, onUpdate });
    try {
      mounted.commands.focus('end');
      mounted.view.dom.dispatchEvent(new FocusEvent('focus'));
      expect(onUpdate).not.toHaveBeenCalled();
      mounted.state.doc.check();
      expect(mounted.state.doc.toJSON()).toEqual(markdownSchema({ images: true }).nodeFromJSON(doc).toJSON());
    } finally { mounted.destroy(); }
  });
});

describe('documents built with commands', () => {
  type Step = (editor: Editor) => boolean;
  /** A document built one command at a time from an empty editor; each command must apply. */
  const build = (steps: Step[]) => {
    const built = new Editor({ element: document.createElement('div'), extensions: extensions(), content: '' });
    try {
      steps.forEach((step, index) => { expect(step(built), `step ${index}: ${step.toString()}`).toBe(true); });
      built.state.doc.check();
      return built.state.doc;
    } finally { built.destroy(); }
  };
  const readsBack = (doc: ReturnType<typeof build>) => {
    const saved = serialize(doc);
    expect(markdownSchema({ images: true }).nodeFromJSON(parse(saved, { images: true })).toJSON(), saved).toEqual(doc.toJSON());
    return saved;
  };
  const text = (value: string, marks: string[] = []) => ({ type: 'text', text: value, ...(marks.length ? { marks: marks.map(type => ({ type })) } : {}) });

  it('save and read back as the same document', () => {
    const doc = build([
      e => e.commands.insertContent('Title'), e => e.commands.setNode('heading', { level: 2 }),
      e => e.commands.splitBlock(),
      e => e.commands.insertContent([text('plain '), text('bold', ['bold']), text(' '), text('code', ['bold', 'code']), text(' and '), text('struck', ['strike']), text('.')]),
      e => e.commands.setHardBreak(), e => e.commands.insertContent([text('- not a list item')]),
      e => e.commands.setHardBreak(), e => e.commands.insertContent([text('# not a heading')]),
      e => e.commands.setHardBreak(), e => e.commands.insertContent([text('> not a quote')]),
      e => e.commands.setHardBreak(), e => e.commands.insertContent([text('1. not a number')]),
      e => e.commands.splitBlock(), e => e.commands.toggleBulletList(), e => e.commands.insertContent('first'),
      e => e.commands.splitListItem('listItem'), e => e.commands.insertContent('second'), e => e.commands.sinkListItem('listItem'),
      e => e.commands.splitListItem('listItem'), e => e.commands.liftListItem('listItem'), e => e.commands.liftListItem('listItem'),
      e => e.commands.toggleTaskList(), e => e.commands.insertContent('[ ] task text'),
      e => e.commands.splitListItem('taskItem'), e => e.commands.liftListItem('taskItem'),
      e => e.commands.toggleOrderedList(), e => e.commands.insertContent('1. numbered'),
      e => e.commands.splitListItem('listItem'), e => e.commands.liftListItem('listItem'),
      e => e.commands.toggleBlockquote(), e => e.commands.insertContent('quoted *stars* and _under_'),
      e => e.commands.splitBlock(), e => e.commands.lift('blockquote'),
      e => e.commands.setCodeBlock({ language: 'ts' }), e => e.commands.insertContent('const fence = "```";'), e => e.commands.exitCode(),
      e => e.commands.insertContent([text('a '), { type: 'text', text: 'link', marks: [{ type: 'link', attrs: { href: 'https://l.example', title: 'Title' } }] }, text(' and '), { type: 'image', attrs: { src: 'ref:abc123', alt: 'upload [1]', title: null } }]),
      e => e.commands.insertTable({ rows: 2, cols: 2, withHeaderRow: true }),
      e => e.commands.insertContent('a | b'), e => e.commands.goToNextCell(), e => e.commands.insertContent('x'),
      e => e.commands.goToNextCell(), e => e.commands.insertContent('1'), e => e.commands.insertContent({ type: 'hardBreak' }), e => e.commands.insertContent('2'),
    ]);
    const saved = readsBack(doc);
    expect(saved).toContain('```ts\nconst fence = "```";\n```');
    expect(saved).toContain('~~struck~~.\n\\- not a list item\n\\# not a heading\n\\> not a quote\n1\\. not a number\n\n- first\n  - second\n- [ ] [ ] task text\n\n1. 1\\. numbered');
    expect(saved).toContain('| a \\| b | x |\n| --- | --- |\n| 1<br>2 |  |');
  });
  it('cannot hold what Markdown cannot write: a break in a heading, a block in a table cell', () => {
    const schema = markdownSchema({ images: true });
    const { heading, hardBreak, image, tableCell, tableHeader, paragraph } = schema.nodes;
    expect(heading!.validContent(Fragment.from(hardBreak!.create()))).toBe(false);
    expect(heading!.validContent(Fragment.from([schema.text('a'), image!.create({ src: '/i.png' })]))).toBe(true);
    for (const cell of [tableCell!, tableHeader!]) {
      expect(cell.validContent(Fragment.from(paragraph!.create()))).toBe(false);
      expect(cell.validContent(Fragment.from([schema.text('a'), hardBreak!.create()]))).toBe(true);
    }
    // Shift-Enter in a heading cannot put a break inside it, whatever the command does instead.
    const doc = build([e => e.commands.setNode('heading', { level: 1 }), e => e.commands.insertContent('a'), e => { e.commands.setHardBreak(); return true; }]);
    doc.descendants(node => { if (node.type.name === 'heading') expect(node.content.toJSON()?.some((child: { type: string }) => child.type === 'hardBreak') ?? false).toBe(false); });
  });
  it('turn a list loose when its items hold content a tight list cannot', () => {
    const doc = build([e => e.commands.toggleBulletList(), e => e.commands.insertContent('one'), e => e.commands.splitBlock(), e => e.commands.insertContent('two paragraphs')]);
    expect(doc.firstChild!.attrs.tight).toBe(false);
    readsBack(doc);
  });
});

describe('task items and images', () => {
  it('toggle a task item by a click on its marker or Mod-Enter', () => {
    const mounted = new Editor({ element: document.createElement('div'), extensions: extensions(), content: parse('- [ ] todo') as JSONContent });
    try {
      const item = mounted.view.dom.querySelector('li[role="checkbox"]')!;
      item.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      expect(serialize(mounted.state.doc)).toBe('- [x] todo');
      mounted.commands.focus('end');
      mounted.commands.keyboardShortcut('Mod-Enter');
      expect(serialize(mounted.state.doc)).toBe('- [ ] todo');
      expect(mounted.view.dom.querySelector('li')!.getAttribute('aria-checked')).toBe('false');
    } finally { mounted.destroy(); }
  });
  it('show an image once an asynchronous address resolves', async () => {
    let resolve!: (value: string) => void;
    const mounted = new Editor({ element: document.createElement('div'), extensions: markdownExtensions({ images: true, imageAddress: () => new Promise(done => { resolve = done; }) }), content: parse('![a](/p.png)', { images: true }) as JSONContent });
    try {
      const img = mounted.view.dom.querySelector('img:not(.ProseMirror-separator)')!;
      expect(img.getAttribute('src')).toBeNull();
      resolve('blob:figure');
      await Promise.resolve();
      expect(img.getAttribute('src')).toBe('blob:figure');
      expect(img.getAttribute('alt')).toBe('a');
    } finally { mounted.destroy(); }
  });
});
