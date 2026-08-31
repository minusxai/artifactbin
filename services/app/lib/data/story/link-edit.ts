/**
 * link-edit — the inline-link algebra for WYSIWYG text hosts (jsx stories).
 *
 * A link edit is an INLINE edit: it lives inside a contenteditable text host's children, so it
 * cannot ride the typography toolbar's className write-back (that addresses whole elements).
 * Instead the toolbar captures the selection as CHARACTER OFFSETS over the host's text
 * (`captureLinkTarget`), lets the user type a URL (which blurs the host — a live Range would go
 * stale if a pending text edit commits and re-renders), then re-resolves the offsets against the
 * host's CURRENT DOM and wraps them in an `<a>` (`applyLinkToHost`). The caller stages the
 * returned innerHTML through the edit session (StoryJsxEditApi.applyContentEdit), the same
 * channel a blur-commit uses — so link edits compose with text/format/layout edits under the
 * no-clobber invariant.
 *
 * Everything here is DOM-pure (Document/Range only — no React, no session): offsets are measured
 * with boundary Ranges (`range.toString().length`), which handles element-container endpoints
 * for free. Styling is CLASSES ONLY (LINK_CLASSES, the one house link style) — the story
 * validator rejects inline `style` attributes, so a style-persisted look would poison the next
 * save.
 */

/** The one link style: every toolbar-made link is orange + bold, no per-link options. */
export const LINK_CLASSES = 'font-bold text-orange-600';

/** A selection captured as character offsets over the host's text content (Range-stable). */
export interface LinkTextSpan {
  start: number;
  end: number;
}

/** What the toolbar's link popover opens with: the span plus any existing link's href. */
export interface LinkDraftInfo {
  span: LinkTextSpan;
  /** Prefilled from an existing `<a>` when the span sits inside one; '' otherwise. */
  href: string;
  /** True when the span addresses an existing `<a>` (enables Remove + href prefill). */
  existing: boolean;
}

/**
 * Sanity-normalize user-typed link input. Absolute http(s)/mailto/tel pass through, a bare
 * domain gains `https://`, site-relative (`/…`) and fragment (`#…`) forms pass; anything
 * with an active-content scheme (javascript:, data:, …) or unrecognizable is null — the
 * write-back sanitizer would drop a dangerous href anyway, leaving a dead `<a>` behind.
 */
export function normalizeLinkHref(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  // The scheme is case-insensitive; lower it so a downstream literal-prefix
  // check (the frame re-validates before writing the attribute) cannot read
  // `HTTPS://` as some scheme it has never heard of and drop the link.
  const scheme = /^(?:https?|mailto|tel):/i.exec(t);
  if (scheme) return scheme[0].toLowerCase() + t.slice(scheme[0].length);
  if (/^[a-z][a-z0-9+.-]*:/i.test(t)) return null; // any other scheme: active content or unknown
  if (t.startsWith('/') || t.startsWith('#')) return t;
  if (/^[\w-]+(\.[\w-]+)+([/?#]\S*)?$/.test(t)) return `https://${t}`;
  return null;
}

/** The character offset of a (container, offset) boundary within `host`'s text. */
function textOffset(host: HTMLElement, container: Node, offset: number): number {
  const pre = host.ownerDocument.createRange();
  pre.selectNodeContents(host);
  pre.setEnd(container, offset);
  return pre.toString().length;
}

/** Every `<a>` under `host` with its text span (document order). */
function anchorSpans(host: HTMLElement): { a: HTMLAnchorElement; start: number; end: number }[] {
  return Array.from(host.querySelectorAll('a')).map(a => {
    const start = textOffset(host, a, 0);
    return { a, start, end: start + (a.textContent ?? '').length };
  });
}

/** Resolve character offsets back to a Range over `host`'s current text nodes. */
function resolveSpan(host: HTMLElement, span: LinkTextSpan): Range | null {
  const doc = host.ownerDocument;
  const walker = doc.createTreeWalker(host, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n as Text);
  const locate = (offset: number): [Text, number] | null => {
    let acc = 0;
    for (const t of nodes) {
      if (offset <= acc + t.data.length) return [t, offset - acc];
      acc += t.data.length;
    }
    return null;
  };
  const s = locate(span.start);
  const e = locate(span.end);
  if (!s || !e) return null;
  const r = doc.createRange();
  r.setStart(s[0], s[1]);
  r.setEnd(e[0], e[1]);
  return r;
}

/** The anchor whose span fully covers `span`, if any. */
function coveringAnchor(host: HTMLElement, span: LinkTextSpan): HTMLAnchorElement | null {
  for (const { a, start, end } of anchorSpans(host)) {
    if (start <= span.start && span.end <= end) return a;
  }
  return null;
}

/**
 * Capture the current selection as a link target within `host`. Returns null when the range is
 * missing, escapes the host, or is a bare caret outside any link. A span touching an existing
 * `<a>` expands to that whole link and prefills its href (editing, not nesting).
 */
export function captureLinkTarget(host: HTMLElement, range: Range | null): LinkDraftInfo | null {
  if (!range) return null;
  if (!host.contains(range.startContainer) || !host.contains(range.endContainer)) return null;
  const span: LinkTextSpan = {
    start: textOffset(host, range.startContainer, range.startOffset),
    end: textOffset(host, range.endContainer, range.endOffset),
  };
  const covering = coveringAnchor(host, span);
  if (covering) {
    const covered = anchorSpans(host).find(s => s.a === covering)!;
    return {
      span: { start: covered.start, end: covered.end },
      href: covering.getAttribute('href') ?? '',
      existing: true,
    };
  }
  if (span.start === span.end) return null;
  return { span, href: '', existing: false };
}

/**
 * Wrap the span in an `<a href>` (or update the existing link covering it) on the LIVE host
 * DOM, and return the host's new innerHTML for the content-edit stage — null when the span no
 * longer resolves. New links get `target="_blank" rel="noopener noreferrer"` (the story
 * renders inside an iframe — same-tab navigation would navigate the canvas) and LINK_CLASSES.
 * Never nests: existing `<a>`s inside the wrapped fragment are unwrapped first.
 */
export function applyLinkToHost(host: HTMLElement, span: LinkTextSpan, href: string): string | null {
  const covering = coveringAnchor(host, span);
  if (covering) {
    covering.setAttribute('href', href);
    return host.innerHTML;
  }
  if (span.start === span.end) return null;
  const range = resolveSpan(host, span);
  if (!range) return null;
  const doc = host.ownerDocument;
  const a = doc.createElement('a');
  a.setAttribute('href', href);
  a.setAttribute('target', '_blank');
  a.setAttribute('rel', 'noopener noreferrer');
  a.setAttribute('class', LINK_CLASSES);
  const frag = range.extractContents();
  // Links never nest: a partially-selected existing anchor was split by extractContents —
  // unwrap whatever anchor pieces landed in the fragment.
  for (const inner of Array.from(frag.querySelectorAll('a'))) {
    inner.replaceWith(...Array.from(inner.childNodes));
  }
  a.appendChild(frag);
  range.insertNode(a);
  // extractContents can leave empty split-off elements (an emptied <a> half, a hollow <strong>)
  // around the insertion point; drop them so the staged innerHTML stays canonical-ish.
  for (const el of Array.from(host.querySelectorAll('*'))) {
    if (el !== a && !el.hasChildNodes() && el.tagName !== 'BR' && el.tagName !== 'IMG' && el.tagName !== 'HR') {
      el.remove();
    }
  }
  host.normalize();
  return host.innerHTML;
}

/**
 * Unwrap every `<a>` intersecting the span (children stay in place), returning the host's new
 * innerHTML — null when no link intersects.
 */
export function removeLinkFromHost(host: HTMLElement, span: LinkTextSpan): string | null {
  const hits = anchorSpans(host).filter(({ start, end }) =>
    (start < span.end && end > span.start) || (start <= span.start && span.end <= end));
  if (hits.length === 0) return null;
  for (const { a } of hits) a.replaceWith(...Array.from(a.childNodes));
  host.normalize();
  return host.innerHTML;
}
