import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseJsx } from '@/lib/jsx';
import { InlineStoryRuntime, type InlineStoryController } from '../InlineStoryRuntime';
import { STORY_DOCUMENT_MESSAGE, STORY_EDIT_MODE_MESSAGE, STORY_COMMIT_MESSAGE, STORY_SELECT_MESSAGE, type StoryIslandData } from '../contract';
import { StrictMode } from 'react';

afterEach(cleanup);
const data = (label: string): StoryIslandData => {
  const parsed = parseJsx(`<h1 id="heading" aria-label="Artifact heading">${label}</h1>`);
  if (!parsed.ok) throw new Error(parsed.error);
  return { nodes: parsed.nodes, colorMode: 'light', refData: {}, chrome: false };
};
const transport = { run: vi.fn(async () => ({ tables: {}, errors: {} })), page: vi.fn(async () => ({ rows: [], columns: [] })) };

describe('inline artifact runtime lifetime', () => {
  it('survives StrictMode replay with a live store and scoped signal updates', async () => {
    const initial = data('Strict');
    initial.dataflow = {flow:{values:[{kind:'scalar',name:'n',type:'number',default:0,start:0,end:0}],queries:[{name:'q',sql:'select $n',params:['n'],refs:[],start:0,end:0}]}};
    const run = vi.fn(async () => ({tables:{},errors:{}}));
    let controller: InlineStoryController | null = null;
    const view = render(<StrictMode><InlineStoryRuntime data={initial} transport={{...transport,run}} onController={value => { controller=value; }} /></StrictMode>);
    await waitFor(() => expect(controller).not.toBeNull());
    const listener = vi.fn(); controller!.subscribe(listener);
    await act(async () => { controller!.update({type:STORY_DOCUMENT_MESSAGE,nodes:data('Replayed').nodes,dataflow:initial.dataflow}); });
    await waitFor(() => expect(run.mock.calls.length).toBeGreaterThan(1));
    expect(screen.getByLabelText('Artifact heading')).toHaveTextContent('Replayed');
    view.unmount();
  });
  it('renders directly in the main document and adopts versions without replacing its root', async () => {
    let session: InlineStoryController | null = null;
    const view = render(<InlineStoryRuntime data={data('First')} transport={transport} onController={value => { session = value; }} />);
    await waitFor(() => expect(session).not.toBeNull());
    const heading = screen.getByLabelText('Artifact heading');
    expect(heading.getRootNode()).toBe(document);
    expect(view.container.querySelector('iframe')).toBeNull();
    const parent = heading.parentElement;
    await act(async () => { session!.update({ type: STORY_DOCUMENT_MESSAGE, nodes: data('Second').nodes }); });
    expect(screen.getByLabelText('Artifact heading')).toHaveTextContent('Second');
    expect(screen.getByLabelText('Artifact heading').parentElement).toBe(parent);
  });

  it('scopes duplicate AST paths to its own root and commits actual edited text', async () => {
    let session: InlineStoryController | null = null;
    const view = render(<><p id="outside" data-mx-ast="0">Trusted sibling</p><InlineStoryRuntime data={data('First')} transport={transport} onController={value => {session=value;}} /></>);
    await waitFor(() => expect(session).not.toBeNull());
    const messages: unknown[] = [];
    session!.subscribe(message => messages.push(message));
    await act(async () => session!.send({type:STORY_EDIT_MODE_MESSAGE,on:true}));
    await waitFor(() => expect(screen.getByLabelText('Artifact heading')).toHaveAttribute('contenteditable','true'));
    const heading = screen.getByLabelText('Artifact heading');
    await act(async () => session!.send({type:STORY_SELECT_MESSAGE,path:'0'}));
    expect(document.getElementById('outside')).not.toHaveAttribute('data-mx-selected');
    fireEvent.focus(heading);
    heading.innerHTML = 'Typed draft';
    fireEvent.input(heading);
    await act(async () => session!.send({type:STORY_COMMIT_MESSAGE}));
    expect(messages).toEqual(expect.arrayContaining([expect.objectContaining({type:'mx:text-edit',innerHtml:'Typed draft'}),expect.objectContaining({type:'mx:committed'})]));
    view.unmount();
  });

  it('does not create a lazy edit session after unmount', async () => {
    let session: InlineStoryController | null = null;
    const view = render(<InlineStoryRuntime data={data('First')} transport={transport} onController={value=>{session=value;}} />);
    await waitFor(() => expect(session).not.toBeNull());
    const old = session!;
    await act(async () => { old.send({type:STORY_EDIT_MODE_MESSAGE,on:true}); view.unmount(); });
    expect(document.querySelector('style[data-mx-edit-css]')).toBeNull();
    expect(document.querySelector('[contenteditable]')).toBeNull();
  });

  it('accepts editing through its private endpoint, never forged window messages, and revokes the endpoint on unmount', async () => {
    let session: InlineStoryController | null = null;
    const callback = (value: InlineStoryController | null) => { session = value; };
    const view = render(<InlineStoryRuntime data={data('First')} transport={transport} onController={callback} />);
    await waitFor(() => expect(session).not.toBeNull());
    await act(async () => { window.dispatchEvent(new MessageEvent('message', { data: { type: STORY_EDIT_MODE_MESSAGE, on: true }, source: window })); });
    expect(screen.getByLabelText('Artifact heading')).not.toHaveAttribute('contenteditable', 'true');
    await act(async () => { session!.send({ type: STORY_EDIT_MODE_MESSAGE, on: true }); });
    await waitFor(() => expect(screen.getByLabelText('Artifact heading')).toHaveAttribute('contenteditable', 'true'));
    const old = session!;
    const listener = vi.fn();
    old.subscribe(listener);
    view.unmount();
    expect(session).toBeNull();
    listener.mockClear();
    old.send({ type: STORY_EDIT_MODE_MESSAGE, on: true });
    old.update({ type: STORY_DOCUMENT_MESSAGE, nodes: data('Stale').nodes });
    expect(listener).not.toHaveBeenCalled();
    expect(document.querySelector('[aria-label="Artifact heading"]')).toBeNull();
  });
});
