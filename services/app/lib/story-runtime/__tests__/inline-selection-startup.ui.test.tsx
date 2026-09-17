import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { InlineStoryRuntime, type InlineStoryController } from '../InlineStoryRuntime';
import { STORY_SELECTION_ACTIONS_MESSAGE } from '../contract';
import { createFrameSelectionActions } from '../edit/selection-actions';

const fixture = vi.hoisted(() => ({portal: null as HTMLElement | null, updates: [] as unknown[]}));
vi.mock('@/components/TrustedUi', () => ({
  TrustedUi: ({children}: {children: ReactNode}) => children,
  useTrustedPortalContainer: () => fixture.portal ?? undefined,
}));
vi.mock('../edit/selection-actions', async importOriginal => {
  const actual = await importOriginal<typeof import('../edit/selection-actions')>();
  return {...actual, createFrameSelectionActions: vi.fn((...args: Parameters<typeof actual.createFrameSelectionActions>) => {
    const session = actual.createFrameSelectionActions(...args);
    return {...session, update: (command: Parameters<typeof session.update>[0]) => {fixture.updates.push(command); session.update(command);}};
  })};
});
beforeEach(() => {fixture.portal = null; fixture.updates = []; vi.mocked(createFrameSelectionActions).mockClear();});
afterEach(() => {cleanup(); fixture.portal?.remove();});
const data = {nodes: [], colorMode: 'light' as const, refData: {}, chrome: false};
const grant = (edit: boolean, annotate: boolean) => ({type: STORY_SELECTION_ACTIONS_MESSAGE, edit, annotate});

it('starts once when the portal is ready before the grant', async () => {
  fixture.portal = document.body.appendChild(document.createElement('div'));
  let controller!: InlineStoryController;
  render(<InlineStoryRuntime data={data} onController={value => {if(value) controller = value;}}/>);
  await act(async () => {controller.send(grant(false, true)); await import('../edit/selection-actions');});
  expect(createFrameSelectionActions).toHaveBeenCalledOnce();
  expect(fixture.updates.at(-1)).toEqual(grant(false, true));
});

it('does not construct a session for a grant revoked during the import', async () => {
  fixture.portal = document.body.appendChild(document.createElement('div'));
  let controller!: InlineStoryController;
  render(<InlineStoryRuntime data={data} onController={value => {if(value) controller = value;}}/>);
  await act(async () => {
    controller.send(grant(false, true));
    controller.send(grant(false, false));
    await import('../edit/selection-actions');
  });
  expect(createFrameSelectionActions).not.toHaveBeenCalled();
});

it('replays the latest grant when the trusted portal arrives after the lazy module', async () => {
  let controller!: InlineStoryController;
  const ready = (value: InlineStoryController | null) => {if(value) controller = value;};
  const view = render(<InlineStoryRuntime data={data} onController={ready}/>);
  await act(async () => {controller.send(grant(true, false)); await import('../edit/selection-actions');});
  expect(createFrameSelectionActions).not.toHaveBeenCalled();
  await act(async () => {controller.send(grant(false, true));});
  fixture.portal = document.body.appendChild(document.createElement('div'));
  view.rerender(<InlineStoryRuntime data={data} onController={ready}/>);
  await waitFor(() => expect(createFrameSelectionActions).toHaveBeenCalledOnce());
  expect(fixture.updates.at(-1)).toEqual(grant(false, true));
  expect(vi.mocked(createFrameSelectionActions).mock.calls[0][0].portal).toBe(fixture.portal);
});

it('does not start a revoked grant when the portal arrives', async () => {
  let controller!: InlineStoryController;
  const ready = (value: InlineStoryController | null) => {if(value) controller = value;};
  const view = render(<InlineStoryRuntime data={data} onController={ready}/>);
  await act(async () => {controller.send(grant(false, true)); await import('../edit/selection-actions');});
  await act(async () => {controller.send(grant(false, false));});
  fixture.portal = document.body.appendChild(document.createElement('div'));
  view.rerender(<InlineStoryRuntime data={data} onController={ready}/>);
  await act(async () => {});
  expect(createFrameSelectionActions).not.toHaveBeenCalled();
});

it('does not resume a disposed document when portal readiness changes', async () => {
  let controller!: InlineStoryController;
  const ready = (value: InlineStoryController | null) => {if(value) controller = value;};
  const view = render(<InlineStoryRuntime data={data} onController={ready}/>);
  await act(async () => {controller.send(grant(false, true)); await import('../edit/selection-actions');});
  controller.dispose();
  fixture.portal = document.body.appendChild(document.createElement('div'));
  view.rerender(<InlineStoryRuntime data={data} onController={ready}/>);
  await act(async () => {});
  expect(createFrameSelectionActions).not.toHaveBeenCalled();
});
