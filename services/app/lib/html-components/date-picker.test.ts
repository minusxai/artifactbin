// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { AfDatePicker, registerDatePicker, type AfDatePickerChangeDetail } from './date-picker';
registerDatePicker(); afterEach(()=>document.body.replaceChildren());
function fixture(attrs='') { const host=document.createElement('div'); host.innerHTML=`<af-date-picker ${attrs}><span data-af-id="authored">Help</span></af-date-picker>`; document.body.append(host); return host.firstElementChild as AfDatePicker; }
it('opens a labeled calendar, changes uncontrolled values and preserves authored nodes',()=>{
 const root=fixture('label="Start" default-value="2024-02-29"'); const authored=root.querySelector('[data-af-id]');
 root.querySelector<HTMLButtonElement>('button')!.click();
 expect(root.querySelector('[role=dialog]')?.getAttribute('aria-label')).toBe('Start calendar');
 root.querySelector<HTMLButtonElement>('button[aria-label="2024-03-01"]')!.click();
 expect(root.value).toBe('2024-03-01'); expect(root.querySelector('[data-af-id]')).toBe(authored);
 root.remove(); document.body.append(root); expect(root.querySelectorAll('.af-date-trigger')).toHaveLength(1);
});
it('reports cancelable composed intent and waits for controlled reflection',()=>{
 const root=fixture('value="2024-02-29"'); let event:CustomEvent<AfDatePickerChangeDetail>|undefined;
 root.addEventListener('af-change',e=>{event=e as CustomEvent<AfDatePickerChangeDetail>; e.preventDefault();});
 root.querySelector<HTMLButtonElement>('button')!.click(); root.querySelector<HTMLButtonElement>('button[aria-label="2024-03-01"]')!.click();
 expect(event?.detail).toEqual({value:'2024-03-01'}); expect(event?.composed).toBe(true); expect(event?.bubbles).toBe(true); expect(root.value).toBe('2024-02-29');
 root.value=null; expect(root.value).toBe(null);
});
it('enforces bounds, escape and disabled/read-only behavior',()=>{
 const root=fixture('default-value="2024-02-29" min="2024-02-29" max="2024-03-01"');
 const trigger=root.querySelector<HTMLButtonElement>('button')!; trigger.click();
 expect(root.querySelector<HTMLButtonElement>('button[aria-label="2024-02-28"]')!.disabled).toBe(true);
 root.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})); expect(root.querySelector<HTMLElement>('[role=dialog]')!.hidden).toBe(true);
 root.setAttribute('read-only',''); trigger.click(); expect(root.querySelector<HTMLElement>('[role=dialog]')!.hidden).toBe(true);
 root.setAttribute('disabled',''); expect(trigger.disabled).toBe(true);
});
it('moves keyboard focus across leap day and years and dismisses outside',()=>{
 const root=fixture('default-value="2024-02-29"'); root.querySelector<HTMLButtonElement>('button')!.click();
 const day=root.querySelector<HTMLButtonElement>('[data-date="2024-02-29"]')!;
 day.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));
 expect((document.activeElement as HTMLElement).dataset.date).toBe('2024-03-01');
 document.activeElement!.dispatchEvent(new KeyboardEvent('keydown',{key:'PageUp',shiftKey:true,bubbles:true}));
 expect(root.textContent).toContain('March 2023');
 document.body.dispatchEvent(new Event('pointerdown',{bubbles:true})); expect(root.querySelector<HTMLElement>('[role=dialog]')!.hidden).toBe(true);
});
it('clears to null, prevents read-only intent and cleans up on reconnect',()=>{
 const root=fixture('default-value="2024-02-29"'); let count=0;
 root.addEventListener('af-change',()=>count++); root.querySelector<HTMLButtonElement>('button')!.click(); root.querySelector<HTMLButtonElement>('[aria-label="Clear date"]')!.click();
 expect(root.value).toBe(null); expect(count).toBe(1);
 root.remove(); document.body.append(root); root.setAttribute('read-only',''); root.querySelector<HTMLButtonElement>('button')!.click(); expect(count).toBe(1);
});
