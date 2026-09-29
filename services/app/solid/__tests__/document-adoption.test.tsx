/* @jsxImportSource solid-js */
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@solidjs/testing-library';
import { afterEach, expect, it } from 'vitest';
import { onMount } from 'solid-js';
import { adoptReaderDocument } from '../pages/Document';

afterEach(() => { cleanup(); document.body.replaceChildren(); });

it('moves the served document without replacing its running nodes or chrome', () => {
  const story = document.createElement('main');
  story.setAttribute('data-mx-inline-story', '');
  const live = document.createElement('button');
  live.textContent = 'Live control';
  story.append(live);
  const chrome = document.createElement('div');
  chrome.setAttribute('data-mx-reader-chrome', '');
  chrome.innerHTML = '<button aria-label="Like">Like</button>';
  document.body.append(story, chrome);
  let host!: HTMLDivElement;
  render(() => {
    onMount(() => adoptReaderDocument(host));
    return <div ref={host} />;
  });
  expect(host.querySelector('[data-mx-inline-story]')).toBe(story);
  expect(story.querySelector('button')).toBe(live);
  expect(screen.getByRole('button', { name: 'Like' })).toBeInTheDocument();
  expect(document.body.querySelector(':scope > [data-mx-reader-chrome]')).toBeNull();
});
