/** Shared browser/server syntax for legacy UUID and reconnectable SHA-256 session IDs. */
const SESSION_ID_SOURCE = '(?:[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}|[a-f0-9]{64})';
const SESSION_HREF_RE = new RegExp(`^/chat\\?session=${SESSION_ID_SOURCE}$`);

/** Admit only the exact internal session route, without extra URL components. */
export function isSessionMentionHref(href: string): boolean {
  return SESSION_HREF_RE.test(href);
}

/** Fresh iterator state per caller; captures the visible @label and stable session ID. */
export function sessionMentions(text: string): RegExpStringIterator<RegExpExecArray> {
  return text.matchAll(new RegExp(`\\[(@[^\\]\\n]+)\\]\\(/chat\\?session=(${SESSION_ID_SOURCE})\\)`, 'g'));
}
