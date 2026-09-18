/**
 * The kit control components rendered STATIC — the edit canvas, the crawler
 * copy and the deck-rail previews use the bare registry, where no store
 * exists: the control must look right, be disabled (no pretence of working),
 * carry its bindings as a `data-mx-bound` stamp for the write-back, and never
 * leak a `$name` into the DOM. Same semantics as StaticBoundControl for the
 * native tags.
 */
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { type JsxNode, validateJsxSource } from '@/lib/jsx';
import { JSX_STORY_COMPONENT_NAMES } from '@/lib/jsx/components';
import { STORY_HTML_TAGS } from '../component-names';
import { renderStoryNodes } from '../interpreter';
import { STORY_UI_COMPONENTS } from '../registry';
import { parseJsxOrThrow } from '@/test/helpers/jsx';

function staticRender(src: string) {
  const parsed = parseJsxOrThrow(src);
  return render(<>{renderStoryNodes(parsed.nodes as JsxNode[], { components: STORY_UI_COMPONENTS })}</>);
}

describe('kit controls — static rendering (no store)', () => {
  it('a bound Select renders a disabled trigger with its label, stamped with the binding', () => {
    const { container, getByLabelText } = staticRender(
      '<Select label="Region" value="$region" options="$regions" placeholder="All regions" />',
    );
    const trigger = getByLabelText('Region') as HTMLButtonElement;
    expect(trigger.disabled).toBe(true);
    // The binding survives ONLY as the write-back stamp — never as a value
    // the control pretends to hold, never as visible text.
    expect(trigger.textContent).not.toContain('$');
    expect(container.innerHTML).not.toContain('value="$');
    const stamped = container.querySelector('[data-mx-bound]') as HTMLElement;
    expect(stamped.getAttribute('data-mx-bound')).toBe('value:$region options:$regions');
  });

  it('Slider, DatePicker, Segmented and Switch all render disabled with no $ leakage', () => {
    const { container, getByLabelText } = staticRender(
      '<div>' +
      '<Slider label="Min" value="$min_rev" min={0} max={100} />' +
      '<DatePicker label="Since" value="$since" />' +
      '<Segmented label="Grain" value="$grain" options={["day","week"]} />' +
      '<Switch label="Compare" checked="$flag" />' +
      '</div>',
    );
    expect((getByLabelText('Min') as HTMLInputElement).disabled).toBe(true);
    expect((getByLabelText('Since') as HTMLInputElement).disabled).toBe(true);
    const segments = [...getByLabelText('Grain').querySelectorAll('button')];
    expect(segments.length).toBeGreaterThan(0);
    expect(segments.every((b) => b.disabled)).toBe(true);
    expect((getByLabelText('Compare') as HTMLButtonElement).disabled).toBe(true);
    // Bindings live in stamps only — no control holds a `$name` as its value
    // and none shows one to the reader.
    expect(container.innerHTML).not.toContain('value="$');
    expect(container.textContent).not.toContain('$');
    expect([...container.querySelectorAll('[data-mx-bound]')].map((n) => n.getAttribute('data-mx-bound')))
      .toEqual(['value:$min_rev', 'value:$since', 'value:$grain', 'checked:$flag']);
  });

  /**
   * THE MISSING CONTROL. The kit had no text box, so an "add expense" form was
   * written `<input placeholder="What was it for?" value="$item" />` beside a
   * `<DatePicker>` — and Tailwind's preflight strips a bare input's border and
   * padding, so two fields rendered as floating placeholder text next to a
   * fully framed one. `<Input>`/`<Textarea>` are that missing member of the
   * family, and the frame they wear has to be the SAME frame.
   */
  it('Input and Textarea render disabled, labelled, stamped, with no $ leakage', () => {
    const { container, getByLabelText } = staticRender(
      '<div>'
      + '<Input label="What it was for" value="$item" placeholder="Dinner" />'
      + '<Input label="Amount" type="number" value="$amount" min={0} step={0.01} />'
      + '<Textarea label="Note" value="$note" rows={4} />'
      + '</div>',
    );
    const item = getByLabelText('What it was for') as HTMLInputElement;
    expect(item.tagName).toBe('INPUT');
    expect(item.type).toBe('text');
    expect(item.placeholder).toBe('Dinner');
    expect(item.disabled).toBe(true);
    const amount = getByLabelText('Amount') as HTMLInputElement;
    expect(amount.type).toBe('number');
    expect(amount.getAttribute('min')).toBe('0');
    expect(amount.getAttribute('step')).toBe('0.01');
    const note = getByLabelText('Note') as HTMLTextAreaElement;
    expect(note.tagName).toBe('TEXTAREA');
    expect(note.rows).toBe(4);
    expect(note.disabled).toBe(true);
    // The label is VISIBLE too — the micro-label every control shell draws.
    expect(container.textContent).toContain('Amount');
    expect(container.innerHTML).not.toContain('value="$');
    expect(container.textContent).not.toContain('$');
    expect([...container.querySelectorAll('[data-mx-bound]')].map((n) => n.getAttribute('data-mx-bound')))
      .toEqual(['value:$item', 'value:$amount', 'value:$note']);
  });

  it('wears the same frame as DatePicker — one visual family, not two', () => {
    const { getByLabelText } = staticRender(
      '<div><Input label="Item" value="$item" /><Textarea label="Note" value="$note" /><DatePicker label="Spent on" value="$spent_on" /></div>',
    );
    const classesOf = (el: Element) => new Set((el.getAttribute('class') ?? '').split(/\s+/));
    const date = classesOf(getByLabelText('Spent on'));
    // The frame tokens the date field draws: height, padding, radius, border,
    // surface, type scale, shadow and the focus ring.
    const frame = ['h-9', 'px-3', 'rounded-md', 'border', 'border-input', 'bg-background', 'text-sm', 'shadow-xs', 'focus-visible:ring-2', 'focus-visible:ring-ring/50'];
    for (const token of frame) expect(date, `DatePicker lost ${token}`).toContain(token);
    const input = classesOf(getByLabelText('Item'));
    for (const token of frame) expect(input, `Input lost ${token}`).toContain(token);
    // A textarea is taller by nature, so it shares everything but the height.
    const note = classesOf(getByLabelText('Note'));
    for (const token of frame.filter((t) => t !== 'h-9')) expect(note, `Textarea lost ${token}`).toContain(token);
    // Both sit inside the shell every other control uses.
    expect(getByLabelText('Item').closest('.mx-control')).not.toBeNull();
    expect(getByLabelText('Note').closest('.mx-control')).not.toBeNull();
  });

  it('takes its accessible name from aria-label when there is no visible label', () => {
    const { getByLabelText, container } = staticRender('<Input aria-label="Amount" type="number" value="$amount" />');
    expect((getByLabelText('Amount') as HTMLInputElement).type).toBe('number');
    // The name belongs to the FIELD, not to the shell around it — two elements
    // answering to one name is an ambiguous control.
    expect(container.querySelectorAll('[aria-label="Amount"]').length).toBe(1);
  });

  it('is admitted by the publish gate, and drops handlers and denied props like every other component', () => {
    expect(validateJsxSource(
      '<div><Input label="Item" value="$item" required autoFocus /><Textarea label="Note" value="$note" rows={3} /></div>',
      JSX_STORY_COMPONENT_NAMES, STORY_HTML_TAGS, 'no-inline-style',
    )).toEqual([]);
    const { getByLabelText, container } = staticRender('<Input label="Item" value="$item" onChange="steal()" ref="x" run="$add" required />');
    const field = getByLabelText('Item') as HTMLInputElement;
    expect(field.getAttribute('onchange')).toBeNull();
    expect(field.getAttribute('ref')).toBeNull();
    expect(field.required).toBe(true);
    // `run=` is the Button's trigger, not a text field's: Enter reaches a form
    // through the real input inside, so the attribute has nothing to do here —
    // and a `$name` must never reach the DOM, on the field or on the shell.
    expect(container.innerHTML).not.toContain('$add');
    expect(container.innerHTML).not.toContain('run=');
  });

  it('unbound (literal) props still render the control usably static', () => {
    // An author previewing chrome without a binding gets the same look.
    const { getByLabelText } = staticRender('<Segmented label="Grain" options={["day","week"]} />');
    expect([...getByLabelText('Grain').querySelectorAll('button')].map((b) => b.textContent)).toEqual(['day', 'week']);
  });
});
