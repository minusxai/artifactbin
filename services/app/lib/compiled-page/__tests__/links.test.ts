// DESTINATION: services/app/lib/compiled-page/__tests__/links.test.ts
/**
 * LINK HINTS (docs/phase2-architecture.md §8; contract LinkHints): every `<a href>` that names an
 * artifact on this deployment, collected at compile, deduplicated, in document order; the first few
 * prerendered. Pure over the parsed nodes and the deployment's origins.
 */
import { describe, expect, it } from 'vitest';
import { parseJsx } from '@/lib/jsx';
import { linkHintsOf } from '../links';
import { PRERENDER_LIMIT } from '../contract';

const nodes = (markup: string) => { const parsed = parseJsx(markup); if (!parsed.ok) throw new Error(parsed.error); return parsed.nodes; };
const deployment = { origins: ['https://app.artifactbin.dev', 'https://artifactbin.dev'] };

describe('linkHintsOf', () => {
  it('collects same-deployment artifact links, relative and absolute, once each, in document order', () => {
    const hints = linkHintsOf(nodes(
      '<div><a href="/a/Btruq6">phase 1</a> <a href="https://app.artifactbin.dev/a/R9gGaO">proposal</a>'
      + ' <a href="https://artifactbin.dev/@sree/BID85d-offline-file">offline</a> <a href="/a/Btruq6#section">again</a>'
      + ' <a href="/a/8krW3P?$region=west">with values</a></div>'), deployment);
    expect(hints.prefetch).toEqual(['/a/Btruq6', 'https://app.artifactbin.dev/a/R9gGaO', 'https://artifactbin.dev/@sree/BID85d-offline-file', '/a/8krW3P?$region=west']);
    expect(hints.prerender).toEqual(hints.prefetch.slice(0, PRERENDER_LIMIT));
  });

  it('ignores external, mailto, anchor-only, javascript and non-artifact links, and reactive hrefs', () => {
    const hints = linkHintsOf(nodes(
      '<div><a href="https://example.com/a/Btruq6">elsewhere</a><a href="mailto:x@y.z">mail</a><a href="#top">top</a>'
      + '<a href="/login">login</a><a href="/@sree">profile</a><a href="/a/Btruq6/raw">raw</a><a href="$_row.url">row</a></div>'), deployment);
    expect(hints).toEqual({ prefetch: [], prerender: [] });
  });

  it('follows links inside kit components and For templates without repeating a template link per row', () => {
    const hints = linkHintsOf(nodes('<Card><CardContent><a href="/a/Btruq6">one</a><For each={$rows}><a href="/a/R9gGaO">template</a></For></CardContent></Card>'), deployment);
    expect(hints.prefetch).toEqual(['/a/Btruq6', '/a/R9gGaO']);
  });

  it('ignores protocol-relative, backslash, javascript: and downloadable links, and encodes what it emits', () => {
    const hints = linkHintsOf(nodes(
      '<div><a href="//example.com/a/Btruq6">pr</a><a href="/\\\\example.com/a/Btruq6">bs</a><a href="javascript:alert(1)//https://app.artifactbin.dev/a/Btruq6">js</a>'
      + '<a href="/a/Btruq6" download="x">dl</a><a href={"/a/R9gGaO"}>static expr</a><a href="/a/8krW3P?x=&quot;>q">quote</a>'
      + '<a href="http://app.artifactbin.dev/a/Btruq6">plain http is another origin</a></div>'), deployment);
    expect(hints.prefetch).toEqual(['/a/R9gGaO', '/a/8krW3P?x=%22%3Eq']);
  });

  it('prerenders only the first PRERENDER_LIMIT of many links', () => {
    const ids = ['AAAAA1', 'AAAAA2', 'AAAAA3', 'AAAAA4', 'AAAAA5'];
    const hints = linkHintsOf(nodes(`<div>${ids.map((id) => `<a href="/a/${id}">${id}</a>`).join('')}</div>`), deployment);
    expect(hints.prefetch).toEqual(ids.map((id) => `/a/${id}`));
    expect(hints.prerender).toEqual(hints.prefetch.slice(0, PRERENDER_LIMIT));
    expect(hints.prerender.length).toBeLessThan(hints.prefetch.length);
  });

  it('is empty for a document with no links', () => {
    expect(linkHintsOf(nodes('<p>plain</p>'), deployment)).toEqual({ prefetch: [], prerender: [] });
  });
});
