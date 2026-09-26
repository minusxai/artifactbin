/**
 * `<Input>` and `<Textarea>` — the kit's TEXT controls, live.
 *
 * The form an agent actually wrote for "add an expense" put two bare
 * `<input>`s beside a `<DatePicker>` and a `<Button>`, because the kit had no
 * text box to reach for. These are that box: bound two-way to a scalar
 * `<Value>` through the same store path as every other control, typed on the
 * way in (a `number` Value gets a number), submitting the enclosing `run=`
 * form on Enter exactly as a bare input does — they ARE native inputs, inside
 * the kit's frame — and cleared by `<Mutation reset>` once a write commits.
 */
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { compiledSource } from '@/test/helpers/compiled';
import type { MutationRequest } from '@/lib/story/mutation-request';
import { fireEvent, render, waitFor } from '@testing-library/react';
import { type JsxNode } from '@/lib/jsx';
import { splitHelmet } from '@/lib/story/helmet';
import { StoryRuntimeApp } from '../StoryRuntimeApp';
import { createDataflowStore, type QueryTransport } from '../store';
import type { DataflowState } from '@/lib/story/dataflow';
import { parseJsxOrThrow } from '@/test/helpers/jsx';

const HELMET =
  '<Helmet>'
  + '<Value name="item" type="string" url={false} />'
  + '<Value name="amount" type="number" url={false} />'
  + '<Value name="note" type="string" default="" url={false} />'
  + '<Import name="expenses" src="ref:abc123" />'
  + '<Query name="tab">{`select item, amount from expenses.rows`}</Query>'
  + '<Mutation name="add" reset="item amount note">{`'
  + 'insert into expenses.rows (item, amount) values ($item, $amount)`}</Mutation>'
  + '</Helmet>';
const FLOW = await compiledSource(HELMET, { abc123: [{ name: 'item', type: 'string' }, { name: 'amount', type: 'number' }] });

const STATE: DataflowState = {
  values: { item: null, amount: null, note: '' },
  tables: { tab: { rows: [], columns: [] } },
  errors: {},
  mutationAccess: { add: null },
};

function build(body: string) {
  const parsed = parseJsxOrThrow(HELMET + body);
  const { body: nodes } = splitHelmet(parsed.nodes as JsxNode[]);
  return { nodes, dataflow: { flow: FLOW, state: STATE } };
}

function storeFor(dataflow: ReturnType<typeof build>['dataflow'], mutate?: QueryTransport['mutate']) {
  const transport: QueryTransport = {
    run: () => Promise.resolve({ tables: {}, errors: {}, mutationAccess: { add: null } }),
    page: () => Promise.reject(new Error('unused')),
    ...(mutate ? { mutate } : {}),
  };
  return createDataflowStore(dataflow, { transport, debounceMs: 0 });
}

const FORM =
  '<div>'
  + '<Input label="What it was for" value="$item" placeholder="Dinner" />'
  + '<Input label="Amount" type="number" value="$amount" min={0} />'
  + '<Textarea label="Note" value="$note" rows={3} />'
  + '<Button run="$add">Add expense</Button>'
  + '</div>';

describe('the live text controls', () => {
  it('renders from the store — a number field is a spinbutton — and typing writes the bound Value typed', () => {
    const { nodes, dataflow } = build(FORM);
    const store = storeFor(dataflow);
    const { getByRole, getByLabelText, container } = render(
      <StoryRuntimeApp nodes={nodes} refData={{}} dataflow={dataflow} store={store} colorMode="light" chrome={true} />,
    );
    // A `type="number"` Input is a real number input: the platform's spinbutton
    // role, its keypad on a phone, its own validity.
    const amount = getByRole('spinbutton', { name: 'Amount' }) as HTMLInputElement;
    expect(amount.value).toBe(''); // a null Value is an empty box, not "null"
    const item = getByRole('textbox', { name: 'What it was for' }) as HTMLInputElement;
    expect(item.placeholder).toBe('Dinner');

    fireEvent.change(item, { target: { value: 'Dinner' } });
    expect(store.getValue('item')).toBe('Dinner');
    fireEvent.change(amount, { target: { value: '42.5' } });
    expect(store.getValue('amount')).toBe(42.5); // the Value's declared type, not "42.5"
    const note = getByLabelText('Note') as HTMLTextAreaElement;
    expect(note.tagName).toBe('TEXTAREA');
    fireEvent.change(note, { target: { value: 'split four ways' } });
    expect(store.getValue('note')).toBe('split four ways');
    // An emptied number box is null — which is how "$amount is null" reads in SQL.
    fireEvent.change(amount, { target: { value: '' } });
    expect(store.getValue('amount')).toBeNull();
    expect(container.innerHTML).not.toContain('$item');
    expect(container.innerHTML).not.toContain('$amount');
  });

  it('shows an external store write, the way every other control does', () => {
    const { nodes, dataflow } = build(FORM);
    const store = storeFor(dataflow);
    const { getByRole } = render(
      <StoryRuntimeApp nodes={nodes} refData={{}} dataflow={dataflow} store={store} colorMode="light" chrome={true} />,
    );
    fireEvent.change(getByRole('spinbutton', { name: 'Amount' }), { target: { value: '12' } });
    expect((getByRole('spinbutton', { name: 'Amount' }) as HTMLInputElement).value).toBe('12');
  });

  /**
   * `<Mutation reset="item amount note">` clears the form once the write has
   * COMMITTED — the box empties itself for the next entry. The control is
   * bound, so it has nothing of its own to clear: it shows the store, and the
   * store went back to the declared defaults.
   */
  it('is cleared by a Mutation reset on success, and keeps what was typed when the write is refused', async () => {
    const mutate = vi.fn(async () => ({ dataset: 'abc123' }));
    const { nodes, dataflow } = build(FORM);
    const store = storeFor(dataflow, mutate);
    const { getByRole, getByLabelText } = render(
      <StoryRuntimeApp nodes={nodes} refData={{}} dataflow={dataflow} store={store} colorMode="light" chrome={true} />,
    );
    fireEvent.change(getByRole('textbox', { name: 'What it was for' }), { target: { value: 'Dinner' } });
    fireEvent.change(getByRole('spinbutton', { name: 'Amount' }), { target: { value: '42' } });
    fireEvent.change(getByLabelText('Note'), { target: { value: 'split four ways' } });
    fireEvent.click(getByRole('button', { name: 'Add expense' }));
    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
    await waitFor(() => expect((getByRole('textbox', { name: 'What it was for' }) as HTMLInputElement).value).toBe(''));
    expect((getByRole('spinbutton', { name: 'Amount' }) as HTMLInputElement).value).toBe('');
    expect((getByLabelText('Note') as HTMLTextAreaElement).value).toBe('');

    // A refused write changes nothing the person typed.
    mutate.mockRejectedValueOnce(new Error('this dataset is not open for writes'));
    fireEvent.change(getByRole('textbox', { name: 'What it was for' }), { target: { value: 'Taxi' } });
    fireEvent.click(getByRole('button', { name: 'Add expense' }));
    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(2));
    expect((getByRole('textbox', { name: 'What it was for' }) as HTMLInputElement).value).toBe('Taxi');
  });
});

/**
 * A text box and a slider are CONTINUOUS: the reader is mid-gesture, and a
 * query per keystroke is a query nobody reads. They wait for a pause. A
 * select is one decision, and its queries run the moment it is made.
 */
describe('when a bound control re-runs what it feeds', () => {
  const SEARCH =
    '<Helmet>'
    + '<Value name="q" type="string" url={false} />'
    + '<Value name="size" type="string" default="s" url={false} />'
    + '<Query name="hits">{`select $q as q, $size as size`}</Query>'
    + '</Helmet>'
    + '<div><Input label="Search" value="$q" />'
    + '<select aria-label="Size" value="$size"><option value="s">S</option><option value="l">L</option></select></div>';

  it('typing waits for the debounce; a select runs at once', async () => {
    const flow = await compiledSource(SEARCH);
    vi.useFakeTimers();
    try {
      const parsed = parseJsxOrThrow(SEARCH);
      const { body: nodes } = splitHelmet(parsed.nodes as JsxNode[]);
      const dataflow = {
        flow,
        state: { values: { q: null, size: 's' }, tables: { hits: { rows: [], columns: [] } }, errors: {} },
      };
      const run = vi.fn<QueryTransport['run']>(() => new Promise(() => {}));
      const store = createDataflowStore(dataflow, { transport: { run, page: () => Promise.reject(new Error('unused')) }, debounceMs: 150 });
      const { getByRole } = render(
        <StoryRuntimeApp nodes={nodes} refData={{}} dataflow={dataflow} store={store} colorMode="light" chrome={true} />,
      );
      fireEvent.change(getByRole('textbox', { name: 'Search' }), { target: { value: 'ab' } });
      expect(run).not.toHaveBeenCalled();
      vi.advanceTimersByTime(150);
      expect(run).toHaveBeenCalledTimes(1);
      expect(run.mock.calls[0]![0]).toMatchObject({ q: 'ab' });
      fireEvent.change(getByRole('combobox', { name: 'Size' }), { target: { value: 'l' } });
      expect(run).toHaveBeenCalledTimes(2);
      expect(run.mock.calls[1]![0]).toMatchObject({ size: 'l' });
    } finally { vi.useRealTimers(); }
  });
});

describe('inside a `run=` form', () => {
  beforeEach(() => {
    HTMLDialogElement.prototype.show = function () { this.open = true; };
    HTMLDialogElement.prototype.showModal = function () { this.open = true; };
    HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new Event('close')); };
  });

  const DIALOG =
    '<Dialog open>'
    + '<DialogTrigger>Add</DialogTrigger>'
    + '<DialogContent aria-label="Add an expense" run="$add">'
    + '<Input label="What it was for" value="$item" required />'
    + '<button type="submit">Save</button>'
    + '</DialogContent></Dialog>';

  /**
   * Enter in a text field submits its form — the browser's own implicit
   * submission, which needs the field to BE a form control inside that form.
   * jsdom does not implement implicit submission, so what is asserted here is
   * exactly the condition it depends on (the field's form is the Mutation's
   * form), plus the submission itself running the write.
   */
  it('submits the enclosing form — the field belongs to it, and the submit runs the Mutation', async () => {
    const writes: MutationRequest[] = [];
    const mutate = vi.fn(async (request: MutationRequest) => { writes.push(request); return { dataset: 'abc123' }; });
    const { nodes, dataflow } = build(DIALOG);
    const store = storeFor(dataflow, mutate);
    const { getByRole } = render(
      <StoryRuntimeApp nodes={nodes} refData={{}} dataflow={dataflow} store={store} colorMode="light" chrome={true} />,
    );
    const field = getByRole('textbox', { name: 'What it was for' }) as HTMLInputElement;
    expect(field.required).toBe(true);
    const form = getByRole('dialog').querySelector('form');
    expect(form).not.toBeNull();
    expect(field.form).toBe(form); // the Enter key's target, in the browser
    fireEvent.change(field, { target: { value: 'Dinner' } });
    fireEvent.submit(form!);
    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
    expect(writes[0]).toMatchObject({ mutation: 'add', args: { item: 'Dinner' } });
  });
});
