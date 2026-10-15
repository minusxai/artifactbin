/**
 * THE KIT TEXT DECLARATION AGREES WITH THE KIT (lib/jsx/component-names `KIT_TEXT_ELEMENTS`).
 *
 * The editor types into a kit text component's compiled element as it would into a paragraph, and the
 * write-back replaces the component's children with what was typed. That is only right while the component
 * renders its children, unchanged, as the content of the one element the declaration names, on the element
 * carrying the node's AST stamp, as static kit HTML (no island hydrating over the typing). This compiles each
 * declared component in its usual context and checks exactly that, so a kit change that wraps, reorders or
 * replaces the children fails here instead of writing render output into an author's source.
 */
import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { compilePage, KIT } from '../compiler';
import { loadCompilerBuild } from '../build.server';
import { KIT_TEXT_ELEMENTS } from '@/lib/jsx/component-names';
import { inputOf } from './p3-static/harness';

/** Each declared component where an author writes it: a cell in a row, a title in a card. */
const CONTEXT: Record<string, (inner: string) => string> = {
  TableHead: (inner) => `<Table><TableHeader><TableRow>${inner}</TableRow></TableHeader></Table>`,
  TableCell: (inner) => `<Table><TableBody><TableRow>${inner}</TableRow></TableBody></Table>`,
  TableCaption: (inner) => `<Table>${inner}</Table>`,
  CardTitle: (inner) => `<Card><CardHeader>${inner}</CardHeader></Card>`,
  CardDescription: (inner) => `<Card><CardHeader>${inner}</CardHeader></Card>`,
  CardContent: (inner) => `<Card>${inner}</Card>`,
  CardFooter: (inner) => `<Card>${inner}</Card>`,
  AlertTitle: (inner) => `<Alert>${inner}</Alert>`,
  AlertDescription: (inner) => `<Alert>${inner}</Alert>`,
  Badge: (inner) => `<p>${inner}</p>`,
  BreadcrumbLink: (inner) => `<Breadcrumb><BreadcrumbList><BreadcrumbItem>${inner}</BreadcrumbItem></BreadcrumbList></Breadcrumb>`,
  BreadcrumbPage: (inner) => `<Breadcrumb><BreadcrumbList><BreadcrumbItem>${inner}</BreadcrumbItem></BreadcrumbList></Breadcrumb>`,
};

/** A node's children as the editor would read them back: text, and elements by tag with theirs. */
const shape = (node: Node): unknown => node.nodeType === 3 ? node.textContent
  : [(node as Element).localName, ...[...node.childNodes].map(shape)];

describe('kit text components', () => {
  it('every declared one has a context here (a new entry is checked, never skipped)', () => {
    expect(Object.keys(CONTEXT).sort()).toEqual(Object.keys(KIT_TEXT_ELEMENTS).sort());
  });

  it.each(Object.entries(KIT_TEXT_ELEMENTS))('%s renders its children unchanged as the content of its stamped <%s>', async (tag, element) => {
    const meta = KIT[tag];
    expect(meta, `${tag} is a kit component`).toBeDefined();
    expect(meta!.island, `${tag} is static, not an island`).toBeUndefined();
    expect(meta!.noChildren).toBeUndefined();
    const markup = `<div id="root">${CONTEXT[tag]!(`<${tag} id="k">Plain &amp; <b>bold</b> text</${tag}>`)}</div>`;
    const page = await compilePage(await inputOf({ key: `kit-text-${tag}`, group: 'tag', template: null, markup }), loadCompilerBuild());
    const doc = new JSDOM(page.html).window.document;
    const host = doc.getElementById('k');
    expect(host?.localName).toBe(element);
    expect(host!.hasAttribute('data-mx-ast')).toBe(true);
    // Served as static HTML: no hydration key on it or around it.
    expect(host!.closest('[data-hk]')).toBeNull();
    expect([...host!.childNodes].map(shape)).toEqual(['Plain & ', ['b', 'bold'], ' text']);
  });
});
