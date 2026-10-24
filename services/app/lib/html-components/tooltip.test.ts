// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
import {AfTooltip,registerTooltip} from './tooltip';
registerTooltip();
afterEach(() => { document.body.replaceChildren(); vi.useRealTimers(); });
function fixture(attrs = '') {
 const host = document.createElement('af-tooltip-provider'); host.innerHTML = `<af-tooltip ${attrs}><af-tooltip-trigger><button aria-describedby="existing">Help</button></af-tooltip-trigger><af-tooltip-content data-af-id="tip">Helpful text</af-tooltip-content></af-tooltip>`; document.body.append(host);
 return {root:host.firstElementChild as AfTooltip,trigger:host.querySelector('button')!,content:host.querySelector<HTMLElement>('af-tooltip-content')!};
}
it('delays hover, cancels pending work on leave and opens immediately on focus', () => {
 vi.useFakeTimers(); const {root,trigger,content} = fixture('delay-duration="300"');
 trigger.dispatchEvent(new MouseEvent('pointerover',{bubbles:true})); vi.advanceTimersByTime(299); expect(root.open).toBe(false);
 trigger.dispatchEvent(new MouseEvent('pointerout',{bubbles:true})); vi.advanceTimersByTime(1); expect(root.open).toBe(false);
 trigger.focus(); expect(root.open).toBe(true); expect(content.getAttribute('role')).toBe('tooltip'); expect(trigger.getAttribute('aria-describedby')).toBe(`existing ${content.id}`);
 trigger.blur(); vi.runAllTimers(); expect(root.open).toBe(false); expect(trigger.getAttribute('aria-describedby')).toBe('existing');
});
it('styles only a nested native tooltip trigger like its host and preserves keyboard focus behavior', () => {
 const {root,trigger,content}=fixture(); const wrapper=trigger.parentElement!; const wrapperStyle=getComputedStyle(wrapper); const buttonStyle=getComputedStyle(trigger);
 for (const property of ['paddingTop','paddingRight','paddingBottom','paddingLeft','fontFamily','fontSize','fontWeight','color','backgroundColor','borderTopWidth','borderTopStyle','cursor'] as const) {
  if (/^padding/.test(property)) expect(parseFloat(buttonStyle[property]) || 0,property).toBe(parseFloat(wrapperStyle[property]) || 0); else if (property !== 'borderTopWidth') expect(buttonStyle[property],property).toBe(wrapperStyle[property]);
 }
 expect(buttonStyle.borderTopStyle).toBe('none'); expect(parseFloat(buttonStyle.paddingTop)).toBe(0);
 trigger.focus(); expect(root.open).toBe(true); expect(document.activeElement).toBe(trigger); expect(content.getAttribute('role')).toBe('tooltip');
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
it('inherits the nearest provider delay, overrides it locally, and shares only that provider warm interval', () => {
 vi.useFakeTimers(); vi.setSystemTime(1000);
 const provider = document.createElement('af-tooltip-provider'); provider.setAttribute('delay-duration','600'); provider.setAttribute('skip-delay-duration','200'); document.body.append(provider);
 const first = fixture(); const second = fixture(); provider.append(first.root,second.root);
 first.trigger.dispatchEvent(new MouseEvent('pointerover',{bubbles:true})); vi.advanceTimersByTime(599); expect(first.root.open).toBe(false); vi.advanceTimersByTime(1); expect(first.root.open).toBe(true);
 first.trigger.dispatchEvent(new MouseEvent('pointerout',{bubbles:true})); vi.advanceTimersByTime(100);
 second.trigger.dispatchEvent(new MouseEvent('pointerover',{bubbles:true})); expect(second.root.open).toBe(true);
 second.trigger.dispatchEvent(new MouseEvent('pointerout',{bubbles:true})); vi.advanceTimersByTime(301);
 first.root.setAttribute('delay-duration','20'); first.trigger.dispatchEvent(new MouseEvent('pointerover',{bubbles:true})); vi.advanceTimersByTime(19); expect(first.root.open).toBe(false); vi.advanceTimersByTime(1); expect(first.root.open).toBe(true);
 const isolated = fixture(); isolated.trigger.dispatchEvent(new MouseEvent('pointerover',{bubbles:true})); expect(isolated.root.open).toBe(false);
});
it('keeps focused tooltips open through hover leave and cancels a close when hovered again', () => {
 vi.useFakeTimers(); const {root,trigger,content} = fixture(); trigger.focus(); trigger.dispatchEvent(new MouseEvent('pointerout',{bubbles:true})); vi.advanceTimersByTime(200); expect(root.open).toBe(true);
 trigger.blur(); trigger.dispatchEvent(new MouseEvent('pointerover',{bubbles:true})); vi.advanceTimersByTime(300); expect(root.open).toBe(true);
 trigger.dispatchEvent(new MouseEvent('pointerout',{bubbles:true})); vi.advanceTimersByTime(50); content.dispatchEvent(new MouseEvent('pointerover',{bubbles:true,relatedTarget:trigger})); vi.advanceTimersByTime(100); expect(root.open).toBe(true);
});
it('keeps hovered content visible when trigger focus leaves until both hover and focus leave', () => {
 vi.useFakeTimers(); const {root,trigger,content} = fixture(); trigger.focus();
 content.dispatchEvent(new MouseEvent('pointerover',{bubbles:true,relatedTarget:trigger})); trigger.blur(); expect(root.open).toBe(true);
 content.dispatchEvent(new MouseEvent('pointerout',{bubbles:true})); vi.advanceTimersByTime(100); expect(root.open).toBe(false);
});
