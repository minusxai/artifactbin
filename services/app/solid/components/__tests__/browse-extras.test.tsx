/* @jsxImportSource solid-js */
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, expect, it, vi } from 'vitest';
import SharedWithYou from '@/solid/components/SharedWithYou';
import type { WorkspaceSharedItem } from '@/lib/workspace';

const shared = (id: string, role: WorkspaceSharedItem['role'] = 'viewer'): WorkspaceSharedItem => ({ id, title: `doc ${id}`, description: null, format: 'markup', role, version: 1, visibility: 'private', updated_at: '2026-08-01T00:00:00.000Z', owner_username: 'alice' });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('keeps shared work absent when empty, and filters by role and search', () => {
  const blank = render(() => <SharedWithYou items={[]} />);
  expect(blank.container.innerHTML).toBe(''); blank.unmount();
  render(() => <SharedWithYou items={[shared('one'), shared('two', 'editor')]} />);
  expect(screen.getByLabelText('Your role on one')).toHaveTextContent('can view');
  expect(screen.getByLabelText('Open shared artifact one')).toHaveAttribute('href', '/a/one');
  fireEvent.click(screen.getByLabelText('Filter editor'));
  expect(screen.queryByLabelText('Open shared artifact one')).toBeNull();
  expect(screen.getByLabelText('Open shared artifact two')).toBeInTheDocument();
  fireEvent.input(screen.getByLabelText('Search shared artifacts'), { target: { value: 'one' } });
  expect(screen.queryByLabelText('Open shared artifact two')).toBeNull();
});

it('ANDs an external query (Home\'s own search box) with its own search box', () => {
  render(() => <SharedWithYou items={[shared('one'), shared('two')]} query="one" />);
  expect(screen.getByLabelText('Open shared artifact one')).toBeInTheDocument();
  expect(screen.queryByLabelText('Open shared artifact two')).toBeNull();
  // Its own box still narrows further within the external query's result, rather than replacing it.
  fireEvent.input(screen.getByLabelText('Search shared artifacts'), { target: { value: 'two' } });
  expect(screen.queryByLabelText('Open shared artifact one')).toBeNull();
});

it('names each recipient role and uses short artifact links even for untitled work', () => {
  render(() => <SharedWithYou items={[shared('one'), shared('two', 'editor'), { ...shared('three', 'commenter'), title: null, owner_username: null }]} />);
  expect(screen.getByLabelText('Your role on one')).toHaveTextContent('can view');
  expect(screen.getByLabelText('Your role on two')).toHaveTextContent('can edit');
  expect(screen.getByLabelText('Your role on three')).toHaveTextContent('can comment');
  expect(screen.getByLabelText('Shared with you')).toHaveTextContent('@alice');
  expect(screen.getByLabelText('Open shared artifact one')).toHaveAttribute('href', '/a/one');
  expect(screen.getByLabelText('Open shared artifact three')).toHaveAttribute('href', '/a/three');
  expect(screen.getByLabelText('Open shared artifact three')).toHaveTextContent('three');
});

it('marks the active role and format filters as pressed and counts what remains', () => {
  render(() => <SharedWithYou items={[shared('one'), shared('two', 'editor')]} />);
  const editor = screen.getByRole('button', { name: 'Filter editor' });
  expect(editor).toHaveAttribute('aria-pressed', 'false');
  fireEvent.click(editor);
  expect(editor).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByLabelText('Shared with you')).toHaveTextContent('1/2');
  fireEvent.click(editor);
  expect(editor).toHaveAttribute('aria-pressed', 'false');
});

it('says when nothing shared matches the search, quoting it', () => {
  render(() => <SharedWithYou items={[shared('one')]} />);
  fireEvent.input(screen.getByLabelText('Search shared artifacts'), { target: { value: 'zzz' } });
  expect(screen.getByRole('status')).toHaveTextContent('nothing matches “zzz”');
  expect(screen.queryByLabelText('Open shared artifact one')).toBeNull();
});

// Contract: the view is chosen before facets, result counts and page slicing.
it('defaults mixed shared inventory to documents and deliberately exposes every asset', () => {
  const docs = Array.from({ length: 12 }, (_, i): WorkspaceSharedItem => ({ ...shared(`page_${i}`), format: 'html' }));
  const assets = Array.from({ length: 205 }, (_, i): WorkspaceSharedItem => ({ ...shared(`asset_${i}`, 'editor'), title: `asset_${i}.${['css', 'js', 'woff2', 'csv'][i % 4]}`, format: i % 4 === 3 ? 'dataset' : 'file' }));
  render(() => <SharedWithYou items={[...assets, ...docs]} />);
  expect(screen.queryByLabelText('Open shared artifact asset_0')).toBeNull();
  expect(screen.queryByLabelText('Filter file')).toBeNull();
  expect(screen.queryByLabelText('Filter editor')).toBeNull();
  expect(screen.getByLabelText('Shared page range')).toHaveTextContent('1-10 of 12');
  fireEvent.click(screen.getByLabelText('Next shared page'));
  expect(screen.getByLabelText('Open shared artifact page_11')).toBeInTheDocument();
  expect(screen.getByLabelText('Shared page range')).toHaveTextContent('11-12 of 12');
  fireEvent.click(screen.getByRole('button', { name: 'Shared assets' }));
  expect(screen.getByLabelText('Open shared artifact asset_0')).toBeInTheDocument();
  expect(screen.queryByLabelText('Open shared artifact page_0')).toBeNull();
  expect(screen.getByLabelText('Shared page range')).toHaveTextContent('1-10 of 205');
  for (let page = 1; page <= 20; page++) fireEvent.click(screen.getByLabelText('Next shared page'));
  expect(screen.getByLabelText('Shared page range')).toHaveTextContent('201-205 of 205');
  expect(screen.getByLabelText('Open shared artifact asset_204')).toBeInTheDocument();
  expect(screen.getByLabelText('Next shared page')).toBeDisabled();
  fireEvent.click(screen.getByLabelText('Filter dataset'));
  expect(screen.getByLabelText('Shared page range')).toHaveTextContent('1-10 of 51');
  fireEvent.input(screen.getByLabelText('Search shared artifacts'), { target: { value: 'asset_203' } });
  expect(screen.getByLabelText('Open shared artifact asset_203')).toHaveAttribute('href', '/a/asset_203');
  expect(screen.getByLabelText('Shared result count')).toHaveTextContent('1/205');
  fireEvent.click(screen.getByRole('button', { name: 'Shared documents' }));
  expect(screen.getByRole('status')).toHaveTextContent('nothing matches');
});

it('offers the assets view when no documents have been shared', () => {
  render(() => <SharedWithYou items={[{ ...shared('file'), format: 'file', title: 'font.woff2' }]} />);
  expect(screen.getByRole('status')).toHaveTextContent('no shared documents');
  fireEvent.click(screen.getByRole('button', { name: 'Shared assets' }));
  expect(screen.getByLabelText('Open shared artifact file')).toBeInTheDocument();
});
