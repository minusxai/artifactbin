/**
 * THE READER CHROME'S DOM CONTRACT. Every attribute and label here is what a
 * browser gate clicks or a stylesheet positions, so the strings are pinned
 * verbatim rather than approximately.
 */
import { describe, expect, it } from 'vitest';
import { renderReaderChrome, type ReaderChromeInput } from '@/lib/story/reader-chrome';

const chrome = (over: Partial<ReaderChromeInput> = {}): string =>
  renderReaderChrome({
    artifactId: 'ab12cd',
    title: 'Quarterly review',
    author: { username: 'ada' },
    ...over,
  });

describe('renderReaderChrome', () => {
  it('renders HIDDEN, stamped with the artifact id', () => {
    const html = chrome();
    expect(html).toContain('<div class="mx-reader-chrome mx-reader-chrome--hidden" data-mx-reader-chrome data-mx-reader-state="hidden" data-mx-artifact-id="ab12cd">');
    expect(chrome({ artifactId: null })).not.toContain('data-mx-artifact-id');
  });

  it('puts the logo first — home, and the only "hosted on" mark there is', () => {
    const html = chrome();
    expect(html).toContain('<a class="mx-reader-home" href="/" target="_top" aria-label="Home" data-mx-reader-logo data-mx-tip="Home"><img src="/logo-128.png" alt=""></a>');
    expect(html).not.toContain('Hosted on artifactbin');
    expect(html.indexOf('data-mx-reader-logo')).toBeLessThan(html.indexOf('data-mx-reader-rail'));
  });

  it('lays the rail out as like · comment · share · settings · profile, each labelled', () => {
    const html = chrome();
    const order = [
      'data-mx-reader-action="like" aria-label="Like"',
      'data-mx-reader-action="comment" aria-label="Comment"',
      'data-mx-reader-action="share" aria-label="Share"',
      'data-mx-reader-trigger="controls" aria-label="Open artifact controls" aria-expanded="false"',
      'data-mx-reader-trigger="menu" aria-label="Open menu" aria-expanded="false"',
    ];
    const positions = order.map((needle) => html.indexOf(needle));
    expect(positions.every((p) => p > -1)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    for (const label of ['like', 'comment', 'share', 'settings', 'profile']) {
      expect(html).toContain(`data-mobile-label>${label}</span>`);
    }
    expect(html.match(/<button type="button" class="mx-reader-action"/g)).toHaveLength(3);
    expect(html.match(/<button type="button" class="mx-reader-trigger"/g)).toHaveLength(2);
    const rail = html.indexOf('<div class="mx-reader-rail" data-mx-reader-rail>');
    expect(rail).toBeGreaterThan(-1);
    expect(positions[0]).toBeGreaterThan(rail);
  });

  it('bylines the author and the title, and offers Follow on the author', () => {
    const html = chrome({ title: 'A <b>bold</b> & "quoted" title' });
    expect(html).toContain('<div class="mx-reader-byline" data-mx-reader-byline>');
    expect(html).toContain('<a class="mx-reader-author" href="/@ada" target="_top" aria-label="View @ada\'s profile">@ada</a>');
    expect(html).toContain('<span class="mx-reader-title">A &lt;b&gt;bold&lt;/b&gt; &amp; &quot;quoted&quot; title</span>');
    expect(html).toContain('<button type="button" class="mx-reader-follow" data-mx-reader-action="follow" data-mx-author="ada" aria-label="Follow @ada" data-mx-tip="Follow @ada">follow</button>');
    // After the handle and the title: @who · what · follow.
    expect(html.indexOf('mx-reader-follow')).toBeGreaterThan(html.indexOf('mx-reader-title'));
    expect(html).not.toContain('mx-reader-create');
    expect(html).not.toContain('New artifact');
  });

  it('names every control for a hover tip', () => {
    const html = chrome();
    for (const [needle, tip] of [
      ['data-mx-reader-logo', 'Home'],
      ['data-mx-reader-action="like"', 'Like'],
      ['data-mx-reader-action="comment"', 'Comment'],
      ['data-mx-reader-action="share"', 'Share'],
      ['data-mx-reader-trigger="controls"', 'Artifact settings'],
      ['data-mx-reader-trigger="menu"', 'Profile'],
      ['data-mx-reader-action="follow"', 'Follow @ada'],
    ] as const) {
      const at = html.indexOf(needle);
      expect(at).toBeGreaterThan(-1);
      const tag = html.slice(at, html.indexOf('>', at));
      expect(tag).toContain(`data-mx-tip="${tip}"`);
    }
  });

  it('marks no author on an anonymous document, and no title when there is none', () => {
    const html = chrome({ author: { username: null }, title: null });
    expect(html).not.toContain('mx-reader-author');
    expect(html).not.toContain("'s profile");
    expect(html).not.toContain('mx-reader-title');
    expect(html).not.toContain('mx-reader-follow');
    expect(chrome({ author: null })).not.toContain('mx-reader-author');
    expect(chrome({ author: null })).not.toContain('mx-reader-follow');
  });

  it('escapes a hostile handle everywhere it is written, the follow tip included', () => {
    const html = chrome({ author: { username: 'a"><img src=x onerror=alert(1)>' } });
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&quot;&gt;&lt;img');
    expect(html).toContain('data-mx-tip="Follow @a&quot;&gt;&lt;img src=x onerror=alert(1)&gt;"');
  });

  it('carries the share toast and the copy fallback field', () => {
    const html = chrome();
    expect(html).toContain('<span class="mx-reader-toast" data-mx-reader-toast hidden>link copied</span>');
    expect(html).toContain('<input class="mx-reader-copy" data-mx-reader-copy type="text" readonly tabindex="-1" aria-hidden="true">');
  });

  it('keeps the two panels and the scrim exactly as the gates know them', () => {
    const html = chrome();
    expect(html).toContain('data-mx-reader-scrim');
    expect(html).toContain('data-mx-reader-panel="menu"');
    expect(html).toContain('data-mx-reader-panel="controls"');
    expect(html).toContain('data-mx-mode-choice="light"');
    expect(html).toContain('data-mx-mode-choice="dark"');
    expect(html).toContain('href="/account" target="_top"');
    expect(html).toContain('href="/docs/artifactbin/SKILL.md" target="_top"');
    expect(html).toContain('class="mx-reader-brand"');
  });

  it('offers the sign-in door and the fork ask under "this document", as before', () => {
    const html = chrome({ signIn: { unlocks: 'commenter', callbackUrl: '/a/ab12cd?intent=comment' }, fork: { href: '/a/ab12cd?intent=fork' } });
    expect(html).toContain('this document');
    expect(html).toContain('data-mx-signin href="/login?callbackUrl=%2Fa%2Fab12cd%3Fintent%3Dcomment" target="_top" aria-label="log in to comment"');
    expect(html).toContain('data-mx-fork href="/a/ab12cd?intent=fork" target="_top" aria-label="Fork artifact"');
    const bare = chrome();
    expect(bare).not.toContain('data-mx-signin');
    expect(bare).not.toContain('data-mx-fork');
    expect(bare).not.toContain('this document');
  });

  it('states provenance in the settings panel: linked when public, text only otherwise, absent when not forked', () => {
    const linked = chrome({ author: { username: 'ada', forkedFrom: { label: '@grace/xy98zw-first-draft', href: '/@grace/xy98zw-first-draft' } } });
    expect(linked).toContain('<span class="mx-reader-forked" data-mx-forked-from>forked from <a href="/@grace/xy98zw-first-draft" target="_top" aria-label="Open the artifact this was forked from">@grace/xy98zw-first-draft</a></span>');
    expect(linked.indexOf('data-mx-forked-from')).toBeGreaterThan(linked.indexOf('data-mx-reader-panel="controls"'));
    expect(linked).toContain('this document');

    const plain = chrome({ author: { username: 'ada', forkedFrom: { label: 'a document that is not public', href: null } } });
    expect(plain).toContain('<span class="mx-reader-forked" data-mx-forked-from>forked from a document that is not public</span>');
    expect(plain).not.toMatch(/<a[^>]*data-mx-forked-from/);
    expect(plain).not.toContain('xy98zw');

    expect(chrome()).not.toContain('data-mx-forked-from');
  });

  it('offers Edit only to a writer, between share and settings', () => {
    const html = chrome({ edit: true });
    expect(html).toContain('data-mx-reader-action="edit" aria-label="Edit" data-mx-tip="Edit"');
    expect(html.indexOf('data-mx-reader-action="edit"')).toBeGreaterThan(html.indexOf('data-mx-reader-action="share"'));
    expect(html.indexOf('data-mx-reader-action="edit"')).toBeLessThan(html.indexOf('data-mx-reader-trigger="controls"'));
    expect(chrome()).not.toContain('data-mx-reader-action="edit"');
  });

  it("carries the counts, the viewer's own state and the doors when the route gives them", () => {
    const html = chrome({ reactions: {
      like: { count: 128, liked: true, href: '/a/ab12cd?intent=like' },
      follow: { following: false, count: 12, href: '/login?callbackUrl=%2Fa%2Fab12cd%3Fintent%3Dfollow' },
      comment: { count: 6, href: '/a/ab12cd?intent=comment' },
    } });
    expect(html).toContain('data-mx-reader-action="like" aria-label="Unlike" data-mx-tip="Unlike" data-mx-liked="true" data-mx-href="/a/ab12cd?intent=like"');
    expect(html).toContain('<span class="mx-reader-count" data-mx-reader-count="like">128</span>');
    expect(html).toContain('data-mx-reader-action="comment" aria-label="Comment" data-mx-tip="Comment" data-mx-href="/a/ab12cd?intent=comment"');
    expect(html).toContain('<span class="mx-reader-count" data-mx-reader-count="comment">6</span>');
    expect(html).toContain('aria-label="Follow @ada" data-mx-tip="Follow @ada" data-mx-following="false" data-mx-href="/login?callbackUrl=%2Fa%2Fab12cd%3Fintent%3Dfollow">follow</button>');

    const followed = chrome({ reactions: { like: { count: 0, liked: false, href: '/x' }, follow: { following: true, count: 1, href: '/y' }, comment: { count: 0, href: '/z' } } });
    expect(followed).toContain('aria-label="Unfollow @ada" data-mx-tip="Unfollow @ada" data-mx-following="true" data-mx-href="/y">following</button>');
    expect(followed).toContain('<span class="mx-reader-count" data-mx-reader-count="like"></span>');
    expect(followed).toContain('<span class="mx-reader-count" data-mx-reader-count="comment"></span>');
    expect(followed).toContain('data-mx-liked="false"');

    // Nobody to follow — the author reading their own, an anonymous document.
    const own = chrome({ reactions: { like: { count: 3, liked: false, href: '/x' }, follow: null, comment: { count: 0, href: '/z' } } });
    expect(own).not.toContain('data-mx-reader-action="follow"');
  });

  it('never renders the retired credits', () => {
    const html = chrome();
    expect(html).not.toContain('mx-artifact-credits');
    expect(html).not.toContain('made with');
  });
});
