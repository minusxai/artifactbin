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
import { parseJsx, type JsxNode } from '@/lib/jsx';
import { renderStoryNodes } from '../interpreter';
import { STORY_UI_COMPONENTS } from '../registry';

function staticRender(src: string) {
  const parsed = parseJsx(src);
  if (!parsed.ok) throw new Error(parsed.error);
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

  it('unbound (literal) props still render the control usably static', () => {
    // An author previewing chrome without a binding gets the same look.
    const { getByLabelText } = staticRender('<Segmented label="Grain" options={["day","week"]} />');
    expect([...getByLabelText('Grain').querySelectorAll('button')].map((b) => b.textContent)).toEqual(['day', 'week']);
  });
});
