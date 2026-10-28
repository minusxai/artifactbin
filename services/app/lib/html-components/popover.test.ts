// @vitest-environment jsdom
import {afterEach,expect,it} from 'vitest';
import {AfPopover,popoverComponent,popoverStyles} from './popover';
import './tooltip';
import { registerComponent } from './register-component';
afterEach(() => document.body.replaceChildren());
const tick = async () => { await Promise.resolve(); await Promise.resolve(); };
function fixture(attrs = '') {
 const host = document.createElement('div'); host.innerHTML = `<af-popover ${attrs}><af-popover-trigger><button>Open</button></af-popover-trigger><af-popover-content data-af-id="kept"><af-popover-header><af-popover-title>Settings</af-popover-title><af-popover-description>Choose settings</af-popover-description></af-popover-header><input value="retained"></af-popover-content></af-popover>`; document.body.append(host);
 return {root:host.firstElementChild as AfPopover,trigger:host.querySelector('button')!,content:host.querySelector<HTMLElement>('af-popover-content')!};
}
it('retains authored state and links native trigger and dialog labels without wrapper tab stops', () => {
 const {root,trigger,content} = fixture(); const input = content.querySelector('input')!;
 trigger.focus(); trigger.click(); expect(root.open).toBe(true); expect(content.hidden).toBe(false); expect(document.activeElement).toBe(trigger);
 expect(trigger.parentElement!.hasAttribute('tabindex')).toBe(false); expect(trigger.getAttribute('aria-controls')).toBe(content.id); expect(content.getAttribute('aria-labelledby')).toBe(root.querySelector('af-popover-title')!.id);
 input.focus(); expect(document.activeElement).toBe(input);
 document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true})); expect(root.open).toBe(false); expect(document.activeElement).toBe(trigger); expect(input.value).toBe('retained'); expect(content.dataset.afId).toBe('kept');
});
it('keeps keyboard-open focus on the trigger and allows focus into content before Escape restores it', () => {
 const host = document.createElement('div'); host.innerHTML = '<af-popover><af-popover-trigger>Open</af-popover-trigger><af-popover-content><button>First action</button></af-popover-content></af-popover>'; document.body.append(host);
 const root = host.querySelector<AfPopover>('af-popover')!; const trigger = host.querySelector<HTMLElement>('af-popover-trigger')!; const action = host.querySelector<HTMLButtonElement>('button')!;
 trigger.focus(); trigger.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
 expect(root.open).toBe(true); expect(document.activeElement).toBe(trigger);
 action.focus(); expect(root.open).toBe(true); expect(document.activeElement).toBe(action);
 action.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
 expect(root.open).toBe(false); expect(document.activeElement).toBe(trigger);
});
it('styles only a nested native trigger button like its text-only host and preserves click focus', () => {
 const {root,trigger,content} = fixture(); const wrapper=trigger.parentElement!; const wrapperStyle=getComputedStyle(wrapper); const buttonStyle=getComputedStyle(trigger);
 for (const property of ['paddingTop','paddingRight','paddingBottom','paddingLeft','fontFamily','fontSize','fontWeight','color','backgroundColor','borderTopWidth','borderTopStyle','cursor'] as const) {
  if (/^padding/.test(property)) expect(parseFloat(buttonStyle[property]) || 0,property).toBe(parseFloat(wrapperStyle[property]) || 0); else if (property !== 'borderTopWidth') expect(buttonStyle[property],property).toBe(wrapperStyle[property]);
 }
 expect(buttonStyle.borderTopStyle).toBe('none'); expect(parseFloat(buttonStyle.paddingTop)).toBe(0);
 expect(wrapperStyle.lineHeight).toBe('1.5'); expect(buttonStyle.lineHeight).toBe('1.5'); expect(buttonStyle.display).toBe('inline-block');
 const unrelated=document.createElement('button'); content.append(unrelated);
 const bareStyle=getComputedStyle(document.createElement('button'));
 expect(getComputedStyle(unrelated).borderTopStyle).toBe(bareStyle.borderTopStyle);
 expect(getComputedStyle(unrelated).paddingTop).toBe(bareStyle.paddingTop);
 trigger.focus(); trigger.click(); expect(root.open).toBe(true); expect(document.activeElement).toBe(trigger);
});
it('keeps the floating panel text rhythm and border inherited from its source story surface', () => {
 const {root,content} = fixture(); root.style.color='rgb(55, 72, 54)';
 const panelStyle=getComputedStyle(content);
 expect(panelStyle.lineHeight).toBe('1.5');
 expect(popoverStyles).toContain('border:1px solid currentColor');
});
it('applies the source bare-paragraph rhythm only to unclassed panel paragraphs', () => {
 const {content}=fixture(); const bare=document.createElement('p'); bare.textContent='Bare paragraph';
 const authored=document.createElement('p'); authored.className='authored'; authored.style.lineHeight='2'; authored.style.marginBlock='0.5em';
 content.append(bare,authored);
 expect(getComputedStyle(bare).lineHeight).toBe('1.65');
 expect(popoverStyles).toContain('margin-block:.75em;max-width:68ch;line-height:1.65');
 expect(getComputedStyle(authored).lineHeight).toBe('2');
});
it('leaves a nested native trigger button to its browser focus treatment', () => {
 const {root,trigger} = fixture(); root.style.setProperty('--ring','rgb(1, 2, 3)'); trigger.focus();
 expect(getComputedStyle(trigger).outlineColor).not.toBe('rgb(1, 2, 3)');
 expect(popoverStyles).not.toContain('af-popover-trigger>button:focus-visible');
});
it('waits for author-controlled state and supports canceled intent', () => {
 const {root,trigger,content} = fixture('open'); trigger.click(); expect(content.hidden).toBe(false);
 root.open = false; trigger.click(); expect(root.open).toBe(false); root.open = undefined; root.removeAttribute('open');
 root.addEventListener('af-change',e => { expect(e.bubbles && e.composed && e.cancelable).toBe(true); e.preventDefault(); }); trigger.click(); expect(root.open).toBe(false);
});
it('dismisses only the nested top overlay and respects outside cancellation and lifecycle', async () => {
 const outer = fixture('default-open'); const inner = fixture(); outer.content.append(inner.root); inner.trigger.click();
 document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',cancelable:true})); expect(inner.root.open).toBe(false); expect(outer.root.open).toBe(true);
 outer.root.remove(); document.body.append(outer.root); let count = 0; outer.root.addEventListener('af-change',() => count++);
 document.body.dispatchEvent(new MouseEvent('pointerdown',{bubbles:true})); expect(outer.root.open).toBe(false); expect(count).toBe(1);
 outer.trigger.disabled = true; outer.trigger.click(); expect(outer.root.open).toBe(false);
 outer.content.id = 'authored'; await tick(); expect(outer.trigger.getAttribute('aria-controls')).toBe('authored');
});
it('preserves disabled native children and removes obsolete generated label links', async () => {
 const {root,trigger,content} = fixture(); const wrapper = trigger.parentElement!;
 wrapper.setAttribute('disabled',''); await tick(); expect(trigger.disabled).toBe(true); expect(trigger.tabIndex).toBe(-1);
 wrapper.removeAttribute('disabled'); await tick(); expect(trigger.disabled).toBe(false); expect(trigger.tabIndex).toBe(0);
 trigger.disabled = true; wrapper.setAttribute('disabled',''); await tick(); wrapper.removeAttribute('disabled'); await tick(); expect(trigger.disabled).toBe(true);
 root.querySelector('af-popover-title')!.remove(); await tick(); expect(content.hasAttribute('aria-labelledby')).toBe(false); expect(content.getAttribute('aria-label')).toBe('Open');
});
it('restores focus when a controlled author closes and registers once', () => {
 const {root,trigger,content} = fixture('open'); content.querySelector('input')!.focus(); expect(content.contains(document.activeElement)).toBe(true);
 root.open = false; expect(document.activeElement).toBe(trigger); registerComponent(popoverComponent); expect(document.querySelectorAll('style[data-af-popover-styles]')).toHaveLength(1);
});
it('dismisses a nested tooltip before its containing popover', () => {
 const {root,content} = fixture('default-open');
 const tip = document.createElement('af-tooltip'); tip.innerHTML = '<af-tooltip-trigger><button>Help</button></af-tooltip-trigger><af-tooltip-content>Explanation</af-tooltip-content>'; content.append(tip);
 tip.querySelector('button')!.focus(); expect(tip.dataset.state).toBe('open');
 document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',cancelable:true})); expect(tip.dataset.state).toBe('closed'); expect(root.open).toBe(true);
});
it('moves semantics when a native trigger is added after initial connection', async () => {
 const {root,trigger} = fixture(); const wrapper = trigger.parentElement!; wrapper.replaceChildren('Plain'); await tick(); expect(wrapper.tabIndex).toBe(0);
 wrapper.append(trigger); await tick(); expect(wrapper.hasAttribute('tabindex')).toBe(false); expect(wrapper.hasAttribute('role')).toBe(false);
 root.remove();
});
it('dismisses on Tab focus leaving, preserves outside focus, and restores the trigger when content is replaced', async () => {
 const {root,trigger,content} = fixture(); trigger.focus(); trigger.click();
 const outside = document.createElement('button'); document.body.append(outside); outside.focus(); expect(root.open).toBe(false); expect(document.activeElement).toBe(outside);
 trigger.click(); const next = document.createElement('af-popover-content'); next.innerHTML = '<input aria-label="Replacement">'; content.replaceWith(next); await tick();
 expect(root.open).toBe(true); expect(document.activeElement).toBe(trigger);
});
it('requests dismissal when the trigger becomes disabled, while controlled visibility waits for the author', async () => {
 const a = fixture(); a.trigger.click(); a.trigger.disabled = true; await tick(); expect(a.root.open).toBe(false);
 const b = fixture('open'); const intents: boolean[] = []; b.root.addEventListener('af-change',e => intents.push((e as CustomEvent).detail.value));
 b.trigger.disabled = true; await tick(); expect(intents).toEqual([false]); expect(b.root.open).toBe(true);
});
