import { describe, expect, it } from 'vitest';
import { PERSON_FACE_LIGHTNESS, PERSON_FACE_SATURATION, personFaceBackground, personHue, personInitial } from '../person-face';

/** WCAG relative luminance of an sRGB colour given as 0..255 channels. */
const luminance = (rgb: number[]): number => {
  const [r, g, b] = rgb.map((c) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};

/** HSL (degrees, percent, percent) to 0..255 sRGB channels. */
const hslToRgb = (h: number, s: number, l: number): number[] => {
  const sat = s / 100, light = l / 100;
  const a = sat * Math.min(light, 1 - light);
  const f = (n: number) => { const k = (n + h / 30) % 12; return light - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
  return [f(0), f(8), f(4)].map((x) => Math.round(x * 255));
};

describe('person-face', () => {
  it('gives the same id the same hue, and spreads ids around the wheel', () => {
    expect(personHue('usr_abc')).toBe(personHue('usr_abc'));
    const hues = new Set(Array.from({ length: 50 }, (_, i) => personHue(`usr_${i}_x`)));
    expect(hues.size).toBeGreaterThan(20);
    for (const hue of hues) expect(hue).toBeGreaterThanOrEqual(0), expect(hue).toBeLessThan(360);
  });

  it('keeps white initials at WCAG AA contrast on every hue', () => {
    let worst = Infinity;
    for (let hue = 0; hue < 360; hue += 1) {
      const contrast = 1.05 / (luminance(hslToRgb(hue, PERSON_FACE_SATURATION, PERSON_FACE_LIGHTNESS)) + 0.05);
      worst = Math.min(worst, contrast);
    }
    expect(worst).toBeGreaterThanOrEqual(4.5);
  });

  it('writes the background from the id alone', () => {
    expect(personFaceBackground('usr_abc')).toBe(`hsl(${personHue('usr_abc')} 55% 30%)`);
  });

  it('draws the first letter, upper-cased, and ? for nothing', () => {
    expect(personInitial('ada')).toBe('A');
    expect(personInitial('  zed ')).toBe('Z');
    expect(personInitial('')).toBe('?');
    expect(personInitial(null)).toBe('?');
    expect(personInitial(undefined)).toBe('?');
  });
});
