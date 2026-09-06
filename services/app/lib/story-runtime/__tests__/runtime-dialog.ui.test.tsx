import React from 'react';
import {expect, it, vi, beforeEach} from 'vitest';
import {render, fireEvent, waitFor} from '@testing-library/react';
import {parseJsx} from '@/lib/jsx';
import {splitHelmet} from '@/lib/story/helmet';
import {initialValues, initialTables} from '@/lib/story/dataflow';
import {StoryRuntimeApp} from '../StoryRuntimeApp';
import {createDataflowStore} from '../store';

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {this.open = true;};
  HTMLDialogElement.prototype.close = function () {this.open = false; this.dispatchEvent(new Event('close'));};
});

it('binds dialog state two ways and submits with current signals through the existing mutation transport', async () => {
  const parsed = parseJsx('<Helmet><Value name="editing" type="boolean" default={false} /><Value name="title" type="string" default="First" /><Mutation name="save">{`insert into ref_abc123 (title) values ($title)`}</Mutation></Helmet><Dialog open="$editing"><DialogTrigger>Open</DialogTrigger><DialogContent run="$save" aria-label="Editor"><input aria-label="Title" value="$title" required /><button type="submit">Save</button><DialogClose>Cancel</DialogClose></DialogContent></Dialog>{$editing && <p>Editing</p>}');
  if (!parsed.ok) throw new Error(parsed.error);
  const {content, body: nodes} = splitHelmet(parsed.nodes);
  const flow = {values: content.values, queries: content.queries, mutations: content.mutations};
  const state = {values: initialValues(flow), tables: initialTables(flow), errors: {}, mutationAccess: {save: null}};
  const mutate = vi.fn(async () => ({dataset: 'abc123'}));
  const store = createDataflowStore({flow, state}, {transport: {run: async () => ({tables: {}, errors: {}, mutationAccess: {save:null}}), page: async () => ({rows:[],columns:[]}), mutate}, debounceMs: 0});
  const view = render(<StoryRuntimeApp nodes={nodes} refData={{}} dataflow={{flow,state}} colorMode="light" chrome={true} store={store} />);
  fireEvent.click(view.getByText('Open'));
  expect(store.getValue('editing')).toBe(true);
  expect(view.getByText('Editing')).toBeVisible();
  fireEvent.change(view.getByLabelText('Title'), {target: {value: 'Updated'}});
  fireEvent.submit(view.getByRole('dialog').querySelector('form')!);
  await waitFor(() => expect(store.getValue('editing')).toBe(false));
  expect(mutate).toHaveBeenCalledWith(expect.objectContaining({title:'Updated'}), 'save');
  expect(view.queryByText('Editing')).toBeNull();
});
