/* @jsxImportSource solid-js */
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, expect, it } from 'vitest';
import ArtifactPageChrome from '../PageChrome';

afterEach(cleanup);

it('opens a named controls dialog and dismisses it after an action', () => {
  render(() => <ArtifactPageChrome authed anon={false} title="Dataset" label="Artifact controls"><button type="button">Share</button></ArtifactPageChrome>);
  fireEvent.click(screen.getByRole('button', { name: 'Open artifact controls' }));
  expect(screen.getByRole('dialog', { name: 'Artifact controls' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Share' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss artifact controls' }));
  expect(screen.queryByRole('dialog', { name: 'Artifact controls' })).toBeNull();
});
