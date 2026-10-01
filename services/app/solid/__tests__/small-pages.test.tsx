/* @jsxImportSource solid-js */
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { App } from '@/solid/App';
import { replaceDocument } from '@/solid/lib/document-navigation';

vi.mock('@/solid/lib/document-navigation', () => ({ replaceDocument: vi.fn() }));

let session: unknown;
let profileStatus = 200;
let startStatus = 200;
const calls: Array<{ url: string; method: string }> = [];
beforeEach(() => {
  vi.clearAllMocks();
  calls.length = 0;
  profileStatus = 200;
  startStatus = 200;
  session = { user: null, kind: 'none', onboarded: true };
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), method: init?.method ?? 'GET' });
    if (url === '/api/page/session') return Response.json(session);
    if (url === '/api/auth/email-otp/send-verification-otp') return Response.json({});
    if (url === '/api/start' || url === '/api/start?mode=blank') return Response.json({ id: 'doc_1' }, { status: startStatus });
    if (url === '/api/my/profile/image' && init?.method === 'PUT') return Response.json({ image: '/api/users/new_1/avatar?v=1' });
    if (url === '/api/my/profile' && init?.method === 'PATCH') return Response.json(profileStatus === 200 ? { username: 'chosen' } : { error: 'username_taken' }, { status: profileStatus });
    if (url === '/api/my/profile') return Response.json({ username: 'initial', image: null });
    return Response.json({}, { status: 404 });
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.history.replaceState(null, '', '/'); });

it('keeps login hidden until session resolves, then requests and verifies an email code', async () => {
  window.history.replaceState(null, '', '/login');
  render(() => <App />);
  expect(screen.queryByRole('textbox', { name: 'Email' })).toBeNull();
  const email = await screen.findByRole('textbox', { name: 'Email' });
  fireEvent.input(email, { target: { value: 'user@example.com' } });
  fireEvent.click(screen.getByRole('button', { name: 'Log in with email' }));
  await waitFor(() => expect(calls).toContainEqual({ url: '/api/auth/email-otp/send-verification-otp', method: 'POST' }));
  expect(await screen.findByRole('textbox', { name: 'Login code' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Change email' }));
  expect(screen.getByRole('textbox', { name: 'Email' })).toBeInTheDocument();
});

it('holds the login callback for an anonymous reader without redirecting away', async () => {
  window.history.replaceState(null, '', '/login?callbackUrl=%2Fa%2Fdoc%3Fintent%3Dlike');
  render(() => <App />);
  expect(await screen.findByRole('textbox', { name: 'Email' })).toBeInTheDocument();
  expect(window.location.pathname).toBe('/login');
  expect(window.location.search).toContain('intent%3Dlike');
});

it('starts one artifact and leaves the Solid route for its document', async () => {
  window.history.replaceState(null, '', '/start');
  render(() => <App />);
  await waitFor(() => expect(calls.filter(call => call.url === '/api/start?mode=blank')).toHaveLength(1));
  expect(calls).toContainEqual({ url: '/api/start?mode=blank', method: 'POST' });
  await waitFor(() => expect(replaceDocument).toHaveBeenCalledWith('/a/doc_1/edit'));
});

it('preserves explicit external-agent handoff instead of opening the editor', async () => {
  window.history.replaceState(null, '', '/start?agent=1');
  render(() => <App />);
  await waitFor(() => expect(replaceDocument).toHaveBeenCalledWith('/a/doc_1'));
  expect(calls).toContainEqual({ url: '/api/start', method: 'POST' });
  expect(calls.some(call => call.url === '/api/start?mode=blank')).toBe(false);
});

it('shows an uncertain start failure and never retries it', async () => {
  startStatus = 503;
  window.history.replaceState(null, '', '/start');
  render(() => <App />);
  expect(await screen.findByRole('alert')).toHaveTextContent('The request may have completed');
  expect(calls.filter(call => call.url === '/api/start?mode=blank')).toHaveLength(1);
  expect(replaceDocument).not.toHaveBeenCalled();
});

it('keeps the welcome form on a refused handle and saves the confirmation with the handle', async () => {
  session = { user: { id: 'new_1', email: 'mxmx_test_new@example.com', username: null, image: null }, kind: 'account', onboarded: false };
  window.history.replaceState(null, '', '/welcome?callbackUrl=%2Ftrash');
  render(() => <App />);
  const username = await screen.findByRole('textbox', { name: 'Username' });
  await waitFor(() => expect((username as HTMLInputElement).value).toBe('initial'));
  fireEvent.input(username, { target: { value: 'chosen' } });
  fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
  await waitFor(() => expect(calls).toContainEqual({ url: '/api/my/profile', method: 'PATCH' }));
});

it('hands a welcome callback for a React-owned artifact to a full document navigation', async () => {
  session = { user: { id: 'new_1', email: 'mxmx_test_new@example.com', username: null, image: null }, kind: 'account', onboarded: false };
  window.history.replaceState(null, '', '/welcome?callbackUrl=%2F%40owner%2Fabc123-copy');
  render(() => <App />);
  await waitFor(() => expect((screen.getByRole('textbox', { name: 'Username' }) as HTMLInputElement).value).toBe('initial'));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
  await waitFor(() => expect(replaceDocument).toHaveBeenCalledWith('/@owner/abc123-copy'));
  expect(screen.queryByRole('main', { name: 'Not found' })).toBeNull();
});

it('keeps the welcome form when the handle is refused', async () => {
  profileStatus = 409;
  session = { user: { id: 'new_1', email: 'mxmx_test_new@example.com', username: null, image: null }, kind: 'account', onboarded: false };
  window.history.replaceState(null, '', '/welcome');
  render(() => <App />);
  await waitFor(() => expect((screen.getByRole('textbox', { name: 'Username' }) as HTMLInputElement).value).toBe('initial'));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
  expect(await screen.findByRole('status')).toHaveTextContent('that handle is taken');
  expect(screen.getByRole('button', { name: 'Confirm' })).toBeInTheDocument();
});

it('uploads a welcome photo through the named picture control', async () => {
  session = { user: { id: 'new_1', email: 'mxmx_test_new@example.com', username: null, image: null }, kind: 'account', onboarded: false };
  window.history.replaceState(null, '', '/welcome');
  const view = render(() => <App />);
  await screen.findByRole('button', { name: 'Upload a photo' });
  const picker = view.container.querySelector('input[type="file"]') as HTMLInputElement;
  expect(picker.accept).toBe('image/png,image/jpeg,image/webp,image/gif,image/avif');
  fireEvent.change(picker, { target: { files: [new File(['x'], 'me.png', { type: 'image/png' })] } });
  await waitFor(() => expect(view.container.querySelector('img[src="/api/users/new_1/avatar?v=1"]')).toBeInTheDocument());
});
