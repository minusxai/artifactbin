/* @jsxImportSource solid-js */
/**
 * COMMENT BODIES THROUGH lib/markdown (../comment-display, ../CommentMarkdown): the display chunk loads on first use
 * (the first test runs before anything has loaded it), mention links become the mention components, images go through
 * the document's asset route, refused links and images and raw HTML show as typed, and tables written in a comment
 * display. This file never preloads the chunk; the rig the other comment tests share does, so this file runs in a graph
 * of its own (an islands worker's shared graph may already hold the chunk).
 */
// @isolated
import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/dom';
import { render } from '../../__tests__/helpers';
import { CommentMarkdown } from '../CommentMarkdown';
import { CommentFoldingBody } from '../CommentFoldingBody';
import { firstLine, previewText } from '../AnnotationPreview';
import { CommentDocument, loadCommentDisplay } from '../comment-display';

afterEach(() => { vi.restoreAllMocks(); });

const AGENT_BODY = 'Fixed in `lib/config.ts` — the cap was **10**:\n\n```ts\nconst max = 10;\n```\n\n- bumped the cap\n- added a test';

it('loads the display chunk on first use: the body, its fold and its preview appear once it arrives', async () => {
  // Every laid-out body is tall: the fold must be measured again once the markup is in.
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function (this: HTMLElement) { return this.querySelector('p') ? 2000 : 0; });
  const long = Array.from({ length: 30 }, (_, i) => `line ${i}`).join('\n');
  render(() => <section aria-label="Cold"><CommentFoldingBody text={long} foldable /><output aria-label="Preview">{firstLine(AGENT_BODY)}</output></section>);
  const cold = screen.getByLabelText('Cold');
  expect(cold.querySelector('[data-markdown] p')).toBeNull();
  expect(screen.getByLabelText('Preview').textContent).toBe('');
  // The render started the load; wait for it (however slow a cold runner is) rather than a timeout.
  await loadCommentDisplay();
  await waitFor(() => expect(cold.querySelector('[data-markdown] p')?.textContent).toContain('line 29'));
  expect(await within(cold).findByRole('button', { name: 'Show whole comment' })).toBeTruthy();
  expect(screen.getByLabelText('Preview').textContent).toBe('Fixed in lib/config.ts — the cap was 10:');
});

describe('once loaded', () => {
  it('previews a body as plain text, every block on its own line', async () => {
    await loadCommentDisplay();
    expect(previewText(AGENT_BODY)).toBe('Fixed in lib/config.ts — the cap was 10:\nconst max = 10;\nbumped the cap\nadded a test');
    expect(previewText('This is new\n## This is **a heading**\n\\## literal')).toBe('This is new\nThis is a heading\n## literal');
    expect(previewText('2 * 3 and a lone ` backtick')).toBe('2 * 3 and a lone ` backtick');
    expect(previewText('![a chart](https://example.com/c.png) here')).toBe('a chart here');
  });

  it('hydrates person and agent-session mentions into their components, and opens plain links in a new tab', async () => {
    await loadCommentDisplay();
    const session = `/chat?session=${'a'.repeat(64)}`;
    render(() => <CommentMarkdown label="Body" text={`ask **[@asha](/people/usr_asha)** and [@koala-8e44ad](${session}), see https://example.com/docs and README.md`} />);
    const body = screen.getByLabelText('Body');
    const person = within(body).getByRole('link', { name: '@asha' });
    expect(person.getAttribute('href')).toBe('/people/usr_asha');
    expect(person.className).toBe('text-accent');
    expect(person.querySelector('strong')?.textContent).toBe('@asha');
    const badge = within(body).getByRole('link', { name: '@koala-8e44ad' });
    expect(badge.getAttribute('href')).toBe(session);
    expect(badge.hasAttribute('data-agent-mention')).toBe(true);
    expect(badge.style.getPropertyValue('--mention-color')).toBe('#8e44ad');
    expect(body.querySelectorAll('[data-mx-link]')).toHaveLength(0);
    const plain = within(body).getByRole('link', { name: 'https://example.com/docs' });
    expect(plain.getAttribute('target')).toBe('_blank');
    expect(plain.getAttribute('rel')).toBe('noopener noreferrer');
    expect(within(body).queryByRole('link', { name: 'README.md' })).toBeNull();
  });

  it("shows an image through the document's asset route and an upload at its own address", async () => {
    await loadCommentDisplay();
    render(() => <CommentDocument.Provider value="doc1"><CommentMarkdown label="Body" text="![chart](https://example.com/c.png) ![mine](ref:abc123XYZ) ![here](/files/a.png)" /></CommentDocument.Provider>);
    const images = within(screen.getByLabelText('Body')).getAllByRole('img');
    expect(images.map(image => [image.getAttribute('alt'), image.getAttribute('src')])).toEqual([
      ['chart', `/a/doc1/assets?u=${encodeURIComponent('https://example.com/c.png')}`],
      ['mine', '/a/abc123XYZ/raw'],
      ['here', `/a/doc1/assets?u=${encodeURIComponent('/files/a.png')}`],
    ]);
  });

  it('shows refused links and images, images with no document to route through, and raw HTML as typed', async () => {
    await loadCommentDisplay();
    const source = 'click [here](javascript:alert(1)) or [there](java\tscript:alert(1)), ![x](http://plain.example/a.png) <img src=x onerror=alert(1)> <b>not bold</b>';
    render(() => <CommentDocument.Provider value="doc1"><CommentMarkdown label="Refused" text={source} /></CommentDocument.Provider>);
    const refused = screen.getByLabelText('Refused');
    expect(refused.querySelector('img, b')).toBeNull();
    expect(refused.textContent).toBe(source);
    // The refused image's text holds a bare address, which links as any bare address does; nothing else is a link.
    expect([...refused.querySelectorAll('a')].map(link => link.getAttribute('href'))).toEqual(['http://plain.example/a.png']);
    render(() => <CommentMarkdown label="Nowhere" text="![chart](https://example.com/c.png)" />);
    expect(screen.getByLabelText('Nowhere').querySelector('img')).toBeNull();
    expect(screen.getByLabelText('Nowhere').textContent).toBe('![chart](https://example.com/c.png)');
  });

  it('displays a table written in a comment, keeps snake_case and today\'s compact look', async () => {
    await loadCommentDisplay();
    render(() => <CommentMarkdown label="Table" text={'a snake_case_name\n\n| who | why |\n| --- | ---: |\n| `asha` | review |\n\n> quoted\n\n1. one\n\n```ts\nconst a = 1;\n```'} />);
    const body = screen.getByLabelText('Table');
    const table = within(body).getByRole('table');
    expect(within(table).getAllByRole('cell').map(cell => cell.textContent)).toEqual(['asha', 'review']);
    expect(within(table).getByRole('columnheader', { name: 'why' }).style.textAlign).toBe('right');
    expect(body.querySelector('em')).toBeNull();
    expect(body.querySelector('p')?.className).toBe('leading-normal');
    expect(body.querySelector('blockquote')?.className).toContain('border-l-2');
    expect(body.querySelector('ol')?.className).toContain('list-decimal');
    expect(body.querySelector('td code')?.className).toContain('font-mono');
    expect(body.querySelector('.comment-code-highlight > pre > code')?.textContent).toBe('const a = 1;');
  });
});
