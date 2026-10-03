/* @jsxImportSource solid-js */
import { afterEach, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/dom';
import { fireEvent, render } from '../../__tests__/helpers';
import { CspConsentBar, cspAskSentence } from '../CspConsentBar';
import { EMPTY_CSP_EXTENSIONS, type CspRequest } from '@/lib/story/document/csp-extensions';
afterEach(() => vi.unstubAllGlobals());

const DECLARED = { ...EMPTY_CSP_EXTENSIONS, connect: ['https://api.open-meteo.com', 'https://mine.example.com'], script: ['https://cdn.plot.ly'] };
// The reader published mine.example.com themselves: they are asked about the rest only.
const ASK: CspRequest = { status: 'blocked', denied: false, extensions: DECLARED, asking: { ...EMPTY_CSP_EXTENSIONS, connect: ['https://api.open-meteo.com'], script: ['https://cdn.plot.ly'] } };
const ALLOWED: CspRequest = { ...ASK, status: 'allowed', asking: EMPTY_CSP_EXTENSIONS };
const reply = (cspRequest: CspRequest, status = 200) => vi.fn(async () => Response.json(status === 200 ? { cspRequest } : { error: 'nope' }, { status }));
const sent = (fetcher: ReturnType<typeof vi.fn>) => JSON.parse(((fetcher.mock.calls[0] as unknown[])[1] as RequestInit).body as string) as Record<string, unknown>;

it('says what the document asks this reader for, in hosts, leaving out the hosts they published', () => {
  const view = render(() => <CspConsentBar id="abc123" request={ASK} accountSession />);
  const bar = view.getByRole('region', { name: 'Document network access' });
  expect(bar).toHaveTextContent('This document wants to load scripts from cdn.plot.ly and connect to api.open-meteo.com');
  expect(bar).not.toHaveTextContent('mine.example.com');
  expect(cspAskSentence({ ...EMPTY_CSP_EXTENSIONS, connect: ['https://a.example.com', 'https://b.example.com', 'https://c.example.com'], img: ['https://*.img.example.com'] }))
    .toBe('This document wants to connect to a.example.com, b.example.com and c.example.com and load images from *.img.example.com');
  expect(cspAskSentence({ ...EMPTY_CSP_EXTENSIONS, style: ['https://fonts.example.com'], media: ['https://media.example.com'], frame: ['https://www.youtube-nocookie.com'] }))
    .toBe('This document wants to load styles and fonts from fonts.example.com, play media from media.example.com and embed pages from www.youtube-nocookie.com');
});

it('Allow once grants for the session and reloads the document', async () => {
  const fetcher = reply(ALLOWED);
  vi.stubGlobal('fetch', fetcher);
  const reload = vi.fn();
  const view = render(() => <CspConsentBar id="abc123" request={ASK} accountSession reload={reload} />);
  fireEvent.click(view.getByRole('button', { name: 'Allow once' }));
  await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
  expect(fetcher).toHaveBeenCalledWith('/api/trust', expect.objectContaining({ method: 'POST', credentials: 'same-origin' }));
  expect(sent(fetcher)).toEqual({ artifactId: 'abc123', grant: 'once' });
  expect(view.queryByRole('region', { name: 'Document network access' })).toBeNull();
});

it('Always for this document grants this document and reloads', async () => {
  const fetcher = reply(ALLOWED);
  vi.stubGlobal('fetch', fetcher);
  const reload = vi.fn();
  const view = render(() => <CspConsentBar id="abc123" request={ASK} accountSession reload={reload} />);
  fireEvent.click(view.getByRole('button', { name: 'Always for this document' }));
  await waitFor(() => expect(reload).toHaveBeenCalled());
  expect(sent(fetcher)).toEqual({ artifactId: 'abc123', grant: 'document' });
});

it('offers Always only to an account, and never an author-wide choice', () => {
  const signedOut = render(() => <CspConsentBar id="abc123" request={ASK} accountSession={false} />);
  expect(signedOut.queryByRole('button', { name: 'Always for this document' })).toBeNull();
  expect(signedOut.getByRole('button', { name: 'Allow once' })).toBeInTheDocument();
  expect(signedOut.getByRole('button', { name: 'Never' })).toBeInTheDocument();
  signedOut.unmount();
  const account = render(() => <CspConsentBar id="abc123" request={ASK} accountSession />);
  expect(account.getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['Allow once', 'Always for this document', 'Never']);
});

it('Never collapses the bar to a one-line note without reloading, and Ask again brings it back', async () => {
  vi.stubGlobal('fetch', reply({ ...ASK, denied: true }));
  const reload = vi.fn();
  const view = render(() => <CspConsentBar id="abc123" request={ASK} accountSession reload={reload} />);
  fireEvent.click(view.getByRole('button', { name: 'Never' }));
  await waitFor(() => expect(view.getByRole('region', { name: 'Document network access' })).toHaveTextContent('Blocked: this document cannot reach cdn.plot.ly and api.open-meteo.com.'));
  expect(view.queryByRole('button', { name: 'Allow once' })).toBeNull();
  expect(reload).not.toHaveBeenCalled();

  const undo = reply(ASK);
  vi.stubGlobal('fetch', undo);
  fireEvent.click(view.getByRole('button', { name: 'Ask again' }));
  await waitFor(() => expect(view.getByRole('button', { name: 'Allow once' })).toBeInTheDocument());
  expect(undo).toHaveBeenCalledWith('/api/trust', expect.objectContaining({ method: 'DELETE' }));
  expect(sent(undo)).toEqual({ artifactId: 'abc123' });
});

it('a denied request opens as the note', () => {
  const view = render(() => <CspConsentBar id="abc123" request={{ ...ASK, denied: true }} accountSession />);
  expect(view.getByRole('button', { name: 'Ask again' })).toBeInTheDocument();
});

it('names a failure and keeps the choices', async () => {
  vi.stubGlobal('fetch', reply(ASK, 401));
  const view = render(() => <CspConsentBar id="abc123" request={ASK} accountSession />);
  fireEvent.click(view.getByRole('button', { name: 'Never' }));
  await waitFor(() => expect(view.getByRole('alert')).toHaveTextContent('Sign in to keep this choice.'));
  expect(view.getByRole('button', { name: 'Allow once' })).toBeInTheDocument();
});
