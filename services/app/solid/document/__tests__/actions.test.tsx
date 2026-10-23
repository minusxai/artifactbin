/* @jsxImportSource solid-js */
import { expect, it, vi } from 'vitest';
import { fireEvent, render } from '../../__tests__/helpers';
import { DocumentActions } from '../DocumentActions';

it('keeps archived actions read only and exposes a reader fork', () => {
  const view = render(() => <DocumentActions id="abc" title="Report" version={2} archived owner canEdit canAnnotate
    like={{ liked: false, count: 0 }} accountSession={false} onCommentsChange={() => {}} />);
  expect(view.queryByRole('button', { name: 'Edit artifact' })).toBeNull();
  expect(view.queryByRole('button', { name: 'Delete Report' })).toBeNull();
  expect(view.getByRole('button', { name: 'Fork artifact' })).toBeTruthy();
});

it('toggles comments without changing document mode', () => {
  const comments = vi.fn();
  const view = render(() => <DocumentActions id="abc" title="Report" version={3} owner canEdit canAnnotate
    like={{ liked: false, count: 0 }} accountSession onCommentsChange={comments} />);
  fireEvent.click(view.getByRole('button', { name: 'Toggle comments' }));
  expect(comments).toHaveBeenCalledWith(true);
  expect(view.getByRole('button', { name: 'Toggle comments' })).toHaveAttribute('aria-pressed', 'true');
});

it('keeps people accessible independently of app mutations', () => {
  const view = render(() => <DocumentActions id="abc123" title="Report" version={1} owner canEdit canAnnotate
    like={{ liked: false, count: 0 }} accountSession onCommentsChange={() => {}} />);
  expect(view.getByRole('button', { name: 'People' })).toBeTruthy();
});

it('draws every row of the controls panel alike: a ghost row with one icon and a lower-case label', () => {
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  try {
    const view = render(() => <DocumentActions id="abc123" title="Report" version={1} owner canEdit canAnnotate pwaEnabled
      like={{ liked: false, count: 0 }} accountSession onCommentsChange={() => {}} onDeleted={() => {}} />);
    const rows = ['Toggle comments', 'Install app', 'Download for offline', 'Fork artifact', 'Like artifact', 'Transfer ownership of Report', 'Refresh external images', 'Share', 'Delete Report']
      .map(name => view.getAllByRole(name === 'Install app' || name === 'Download for offline' ? 'link' : 'button', { name })[0]!);
    const look = (row: HTMLElement) => row.className.split(/\s+/).filter(token => /^(h-control|rounded-|px-|font-mono|text-xs|hover:bg-)/.test(token)).sort().join(' ');
    for (const row of rows) {
      expect(row.querySelectorAll(':scope svg, :scope > span > svg').length, `${row.getAttribute('aria-label')} has one icon`).toBe(1);
      expect(row.textContent!.trim(), `${row.getAttribute('aria-label')} is lower-case`).toMatch(/^[a-z0-9]/);
      expect(look(row), `${row.getAttribute('aria-label')} is drawn as a ghost sm row`).toBe(look(rows[0]!));
    }
  } finally { vi.unstubAllGlobals(); }
});

it('offers discussion and sharing without an in-app document editor', () => {
  const view = render(() => <DocumentActions id="abc" title="Report" version={3} owner canEdit canAnnotate
    like={{ liked: false, count: 0 }} accountSession onCommentsChange={() => {}} />);
  expect(view.queryByRole('button', { name: 'Edit artifact' })).toBeNull();
  expect(view.getByRole('button', { name: 'Toggle comments' })).toBeTruthy();
  expect(view.getByRole('button', { name: 'Share' })).toBeTruthy();
});
