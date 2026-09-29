/* @jsxImportSource solid-js */
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, expect, it, vi } from 'vitest';
import ShareLink from '../ShareLink';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('offers only the selected recipient role options while editing a share', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ visibility: 'private', linkRole: 'viewer', canPrivate: true, shares: [{ email: 'one@example.com', role: 'viewer' }, { email: 'two@example.com', role: 'viewer' }] })));
  render(() => <ShareLink artifactId="dataset" title="Dataset" format="dataset" editable />);
  fireEvent.click(screen.getByRole('button', { name: 'Share' }));
  const recipient = await screen.findByRole('button', { name: 'Role for two@example.com' });
  fireEvent.click(recipient);
  expect(screen.getAllByRole('option', { name: 'can edit' })).toHaveLength(1);
});
