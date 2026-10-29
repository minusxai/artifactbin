// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import type { AfAccordion } from './accordion';
import { registerComponent } from './register-component';

const preUpgradeHost = document.createElement('div');
preUpgradeHost.innerHTML = '<af-accordion><af-accordion-item value="a"><af-accordion-trigger>A</af-accordion-trigger><af-accordion-content>A</af-accordion-content></af-accordion-item><af-accordion-item value="b"><af-accordion-trigger>B</af-accordion-trigger><af-accordion-content>B</af-accordion-content></af-accordion-item></af-accordion>';
const preUpgradeRoot = preUpgradeHost.firstElementChild as AfAccordion;
Object.defineProperty(preUpgradeRoot,'value',{value:'b',writable:true,configurable:true});
const { accordionStyles, accordionComponent } = await import('./accordion');
afterEach(() => document.body.replaceChildren());
const tick = async () => { await Promise.resolve(); await Promise.resolve(); };
function fixture(attrs = '', triggerMarkup = '<af-accordion-trigger>Toggle</af-accordion-trigger>', values = ['a','b','c']) {
  const host = document.createElement('div');
  host.innerHTML = `<af-accordion ${attrs}>${values.map((value,index) => `<af-accordion-item value="${value}"${index === 2 ? ' disabled' : ''}><h3>${triggerMarkup.replace('Toggle',value.toUpperCase())}</h3><af-accordion-content${index === 1 ? ' id="authored-panel"' : ''}><p data-af-id="authored-${value}">Panel ${value}</p></af-accordion-content></af-accordion-item>`).join('')}</af-accordion>`;
  document.body.append(host);
  const root = host.firstElementChild as AfAccordion;
  const items = [...root.querySelectorAll<HTMLElement>('af-accordion-item')];
  const triggers = [...root.querySelectorAll<HTMLElement>('af-accordion-trigger')];
  const contents = [...root.querySelectorAll<HTMLElement>('af-accordion-content')];
  return {root,items,triggers,contents};
}

describe('native authored accordion', () => {
  it('starts closed and toggles one panel in single mode with intent events', () => {
    const {root,triggers,contents} = fixture();
    expect(root.value).toBe(''); expect(contents.every(panel => panel.hidden && panel.hasAttribute('inert'))).toBe(true);
    let detail: unknown; let composed = false; let bubbled = false;
    root.addEventListener('af-change',event => {detail=(event as CustomEvent).detail; composed=event.composed;});
    document.body.addEventListener('af-change',() => {bubbled=true;},{once:true});
    triggers[0]!.click();
    expect(root.value).toBe('a'); expect(detail).toEqual({value:'a'}); expect(composed).toBe(true); expect(bubbled).toBe(true);
    expect(contents[0]!.hidden).toBe(false); expect(contents[1]!.hidden).toBe(true);
    expect(contents[0]!.querySelector('[data-af-id="authored-a"]')).not.toBeNull();
  });
  it('supports multiple open values with controlled events and a cancelable change', () => {
    const {root,triggers,contents} = fixture(`type="multiple" default-value='["a"]'`);
    let event: CustomEvent | undefined;
    root.addEventListener('af-change',e => {event=e as CustomEvent; e.preventDefault();});
    triggers[1]!.click();
    expect(root.value).toEqual(['a']); expect(event?.detail).toEqual({value:['a','b']});
    expect(event?.bubbles).toBe(true); expect(event?.composed).toBe(true); expect(event?.cancelable).toBe(true);
    root.value = ['a','b']; expect(contents[0]!.hidden).toBe(false); expect(contents[1]!.hidden).toBe(false);
    triggers[0]!.click(); expect(root.value).toEqual(['a','b']);
  });
  it('waits for controlled property or attribute updates and allows single close only when collapsible', () => {
    const {root,triggers,contents} = fixture('value="a"');
    triggers[0]!.click(); expect(root.value).toBe('a'); expect(contents[0]!.hidden).toBe(false);
    root.value = 'b'; expect(contents[1]!.hidden).toBe(false);
    const collapsible = fixture('value="a" collapsible');
    collapsible.triggers[0]!.click(); expect(collapsible.root.value).toBe('a');
    collapsible.root.removeAttribute('value'); collapsible.root.value = '';
    collapsible.triggers[0]!.click(); expect(collapsible.root.value).toBe('');
  });
  it('reflects external controlled attribute changes and preserves pre-upgrade properties', () => {
    const controlled = fixture('value="a"');
    controlled.root.setAttribute('value','b'); expect(controlled.root.value).toBe('b'); expect(controlled.contents[1]!.hidden).toBe(false);
    document.body.append(preUpgradeHost);
    expect(preUpgradeRoot.value).toBe('b');
    expect(preUpgradeRoot.querySelectorAll<HTMLElement>('af-accordion-content')[1]!.hidden).toBe(false);
  });
  it('honors disabled items and root, and navigates enabled triggers with arrows and Home/End', () => {
    const {root,triggers} = fixture('orientation="vertical"');
    triggers[0]!.focus(); triggers[0]!.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true}));
    expect(document.activeElement).toBe(triggers[1]);
    triggers[1]!.dispatchEvent(new KeyboardEvent('keydown',{key:'End',bubbles:true,cancelable:true}));
    expect(document.activeElement).toBe(triggers[1]);
    triggers[1]!.dispatchEvent(new KeyboardEvent('keydown',{key:'Home',bubbles:true,cancelable:true}));
    expect(document.activeElement).toBe(triggers[0]);
    root.setAttribute('disabled',''); triggers[1]!.click(); expect(root.value).toBe('');
  });
  it('moves horizontally in inherited RTL direction', () => {
    const {root,triggers} = fixture('orientation="horizontal" dir="rtl"','<af-accordion-trigger>Toggle</af-accordion-trigger>',['a','b','c','d']);
    triggers[0]!.focus(); triggers[0]!.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true,cancelable:true}));
    expect(document.activeElement).toBe(triggers[1]);
    triggers[1]!.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true}));
    expect(document.activeElement).toBe(triggers[0]);
    expect(root.value).toBe('');
  });
  it('keeps missing and empty item values closed, disabled, and unselectable by keyboard', async () => {
    const {root,items,triggers,contents} = fixture();
    items[0]!.removeAttribute('value'); items[1]!.setAttribute('value','');
    await tick();
    let changes = 0; root.addEventListener('af-change',() => changes++);
    for (const index of [0,1]) {
      expect(contents[index]!.hidden).toBe(true); expect(triggers[index]!.getAttribute('aria-disabled')).toBe('true');
      triggers[index]!.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
    }
    expect(root.value).toBe(''); expect(changes).toBe(0);
  });
  it('opens all items sharing a duplicate value and treats them as one selection', () => {
    const {root,triggers,contents} = fixture('', '<af-accordion-trigger>Toggle</af-accordion-trigger>', ['shared','shared','other']);
    triggers[0]!.click();
    expect(root.value).toBe('shared');
    expect(contents[0]!.hidden).toBe(false); expect(contents[1]!.hidden).toBe(false); expect(contents[2]!.hidden).toBe(true);
    expect(triggers[0]!.getAttribute('aria-expanded')).toBe('true'); expect(triggers[1]!.getAttribute('aria-expanded')).toBe('true');
  });
  it('links and retains every content part belonging to an item', async () => {
    const {root,triggers,contents} = fixture('collapsible','<af-accordion-trigger>Toggle</af-accordion-trigger>', ['a','b']);
    const extra = document.createElement('af-accordion-content'); extra.innerHTML='<p>Additional panel</p>'; root.querySelector('af-accordion-item')!.append(extra);
    await tick();
    const trigger=triggers[0]!; const first=contents[0]!;
    expect(extra.hidden).toBe(true); expect(extra.hasAttribute('inert')).toBe(true);
    expect(trigger.getAttribute('aria-controls')).toBe(`${first.id} ${extra.id}`);
    expect(extra.getAttribute('aria-labelledby')).toBe(trigger.id);
    trigger.click(); expect(first.hidden).toBe(false); expect(extra.hidden).toBe(false);
    trigger.click(); expect(first.hidden).toBe(true); expect(extra.hidden).toBe(true);
  });
  it('links existing panel IDs and generated unique IDs while retaining authored data-af-id', () => {
    const {triggers,contents} = fixture();
    expect(triggers[1]!.getAttribute('aria-controls')).toBe('authored-panel');
    expect(contents[1]!.id).toBe('authored-panel');
    expect(contents[0]!.getAttribute('aria-labelledby')).toBe(triggers[0]!.id);
    expect(new Set([...triggers,...contents].map(node=>node.id)).size).toBe(6);
    expect(contents[1]!.querySelector('[data-af-id="authored-b"]')).not.toBeNull();
  });
  it('retains every authored panel in the DOM while closed, including force-mount content', () => {
    const {root,triggers,contents} = fixture('collapsible');
    contents[1]!.setAttribute('force-mount',''); const body = contents[1]!.firstChild;
    expect(contents[1]!.hidden).toBe(true); triggers[1]!.click(); expect(root.contains(contents[1]!)).toBe(true);
    expect(contents[1]!.firstChild).toBe(body); triggers[1]!.click(); expect(contents[1]!.hasAttribute('inert')).toBe(true);
  });
  it('uses a native child button as the only semantic trigger and temporarily disables it', async () => {
    const {root,triggers,contents} = fixture('', '<af-accordion-trigger><button>Toggle</button></af-accordion-trigger>', ['a','b']);
    const trigger = triggers[0]!; const button = trigger.querySelector('button')!; await tick();
    expect(trigger.hasAttribute('role')).toBe(false); expect(trigger.hasAttribute('tabindex')).toBe(false);
    expect(button.getAttribute('aria-expanded')).toBe('false'); expect(button.getAttribute('aria-controls')).toBe(contents[0]!.id);
    let changes = 0; root.addEventListener('af-change',() => changes++);
    button.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
    button.click(); expect(changes).toBe(1); expect(root.value).toBe('a');
    root.setAttribute('disabled',''); expect(button.disabled).toBe(true); button.dispatchEvent(new MouseEvent('click',{bubbles:true})); expect(changes).toBe(1);
    root.removeAttribute('disabled'); expect(button.disabled).toBe(false);
  });
  it('styles a nested native trigger like the full-row text trigger and keeps it as the interactive control', () => {
    const {root,triggers,contents} = fixture('', '<af-accordion-trigger><button>Toggle</button></af-accordion-trigger>', ['a','b']);
    const trigger=triggers[0]!; const button=trigger.querySelector('button')!; const hostStyle=getComputedStyle(trigger); const buttonStyle=getComputedStyle(button);
    for (const property of ['width','paddingTop','paddingRight','paddingBottom','paddingLeft','fontSize','fontWeight','fontFamily','lineHeight','textAlign','color','backgroundColor','cursor'] as const) {
      if (/^(padding|border.*Width)/.test(property)) expect(parseFloat(buttonStyle[property]) || 0,property).toBe(parseFloat(hostStyle[property]) || 0); else expect(buttonStyle[property],property).toBe(hostStyle[property]);
    }
    const unrelated=document.createElement('button'); contents[0]!.append(unrelated);
    expect(getComputedStyle(unrelated).display).not.toBe(buttonStyle.display);
    button.focus(); expect(document.activeElement).toBe(button);
    button.click(); expect(root.value).toBe('a'); expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(contents[0]!.hidden).toBe(false);
  });
  it('settles observer updates when disabling an accordion with a native trigger button', async () => {
    const NativeObserver = globalThis.MutationObserver;
    const runs = [0];
    class BoundedMutationObserver extends NativeObserver {
      constructor(callback: MutationCallback) {
        let count = 0;
        super((records,observer) => { count++; runs[0] = count; if (count <= 4) callback(records,observer); else observer.disconnect(); });
      }
    }
    globalThis.MutationObserver = BoundedMutationObserver;
    try {
      const {root} = fixture('', '<af-accordion-trigger><button>Toggle</button></af-accordion-trigger>', ['a']);
      await tick(); runs[0] = 0;
      root.setAttribute('disabled',''); await tick(); await tick();
      expect(runs[0]).toBeLessThanOrEqual(2);
    } finally {
      globalThis.MutationObserver = NativeObserver; document.body.replaceChildren();
    }
  });
  it('isolates nested accordions, responds to external mutations, and reconnects without duplicate listeners', async () => {
    const {root,triggers,contents} = fixture('default-value="a"', '<af-accordion-trigger>Toggle</af-accordion-trigger>', ['a','b']);
    const inner = document.createElement('af-accordion'); inner.innerHTML='<af-accordion-item value="inner"><af-accordion-trigger>Inner</af-accordion-trigger><af-accordion-content>Inside</af-accordion-content></af-accordion-item>';
    contents[0]!.append(inner); const innerTrigger = inner.querySelector<HTMLElement>('af-accordion-trigger')!;
    innerTrigger.click(); expect((inner as AfAccordion).value).toBe('inner'); expect(root.value).toBe('a');
    triggers[1]!.click(); expect(root.value).toBe('b'); expect(contents[1]!.hidden).toBe(false);
    const extra = document.createElement('af-accordion-item'); extra.setAttribute('value','c'); extra.innerHTML='<af-accordion-trigger>C</af-accordion-trigger><af-accordion-content>C panel</af-accordion-content>';
    root.append(extra); await tick(); const extraTrigger=extra.querySelector<HTMLElement>('af-accordion-trigger')!; extraTrigger.click(); expect(root.value).toBe('c');
    root.remove(); document.body.append(root); await tick(); let count=0; root.addEventListener('af-change',()=>count++); triggers[0]!.click(); expect(count).toBe(1);
  });
  it('keeps generated chevrons with their owning trigger through nested controls and reparenting', async () => {
    const nestedMarkup='<af-accordion-trigger><span><af-accordion><af-accordion-item value="inner"><af-accordion-trigger><button>Inner</button></af-accordion-trigger><af-accordion-content>Nested content</af-accordion-content></af-accordion-item></af-accordion></span></af-accordion-trigger>';
    const nested=fixture('default-value="outer"',nestedMarkup,['outer']);
    const [outerTrigger,innerTrigger]=[...nested.root.querySelectorAll<HTMLElement>('af-accordion-trigger')];
    const outerIcon=outerTrigger!.querySelector(':scope > svg[data-af-accordion-icon]');
    const innerButton=innerTrigger!.querySelector('button')!;
    const innerIcon=innerButton.querySelector(':scope > svg[data-af-accordion-icon]');
    expect(outerIcon).not.toBeNull(); expect(innerIcon).not.toBeNull(); expect(outerIcon!.parentElement).toBe(outerTrigger);
    expect(innerIcon!.parentElement).toBe(innerButton); expect(outerTrigger!.querySelectorAll(':scope > svg[data-af-accordion-icon]')).toHaveLength(1);

    const wrapped=fixture('', '<af-accordion-trigger><span><button>Toggle</button></span></af-accordion-trigger>', ['a']);
    const trigger=wrapped.triggers[0]!; const button=trigger.querySelector('button')!;
    expect(button.querySelectorAll(':scope > svg[data-af-accordion-icon]')).toHaveLength(1);
    const wrapper=button.parentElement!; const replacement=wrapper.ownerDocument.createElement('section'); replacement.append(button); wrapper.replaceWith(replacement);
    await tick();
    expect(button.querySelectorAll(':scope > svg[data-af-accordion-icon]')).toHaveLength(1);
    expect(accordionStyles).not.toContain('rotate(180deg)');
    expect(accordionStyles).not.toContain('af-accordion-trigger[aria-expanded="true"] .af-accordion-icon');
  });
  it('registers elements and styles idempotently', () => {
    registerComponent(accordionComponent); expect(document.querySelectorAll('style[data-af-accordion-styles]')).toHaveLength(1);
  });
});

describe('accordion appearance', () => {
  it('matches the captured accordion content line-height and bottom spacing recipe', () => {
    const {root,items,contents} = fixture('default-value="a"', '<af-accordion-trigger><button>Toggle</button></af-accordion-trigger>', ['a']);
    const button = items[0]!.querySelector('button')!;
    expect(getComputedStyle(button).lineHeight).toBe('20px');
    expect(getComputedStyle(contents[0]!).lineHeight).toBe('20px');
    expect(parseFloat(getComputedStyle(contents[0]!).paddingBottom)).toBe(16);
    const icon = button.querySelector('svg[data-af-accordion-icon]')!;
    expect(icon.getAttribute('viewBox')).toBe('0 0 24 24');
    expect(icon.querySelector('path')?.getAttribute('d')).toBe('m6 9 6 6 6-6');
    expect(icon.getAttribute('stroke-linecap')).toBe('round');
    expect(accordionStyles).toContain('transform:translateY(.125rem);color:var(--muted-foreground,currentColor);transition:transform .2s');
    expect(accordionStyles).not.toContain('rotate(180deg)');
    items[0]!.querySelector('button')!.click();
    expect(items[0]!.querySelector('svg[data-af-accordion-icon] path')?.getAttribute('d')).toBe('m6 9 6 6 6-6');
    expect(accordionStyles).toContain('box-shadow:0 0 0 3px color-mix(in oklab');
    root.remove();
  });

  it('matches the source border-b and last:border-b-0 recipe', () => {
    const {items,root} = fixture();
    const itemColor = getComputedStyle(items[0]!).color;
    expect(getComputedStyle(items[0]!).borderBottomColor).toBe(itemColor);
    expect(getComputedStyle(items[0]!).borderBottomWidth).toBe('1px');
    expect(getComputedStyle(items[1]!).borderBottomWidth).toBe('1px');
    expect(items.at(-1)!.matches('af-accordion-item:not(:last-child)')).toBe(false);
    expect(accordionStyles).toContain('af-accordion-item:not(:last-child){border-bottom:1px solid currentColor}');
    root.remove();
  });
});

// probe: pull request lane type check timing
