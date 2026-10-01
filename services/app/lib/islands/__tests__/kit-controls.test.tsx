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
import { parityOf, reactRender, shapeOf } from './kit-parity';
import { RECIPES as controlsRecipes } from '../kit/recipes/controls';
import { RECIPES as peopleRecipes } from '../kit/recipes/people';
import { RECIPES as filesRecipes } from '../kit/recipes/files';
import { RECIPES as mermaidRecipes } from '../kit/recipes/mermaid';
import { IslandProvider } from '../context';
import { fakeIsland } from './context.test';
import { Input, Textarea, Segmented, Slider, Switch, DatePicker, BoundNative } from '../kit/controls';
import { User, UserHandle, SignIn } from '../kit/people';
import { Files } from '../kit/files';
import { Mermaid } from '../kit/mermaid';

const mount = (island = fakeIsland(), view: () => import('solid-js').JSX.Element) => { const host = document.createElement('div'); const dispose = render(() => <IslandProvider value={island}>{view()}</IslandProvider>, host); return { host, dispose }; };

describe('controls', () => {
  // The compiled page runs the LIVE controls, so its reference is the runtime's live face (kit-controls-live.test.tsx,
  // byte for byte). Against the registry's STATIC face below, exactly the two differences between the faces remain:
  // the static face stamps its bindings (`data-mx-bound`) and marks a writer-less field read-only.
  it('Input, Textarea, Segmented, Slider, Switch and DatePicker match today\'s static face except where the live face differs', () => {
    const { host } = mount(undefined, () => <>
      <Input label="Name" placeholder="Your name" value="$name" id="in" />
      <Textarea label="Notes" rows={3} value="$notes" id="ta" />
      <Segmented label="Size" value="$size" options={['S', 'M', 'L']} id="seg" />
      <Slider label="Amount" value="$amount" min={0} max={10} step={1} id="sl" />
      <Switch label="On" checked="$on" id="sw" />
      <DatePicker label="When" value="$when" id="dp" />
    </>);
    expect(parityOf('<Input label="Name" placeholder="Your name" value="$name" id="in" /><Textarea label="Notes" rows={3} value="$notes" id="ta" /><Segmented label="Size" value="$size" options={["S","M","L"]} id="seg" /><Slider label="Amount" value="$amount" min={0} max={10} step={1} id="sl" /><Switch label="On" checked="$on" id="sw" /><DatePicker label="When" value="$when" id="dp" />', host)).toEqual([
      '/0<div> @data-mx-bound: "value:$name" vs undefined', '/0<div>/1<input> @readonly: "" vs undefined',
      '/1<div> @data-mx-bound: "value:$notes" vs undefined', '/1<div>/1<textarea> @readonly: "" vs undefined',
      '/2<div> @data-mx-bound: "value:$size" vs undefined',
      '/3<div> @data-mx-bound: "value:$amount" vs undefined', '/3<div>/1<input> @readonly: "" vs undefined',
      '/4<div> @data-mx-bound: "checked:$on" vs undefined',
      '/5<div> @data-mx-bound: "value:$when" vs undefined',
    ]);
  });

  it('a control writes its value through the island, debounced for typing and at once for a switch', () => {
    const island = fakeIsland({ name: 'x', on: 'false' });
    island.setValue = vi.fn();
    const { host } = mount(island, () => <><Input label="Name" value="$name" id="in" /><Switch label="On" checked="$on" id="sw" /></>);
    const input = host.querySelector('input#in, #in input') as HTMLInputElement;
    input.value = 'Ada'; input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(island.setValue).toHaveBeenCalledWith('name', 'Ada', { debounce: true });
    (host.querySelector('[role="switch"]') as HTMLButtonElement).click();
    expect(island.setValue).toHaveBeenCalledWith('on', true, undefined);
  });

  it('Segmented writes chosen values immediately', () => {
    const island = fakeIsland({ size: 'S' }); island.setValue = vi.fn();
    const { host, dispose } = mount(island, () => <Segmented label="Size" value="$size" options={['S','M']} />);
    ([...host.querySelectorAll('[role="group"] button')].find(x => x.textContent === 'M') as HTMLButtonElement).click();
    expect(island.setValue).toHaveBeenCalledWith('size', 'M', undefined);
    dispose();
  });

  it('DatePicker opens a calendar', () => {
    const island = fakeIsland({ when: '2026-09-28' }); island.setValue = vi.fn();
    const { host, dispose } = mount(island, () => <DatePicker label="When" value="$when" />);
    (host.querySelector('[aria-haspopup="dialog"]') as HTMLButtonElement).click();
    const date = document.querySelector('[role="dialog"] [aria-label="2026-09-29"]') as HTMLButtonElement;
    expect(date).toBeTruthy(); date.click();
    expect(island.setValue).toHaveBeenCalledWith('when', '2026-09-29', undefined);
    dispose();
  });

  it('DatePicker closes on an outside pointer and Escape', () => {
    const { host, dispose } = mount(fakeIsland({ when: '2026-09-28' }), () => <DatePicker label="When" value="$when" />);
    document.body.append(host);
    try {
      const trigger = host.querySelector<HTMLButtonElement>('[aria-haspopup="dialog"]')!;
      trigger.click();
      expect(trigger.getAttribute('aria-expanded')).toBe('true');
      document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      expect(trigger.getAttribute('aria-expanded')).toBe('false');
      expect(document.activeElement).toBe(trigger);
      trigger.click();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      expect(trigger.getAttribute('aria-expanded')).toBe('false');
    } finally { dispose(); host.remove(); }
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
  it('resolved people render their public card and SignIn returns to the current address', () => {
    const previous = window.location.pathname + window.location.search + window.location.hash;
    window.history.replaceState({}, '', '/a/doc?region=West#detail');
    try {
      const island = fakeIsland(); island.people = () => ({ usr_ada: { id: 'usr_ada', name: 'Ada', handle: 'ada', image: null } as never });
      const { host } = mount(island, () => <><User userId="usr_ada" /><SignIn /></>);
      expect(host.textContent).toContain('@ada');
      expect(host.querySelector('a[data-slot="sign-in"]')?.getAttribute('href')).toBe('/login?callbackUrl=%2Fa%2Fdoc%3Fregion%3DWest%23detail');
    } finally { window.history.replaceState({}, '', previous); }
  });
  it('Files renders the file cards of its table', () => {
    const island = fakeIsland();
    island.table = () => ({ rows: [{ name: 'paper.pdf', size: 1234, url: '/a/x/raw' }], columns: [{ name: 'name', type: 'string' }, { name: 'size', type: 'number' }, { name: 'url', type: 'string' }] });
    const { host } = mount(island, () => <Files data="$files" id="f" />);
    expect(host.textContent).toContain('paper.pdf');
  });
});

describe('mermaid', () => {
  // A stored drawing is a StoredMermaidImage (story-runtime/contract: an image `src`, never inline SVG), shown as
  // the retired React Mermaid shows it: an <img>, `ready` once it has loaded (kit-mermaid.test.tsx holds the full parity).
  it('draws from the stored drawing when one exists and marks itself ready once it loads, without loading the engine', () => {
    const island = fakeIsland();
    island.drawings = () => ({ 'k:light': { src: '/assets/mermaid/k.svg', type: 'flowchart-v2', width: 100, height: 50, palette: 'p' } });
    const { host } = mount(island, () => <Mermaid code="graph TD; A-->B" colorMode="light" imageKey="k:light" id="m" />);
    const img = host.querySelector('figure img[src="/assets/mermaid/k.svg"]');
    expect(img).toBeTruthy();
    img!.dispatchEvent(new Event('load'));
    expect(host.querySelector('figure')?.getAttribute('data-mx-mermaid-state')).toBe('ready');
  });
});


describe('class recipes', () => {
  const cases: [string, Record<string, (p: Record<string, unknown>) => string>, string, Record<string, unknown>][] = [
    ['Input', controlsRecipes, '<Input />', {}],
    ['Textarea', controlsRecipes, '<Textarea />', {}],
    ['Slider', controlsRecipes, '<Slider />', {}],
    ['Switch', controlsRecipes, '<Switch />', {}],
    ['DatePicker', controlsRecipes, '<DatePicker />', {}],
    ['Segmented', controlsRecipes, '<Segmented options={["S","M"]} />', { options: ['S','M'] }],
    ['User', peopleRecipes, '<User userId="u1" />', { userId: 'u1' }],
    ['UserHandle', peopleRecipes, '<UserHandle userId="u1" />', { userId: 'u1' }],
    ['UserImage', peopleRecipes, '<UserImage userId="u1" />', { userId: 'u1' }],
    ['SignIn', peopleRecipes, '<SignIn />', {}],
    ['Files', filesRecipes, '<Files />', {}],
    ['Mermaid', mermaidRecipes, '<Mermaid code="graph TD; A--\x3eB" />', { code: 'graph TD; A-->B' }],
  ];
  const variants: [string, Record<string, (p: Record<string, unknown>) => string>, string, Record<string, unknown>][] = [
    ['Input number', controlsRecipes, '<Input type="number" />', { type: 'number' }],
    ['User fallback', peopleRecipes, '<User fallback="Nobody" />', { fallback: 'Nobody' }],
    ['UserImage large', peopleRecipes, '<UserImage userId="u1" size="lg" />', { userId: 'u1', size: 'lg' }],
    ['Files tiles', filesRecipes, '<Files variant="tiles" />', { variant: 'tiles' }],
    ['Mermaid dark', mermaidRecipes, '<Mermaid code="graph TD; A--\x3eB" colorMode="dark" />', { code: 'graph TD; A-->B', colorMode: 'dark' }],
  ];
  for (const [label, recipes, markup, props] of [...cases, ...variants]) {
    const tag = label.split(' ')[0];
    it(`${tag} root recipe matches today's default and authored class`, () => {
      const rendered = shapeOf(reactRender(markup))[0];
      expect(recipes[tag]?.(props).split(/\s+/).sort().join(' ')).toBe(rendered?.attrs.class);
      const authored = markup.replace(' />', ' className="text-red-500" />');
      expect(recipes[tag]?.({ ...props, className: 'text-red-500' }).split(/\s+/).sort().join(' '))
        .toBe(shapeOf(reactRender(authored))[0]?.attrs.class);
    });
  }
});
