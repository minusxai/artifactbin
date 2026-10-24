// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
import {AfTooltip,registerTooltip} from './tooltip';
registerTooltip();
afterEach(() => { document.body.replaceChildren(); vi.useRealTimers(); });
function fixture(attrs = '') {
 const host = document.createElement('div'); host.innerHTML = `<af-tooltip ${attrs}><af-tooltip-trigger><button aria-describedby="existing">Help</button></af-tooltip-trigger><af-tooltip-content data-af-id="tip">Helpful text</af-tooltip-content></af-tooltip>`; document.body.append(host);
 return {root:host.firstElementChild as AfTooltip,trigger:host.querySelector('button')!,content:host.querySelector<HTMLElement>('af-tooltip-content')!};
}
it('delays hover, cancels pending work on leave and opens immediately on focus', () => {
 vi.useFakeTimers(); const {root,trigger,content} = fixture('delay-duration="300"');
 trigger.dispatchEvent(new MouseEvent('pointerover',{bubbles:true})); vi.advanceTimersByTime(299); expect(root.open).toBe(false);
 trigger.dispatchEvent(new MouseEvent('pointerout',{bubbles:true})); vi.advanceTimersByTime(1); expect(root.open).toBe(false);
 trigger.focus(); expect(root.open).toBe(true); expect(content.getAttribute('role')).toBe('tooltip'); expect(trigger.getAttribute('aria-describedby')).toBe(`existing ${content.id}`);
 trigger.blur(); vi.runAllTimers(); expect(root.open).toBe(false); expect(trigger.getAttribute('aria-describedby')).toBe('existing');
});
it('allows hovering the tooltip itself and preserves controlled/canceled visibility', () => {
 vi.useFakeTimers(); const {root,trigger,content} = fixture('default-open');
 trigger.dispatchEvent(new MouseEvent('pointerout',{bubbles:true,relatedTarget:content})); vi.runAllTimers(); expect(root.open).toBe(true);
 root.open = true; document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',cancelable:true})); expect(root.open).toBe(true);
 root.open = undefined; root.addEventListener('af-change',e => e.preventDefault()); content.dispatchEvent(new MouseEvent('pointerout',{bubbles:true})); vi.runAllTimers(); expect(root.open).toBe(true);
});
it('clears timers on disconnect, avoids disabled trigger activation and registers once', () => {
 vi.useFakeTimers(); const {root,trigger} = fixture(); trigger.dispatchEvent(new MouseEvent('pointerover',{bubbles:true})); root.remove(); vi.runAllTimers(); expect(root.open).toBe(false);
 document.body.append(root); trigger.disabled = true; trigger.dispatchEvent(new FocusEvent('focusin',{bubbles:true})); expect(root.open).toBe(false);
 registerTooltip(); expect(document.querySelectorAll('style[data-af-tooltip-styles]')).toHaveLength(1);
});
it('uses an injected clock for actual hover opening and maintains unique authored descriptions', () => {
 const {root,trigger,content} = fixture(); const pending = new Map<number,() => void>();
 root.clock = {setTimeout:fn => { pending.set(1,fn); return 1; },clearTimeout:id => { pending.delete(id); }};
 trigger.dispatchEvent(new MouseEvent('pointerover',{bubbles:true})); expect(root.open).toBe(false); pending.get(1)!(); expect(root.open).toBe(true);
 content.id = 'authored'; root.open = false; trigger.setAttribute('aria-describedby','existing authored'); root.open = true;
 root.open = false; expect(trigger.getAttribute('aria-describedby')).toBe('existing authored'); expect(content.dataset.afId).toBe('tip');
});
it('dismisses sibling tooltips through cancelable intent and keeps attribute controls closed until reflected', () => {
 const first = fixture('default-open'); const second = fixture('open'); expect(first.root.open).toBe(false);
 second.trigger.dispatchEvent(new FocusEvent('focusout',{bubbles:true})); expect(second.root.open).toBe(true);
 second.root.removeAttribute('open'); expect(second.root.open).toBe(false);
});
