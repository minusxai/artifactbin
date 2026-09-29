import { expect, it } from 'vitest';
import { morphDraftDom } from '../morph/engine';

it('updates compiled prose while keeping an unchanged live island element', () => {
  const root = document.createElement('div');
  root.setAttribute('data-mx-inline-story', '');
  root.innerHTML = '<p id="text" data-mx-ast="0">Before</p><div id="chart" data-mx-ast="1" data-hk="s0-0"><svg aria-label="Question embed"></svg></div>';
  document.body.append(root);
  const chart = root.querySelector('#chart');
  const next = document.createElement('div');
  next.setAttribute('data-mx-inline-story', '');
  next.innerHTML = '<p id="text" data-mx-ast="0">After</p><div id="chart" data-mx-ast="1" data-hk="s0-0"><span>Static preview</span></div>';
  morphDraftDom(root, next, new Set(['chart']));
  expect(root.querySelector('#text')?.textContent).toBe('After');
  expect(root.querySelector('#chart')).toBe(chart);
  expect(root.querySelector('[aria-label="Question embed"]')).not.toBeNull();
  root.remove();
});

it('keeps a stable chart drawing when the draft compiler has no hydrated island', () => {
  const root = document.createElement('div');
  root.setAttribute('data-mx-inline-story', '');
  root.innerHTML = '<p id="text">Before</p><div id="chart" aria-label="Question embed"><svg class="marks"></svg></div>';
  document.body.append(root);
  const chart = root.querySelector('#chart');
  const next = document.createElement('div');
  next.setAttribute('data-mx-inline-story', '');
  next.innerHTML = '<p id="text">After</p><div id="chart" data-hk="s0-0"><span>Static preview</span></div>';
  morphDraftDom(root, next, new Set(['chart']));
  expect(root.querySelector('#text')?.textContent).toBe('After');
  expect(root.querySelector('#chart')).toBe(chart);
  expect(root.querySelector('svg.marks')).not.toBeNull();
  root.remove();
});

it('keeps a chart without an authored id by its unchanged AST path', () => {
  const root = document.createElement('div');
  root.setAttribute('data-mx-inline-story', '');
  root.innerHTML = '<p data-mx-ast="0">Before</p><div data-mx-ast="1" data-hk="s0-0" aria-label="Question embed"><svg class="marks"></svg></div>';
  document.body.append(root);
  const chart = root.querySelector('[data-mx-ast="1"]');
  const next = document.createElement('div');
  next.setAttribute('data-mx-inline-story', '');
  next.innerHTML = '<p data-mx-ast="0">After</p><div data-mx-ast="1" data-hk="s1-0"><span>Static preview</span></div>';
  morphDraftDom(root, next, new Set(), new Set(['1']));
  expect(root.querySelector('[data-mx-ast="1"]')).toBe(chart);
  expect(root.querySelector('svg.marks')).not.toBeNull();
  root.remove();
});
