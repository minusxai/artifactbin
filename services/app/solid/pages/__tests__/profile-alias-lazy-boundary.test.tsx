/* @jsxImportSource solid-js */
import { cleanup, render, screen } from '@solidjs/testing-library';
import { Route, Router } from '@solidjs/router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

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

// Every address here is the one this load was served at: the server already answered it.
vi.mock('@/solid/lib/served-frame', () => ({ servedDocumentFrame: () => loaded.servedFrame, servedAt: () => true }));

import { ProfileAliasRoute } from '@/solid/pages/ProfileAlias';

const at = (path: string) => {
  window.history.replaceState(null, '', path);
  return render(() => <Router><Route path="/:user/*rest" component={ProfileAliasRoute} /></Router>);
};

/**
 * The mocked chunks count their loads for the whole file (a chunk, once loaded, stays loaded, and Solid's lazy keeps
 * it), so each test asserts what IT loaded: the counts it started with, against the counts it ends with.
 */
let before = { ...loaded };
const loadedHere = () => ({ profile: loaded.profile - before.profile, notFound: loaded.notFound - before.notFound,
  artifactAddress: loaded.artifactAddress - before.artifactAddress, document: loaded.document - before.document });
beforeEach(() => { loaded.servedFrame = false; before = { ...loaded }; });
afterEach(() => {
  loaded.servedFrame = false;
  cleanup();
  window.history.replaceState(null, '', '/');
});

it('loads only the artifact renderer for a valid alias', async () => {
  at('/@bob/doc001-hello');
  expect(await screen.findByText('ARTIFACT doc001 false')).toBeTruthy();
  expect(loadedHere()).toMatchObject({ profile: 0, notFound: 0, document: 0 });
  expect(loaded.artifactAddress).toBe(1);
});

it('loads the public profile only for a bare handle', async () => {
  at('/@bob/');
  expect(await screen.findByText('PROFILE FALLBACK')).toBeTruthy();
  expect(loaded.profile).toBe(1);
  expect(loadedHere()).toMatchObject({ notFound: 0, artifactAddress: 0, document: 0 });
});

it('loads the not-found page only when the alias cannot resolve an artifact id', async () => {
  at('/@bob/not-an-artifact');
  expect(await screen.findByText('NOT FOUND FALLBACK')).toBeTruthy();
  expect(loaded.notFound).toBe(1);
  expect(loadedHere()).toMatchObject({ profile: 0, artifactAddress: 0, document: 0 });
});

it('adopts the document renderer when the server served a framed document', async () => {
  loaded.servedFrame = true;
  at('/@bob/doc002-hello');
  expect(await screen.findByText('DOCUMENT FALLBACK')).toBeTruthy();
  // Run alone or after the others: adopting the served frame loads the document renderer and nothing else.
  expect(loadedHere()).toEqual({ profile: 0, notFound: 0, artifactAddress: 0, document: 1 });
});
