/* @jsxImportSource solid-js */
// DESTINATION: services/app/lib/islands/__tests__/kit-controls.test.tsx
/**
 * THE CONTROLS, PEOPLE, FILES AND MERMAID KIT (lib/islands/kit: controls, people, files, mermaid) —
 * the same DOM as today's kit (`parityOf`, the unit-level parity gate), bound to the island's data:
 * a control writes its `<Value>` through the context, a `$`-bound native field the same, a person
 * draws from the resolved cards, a diagram from the stored drawings.
 */
import { describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import { parityOf } from './kit-parity';
import { IslandProvider } from '../context';
import { fakeIsland } from './context.test';
import { Input, Textarea, Segmented, Slider, Switch, DatePicker, BoundNative } from '../kit/controls';
import { User, UserHandle, SignIn } from '../kit/people';
import { Files } from '../kit/files';
import { Mermaid } from '../kit/mermaid';

const mount = (island = fakeIsland(), view: () => import('solid-js').JSX.Element) => { const host = document.createElement('div'); const dispose = render(() => <IslandProvider value={island}>{view()}</IslandProvider>, host); return { host, dispose }; };

describe('controls', () => {
  it('Input, Textarea, Segmented, Slider, Switch and DatePicker match today\'s render', () => {
    const { host } = mount(undefined, () => <>
      <Input label="Name" placeholder="Your name" value="$name" id="in" />
      <Textarea label="Notes" rows={3} value="$notes" id="ta" />
      <Segmented label="Size" value="$size" options={['S', 'M', 'L']} id="seg" />
      <Slider label="Amount" value="$amount" min={0} max={10} step={1} id="sl" />
      <Switch label="On" checked="$on" id="sw" />
      <DatePicker label="When" value="$when" id="dp" />
    </>);
    expect(parityOf('<Input label="Name" placeholder="Your name" value="$name" id="in" /><Textarea label="Notes" rows={3} value="$notes" id="ta" /><Segmented label="Size" value="$size" options={["S","M","L"]} id="seg" /><Slider label="Amount" value="$amount" min={0} max={10} step={1} id="sl" /><Switch label="On" checked="$on" id="sw" /><DatePicker label="When" value="$when" id="dp" />', host)).toEqual([]);
  });

  it('a control writes its value through the island, debounced for typing and at once for a switch', () => {
    const island = fakeIsland({ name: 'x', on: 'false' });
    island.setValue = vi.fn();
    const { host } = mount(island, () => <><Input label="Name" value="$name" id="in" /><Switch label="On" checked="$on" id="sw" /></>);
    const input = host.querySelector('input#in, #in input') as HTMLInputElement;
    input.value = 'Ada'; input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(island.setValue).toHaveBeenCalledWith('name', 'Ada', expect.objectContaining({ debounce: expect.any(Number) }));
    (host.querySelector('[role="switch"]') as HTMLButtonElement).click();
    expect(island.setValue).toHaveBeenCalledWith('on', true, undefined);
  });

  it('a $-bound native field reads and writes the value', () => {
    const island = fakeIsland({ region: 'West' });
    island.setValue = vi.fn();
    const { host } = mount(island, () => <BoundNative tag="select" bind={{ value: 'region' }} id="sel"><option value="East">East</option><option value="West">West</option></BoundNative>);
    const select = host.querySelector('select') as HTMLSelectElement;
    expect(select.value).toBe('West');
    select.value = 'East'; select.dispatchEvent(new Event('change', { bubbles: true }));
    expect(island.setValue).toHaveBeenCalledWith('region', 'East', undefined);
  });
});

describe('people and files', () => {
  it('User, UserHandle and SignIn match today\'s render for a guest and a known person', () => {
    const island = fakeIsland();
    island.people = () => ({ u1: { id: 'u1', name: 'Ada', handle: 'ada', image: null } as never });
    const { host } = mount(island, () => <><User userId="u1" id="u" /><UserHandle userId="u1" id="h" /><SignIn id="s" /></>);
    expect(parityOf('<User userId="u1" id="u" /><UserHandle userId="u1" id="h" /><SignIn id="s" />', host).filter((d) => !/@href/.test(d))).toEqual([]);
  });
  it('Files renders the file cards of its table', () => {
    const island = fakeIsland();
    island.table = () => ({ rows: [{ name: 'paper.pdf', size: 1234, url: '/a/x/raw' }], columns: [{ name: 'name', type: 'string' }, { name: 'size', type: 'number' }, { name: 'url', type: 'string' }] });
    const { host } = mount(island, () => <Files data="$files" id="f" />);
    expect(host.textContent).toContain('paper.pdf');
  });
});

describe('mermaid', () => {
  it('draws from the stored drawing when one exists and marks itself ready without loading the engine', () => {
    const island = fakeIsland();
    island.drawings = () => ({ 'k:light': { svg: '<svg data-stored="1"></svg>', width: 100, height: 50 } as never });
    const { host } = mount(island, () => <Mermaid code="graph TD; A-->B" colorMode="light" imageKey="k:light" id="m" />);
    expect(host.querySelector('[data-mx-mermaid-state="ready"] svg[data-stored]')).toBeTruthy();
  });
});
