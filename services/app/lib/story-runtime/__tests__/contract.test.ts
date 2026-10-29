import { describe, expect, it } from 'vitest';
import * as contract from '../contract';
import {
  ACCESS_PENDING, DOCUMENT_MODULE_PATH, ISLANDS_PATH, QUERY_REQUEST_PARAM, READER_MODE_PARAM, STORY_FRAME_BRIDGE_MESSAGE, THEME_KEY,
  isFrameBridgeEnvelope, readerModeOf, withReaderMode,
} from '../contract';

/** The exported string constants, by name. */
const strings = Object.entries(contract).filter(([, value]) => typeof value === 'string') as Array<[string, string]>;
const named = (pattern: RegExp) => strings.filter(([name]) => pattern.test(name));

describe('the frame and island wire names', () => {
  it('names every DOM attribute as a data-mx attribute', () => {
    const attrs = named(/_ATTR$/);
    expect(attrs.map(([name]) => name).sort()).toEqual(['CHART_SLOT_ATTR', 'CHART_SPEC_ATTR', 'CHART_STATE_ATTR', 'LITERALS_ATTR', 'LIVE_DATA_ATTR', 'READER_READY_ATTR', 'SCRIPT_FAILURE_ATTR']);
    for (const [, value] of attrs) expect(value).toMatch(/^data-mx-[a-z-]+$/);
  });

  it('gives every postMessage type the mx: prefix, each distinct, so no two messages are confused', () => {
    const messages = named(/_MESSAGE$/);
    expect(messages.map(([name]) => name).sort()).toEqual([
      'STORY_DATA_MESSAGE', 'STORY_DOCUMENT_MESSAGE', 'STORY_FRAME_BRIDGE_MESSAGE', 'STORY_FRAME_HASH_MESSAGE', 'STORY_NAVIGATE_MESSAGE',
      'STORY_NAVIGATING_MESSAGE', 'STORY_READER_MODE_MESSAGE', 'STORY_SCROLL_MESSAGE', 'STORY_URL_VALUES_MESSAGE',
    ]);
    for (const [, value] of messages) expect(value).toMatch(/^mx:[a-z-]+$/);
    expect(new Set(messages.map(([, value]) => value)).size).toBe(messages.length);
    expect(contract.STORY_VERSION_DRAWN_EVENT).toMatch(/^mx:/);
  });

  it('names window hooks as private __mx globals, each distinct', () => {
    const hooks = named(/_HOOK$/);
    expect(hooks.map(([name]) => name).sort()).toEqual(['STORY_ADOPT_HOOK', 'STORY_DATA_HOOK', 'STORY_MODE_HOOK']);
    for (const [, value] of hooks) expect(value).toMatch(/^__mx[A-Z]\w+$/);
    expect(new Set(hooks.map(([, value]) => value)).size).toBe(hooks.length);
  });

  it('keeps element ids, controller events, paths and storage keys distinct and well formed', () => {
    expect([contract.ISLAND_DATA_ID, contract.STORY_NODES_ID].every(id => /^mx-[a-z-]+$/.test(id))).toBe(true);
    expect(contract.ISLAND_DATA_ID).not.toBe(contract.STORY_NODES_ID);
    expect(contract.STORY_DATA_EVENT).not.toBe(contract.STORY_ANNOTATIONS_EVENT);
    expect(DOCUMENT_MODULE_PATH.startsWith(`${ISLANDS_PATH}/`)).toBe(true);
    expect(ISLANDS_PATH).toMatch(/^\/[a-z]+$/);
    expect(QUERY_REQUEST_PARAM).not.toBe(READER_MODE_PARAM);
    expect(THEME_KEY).toMatch(/^mx_/);
    expect(ACCESS_PENDING).toMatch(/…$/);
  });
});

describe('reader mode in a URL', () => {
  it('reads only light or dark', () => {
    expect(readerModeOf('?mx-mode=dark')).toBe('dark');
    expect(readerModeOf('a=1&mx-mode=light')).toBe('light');
    for (const search of ['', '?mx-mode=', '?mx-mode=Dark', '?mx-mode=sepia', '?other=dark']) expect(readerModeOf(search)).toBeNull();
  });

  it('round-trips through withReaderMode, keeping every other param in order', () => {
    const search = withReaderMode('?b=2&mx-mode=light&a=ü', 'dark');
    expect(search).toBe('?b=2&a=ü&mx-mode=dark');
    expect(readerModeOf(search)).toBe('dark');
    expect(withReaderMode(search, null)).toBe('?b=2&a=ü');
    expect(withReaderMode('', null)).toBe('');
    expect(withReaderMode('?mx-mode=dark', null)).toBe('');
  });
});

describe('isFrameBridgeEnvelope', () => {
  it('is a bridge envelope at any key, with a payload that names its kind', () => {
    expect(isFrameBridgeEnvelope({ type: STORY_FRAME_BRIDGE_MESSAGE, key: 'k', payload: { kind: 'ready' } })).toBe(true);
    expect(isFrameBridgeEnvelope({ type: STORY_FRAME_BRIDGE_MESSAGE, payload: { kind: 'hello' } })).toBe(true);
  });

  it('refuses other messages and malformed payloads', () => {
    for (const data of [null, undefined, 'mx:frame-bridge', 42, {}, { type: 'mx:data', payload: { kind: 'x' } }, { type: STORY_FRAME_BRIDGE_MESSAGE }, { type: STORY_FRAME_BRIDGE_MESSAGE, payload: 'ready' }, { type: STORY_FRAME_BRIDGE_MESSAGE, payload: { kind: 7 } }, { type: STORY_FRAME_BRIDGE_MESSAGE, payload: null }])
      expect(isFrameBridgeEnvelope(data)).toBe(false);
  });
});
