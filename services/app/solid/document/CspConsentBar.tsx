/* @jsxImportSource solid-js */
/**
 * THE CONSENT BAR: a document that declares hosts beyond the default policy (Helmet `csp-*` metas)
 * runs without them until the reader allows it. This bar says what it asks for and takes the reader's
 * answer about the hosts they did not publish themselves: Allow once (this browser session), Always
 * for this document (an account's standing answer), or Never (a stored deny, after which the bar is a
 * one-line note). Granting reloads the document frame,
 * or the page when the document is not framed. The answers are lib/trust/document-trust's, through
 * /api/trust.
 */
import { createSignal, Show, type JSX } from 'solid-js';
import type { CspRequest } from '@/lib/story/document/csp-extensions';
import { DOCUMENT_FRAME_SELECTOR, freshFrameSrc } from './create-framed-story';

/**
 * Draw the document again under the reader's new answer. A framed document (its own origin) loads a FRESH first URL:
 * the served one's ticket is spent, and only a new ticket carries a once-grant across; the page itself otherwise.
 */
export async function reloadDocumentFrame(id: string): Promise<void> {
  const frame = document.querySelector<HTMLIFrameElement>(DOCUMENT_FRAME_SELECTOR);
  if (!frame) { window.location.reload(); return; }
  const src = await freshFrameSrc(id);
  if (src) frame.src = src;
  else window.location.reload();
}

const host = (origin: string): string => origin.replace(/^https:\/\//, '');
const listed = (items: string[]): string => items.length <= 1 ? items[0] ?? '' : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;

/** "This document wants to load scripts from cdn.plot.ly and connect to api.open-meteo.com" */
export function cspAskSentence(extensions: CspRequest['extensions']): string {
  const phrases = [
    extensions.script.length ? `load scripts from ${listed(extensions.script.map(host))}` : null,
    extensions.connect.length ? `connect to ${listed(extensions.connect.map(host))}` : null,
    extensions.style.length ? `load styles and fonts from ${listed(extensions.style.map(host))}` : null,
    extensions.img.length ? `load images from ${listed(extensions.img.map(host))}` : null,
    extensions.media.length ? `play media from ${listed(extensions.media.map(host))}` : null,
    extensions.frame.length ? `embed pages from ${listed(extensions.frame.map(host))}` : null,
  ].filter((phrase): phrase is string => !!phrase);
  return `This document wants to ${listed(phrases)}`;
}

const allHosts = (extensions: CspRequest['extensions']): string[] =>
  [...new Set([...extensions.script, ...extensions.connect, ...extensions.style, ...extensions.img, ...extensions.media, ...extensions.frame].map(host))];

export function CspConsentBar(props: {
  id: string;
  request: CspRequest;
  /** "Always for this document" belongs to an account; a signed-out reader may allow once or say never for the session. */
  accountSession: boolean;
  /** Seam for tests; defaults to reloading the document frame (or the page). */
  reload?: () => void;
}): JSX.Element {
  const [request, setRequest] = createSignal(props.request);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const send = async (method: 'POST' | 'DELETE', body: Record<string, unknown>) => {
    if (busy()) return;
    setBusy(true); setError(null);
    try {
      const response = await fetch('/api/trust', {
        method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ artifactId: props.id, ...body }),
      });
      const reply = await response.json().catch(() => ({})) as { cspRequest?: CspRequest; error?: string };
      if (!response.ok || !reply.cspRequest) { setError(response.status === 401 ? 'Sign in to keep this choice.' : `Could not save your choice (${reply.error ?? response.status}).`); return; }
      setRequest(reply.cspRequest);
      if (reply.cspRequest.status === 'allowed') { if (props.reload) props.reload(); else void reloadDocumentFrame(props.id); }
    } catch { setError('Could not save your choice — try again.'); }
    finally { setBusy(false); }
  };
  const button = 'cursor-pointer rounded border border-edge px-2 py-1 font-mono text-xs hover:bg-raised disabled:opacity-60';
  return <Show when={request().status === 'blocked'}>
    {/* In the slot above the frame (Document's `[data-mx-frame-slot]`): it takes its own row, the frame shrinks. */}
    <section role="region" aria-label="Document network access" class="border-b border-edge bg-surface px-3 py-2 text-sm text-fg">
      <Show when={!request().denied} fallback={
        <p class="flex flex-wrap items-center gap-2 text-xs text-muted">
          <span>Blocked: this document cannot reach {listed(allHosts(request().asking))}.</span>
          <button type="button" class={button} aria-label="Ask again" disabled={busy()} onClick={() => void send('DELETE', {})}>Ask again</button>
        </p>
      }>
        <div class="flex flex-wrap items-center gap-2">
          <p class="min-w-0 flex-1">{cspAskSentence(request().asking)}</p>
          <button type="button" class={button} aria-label="Allow once" disabled={busy()} onClick={() => void send('POST', { grant: 'once' })}>Allow once</button>
          <Show when={props.accountSession}>
            <button type="button" class={button} aria-label="Always for this document" disabled={busy()} onClick={() => void send('POST', { grant: 'document' })}>Always for this document</button>
          </Show>
          <button type="button" class={button} aria-label="Never" disabled={busy()} onClick={() => void send('POST', { grant: 'never' })}>Never</button>
        </div>
      </Show>
      <Show when={error()}><p role="alert" class="mt-1 text-xs text-muted">{error()}</p></Show>
    </section>
  </Show>;
}
