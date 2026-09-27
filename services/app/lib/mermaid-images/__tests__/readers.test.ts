/**
 * WHICH READERS THE SERVER OFFERS STORED DRAWINGS TO (lib/mermaid-images/readers).
 *
 * The server cannot measure a reader, so it offers a stored drawing only where
 * the MEASURED table (reader-match.json, scripts/mermaid-reader-match.mjs)
 * says the reader's class lays the drawing's faces out as the harvest did.
 * Measured on 27 Sep 2026, Blink on macOS vs the unhinted Linux harvest: Inter
 * agrees at 16px (the served document) but not at 14px (the app's reader: its
 * line box is 17.02px, the harvest's 18px — class diagrams come out 2.9px
 * taller); JetBrains Mono agrees at every size; Noto Serif only at 14px.
 */
import { describe, expect, it } from 'vitest';
import { mermaidReaderClass, servableTo } from '../readers';

const MAC_CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const METRICS = [855.9375, 20, -16, 646.796875, 14, -11];
const drawn = (label: string, size: number, edge: string) => ({ portable: true, metrics: METRICS, faces: { label, size, edge } });

describe('the reader class a request names', () => {
  it.each([
    ['Chrome on macOS', MAC_CHROME],
    ['headless Chrome on macOS', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/140.0.0.0 Safari/537.36'],
    ['Edge on macOS', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0'],
  ])('%s is Blink on macOS', (_name, ua) => {
    expect(mermaidReaderClass(ua)).toBe('macos-blink');
  });

  // Everyone else is served the engine's page, as before: none of them is measured to agree.
  it.each([
    ['Chrome on Windows (unmeasured)', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'],
    ['Chrome on Linux (hinted: whole-pixel advances)', 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'],
    ['Chrome on Android (unmeasured)', 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36'],
    ['Chrome on ChromeOS (unmeasured)', 'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'],
    ['Chrome on iOS (WebKit)', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0.0.0 Mobile/15E148 Safari/604.1'],
    ['Safari on macOS (a shorter line box)', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15'],
    ['Firefox on macOS', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:130.0) Gecko/20100101 Firefox/130.0'],
    ['no user agent', ''],
  ])('%s is none', (_name, ua) => {
    expect(mermaidReaderClass(ua)).toBeNull();
  });
  it('a request that names none is none', () => {
    expect(mermaidReaderClass(null)).toBeNull();
    expect(mermaidReaderClass(undefined)).toBeNull();
  });
});

describe('a stored drawing offered to Blink on macOS', () => {
  it('is one whose faces it measures as the harvest did: the served document in Inter (16px) or JetBrains Mono, the app\'s reader in JetBrains Mono (14px)', () => {
    expect(servableTo(drawn('Inter', 16, 'JetBrains Mono'), 'macos-blink')).toBe(true);
    expect(servableTo(drawn('JetBrains Mono', 16, 'JetBrains Mono'), 'macos-blink')).toBe(true);
    expect(servableTo(drawn('JetBrains Mono', 14, 'JetBrains Mono'), 'macos-blink')).toBe(true);
  });
  it('is never one in Inter at 14px (the app\'s reader: a 17.02px line box where the harvest measured 18px)', () => {
    expect(servableTo(drawn('Inter', 14, 'JetBrains Mono'), 'macos-blink')).toBe(false);
  });
  it('is never one whose edge labels are in Noto Serif (it rounds that face\'s advances otherwise at 11px and 16px)', () => {
    expect(servableTo(drawn('Noto Serif', 16, 'Noto Serif'), 'macos-blink')).toBe(false);
    expect(servableTo(drawn('Noto Serif', 14, 'Noto Serif'), 'macos-blink')).toBe(false);
  });
  it('is never one in a face or size nobody measured', () => {
    expect(servableTo(drawn('Some Font', 16, 'JetBrains Mono'), 'macos-blink')).toBe(false);
    expect(servableTo(drawn('Inter', 18, 'JetBrains Mono'), 'macos-blink')).toBe(false);
  });
  it('is never one drawn in a system font, or stored without its measurements or faces', () => {
    expect(servableTo({ ...drawn('Inter', 16, 'JetBrains Mono'), portable: false }, 'macos-blink')).toBe(false);
    expect(servableTo({ portable: true, faces: { label: 'Inter', size: 16, edge: 'JetBrains Mono' } }, 'macos-blink')).toBe(false);
    expect(servableTo({ portable: true, metrics: METRICS }, 'macos-blink')).toBe(false);
  });
});
