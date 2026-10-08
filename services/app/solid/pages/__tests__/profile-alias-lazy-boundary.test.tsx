/* @jsxImportSource solid-js */
import { cleanup, render, screen } from '@solidjs/testing-library';
import { Route, Router } from '@solidjs/router';
import { afterEach, expect, it, vi } from 'vitest';

const loaded = vi.hoisted(() => ({ profile: 0, notFound: 0, artifactAddress: 0, document: 0, servedFrame: false }));

vi.mock('../Profile', () => {
  loaded.profile++;
  return { ProfilePage: () => <p>PROFILE FALLBACK</p> };
});

vi.mock('../NotFound', () => {
  loaded.notFound++;
  return { NotFoundPage: () => <p>NOT FOUND FALLBACK</p> };
});

vi.mock('../ArtifactAddress', () => {
  loaded.artifactAddress++;
  return { ArtifactAddressRoute: (props: { id: string; editing?: boolean }) => <p>ARTIFACT {props.id} {String(props.editing)}</p> };
});

vi.mock('../Document', () => {
  loaded.document++;
  return { DocumentPage: () => <p>DOCUMENT FALLBACK</p> };
});

vi.mock('@/solid/lib/served-frame', () => ({ servedDocumentFrame: () => loaded.servedFrame }));

import { ProfileAliasRoute } from '@/solid/pages/ProfileAlias';

const at = (path: string) => {
  window.history.replaceState(null, '', path);
  return render(() => <Router><Route path="/:user/*rest" component={ProfileAliasRoute} /></Router>);
};

afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/');
});

it('loads only the artifact renderer for a valid alias', async () => {
  at('/@bob/doc001-hello');
  expect(await screen.findByText('ARTIFACT doc001 false')).toBeTruthy();
  expect(loaded).toEqual({ profile: 0, notFound: 0, artifactAddress: 1, document: 0, servedFrame: false });
});

it('loads the public profile only for a bare handle', async () => {
  at('/@bob/');
  expect(await screen.findByText('PROFILE FALLBACK')).toBeTruthy();
  expect(loaded.profile).toBe(1);
  expect(loaded.notFound).toBe(0);
});

it('loads the not-found page only when the alias cannot resolve an artifact id', async () => {
  at('/@bob/not-an-artifact');
  expect(await screen.findByText('NOT FOUND FALLBACK')).toBeTruthy();
  expect(loaded.notFound).toBe(1);
});

it('adopts the document renderer when the server served a framed document', async () => {
  loaded.servedFrame = true;
  at('/@bob/doc002-hello');
  expect(await screen.findByText('DOCUMENT FALLBACK')).toBeTruthy();
  expect(loaded.artifactAddress).toBe(1);
  expect(loaded.document).toBe(1);
  loaded.servedFrame = false;
});
