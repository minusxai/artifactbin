// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { AfProgress, registerProgress } from './progress';

registerProgress();
afterEach(() => document.body.replaceChildren());
function fixture(markup: string) {
  const host = document.createElement('div'); host.innerHTML = markup; document.body.append(host);
  return host.firstElementChild as AfProgress;
}

describe('native authored progress', () => {
  it('reflects valid numeric values, clamps visual fill, and marks completion only at 100', () => {
    const progress = fixture('<af-progress value="0"></af-progress>');
    expect(progress.value).toBe(0); expect(progress.getAttribute('aria-valuenow')).toBe('0');
    expect(progress.dataset.state).toBe('loading');
    progress.value = 100;
    expect(progress.getAttribute('aria-valuenow')).toBe('100'); expect(progress.dataset.state).toBe('complete');
    progress.value = 23.5; expect(progress.getAttribute('aria-valuenow')).toBe('23.5');
    expect(progress.querySelector('[data-slot="progress-indicator"]')!.getAttribute('style')).toContain('translateX(-76.5%)');
  });
  it('keeps missing, empty, malformed, non-finite and out-of-range attributes indeterminate', () => {
    const progress = fixture('<af-progress></af-progress>');
    for (const value of [null, '', 'wat', '-1', '101', 'Infinity', 'NaN']) {
      if (value === null) progress.removeAttribute('value'); else progress.setAttribute('value', value);
      expect(progress.value).toBeNull(); expect(progress.hasAttribute('aria-valuenow')).toBe(false);
      expect(progress.dataset.state).toBe('indeterminate'); expect(progress.getAttribute('aria-valuemin')).toBe('0');
      expect(progress.getAttribute('aria-valuemax')).toBe('100');
    }
    progress.value = Number.POSITIVE_INFINITY;
    expect(progress.value).toBeNull(); expect(progress.hasAttribute('aria-valuenow')).toBe(false);
  });
  it('supports attribute/property updates, property precedence after upgrade, and reconnection', () => {
    const host = document.createElement('div'); host.innerHTML = '<af-progress value="4"></af-progress>';
    const progress = host.firstElementChild as AfProgress;
    Object.defineProperty(progress, 'value', {value: 44, writable:true, configurable:true});
    document.body.append(host); expect(progress.value).toBe(44); expect(progress.getAttribute('aria-valuenow')).toBe('44');
    progress.setAttribute('value','50'); expect(progress.value).toBe(50);
    progress.remove(); document.body.append(progress); expect(progress.value).toBe(50);
  });
  it('preserves authored children and data-af-id while creating one stable internal indicator', () => {
    const progress = fixture('<af-progress value="30" data-af-id="root"><span data-af-id="authored">Text</span></af-progress>');
    const authored = progress.firstElementChild; const indicator = progress.querySelector('[data-slot="progress-indicator"]');
    expect(authored?.getAttribute('data-af-id')).toBe('authored'); expect(progress.getAttribute('data-af-id')).toBe('root');
    expect(indicator).toBeTruthy(); progress.value = 50;
    expect(progress.firstElementChild).toBe(authored); expect(progress.querySelector('[data-slot="progress-indicator"]')).toBe(indicator);
  });
  it('exposes progressbar semantics and an optional accessible label', () => {
    const progress = fixture('<af-progress aria-label="Uploading" value="12"></af-progress>');
    expect(progress.getAttribute('role')).toBe('progressbar'); expect(progress.getAttribute('aria-label')).toBe('Uploading');
    expect(progress.getAttribute('aria-valuenow')).toBe('12');
  });
  it('installs semantic token styles once and scopes independent instances', () => {
    const one = fixture('<af-progress value="10"></af-progress>'); const two = fixture('<af-progress></af-progress>');
    expect(getComputedStyle(one).height).toBe('8px');
    expect(getComputedStyle(one.querySelector('[data-slot="progress-indicator"]')!).backgroundColor).not.toBe('');
    registerProgress(); expect(document.querySelectorAll('style[data-af-progress-styles]')).toHaveLength(1);
    expect(two.dataset.state).toBe('indeterminate');
  });
});
