/**
 * The bar's trail. Pure: a path (and, where one exists, the document's own
 * name) in, the crumbs AFTER the brand mark out.
 */
import { describe, expect, it } from 'vitest';

import { crumbsFor } from '@/lib/breadcrumb';

describe('crumbsFor — the app pages', () => {
  it('gives the root nothing to say: the brand mark IS the root', () => {
    expect(crumbsFor('/')).toEqual([]);
    // …and a trailing slash is the same address.
    expect(crumbsFor('//')).toEqual([]);
  });

  it('names the app pages, unlinked, because you are on them', () => {
    expect(crumbsFor('/account')).toEqual([{ label: 'account' }]);
    expect(crumbsFor('/tokens')).toEqual([{ label: 'tokens' }]);
    expect(crumbsFor('/login')).toEqual([{ label: 'log in' }]);
  });

  it('collapses every docs address to one crumb', () => {
    // The human tour and the agent protocol doc are two readings of one thing,
    // and a bar 44px tall is not where that distinction earns its keep.
    expect(crumbsFor('/docs')).toEqual([{ label: 'docs' }]);
    expect(crumbsFor('/docs-human')).toEqual([{ label: 'docs' }]);
    expect(crumbsFor('/docs/human')).toEqual([{ label: 'docs' }]);
    expect(crumbsFor('/docs/llm')).toEqual([{ label: 'docs' }]);
  });
});

describe('crumbsFor — a profile and what is under it', () => {
  it('is the handle alone at a profile root', () => {
    expect(crumbsFor('/@vivek')).toEqual([{ label: '@vivek' }]);
  });

  it('makes the handle the way back once you are below it', () => {
    expect(crumbsFor('/@vivek/notes')).toEqual([
      { label: '@vivek', href: '/@vivek' },
      { label: 'notes' },
    ]);
  });

  it('lets the document name the leaf, over an address that is decoration', () => {
    expect(crumbsFor('/@vivek/notes/ab12cd-my-doc', 'My doc')).toEqual([
      { label: '@vivek', href: '/@vivek' },
      { label: 'My doc' },
    ]);
  });

  it('keeps ONE ancestor whatever decoration the address carries — five crumbs is a row of ellipses', () => {
    // Nesting is not in a URL any more, so these segments are an OLD link on
    // its way to healing: id-anchored, ignored here, and never a crumb.
    const trail = crumbsFor('/@vivek/a/b/c/d/ab12cd-deep', 'Deep');
    expect(trail).toHaveLength(2);
    expect(trail[0]).toEqual({ label: '@vivek', href: '/@vivek' });
    expect(trail[1]).toEqual({ label: 'Deep' });
  });
});

describe('crumbsFor — a document at its short address', () => {
  it('is its own name, with no ancestor to offer', () => {
    // `/a` is not a page, so there is nothing above a document here.
    expect(crumbsFor('/a/ab12cd', 'My doc')).toEqual([{ label: 'My doc' }]);
  });

  it('still says what it is when the name has not arrived yet', () => {
    expect(crumbsFor('/a/ab12cd')).toEqual([{ label: 'artifact' }]);
    expect(crumbsFor('/a/ab12cd', '   ')).toEqual([{ label: 'artifact' }]);
  });
});

describe('crumbsFor — the unknown', () => {
  it('says nothing rather than inventing a name from the URL', () => {
    expect(crumbsFor('/some/new/thing')).toEqual([]);
  });

  it('but uses a name it was handed', () => {
    expect(crumbsFor('/some/new/thing', 'Named')).toEqual([{ label: 'Named' }]);
  });
});
