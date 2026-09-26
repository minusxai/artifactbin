/**
 * A CONTROL WHOSE BACKEND FEATURE IS MISSING says so in place: disabled, with
 * the backend's reason as its accessible description (and a tooltip). With
 * every feature available (online) the same control is enabled and carries no
 * description — nothing changes. Features with no control of their own (the
 * live stream, table reads, lookups) are simply not requested.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, renderHook, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import ImageDialog from '@/components/views/story/ImageDialog';
import EditPanel from '@/components/EditPanel';
import RemoteMentionPicker from '@/components/RemoteMentionPicker';
import QueryNotebookPanel from '@/components/views/story/QueryNotebookPanel';
import StoryFormatToolbar from '@/components/views/story/StoryFormatToolbar';
import { ArtifactBackendProvider } from '@/lib/artifact-backend/context';
import type { ArtifactBackend } from '@/lib/artifact-backend/types';
import { useLiveArtifact } from '@/lib/story/use-live-artifact';
import { STORY_SELECTION_MESSAGE } from '@/lib/story-runtime/contract';
import { fakeBackend } from '@/test/helpers/artifact-backend';
import { NONCE, flush, fromFrame, installAnnotationFetch, layer, makeFrame } from '@/test/helpers/annotation-layer';

const OFFLINE = 'Not available in a downloaded file.';

const inBackend = (backend: ArtifactBackend, ui: ReactNode) =>
  render(<ArtifactBackendProvider backend={backend}>{ui}</ArtifactBackendProvider>);

function expectUnavailable(control: HTMLElement) {
  expect(control).toBeDisabled();
  expect(control).toHaveAccessibleDescription(OFFLINE);
}
function expectAvailable(control: HTMLElement) {
  expect(control).toBeEnabled();
  expect(control).not.toHaveAccessibleDescription();
}

describe('the image dialog (webAssets)', () => {
  const dialog = (backend: ArtifactBackend) =>
    inBackend(backend, <ImageDialog mode="insert" onUploadFile={vi.fn()} onImportUrl={vi.fn()} onConfirm={vi.fn()} onClose={vi.fn()} />);
  const controls = () => [
    screen.getByRole('button', { name: 'choose a file' }),
    screen.getByRole('textbox', { name: 'Image URL' }),
    screen.getByRole('button', { name: 'Import image from URL' }),
  ];

  it('disables upload and URL import, each described by the reason', () => {
    dialog(fakeBackend({ webAssets: OFFLINE }));
    controls().forEach(expectUnavailable);
  });

  it('is unchanged online', () => {
    dialog(fakeBackend());
    controls().forEach(expectAvailable);
  });
});

describe('the history entry points (versions)', () => {
  const panel = (backend: ArtifactBackend, collapsed: boolean) => inBackend(backend, (
    <EditPanel top={0} tab="selection" onTab={vi.fn()} collapsed={collapsed} onCollapsedChange={vi.fn()} selectionDot={false} commentsAvailable>
      <p>body</p>
    </EditPanel>
  ));

  it.each([false, true])('disables the History tab with the reason (collapsed: %s)', (collapsed) => {
    panel(fakeBackend({ versions: OFFLINE }), collapsed);
    expectUnavailable(screen.getByRole('tab', { name: 'History' }));
    expectAvailable(screen.getByRole('tab', { name: 'Selection' }));
  });

  it.each([false, true])('offers the History tab online (collapsed: %s)', (collapsed) => {
    const onTab = vi.fn();
    inBackend(fakeBackend(), (
      <EditPanel top={0} tab="selection" onTab={onTab} collapsed={collapsed} onCollapsedChange={vi.fn()} selectionDot={false} commentsAvailable>
        <p>body</p>
      </EditPanel>
    ));
    const history = screen.getByRole('tab', { name: 'History' });
    expectAvailable(history);
    fireEvent.click(history);
    expect(onTab).toHaveBeenCalledWith('history');
  });
});

describe('the comment composer (commentImages)', () => {
  beforeEach(installAnnotationFetch);
  afterEach(() => vi.unstubAllGlobals());
  const PICKED = {
    kind: 'text' as const, path: '2.1', nodeId: 'node-2-1', tag: 'p',
    rect: { x: 5, y: 6, width: 200, height: 40 }, className: '', style: '', ancestors: [],
  };

  it('offers no capture on a versioned document, and says why in place of the screenshot', async () => {
    const backend = fakeBackend({ commentImages: OFFLINE });
    const { frame, contentWindow } = makeFrame();
    render(layer(frame, { railOpen: true, editId: 'edit-current' }, backend));
    await flush();
    fireEvent.click(screen.getByLabelText('Select')); await flush();
    await fromFrame(contentWindow, { type: STORY_SELECTION_MESSAGE, nonce: NONCE, selection: PICKED });
    expectUnavailable(screen.getByRole('button', { name: 'Attach screenshot' }));
    expect(screen.queryByLabelText('Upload screenshot')).toBeNull();
    fireEvent.change(screen.getByLabelText('Annotation comment'), { target: { value: 'Text only' } });
    expect(screen.getByLabelText('Save annotation')).toBeEnabled();
    expect(backend.uploadCommentImage).not.toHaveBeenCalled();
  });

  it('keeps requiring a screenshot online, with no unavailable control', async () => {
    const { frame, contentWindow } = makeFrame();
    render(layer(frame, { railOpen: true, editId: 'edit-current' }, fakeBackend()));
    await flush();
    fireEvent.click(screen.getByLabelText('Select')); await flush();
    await fromFrame(contentWindow, { type: STORY_SELECTION_MESSAGE, nonce: NONCE, selection: PICKED });
    expect(screen.queryByRole('button', { name: 'Attach screenshot' })).toBeNull();
    expect(screen.getByLabelText('Upload screenshot')).toBeTruthy();
  });
});

describe('the @mention picker (mentions, remoteSessions)', () => {
  it('says why for each missing lookup and never asks for it', async () => {
    const backend = fakeBackend({ mentions: OFFLINE, remoteSessions: 'Agents need a connection.' });
    inBackend(backend, <RemoteMentionPicker query="" artifactId="doc1" onSelect={vi.fn()} />);
    await flush();
    expect(screen.getByText(OFFLINE)).toBeTruthy();
    expect(screen.getByText('Agents need a connection.')).toBeTruthy();
    expect(screen.queryByText('Loading sessions…')).toBeNull();
    expect(backend.members).not.toHaveBeenCalled();
    expect(backend.remoteSessions).not.toHaveBeenCalled();
  });

  it('asks the backend online', async () => {
    const backend = fakeBackend({}, { members: vi.fn(async () => ({ people: [{ user_id: 'u1', username: 'ada', name: 'Ada' }] })) });
    inBackend(backend, <RemoteMentionPicker query="ad" artifactId="doc1" onSelect={vi.fn()} />);
    expect(await screen.findByRole('button', { name: 'Mention @ada' })).toBeTruthy();
    expect(backend.members).toHaveBeenCalledWith('ad', expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(backend.remoteSessions).toHaveBeenCalled();
  });

  const toolbar = (backend: ArtifactBackend) => inBackend(backend, (
    <StoryFormatToolbar
      artifactId="doc1"
      selection={{ kind: 'text', path: '0', tag: 'p', rect: { x: 0, y: 100, width: 200, height: 40 }, className: '', style: '', ancestors: [] }}
      onApply={vi.fn()} onApplyLink={vi.fn()} onSelect={vi.fn()} onDelete={vi.fn()}
    />
  ));

  it('disables the toolbar\'s Mention person with the reason', () => {
    toolbar(fakeBackend({ mentions: OFFLINE }));
    expectUnavailable(screen.getByRole('button', { name: 'Mention person' }));
  });

  it('offers the toolbar\'s Mention person online', () => {
    toolbar(fakeBackend());
    expectAvailable(screen.getByRole('button', { name: 'Mention person' }));
  });
});

describe('features with nothing to press', () => {
  it('does not read dataset tables when queries cannot run, and says why', async () => {
    const backend = fakeBackend({ runQueries: OFFLINE });
    const cell = { name: 'sales', sql: 'select 1', source: 'ds1234', params: [], result: null, error: null, pending: false, bound: [] };
    inBackend(backend, <QueryNotebookPanel cells={[cell]} onSqlChange={vi.fn()} />);
    expect(await screen.findByText(`shape unavailable — ${OFFLINE}`)).toBeTruthy();
    expect(backend.queryTable).not.toHaveBeenCalled();
  });

  it('does not subscribe to a live stream the backend lacks', () => {
    const offline = fakeBackend({ live: OFFLINE });
    renderHook(() => useLiveArtifact(offline, 'doc1', 'e1', 1));
    expect(offline.live).not.toHaveBeenCalled();
    const online = fakeBackend();
    renderHook(() => useLiveArtifact(online, 'doc1', 'e1', 1));
    expect(online.live).toHaveBeenCalledTimes(1);
  });
});
