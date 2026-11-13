/* @jsxImportSource solid-js */
import { render, screen, cleanup, waitFor, fireEvent } from '@solidjs/testing-library';
import { afterEach, expect, it, vi } from 'vitest';
import { StartPage } from '../pages/Start';
import { replaceDocument } from '../lib/document-navigation';
vi.mock('../lib/document-navigation', () => ({ replaceDocument: vi.fn() }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); window.history.replaceState(null, '', '/'); });
it('returns a signed-out creator to this exact start entry after email login', async () => {
  window.history.replaceState(null, '', '/start?agent=1');
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response('{}', { status: 401 }));
  vi.stubGlobal('fetch', fetch);
  render(() => <StartPage />);
  await waitFor(() => expect(replaceDocument).toHaveBeenCalledWith('/login?callbackUrl=%2Fstart%3Fagent%3D1'));
  expect(fetch).toHaveBeenCalledOnce();
});
it('returns a signed-out person who chose New to /start after email login, from the doc create door', async () => {
  window.history.replaceState(null, '', '/start');
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response('{}', { status: 401 }));
  vi.stubGlobal('fetch', fetch);
  render(() => <StartPage />);
  await waitFor(() => expect(replaceDocument).toHaveBeenCalledWith('/login?callbackUrl=%2Fstart'));
  expect(fetch).toHaveBeenCalledOnce();
  expect(fetch.mock.calls[0]![0]).toBe('/api/my/artifacts');
});
it('does not repeat a creation or redirect to login after an uncertain server failure', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>().mockRejectedValue(new TypeError('Failed to fetch'));
  vi.stubGlobal('fetch', fetch);
  render(() => <StartPage />);
  await screen.findByRole('alert');
  expect(replaceDocument).not.toHaveBeenCalled();
  expect(fetch).toHaveBeenCalledOnce();
});

it('opens shared skill setup without creating, then copies the request for the selected group', async () => {
  window.history.replaceState(null, '', '/start?setup=1&group=grp_selected');
  const writeText = vi.fn(async () => {});
  vi.stubGlobal('navigator', { clipboard: { writeText } });
  const fetcher = vi.fn(async (url: string) => {
    if (url === '/api/groups/grp_selected') return Response.json({group:{id:'grp_selected',handle:'research',name:'Research',role:'editor'}});
    if (url === '/api/deployment') return Response.json({mode:'public'});
    if (url === '/api/start') return Response.json({id:'doc123',prompt:'Canonical server handoff',url:'/a/doc123'});
    throw new Error(`Unexpected request ${url}`);
  });
  vi.stubGlobal('fetch', fetcher);
  render(() => <StartPage />);
  await screen.findByRole('heading', {name:'Create with your agent'});
  expect(screen.getByRole('link', {name:'Download author skill'}).getAttribute('href')).toBe('/skills/artifactbin.zip');
  expect(fetcher.mock.calls.some(([url]) => url === '/api/start')).toBe(false);
  const request = screen.getByRole('textbox', {name:'What would you like to build?'});
  fireEvent.input(request, {target:{value:'Chart this quarter’s revenue.'}});
  fireEvent.click(screen.getByRole('button', {name:'Create a live document for my agent'}));
  await waitFor(() => expect(writeText).toHaveBeenCalledWith('Canonical server handoff\n\nChart this quarter’s revenue.'));
  expect(fetcher).toHaveBeenCalledWith('/api/start', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({destination:{type:'group',id:'grp_selected'}})});
});
it('keeps a refused group from falling back to a different destination', async () => {
  window.history.replaceState(null, '', '/start?setup=1&group=grp_missing');
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({error:'not_found'}, {status:404})));
  render(() => <StartPage />);
  await screen.findByRole('alert');
  expect(screen.queryByRole('button', {name:'Create a live document for my agent'})).toBeNull();
});
it('returns group setup to the same destination after login', async () => {
  window.history.replaceState(null, '', '/start?setup=1&group=grp_selected');
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({}, {status:401})));
  render(() => <StartPage />);
  await waitFor(() => expect(replaceDocument).toHaveBeenCalledWith('/login?callbackUrl=%2Fstart%3Fsetup%3D1%26group%3Dgrp_selected'));
});
