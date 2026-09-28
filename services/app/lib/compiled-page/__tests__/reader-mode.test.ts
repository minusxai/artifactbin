/** The reader mode switch: the deployment decides, a request may only pick the other path when the switch allows. */
import { afterEach, describe, expect, it } from 'vitest';
import { compilesPages, currentCompiledReaderFlag, parseCompiledReaderFlag, readerModeFor, setCompiledReaderFlagForTests } from '../reader-mode';

describe('currentCompiledReaderFlag', () => {
  afterEach(() => setCompiledReaderFlagForTests(null));
  it('is the configured flag unless a test overrides it for its file', () => {
    expect(currentCompiledReaderFlag('off')).toBe('off');
    setCompiledReaderFlagForTests('shadow');
    expect(currentCompiledReaderFlag('off')).toBe('shadow');
    setCompiledReaderFlagForTests(null);
    expect(currentCompiledReaderFlag('on')).toBe('on');
  });
});

describe('parseCompiledReaderFlag', () => {
  it('reads off, shadow and on, trimmed and case-insensitively', () => {
    expect(parseCompiledReaderFlag('off')).toBe('off');
    expect(parseCompiledReaderFlag(' Shadow ')).toBe('shadow');
    expect(parseCompiledReaderFlag('ON')).toBe('on');
  });
  it('treats anything else as off: a typo never turns a reader path on', () => {
    for (const value of [undefined, '', '1', 'true', 'compiled', 'yes']) expect(parseCompiledReaderFlag(value)).toBe('off');
  });
});

describe('readerModeFor', () => {
  it('off: legacy whatever the request asks', () => {
    expect(readerModeFor('off', '')).toBe('legacy');
    expect(readerModeFor('off', '?reader=compiled')).toBe('legacy');
  });
  it('shadow: legacy by default, compiled on request', () => {
    expect(readerModeFor('shadow', '')).toBe('legacy');
    expect(readerModeFor('shadow', '?reader=compiled')).toBe('compiled');
    expect(readerModeFor('shadow', '?reader=legacy')).toBe('legacy');
    expect(readerModeFor('shadow', '?reader=other')).toBe('legacy');
  });
  it('on: compiled by default, legacy on request', () => {
    expect(readerModeFor('on', '')).toBe('compiled');
    expect(readerModeFor('on', '?reader=legacy')).toBe('legacy');
    expect(readerModeFor('on', '?$region=west&reader=compiled')).toBe('compiled');
  });
  it('ignores the request on a custom-domain post, like every URL switch there', () => {
    expect(readerModeFor('shadow', '?reader=compiled', { domainPost: true })).toBe('legacy');
    expect(readerModeFor('on', '?reader=legacy', { domainPost: true })).toBe('compiled');
  });
  it('compiles pages in shadow and on, never in off', () => {
    expect(compilesPages('off')).toBe(false);
    expect(compilesPages('shadow')).toBe(true);
    expect(compilesPages('on')).toBe(true);
  });
});
