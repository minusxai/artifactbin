import { act, render, waitFor } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router';
import { afterEach, expect, it, vi } from 'vitest';
import { App } from '../App';

afterEach(() => vi.restoreAllMocks());

it('keeps one trusted chrome root while app routes navigate outside it', async () => {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    return Response.json(url.includes('/api/page/session')
      ? { kind: 'none', user: null, mixpanel: { token: null, host: '' } }
      : { signedIn: false });
  }));
  const roots: ShadowRoot[] = [];
  const attach = Element.prototype.attachShadow;
  vi.spyOn(Element.prototype, 'attachShadow').mockImplementation(function(this: Element, options: ShadowRootInit) {
    const root = attach.call(this, options);
    roots.push(root);
    return root;
  });
  let go: ReturnType<typeof useNavigate> | undefined;
  function Driver() { go = useNavigate(); return null; }
  const view = render(<MemoryRouter initialEntries={['/privacy']}><Driver /><App /></MemoryRouter>);
  await waitFor(() => expect(roots).toHaveLength(1));
  const trusted = roots[0];
  expect(trusted.mode).toBe('closed');
  expect(trusted.textContent).toContain('artifactbin');
  expect(view.container.textContent).toMatch(/privacy/i);
  const host = trusted.host;
  await act(async () => { await go!('/terms'); });
  expect(roots).toHaveLength(1);
  expect(host.isConnected).toBe(true);
  expect(view.container.textContent).toMatch(/terms/i);
  expect(view.container.querySelector('iframe')).toBeNull();
  vi.unstubAllGlobals();
});
