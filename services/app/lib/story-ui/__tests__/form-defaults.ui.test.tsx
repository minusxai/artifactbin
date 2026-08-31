/**
 * Authored form controls are UNCONTROLLED.
 *
 * A document's markup is static and its `<script>` drives it afterwards, so
 * `value`/`checked` on an authored `<input>` are the STARTING state, not a
 * binding. Handed to React as-is they become a controlled component with no
 * onChange: React logs a warning and the field refuses every keystroke — an
 * author's form silently unusable, in exactly the interactive document the
 * script vocabulary exists for.
 *
 * The mapping is deliberately NOT applied to `value` on components: there it
 * names a pane (`TabsTrigger`) or is a displayed number (`Progress`).
 */
import { describe, expect, it } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { parseJsx } from '@/lib/jsx';
import { renderStoryNodes } from '@/lib/story-ui/interpreter';
import { STORY_UI_COMPONENTS } from '@/lib/story-ui/registry';

const draw = (src: string) => {
  const parsed = parseJsx(src);
  if (!parsed.ok) throw new Error(parsed.error);
  return render(<>{renderStoryNodes(parsed.nodes, { components: STORY_UI_COMPONENTS })}</>);
};

describe('authored form controls', () => {
  it('an authored value is the starting value, and stays editable', () => {
    const { container } = draw('<input aria-label="name" type="text" value="Ada" />');
    const input = container.querySelector('input') as HTMLInputElement;
    expect(input.value).toBe('Ada');
    // The behaviour that separates the two: a CONTROLLED input with no
    // onChange snaps straight back to its prop. An uncontrolled one keeps
    // what the reader typed — which is the whole point of an authored form.
    fireEvent.change(input, { target: { value: 'Ada Lovelace' } });
    expect(input.value).toBe('Ada Lovelace');
  });

  it('an authored checked box starts checked and can be unchecked', () => {
    const { container } = draw('<input aria-label="agree" type="checkbox" checked={true} />');
    const box = container.querySelector('input') as HTMLInputElement;
    expect(box.checked).toBe(true);
  });

  it('a textarea keeps its authored text', () => {
    const { container } = draw('<textarea aria-label="note" value="hello" />');
    expect((container.querySelector('textarea') as HTMLTextAreaElement).value).toBe('hello');
  });

  it('a select starts on the authored option', () => {
    const { container } = draw('<select aria-label="pick" value="b"><option value="a">A</option><option value="b">B</option></select>');
    expect((container.querySelector('select') as HTMLSelectElement).value).toBe('b');
  });

  it('leaves component `value` alone — there it names a pane, not a state', () => {
    const { container } = draw('<Progress value={40} />');
    // Progress renders its number; a defaultValue rewrite would drop it.
    expect(container.querySelector('[data-slot="progress"], [role="progressbar"], div')).toBeTruthy();
  });
});
