/* @jsxImportSource solid-js */
// DESTINATION: services/app/lib/islands/__tests__/kit-controls.test.tsx
/**
 * THE CONTROLS, PEOPLE, FILES AND MERMAID KIT (lib/islands/kit: controls, people, files, mermaid) —
 * labelled, accessible fields bound to the island's data:
 * a control writes its `<Value>` through the context, a `$`-bound native field the same, a person
 * draws from the resolved cards, a diagram from the stored drawings.
 */
import { describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import { RECIPES as controlsRecipes } from '../kit/recipes/controls';
import { RECIPES as peopleRecipes, peopleClasses } from '../kit/recipes/people';
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
  // The live face (what a compiled page runs; kit-controls-live.test.tsx holds it byte for byte) stamps no
  // binding and leaves a bound field writable.
  it('Input, Textarea, Segmented, Slider, Switch and DatePicker render labelled, writable controls with no binding stamp', () => {
    const { host } = mount(undefined, () => <>
      <Input label="Name" placeholder="Your name" value="$name" id="in" />
      <Textarea label="Notes" rows={3} value="$notes" id="ta" />
      <Segmented label="Size" value="$size" options={['S', 'M', 'L']} id="seg" />
      <Slider label="Amount" value="$amount" min={0} max={10} step={1} id="sl" />
      <Switch label="On" checked="$on" id="sw" />
      <DatePicker label="When" value="$when" id="dp" />
    </>);
    expect([...host.children].map((root) => root.id)).toEqual(['in', 'ta', 'seg', 'sl', 'sw', 'dp']);
    expect(host.querySelector('[data-mx-bound]')).toBeNull();
    expect(host.querySelector('[readonly]')).toBeNull();
    const name = host.querySelector<HTMLInputElement>('#in input')!;
    expect([name.getAttribute('aria-label'), name.placeholder]).toEqual(['Name', 'Your name']);
    const notes = host.querySelector<HTMLTextAreaElement>('#ta textarea')!;
    expect([notes.getAttribute('aria-label'), notes.rows]).toEqual(['Notes', 3]);
    expect([...host.querySelectorAll('#seg [role="group"] button')].map((b) => b.textContent)).toEqual(expect.arrayContaining(['S', 'M', 'L']));
    const amount = host.querySelector<HTMLInputElement>('#sl input')!;
    expect([amount.type, amount.min, amount.max, amount.step]).toEqual(['range', '0', '10', '1']);
    expect(host.querySelector('#sw [role="switch"]')?.getAttribute('aria-checked')).toBe('false');
    expect(host.querySelector('#dp [aria-haspopup="dialog"]')?.getAttribute('aria-expanded')).toBe('false');
    for (const label of ['Name', 'Notes', 'Size', 'Amount', 'On', 'When']) expect(host.textContent).toContain(label);
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
  it('User and UserHandle show an unresolved person as unknown, and SignIn links to the login page in the top frame', () => {
    const island = fakeIsland();
    island.people = () => ({ u1: { id: 'u1', name: 'Ada', handle: 'ada', image: null } as never });
    const { host } = mount(island, () => <><User userId="u1" id="u" /><UserHandle userId="u1" id="h" /><SignIn id="s" /></>);
    const user = host.querySelector('#u')!;
    expect(user.getAttribute('data-slot')).toBe('user');
    expect(user.querySelector('[data-slot="avatar"]')?.getAttribute('aria-hidden')).toBe('true');
    expect(user.querySelector('[data-slot="avatar-fallback"]')?.textContent).toBe('?');
    expect(user.querySelector('[data-slot="user-handle"]')?.textContent).toBe('Unknown person');
    expect(host.querySelector('#h')?.textContent).toBe('Unknown person');
    const signIn = host.querySelector<HTMLAnchorElement>('a#s')!;
    expect([signIn.getAttribute('data-slot'), signIn.target, signIn.rel, signIn.textContent]).toEqual(['sign-in', '_top', 'noopener', 'Sign in']);
    expect(signIn.getAttribute('href')).toMatch(/^\/login\b/);
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
  // The compiler writes RECIPES[tag](props) onto the served root before hydration; the live component then
  // draws its own root class. They must agree, or the root's class flips on hydration.
  const flat = (value: string | null | undefined) => (value ?? '').split(/\s+/).filter(Boolean).sort().join(' ');
  // `compiled`: the props the compiler really hands the component — its recipe `class` and, for a person, the
  // evaluated `classes` map (a conflicting author colour is resolved there, since readers ship no tailwind-merge).
  type Case = [string, Record<string, (p: Record<string, unknown>) => string>, (p: Record<string, unknown>) => import('solid-js').JSX.Element, Record<string, unknown>, compiled?: true];
  const island = () => { const i = fakeIsland(); i.people = () => ({ u1: { id: 'u1', name: 'Ada', handle: 'ada', image: null } as never }); return i; };
  const cases: Case[] = [
    ['Input', controlsRecipes, (p) => <Input {...p} />, {}],
    ['Textarea', controlsRecipes, (p) => <Textarea {...p} />, {}],
    ['Slider', controlsRecipes, (p) => <Slider {...p} />, {}],
    ['Switch', controlsRecipes, (p) => <Switch {...p} />, {}],
    ['DatePicker', controlsRecipes, (p) => <DatePicker {...p} />, {}],
    ['Segmented', controlsRecipes, (p) => <Segmented {...p as { options: string[] }} />, { options: ['S', 'M'] }],
    ['Input number', controlsRecipes, (p) => <Input {...p} />, { type: 'number' }],
    ['User', peopleRecipes, (p) => <User {...p as { userId: string }} />, { userId: 'u1' }, true],
    ['UserHandle', peopleRecipes, (p) => <UserHandle {...p as { userId: string }} />, { userId: 'u1' }, true],
    ['SignIn', peopleRecipes, (p) => <SignIn {...p} />, {}, true],
    ['Files', filesRecipes, (p) => <Files {...p} />, {}, true],
    ['Files tiles', filesRecipes, (p) => <Files {...p} />, { variant: 'tiles' }, true],
    ['Mermaid', mermaidRecipes, (p) => <Mermaid {...p as { code: string }} />, { code: 'graph TD; A-->B' }],
  ];
  for (const [label, recipes, view, props, compiled] of cases) {
    const tag = label.split(' ')[0]!;
    it(`${label}: the compile-time root class is the class the live component renders`, () => {
      for (const extra of [{}, { className: 'text-red-500' }]) {
        const given = { ...props, ...extra };
        const served = recipes[tag]!(given);
        const { host, dispose } = mount(island(), () => view(compiled ? { ...given, class: served, classes: peopleClasses(tag, given) ?? undefined } : given));
        try { expect(flat(served)).toBe(flat(host.firstElementChild?.getAttribute('class'))); } finally { dispose(); }
      }
    });
  }
});
