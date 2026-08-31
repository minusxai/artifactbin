/**
 * link-edit — the inline-link algebra for WYSIWYG text hosts.
 *
 * Selections are captured as character offsets over the host's text (Range-stable across the
 * blur/re-render that typing a URL causes), then re-resolved and wrapped in an `<a>` on the
 * live DOM. jsdom project: these are DOM/Range tests, no React.
 */
import {
  normalizeLinkHref, captureLinkTarget, applyLinkToHost, removeLinkFromHost, LINK_CLASSES,
} from '../link-edit';

/** A text host with the given innerHTML, attached so Ranges behave. */
function host(innerHTML: string): HTMLElement {
  const el = document.createElement('p');
  el.innerHTML = innerHTML;
  document.body.appendChild(el);
  return el;
}

/** A Range over [start, end) character offsets of `el`'s text (first-text-node simple cases). */
function rangeOver(el: HTMLElement, start: number, end: number): Range {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n as Text);
  const locate = (offset: number): [Text, number] => {
    let acc = 0;
    for (const t of nodes) {
      const len = t.data.length;
      if (offset <= acc + len) return [t, offset - acc];
      acc += len;
    }
    const last = nodes[nodes.length - 1];
    return [last, last.data.length];
  };
  const r = document.createRange();
  const [sn, so] = locate(start);
  const [en, eo] = locate(end);
  r.setStart(sn, so);
  r.setEnd(en, eo);
  return r;
}

afterEach(() => { document.body.innerHTML = ''; });

describe('normalizeLinkHref', () => {
  it('passes absolute http(s)/mailto/tel through', () => {
    expect(normalizeLinkHref('https://example.com/x?y=1')).toBe('https://example.com/x?y=1');
    expect(normalizeLinkHref('http://example.com')).toBe('http://example.com');
    expect(normalizeLinkHref('mailto:a@b.com')).toBe('mailto:a@b.com');
    expect(normalizeLinkHref('tel:+15551234567')).toBe('tel:+15551234567');
  });

  it('gives a bare domain https://', () => {
    expect(normalizeLinkHref('example.com')).toBe('https://example.com');
    expect(normalizeLinkHref('docs.example.co/path#frag')).toBe('https://docs.example.co/path#frag');
  });

  it('keeps site-relative and fragment forms', () => {
    expect(normalizeLinkHref('/a/abc123')).toBe('/a/abc123');
    expect(normalizeLinkHref('#section')).toBe('#section');
  });

  it('rejects active-content schemes and unrecognizable input', () => {
    expect(normalizeLinkHref('javascript:alert(1)')).toBeNull();
    expect(normalizeLinkHref('data:text/html,x')).toBeNull();
    expect(normalizeLinkHref('vbscript:x')).toBeNull();
    expect(normalizeLinkHref('   ')).toBeNull();
    expect(normalizeLinkHref('not a url')).toBeNull();
  });

  it('lowercases the scheme, which is case-insensitive, and leaves the rest alone', () => {
    // Downstream compares against literal prefixes (the frame re-checks before
    // it writes the attribute), so a scheme that only differs in case must not
    // read as a different scheme and silently drop the link.
    expect(normalizeLinkHref('HTTPS://Example.com/Path?A=B')).toBe('https://Example.com/Path?A=B');
    expect(normalizeLinkHref('MailTo:A@B.com')).toBe('mailto:A@B.com');
    expect(normalizeLinkHref('TEL:+15551234567')).toBe('tel:+15551234567');
  });

  it('trims whitespace before classifying', () => {
    expect(normalizeLinkHref('  example.com  ')).toBe('https://example.com');
  });
});

describe('captureLinkTarget', () => {
  it('captures a plain text selection as offsets', () => {
    const el = host('Hello wonderful world');
    expect(captureLinkTarget(el, rangeOver(el, 6, 15))).toEqual({
      span: { start: 6, end: 15 }, href: '', existing: false,
    });
  });

  it('measures offsets across inline markup', () => {
    const el = host('Hi <strong>brave</strong> new world');
    // "brave new" spans the strong boundary: offsets are TEXT offsets, markup-invisible.
    expect(captureLinkTarget(el, rangeOver(el, 3, 12))).toEqual({
      span: { start: 3, end: 12 }, href: '', existing: false,
    });
  });

  it('returns null for a missing range, a caret outside a link, or a range escaping the host', () => {
    const el = host('Hello world');
    expect(captureLinkTarget(el, null)).toBeNull();
    expect(captureLinkTarget(el, rangeOver(el, 3, 3))).toBeNull();
    const other = host('elsewhere');
    expect(captureLinkTarget(el, rangeOver(other, 0, 4))).toBeNull();
  });

  it('a caret inside an existing link expands to the whole link and prefills its href', () => {
    const el = host('See <a href="https://x.com" class="font-bold">the docs</a> now');
    expect(captureLinkTarget(el, rangeOver(el, 6, 6))).toEqual({
      span: { start: 4, end: 12 }, href: 'https://x.com', existing: true,
    });
  });

  it('a selection inside an existing link is an edit of that link', () => {
    const el = host('See <a href="/a/xyz">the docs</a> now');
    expect(captureLinkTarget(el, rangeOver(el, 5, 8))).toEqual({
      span: { start: 4, end: 12 }, href: '/a/xyz', existing: true,
    });
  });
});

describe('applyLinkToHost', () => {
  it('wraps the span in an orange-bold anchor and returns the new innerHTML', () => {
    const el = host('Hello wonderful world');
    const html = applyLinkToHost(el, { start: 6, end: 15 }, 'https://x.com');
    expect(html).toBe(el.innerHTML);
    expect(el.innerHTML).toBe(
      `Hello <a href="https://x.com" target="_blank" rel="noopener noreferrer" class="${LINK_CLASSES}">wonderful</a> world`,
    );
  });

  it('a selection across inline markup splits it correctly (extractContents semantics)', () => {
    const el = host('Hi <strong>brave</strong> new world');
    applyLinkToHost(el, { start: 3, end: 12 }, 'https://x.com');
    const a = el.querySelector('a')!;
    expect(a.textContent).toBe('brave new');
    expect(a.querySelector('strong')?.textContent).toBe('brave');
    expect(el.textContent).toBe('Hi brave new world');
  });

  it('updates an existing link in place (span covered by it) without nesting', () => {
    const el = host('See <a href="https://old.com" target="_blank" rel="noopener noreferrer" class="font-bold text-orange-600">the docs</a> now');
    applyLinkToHost(el, { start: 4, end: 12 }, 'https://new.com');
    const anchors = el.querySelectorAll('a');
    expect(anchors).toHaveLength(1);
    expect(anchors[0].getAttribute('href')).toBe('https://new.com');
    expect(anchors[0].textContent).toBe('the docs');
  });

  it('wrapping over a partially-selected existing link never nests anchors', () => {
    const el = host('AA <a href="https://old.com">BB CC</a> DD');
    // Select "CC</a> DD" tail + beyond: from inside the anchor to the end.
    applyLinkToHost(el, { start: 6, end: 11 }, 'https://new.com');
    expect(el.querySelector('a a')).toBeNull();
  });

  it('returns null for an unresolvable or collapsed span with no link', () => {
    const el = host('short');
    expect(applyLinkToHost(el, { start: 2, end: 2 }, 'https://x.com')).toBeNull();
  });
});

describe('removeLinkFromHost', () => {
  it('unwraps the link intersecting the span and returns the new innerHTML', () => {
    const el = host('See <a href="https://x.com" class="font-bold">the docs</a> now');
    const html = removeLinkFromHost(el, { start: 4, end: 12 });
    expect(html).toBe(el.innerHTML);
    expect(el.querySelector('a')).toBeNull();
    expect(el.textContent).toBe('See the docs now');
  });

  it('returns null when no link intersects', () => {
    const el = host('no links here');
    expect(removeLinkFromHost(el, { start: 0, end: 4 })).toBeNull();
  });
});
