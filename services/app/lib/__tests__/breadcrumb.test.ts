/**
 * The bar's trail. Pure: a path (and, where one exists, the document's own
 * name) in, the crumbs AFTER the brand mark out.
 */
import { describe, expect, it } from 'vitest';

import { crumbsFor } from '@/lib/workspace';

describe('crumbsFor — the app pages', () => {
  it('names the artifact library at the root', () => {
    expect(crumbsFor('/')).toEqual([{ label: 'artifacts' }]);
    // …and a trailing slash is the same address.
    expect(crumbsFor('//')).toEqual([{ label: 'artifacts' }]);
  });

  it('names the app pages, unlinked, because you are on them', () => {
    expect(crumbsFor('/account')).toEqual([{ label: 'account' }]);
    expect(crumbsFor('/tokens')).toEqual([{ label: 'tokens' }]);
    expect(crumbsFor('/login')).toEqual([{ label: 'log in' }]);
  });

  it('names the docs page for people', () => {
    expect(crumbsFor('/docs-human')).toEqual([{ label: 'docs' }]);
    // The retired `/docs…` addresses answer 404, so the shell never mounts
    // under them and the bar has nothing to draw.
    expect(crumbsFor('/docs')).toEqual([]);
    expect(crumbsFor('/docs/llm')).toEqual([]);
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

it.each([
  ['/assets', 'assets'], ['/schedules', 'schedules'], ['/chat', 'connected agents'],
  ['/notifications', 'notifications'], ['/trash', 'trash'], ['/datasets/new', 'new dataset'],
  ['/files/new', 'upload file'], ['/programs/new', 'new program'], ['/programs/abc123/edit', 'edit program'],
  ['/connect', 'connect'], ['/start', 'get started'], ['/welcome', 'welcome'],
])('names workspace page %s in the breadcrumb', (path, label) => {
  expect(crumbsFor(path)).toEqual([{ label }]);
  expect(crumbsFor(`${path}/`)).toEqual([{ label }]);
});
