// @vitest-environment jsdom
import {afterEach,expect,it} from 'vitest';
import {AfPopover,registerPopover} from './popover';
import {registerTooltip} from './tooltip';
registerPopover();
afterEach(() => document.body.replaceChildren());
const tick = async () => { await Promise.resolve(); await Promise.resolve(); };
function fixture(attrs = '') {
 const host = document.createElement('div'); host.innerHTML = `<af-popover ${attrs}><af-popover-trigger><button>Open</button></af-popover-trigger><af-popover-content data-af-id="kept"><af-popover-header><af-popover-title>Settings</af-popover-title><af-popover-description>Choose settings</af-popover-description></af-popover-header><input value="retained"></af-popover-content></af-popover>`; document.body.append(host);
 return {root:host.firstElementChild as AfPopover,trigger:host.querySelector('button')!,content:host.querySelector<HTMLElement>('af-popover-content')!};
}
it('retains authored state and links native trigger and dialog labels without wrapper tab stops', () => {
 const {root,trigger,content} = fixture(); const input = content.querySelector('input')!;
 trigger.click(); expect(root.open).toBe(true); expect(content.hidden).toBe(false); expect(document.activeElement).toBe(input);
 expect(trigger.parentElement!.hasAttribute('tabindex')).toBe(false); expect(trigger.getAttribute('aria-controls')).toBe(content.id); expect(content.getAttribute('aria-labelledby')).toBe(root.querySelector('af-popover-title')!.id);
 document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true})); expect(root.open).toBe(false); expect(document.activeElement).toBe(trigger); expect(input.value).toBe('retained'); expect(content.dataset.afId).toBe('kept');
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
 const {root,trigger,content} = fixture('open'); expect(content.contains(document.activeElement)).toBe(true);
 root.open = false; expect(document.activeElement).toBe(trigger); registerPopover(); expect(document.querySelectorAll('style[data-af-popover-styles]')).toHaveLength(1);
});
it('dismisses a nested tooltip before its containing popover', () => {
 registerTooltip(); const {root,content} = fixture('default-open');
 const tip = document.createElement('af-tooltip'); tip.innerHTML = '<af-tooltip-trigger><button>Help</button></af-tooltip-trigger><af-tooltip-content>Explanation</af-tooltip-content>'; content.append(tip);
 tip.querySelector('button')!.focus(); expect(tip.dataset.state).toBe('open');
 document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',cancelable:true})); expect(tip.dataset.state).toBe('closed'); expect(root.open).toBe(true);
});
it('moves semantics when a native trigger is added after initial connection', async () => {
 const {root,trigger} = fixture(); const wrapper = trigger.parentElement!; wrapper.replaceChildren('Plain'); await tick(); expect(wrapper.tabIndex).toBe(0);
 wrapper.append(trigger); await tick(); expect(wrapper.hasAttribute('tabindex')).toBe(false); expect(wrapper.hasAttribute('role')).toBe(false);
 root.remove();
});
