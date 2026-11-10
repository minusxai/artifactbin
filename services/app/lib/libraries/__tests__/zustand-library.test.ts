import { expect, it } from 'vitest';
import * as vanilla from 'zustand/vanilla';
import registry from '../registry.json';
import { libraryPathForSpecifier } from '../index';
import * as hosted from '../zustand.js';

it('hosts pinned Zustand as @afbin/zustand, exporting exactly its vanilla entry', () => {
  expect(registry.zustand).toEqual({ package: 'zustand', version: '5.1.0', entry: 'zustand.js' });
  expect(libraryPathForSpecifier('@afbin/zustand')).toBe('/libraries/zustand-5.1.0/index.js');
  expect(Object.keys(hosted).sort()).toEqual(Object.keys(vanilla).sort());
  expect(hosted.createStore).toBe(vanilla.createStore);
  const store = hosted.createStore(() => ({ count: 0 }));
  store.setState({ count: 1 });
  expect(store.getState()).toEqual({ count: 1 });
});
