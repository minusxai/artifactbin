/**
 * A harvested drawing is kept byte for byte when it is inert SVG, and refused
 * — never rewritten — when anything in it could run, navigate or fetch. The
 * fixtures are the engine's own output (Mermaid 12 through the kit), harvested
 * from a real page.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { MAX_MERMAID_SVG_BYTES, sanitizeMermaidSvg } from '../sanitize';

const fixture = (name: string) => readFileSync(path.join(import.meta.dirname, 'fixtures', name), 'utf8');
const SVG = (inner: string, attrs = '') => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"${attrs}>${inner}</svg>`;

describe('sanitizeMermaidSvg keeps the engine\'s drawings exactly', () => {
  it.each(['flowchart.svg', 'sankey.svg', 'treemap.svg'])('%s (markers, gradients, clip paths, keyframes) passes unchanged', (name) => {
    const svg = fixture(name);
    expect(sanitizeMermaidSvg(svg)).toBe(svg);
  });
  it('keeps text with escaped markup, fragment references and xlink', () => {
    const svg = SVG('<defs><marker id="m"><path d="M0 0L1 1"/></marker></defs><use xlink:href="#m"/><path marker-end="url(#m)" style="fill: url(&quot;#g&quot;)"/><text>a &lt;b&gt; &amp; &#x4e2d;</text>', ' xmlns:xlink="http://www.w3.org/1999/xlink"');
    expect(sanitizeMermaidSvg(svg)).toBe(svg);
  });
  it('refuses a Mermaid label drawn through foreignObject rather than rewriting it (the engine keeps drawing it)', () => {
    expect(sanitizeMermaidSvg(fixture('journey-foreign-object.svg'))).toBeNull();
  });
});

describe('sanitizeMermaidSvg refuses anything that could run, navigate or fetch', () => {
  it.each([
    ['a script element', SVG('<script>alert(1)</script>')],
    ['a script in another namespace prefix', SVG('<svg:script>alert(1)</svg:script>')],
    ['foreignObject HTML', SVG('<foreignObject><div xmlns="http://www.w3.org/1999/xhtml">x</div></foreignObject>')],
    ['an event handler', SVG('<rect onload="alert(1)"/>')],
    ['an event handler in upper case', SVG('<rect ONCLICK="alert(1)"/>')],
    ['an anchor', SVG('<a href="https://example.com"><text>x</text></a>')],
    ['an external image', SVG('<image href="https://example.com/x.png"/>')],
    ['a use of an external document', SVG('<use href="https://example.com/sprite.svg#a"/>')],
    ['a javascript: href', SVG('<use xlink:href="javascript:alert(1)"/>', ' xmlns:xlink="http://www.w3.org/1999/xlink"')],
    ['a data: href', SVG('<use href="data:image/svg+xml,&lt;svg/&gt;"/>')],
    ['an animation that rewrites an href', SVG('<set attributeName="href" to="javascript:alert(1)"/>')],
    ['xml:base', SVG('<g xml:base="https://example.com/"><use href="#a"/></g>')],
    ['an external url() in an attribute', SVG('<rect fill="url(https://example.com/p.svg#g)"/>')],
    ['an external url() in a style attribute', SVG('<rect style="fill:url(//example.com/x)"/>')],
    ['a CSS-escaped url in a style attribute', SVG('<rect style="fill:u\\72l(https://example.com)"/>')],
    ['an external url() in a stylesheet', SVG('<style>rect{fill:url(https://example.com/x.svg#g)}</style>')],
    ['an @import', SVG('<style>@import "https://example.com/x.css";</style>')],
    ['an @font-face', SVG('<style>@font-face{font-family:x;src:url(#f)}</style>')],
    ['image-set in a stylesheet', SVG('<style>rect{fill:image-set("https://example.com/x.png" 1x)}</style>')],
    ['a stylesheet that closes its element', SVG('<style>rect{}&lt;/style&gt;</style>')],
    ['a DOCTYPE with an entity', `<!DOCTYPE svg [<!ENTITY x "y">]>${SVG('<text>&x;</text>')}`],
    ['an undefined entity', SVG('<text>&x;</text>')],
    ['a comment', SVG('<!-- x --><rect/>')],
    ['CDATA', SVG('<style><![CDATA[rect{}]]></style>')],
    ['a processing instruction', `<?xml-stylesheet href="https://example.com/x.css"?>${SVG('<rect/>')}`],
    ['an HTML root', '<html><body><svg xmlns="http://www.w3.org/2000/svg"/></body></html>'],
    ['a root in another namespace', '<svg xmlns="http://www.w3.org/1999/xhtml"><rect/></svg>'],
    ['a second namespace', SVG('<rect/>', ' xmlns:h="http://www.w3.org/1999/xhtml"')],
    ['unbalanced markup', '<svg xmlns="http://www.w3.org/2000/svg"><g><rect/></svg>'],
    ['markup after the root', `${SVG('<rect/>')}<script>alert(1)</script>`],
    ['two roots', `${SVG('<rect/>')}${SVG('<rect/>')}`],
    ['a single-quoted attribute', SVG("<rect fill='red'/>")],
    ['an unquoted attribute', SVG('<rect fill=red/>')],
    ['a duplicated attribute', SVG('<rect fill="red" fill="blue"/>')],
    ['an empty input', ''],
  ])('refuses %s', (_name, svg) => {
    expect(sanitizeMermaidSvg(svg)).toBeNull();
  });
  it('refuses a drawing over the size bound', () => {
    expect(sanitizeMermaidSvg(SVG(`<text>${'x'.repeat(MAX_MERMAID_SVG_BYTES)}</text>`))).toBeNull();
  });
});
