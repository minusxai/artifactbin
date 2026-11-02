import { expect, it } from 'vitest';
import { readPwaSettings, writePwaSettings } from '../pwa-settings';

it('round trips settings without altering the document or its social image', () => {
  const source = '<html><head><meta name="artifactbin:og-image" content="ref:Social1" /></head><body><p id="kept">Hello</p>';
  const settings = { name: 'A < B & "C"', shortName: 'App', icon: 'Icon123', themeColor: '#123abc', backgroundColor: '#ffffff' };
  const next = writePwaSettings(source, settings);
  expect(readPwaSettings(next)).toEqual(settings);
  expect(next).toContain('<p id="kept">Hello</p>');
  expect(next).toContain('ref:Social1');
  expect(readPwaSettings(next).icon).toBe('Icon123');
  expect(readPwaSettings(writePwaSettings(next, {}))).toEqual({});
});
it('handles absent and self-closing Helmets, rejects unsafe icon URLs and colors', () => {
  for (const source of ['<p>x</p>', '<html><head></head><body><p>x</p>']) {
    expect(readPwaSettings(writePwaSettings(source, { name: 'Hello' }))).toEqual({ name: 'Hello' });
  }
  expect(readPwaSettings('<html><head><meta name="artifactbin:pwa-icon" content="https://example.com/a.png" /><meta name="artifactbin:pwa-theme-color" content="red;evil" /></head><body>')).toEqual({});
  expect(() => writePwaSettings('<p>x</p>', { icon: 'https://example.com' })).toThrow();
});

it('defaults to disabled and preserves presentation when switched off', () => {
  expect(readPwaSettings('<p>hello</p>').enabled).not.toBe(true);
  const enabled = writePwaSettings('<p>hello</p>', { enabled: true, name: 'My app', icon: 'Abc123' });
  expect(readPwaSettings(enabled)).toEqual({ enabled: true, name: 'My app', icon: 'Abc123' });
  const disabled = writePwaSettings(enabled, { ...readPwaSettings(enabled), enabled: false });
  expect(readPwaSettings(disabled)).toEqual({ enabled: false, name: 'My app', icon: 'Abc123' });
});
