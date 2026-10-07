import { expect, it } from 'vitest';
import { githubStarMarkup } from '@/lib/serving/github-star';

it('offers a compact icon link with its full accessible name and no visual label or count', () => {
  const root = document.createElement('div');
  root.innerHTML = githubStarMarkup(false);
  const link = root.querySelector('a')!;
  expect(link.getAttribute('aria-label')).toBe('Star artifactbin on GitHub');
  expect(link.getAttribute('href')).toBe('https://github.com/minusxai/artifactbin');
  expect(link.getAttribute('target')).toBe('_blank');
  expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  expect(link.querySelector('svg')).not.toBeNull();
  expect(link.textContent).toBe('');
  expect(link.querySelector('[data-mx-github-count]')).toBeNull();
});

it('retains the desktop visual label and independently hydrated count', () => {
  const root = document.createElement('div');
  root.innerHTML = githubStarMarkup();
  const link = root.querySelector('a')!;
  expect(link.textContent).toBe('Star');
  expect(link.querySelector('svg')).not.toBeNull();
  expect(link.querySelector('[data-mx-github-count]')).not.toBeNull();
});
