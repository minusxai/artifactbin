/**
 * `/a/<id>/raw` is an INTERNAL address, and the docs must not teach it.
 *
 * It has one public face now — `/a/<id>` — which serves the document itself to
 * anyone without a session and the app shell to its owner. `/raw` survives
 * underneath as the frame's src, the target of `ref:` image embeds and the
 * exporter's capture URL; it is not access-restricted (a browser must be able
 * to fetch it) but it is nobody's link. Teaching two addresses for one
 * document is how the second one ends up in a chat message, an og:url, or a
 * bookmark — and that one shows the document without any of its chrome.
 *
 * Same shape as no-dead-api-link: the docs are rendered, so the guard is a
 * test rather than a convention — over EVERY file of the tree, since a new
 * file joins the set by existing.
 */
import { describe, expect, it } from 'vitest';
import { buildMcpInstructions, buildQuickSheet, renderTree, skillTree } from '@/lib/skills';
import { startBrief } from '@/lib/start-links';

const BASE = 'https://example.test';

describe.each([
  ...renderTree(skillTree(), BASE).map(({ file, text }) => [`skills/${file.path}`, text] as [string, string]),
  ['the MCP instructions', buildMcpInstructions(BASE)],
  ['the brief', buildQuickSheet(BASE)],
  ['the start brief (fill)', startBrief(BASE, 'Ab3xK9', 'secret', 'fill')],
  ['the start brief (edit)', startBrief(BASE, 'Ab3xK9', 'secret', 'edit')],
])('%s', (_name, doc) => {
  it('never names /raw', () => {
    expect(doc).not.toContain('/raw');
  });
});

describe('the publishing skill', () => {
  it('still teaches the one public address, and the binding that replaces the raw URL', () => {
    const corpus = renderTree(skillTree(), BASE).map((x) => x.text).join('\n');
    expect(corpus).toContain('https://example.test/a/<id>');
    expect(corpus).toContain('ref:');
  });
});
