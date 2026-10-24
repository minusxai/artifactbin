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
it('renders the authored visible label and a decorative calendar icon without changing the trigger name',()=>{
 const root=fixture('label="Due date" default-value="2024-06-15"');
 const label=root.querySelector<HTMLElement>('.af-date-label');
 const trigger=root.querySelector<HTMLButtonElement>('.af-date-trigger')!;
 expect(label?.textContent).toBe('Due date');
 expect(trigger.getAttribute('aria-label')).toBe('Due date: 2024-06-15');
 const icon=trigger.querySelector('svg');
 expect(icon?.getAttribute('aria-hidden')).toBe('true');
 expect(icon?.getAttribute('viewBox')).toBe('0 0 24 24');
 expect(icon?.querySelector('path')?.getAttribute('d')).toBe('M8 2v4');
 expect(icon?.querySelector('rect')?.getAttribute('x')).toBe('3');
 root.setAttribute('aria-label','Deadline');
 expect(root.querySelector('.af-date-label')?.textContent).toBe('Due date');
 expect(trigger.getAttribute('aria-label')).toBe('Deadline: 2024-06-15');
 root.label='Ship date';
 expect(root.querySelector('.af-date-label')?.textContent).toBe('Ship date');
 root.removeAttribute('label');
 expect(root.querySelector('.af-date-label')).toBeNull();
});
it('matches the original popup width, left anchor, weekday labels and default navigation',()=>{
 const root=fixture('label="Due date" default-value="2024-06-15" min="2024-06-01" max="2024-06-30"');
 root.clock=()=>new Date(2026,9,25);
 const trigger=root.querySelector<HTMLButtonElement>('.af-date-trigger')!;
 const popup=root.querySelector<HTMLElement>('.af-date-popup')!;
 trigger.getBoundingClientRect=()=>({left:24,right:184,top:40,bottom:76,width:160,height:36,x:24,y:40,toJSON(){}});
 popup.getBoundingClientRect=()=>({left:0,right:256,top:0,bottom:300,width:256,height:300,x:0,y:0,toJSON(){}});
 trigger.click();
 expect(getComputedStyle(popup).width).toBe('256px');
 expect(popup.dataset.align).toBe('start');
 expect(popup.style.left).toBe('24px');
 expect(Array.from(popup.querySelectorAll('abbr')).map(day=>day.textContent)).toEqual(['S','M','T','W','T','F','S']);
 expect(popup.querySelector('[aria-label="Previous month"]')).not.toBeNull();
 expect(popup.querySelector('[aria-label="Next month"]')).not.toBeNull();
 expect(popup.querySelector('[aria-label="Previous year"]')).toBeNull();
 expect(popup.querySelector('[aria-label="Next year"]')).toBeNull();
 expect(popup.querySelector('[aria-label="Today"]')).toBeNull();
 expect(popup.querySelector('[aria-label="Clear date"]')).toBeNull();
 const day=popup.querySelector<HTMLButtonElement>('[data-date="2024-06-15"]')!;
 const ordinaryDay=popup.querySelector<HTMLButtonElement>('[data-date="2024-06-14"]')!;
 expect(getComputedStyle(day).width).toBe('32px'); expect(getComputedStyle(day).height).toBe('32px');
 expect(getComputedStyle(ordinaryDay).backgroundColor).toBe('rgba(0, 0, 0, 0)');
 const styles=document.querySelector<HTMLStyleElement>('style[data-af-date-picker-styles]')?.textContent ?? '';
 expect(styles).toContain('af-date-picker .af-date-grid [data-date]{background:transparent}');
 expect(styles).toContain('af-date-picker .af-date-grid [data-date][aria-pressed=true]{background:var(--primary,#222)');
 const header=popup.querySelector<HTMLElement>('.af-date-header')!;
 expect(header.firstElementChild?.textContent).toBe('June 2024');
 expect(header.lastElementChild?.querySelector('[aria-label="Previous month"]')).not.toBeNull();
 expect(header.lastElementChild?.querySelector('[aria-label="Next month"]')).not.toBeNull();
});
it('keeps extra calendar actions available through explicit attributes and properties',()=>{
 const root=fixture('default-value="2024-06-15" show-year-navigation show-clear'); root.clock=()=>new Date(2024,5,15);
 expect(root.showYearNavigation).toBe(true); expect(root.showClear).toBe(true);
 root.showYearNavigation=false; root.showYearNavigation=true; root.showClear=false; root.showClear=true;
 expect(root.hasAttribute('show-year-navigation')).toBe(true); expect(root.hasAttribute('show-clear')).toBe(true);
 root.querySelector<HTMLButtonElement>('.af-date-trigger')!.click();
 expect(root.querySelector('[aria-label="Previous year"]')).not.toBeNull();
 expect(root.querySelector('[aria-label="Next year"]')).not.toBeNull();
 expect(root.querySelector('[aria-label="Today"]')).not.toBeNull();
 expect(root.querySelector('[aria-label="Clear date"]')).not.toBeNull();
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
 const root=fixture('default-value="2024-02-29" show-clear'); let count=0;
 root.addEventListener('af-change',()=>count++); root.querySelector<HTMLButtonElement>('button')!.click(); root.querySelector<HTMLButtonElement>('[aria-label="Clear date"]')!.click();
 expect(root.value).toBe(null); expect(count).toBe(1);
 root.remove(); document.body.append(root); root.setAttribute('read-only',''); root.querySelector<HTMLButtonElement>('button')!.click(); expect(count).toBe(1);
});
it('keeps one roving day and focused date during author updates, supports Home and RTL',()=>{
 const root=fixture('default-value="2024-02-29"'); root.querySelector<HTMLButtonElement>('button')!.click();
 expect(root.querySelectorAll('[data-date][tabindex="0"]')).toHaveLength(1);
 root.value='2024-02-28'; expect((document.activeElement as HTMLElement).dataset.date).toBe('2024-02-29');
 document.activeElement!.dispatchEvent(new KeyboardEvent('keydown',{key:'Home',bubbles:true})); expect((document.activeElement as HTMLElement).dataset.date).toBe('2024-02-25');
 root.setAttribute('dir','rtl'); document.activeElement!.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true})); expect((document.activeElement as HTMLElement).dataset.date).toBe('2024-02-26');
});
it('injects today, cancels nullable intent and closes when readonly changes',()=>{
 const root=fixture('default-value="2024-02-29" show-clear'); root.clock=()=>new Date(2024,1,29,23); root.querySelector<HTMLButtonElement>('button')!.click();
 expect(root.querySelector('[aria-current=date]')?.getAttribute('data-date')).toBe('2024-02-29');
 root.addEventListener('af-change',event=>event.preventDefault()); root.querySelector<HTMLButtonElement>('[aria-label="Clear date"]')!.click(); expect(root.value).toBe('2024-02-29');
 root.querySelector<HTMLButtonElement>('button')!.click(); root.setAttribute('readonly',''); expect(root.querySelector<HTMLElement>('[role=dialog]')!.hidden).toBe(true);
});
it('clamps keyboard movement inclusively and preserves day through month navigation',()=>{
 const root=fixture('default-value="2024-02-29" min="2024-02-28" max="2024-03-29"'); root.querySelector<HTMLButtonElement>('button')!.click();
 document.activeElement!.dispatchEvent(new KeyboardEvent('keydown',{key:'Home',bubbles:true})); expect((document.activeElement as HTMLElement).dataset.date).toBe('2024-02-28');
 root.querySelector<HTMLButtonElement>('[aria-label="Next month"]')!.click(); expect(root.querySelector<HTMLElement>('[data-date][tabindex="0"]')?.dataset.date).toBe('2024-03-28');
 root.querySelector<HTMLButtonElement>('[data-date][tabindex="0"]')!.focus(); document.activeElement!.dispatchEvent(new KeyboardEvent('keydown',{key:'End',bubbles:true})); expect((document.activeElement as HTMLElement).dataset.date).toBe('2024-03-29');
});
it('disables year boundary overflow and reconnects without duplicate change listeners',()=>{
 const root=fixture('default-value="9999-12-31" show-clear'); root.querySelector<HTMLButtonElement>('button')!.click();
 for(const day of root.querySelectorAll<HTMLButtonElement>('[data-date^="10000"]')) expect(day.disabled).toBe(true);
 root.setAttribute('disabled',''); expect(root.querySelector<HTMLElement>('[role=dialog]')!.hidden).toBe(true);
 root.removeAttribute('disabled'); root.remove(); document.body.append(root); let count=0; root.addEventListener('af-change',()=>count++);
 root.querySelector<HTMLButtonElement>('button')!.click(); root.querySelector<HTMLButtonElement>('[aria-label="Clear date"]')!.click(); expect(count).toBe(1); expect(root.value).toBe(null);
});
