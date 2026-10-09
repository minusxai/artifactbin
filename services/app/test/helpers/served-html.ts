/**
 * SERVED HTML, READ AS THE BROWSER'S PARSER READS IT. A page the server answers is parsed by parse5 (the
 * HTML standard's tree builder, the one jsdom wraps) into a small element tree: tags, attributes, text and
 * JSON islands, with no window, no CSSOM and no layout. A route test asserting what the bytes SAY uses this; a
 * test asserting what a browser DOES with them (computed style, `hidden`, document order APIs) keeps jsdom.
 */
import { parse } from 'parse5';

interface ParsedNode {
  nodeName: string;
  tagName?: string;
  value?: string;
  attrs?: Array<{ name: string; value: string }>;
  childNodes?: ParsedNode[];
  content?: { childNodes: ParsedNode[] };
}

/** An attribute test: present (`true`), equal to a string, or matching a pattern. */
export type AttrMatch = Record<string, string | true | RegExp>;

/** A class list containing `name`, for an `AttrMatch` on `class`. */
export const cls = (name: string): RegExp => new RegExp(`(?:^|\\s)${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\s|$)`);

export class HtmlElement {
  readonly children: HtmlElement[] = [];

  constructor(private readonly node: ParsedNode, readonly parent: HtmlElement | null) {
    for (const child of node.childNodes ?? []) if (child.tagName) this.children.push(new HtmlElement(child, this));
  }

  get tag(): string { return this.node.tagName ?? ''; }

  attr(name: string): string | null { return this.node.attrs?.find((a) => a.name === name)?.value ?? null; }

  has(name: string): boolean { return this.attr(name) !== null; }

  /** Attribute names in source order. */
  get attrNames(): string[] { return (this.node.attrs ?? []).map((a) => a.name); }

  /** `textContent`, leaving out the text of any element whose tag is in `skip` (a page's `style` and `script`). */
  text(skip: readonly string[] = []): string {
    const walk = (node: ParsedNode): string => {
      if (node.nodeName === '#text') return node.value ?? '';
      if (node.tagName && node !== this.node && skip.includes(node.tagName)) return '';
      return (node.childNodes ?? []).map(walk).join('');
    };
    return walk(this.node);
  }

  matches(tag: string, attrs: AttrMatch = {}): boolean {
    if (tag !== '*' && this.tag !== tag) return false;
    return Object.entries(attrs).every(([name, want]) => {
      const value = this.attr(name);
      if (value === null) return false;
      return want === true || (typeof want === 'string' ? value === want : want.test(value));
    });
  }

  /** Every descendant matching, in document order. */
  findAll(tag: string, attrs: AttrMatch = {}): HtmlElement[] {
    const found: HtmlElement[] = [];
    const walk = (el: HtmlElement) => { for (const child of el.children) { if (child.matches(tag, attrs)) found.push(child); walk(child); } };
    walk(this);
    return found;
  }

  /** The first descendant matching, or null. */
  find(tag: string, attrs: AttrMatch = {}): HtmlElement | null { return this.findAll(tag, attrs)[0] ?? null; }

  /** The first CHILD matching (a `>` step), or null. */
  child(tag: string, attrs: AttrMatch = {}): HtmlElement | null { return this.children.find((el) => el.matches(tag, attrs)) ?? null; }

  byId(id: string): HtmlElement | null { return this.find('*', { id }); }

  /** The nearest ancestor matching (not this element), or null: `closest`, one step up. */
  ancestor(tag: string, attrs: AttrMatch = {}): HtmlElement | null {
    for (let el = this.parent; el; el = el.parent) if (el.matches(tag, attrs)) return el;
    return null;
  }
}

export interface ServedHtml {
  html: HtmlElement;
  head: HtmlElement;
  body: HtmlElement;
  title: string;
  byId(id: string): HtmlElement | null;
  find(tag: string, attrs?: AttrMatch): HtmlElement | null;
  findAll(tag: string, attrs?: AttrMatch): HtmlElement[];
  /** The `src` of every `<script type="module">`, in document order. */
  modules(): Array<string | null>;
  /** The parsed JSON of the element with this id (a data island), or null when there is none. */
  json<T = Record<string, unknown>>(id: string): T | null;
}

/** Parse a whole served document. */
export function servedHtml(source: string): ServedHtml {
  const documentNode = parse(source) as unknown as ParsedNode;
  const root = new HtmlElement({ nodeName: '#document', childNodes: documentNode.childNodes }, null);
  const html = root.child('html')!;
  return {
    html,
    head: html.child('head')!,
    body: html.child('body')!,
    get title() { return (html.child('head')?.child('title')?.text() ?? '').replace(/\s+/g, ' ').trim(); },
    byId: (id) => root.byId(id),
    find: (tag, attrs) => root.find(tag, attrs),
    findAll: (tag, attrs) => root.findAll(tag, attrs),
    modules: () => root.findAll('script', { type: 'module' }).map((script) => script.attr('src')),
    json: <T,>(id: string) => {
      const island = root.byId(id);
      return island ? JSON.parse(island.text()) as T : null;
    },
  };
}
