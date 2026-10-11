/** Where a kit overlay mounts: in the styled story of a standalone document, whether its sheets are inline or linked (lib/publish/prepared/linked-sheets.server). */
import { afterEach, describe, expect, it } from 'vitest';
import { overlayDestination } from '../kit/trusted-overlay';
import type { IslandContext } from '../contract';

const portal = document.createElement('div');
const island = { trustedPortal: () => portal } as unknown as IslandContext;
const page = (head: string) => {
  document.head.innerHTML = head;
  document.body.innerHTML = '<div id="mx-story-root" data-mx-inline-story=""><button id="anchor">open</button></div>';
  return document.getElementById('mx-story-root')!;
};
afterEach(() => { document.head.innerHTML = ''; document.body.innerHTML = ''; });

describe('overlayDestination', () => {
  it('mounts in the story where the document carries its sheets inline', () => {
    const story = page('<style data-mx-tw>.a{}</style>');
    expect(overlayDestination(island)).toBe(story);
  });
  it('mounts in the story where the document links its shared sheets: its Tailwind is not inline there', () => {
    const story = page('<link rel="stylesheet" href="https://app.test/islands/c/0000000000000001.css" data-mx-tw-s0><link rel="stylesheet" href="https://app.test/islands/c/00000000000000b1.css" data-mx-base>');
    expect(overlayDestination(island)).toBe(story);
  });
  it('mounts in the trusted portal where the page carries no document sheet at all', () => {
    page('<style>:root{--x:1}</style>');
    expect(overlayDestination(island)).toBe(portal);
  });
});
