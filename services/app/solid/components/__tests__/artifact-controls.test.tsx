/* @jsxImportSource solid-js */
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@solidjs/testing-library';
import { afterEach, expect, it, vi } from 'vitest';
import ArtifactPageChrome from '../PageChrome';
import { PageControlsPanel } from '../PageBar';

afterEach(cleanup);

it('opens a named controls dialog and dismisses it after an action', () => {
  render(() => <ArtifactPageChrome authed anon={false} title="Dataset" label="Artifact controls"><button type="button">Share</button></ArtifactPageChrome>);
  fireEvent.click(screen.getByRole('button', { name: 'Open artifact controls' }));
  expect(screen.getByRole('dialog', { name: 'Artifact controls' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Share' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss artifact controls' }));
  expect(screen.queryByRole('dialog', { name: 'Artifact controls' })).toBeNull();
});

it('is a modal over the page: Escape dismisses it and a second open starts fresh', () => {
  render(() => <ArtifactPageChrome authed anon={false} title="Dataset" label="Artifact controls"><button type="button">Share</button></ArtifactPageChrome>);
  const opener = screen.getByRole('button', { name: 'Open artifact controls' });
  fireEvent.click(opener);
  expect(opener).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByRole('dialog', { name: 'Artifact controls' })).toHaveAttribute('aria-modal', 'true');
  fireEvent.keyDown(screen.getByRole('dialog', { name: 'Artifact controls' }), { key: 'Escape' });
  expect(screen.queryByRole('dialog', { name: 'Artifact controls' })).toBeNull();
  fireEvent.click(opener);
  expect(screen.getByRole('dialog', { name: 'Artifact controls' })).toBeInTheDocument();
});

it('draws the page controls panel as a named region with a dismiss button for its title', () => {
  const onClose = vi.fn();
  render(() => <PageControlsPanel label="Page controls" title="page controls" onClose={onClose}><p>row</p></PageControlsPanel>);
  const region = screen.getByRole('region', { name: 'Page controls' });
  expect(region).toHaveTextContent('row');
  expect(within(region).getByRole('heading', { name: 'page controls' })).toBeInTheDocument();
  fireEvent.click(within(region).getByRole('button', { name: 'Dismiss page controls' }));
  expect(onClose).toHaveBeenCalledOnce();
});
