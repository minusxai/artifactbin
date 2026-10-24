import { floatingVisibility, identifyFloating, positionFloating, topFloating } from './floating-position';
import { inBounds, localToday, monthGrid, moveMonth, validDate, type CalendarMonth } from './date-calendar';
export interface AfDatePickerChangeDetail { value: string | null }
interface DatePickerClock { clock: () => Date }
/** Author-owned controlled value, or viewer-local default; never persists data. */
export class AfDatePicker extends HTMLElement implements DatePickerClock {
  /** Inject local time for deterministic viewer behavior. */
  clock: () => Date = () => new Date();
  private focusedDate: string | null = null;
  static observedAttributes = ['value','label','aria-label','min','max','disabled','readonly','read-only','placeholder'];
  private controlled = false;
  private propertyValue: string | null = null;
  private state: string | null = null;
  private initialized = false;
  private trigger?: HTMLButtonElement;
  private popup?: HTMLDivElement;
  private view: CalendarMonth = {year:2024,month:1};
  private open = false;
  get value(): string | null { const v=this.controlled ? this.propertyValue : this.hasAttribute('value') ? this.getAttribute('value') : this.state; return validDate(v) ? v : null; }
  set value(value: string | null) { this.controlled=true; this.propertyValue=validDate(value)?value:null; this.render(); }
  get disabled(): boolean { return this.hasAttribute('disabled'); }
  set disabled(value: boolean) { this.toggleAttribute('disabled',value); }
  private get locked(): boolean { return this.disabled || this.hasAttribute('readonly') || this.hasAttribute('read-only'); }
  connectedCallback(): void {
    if(Object.prototype.hasOwnProperty.call(this,'value')) { const v=this.value; delete (this as unknown as {value?:string|null}).value; this.value=v; }
    if(!this.initialized) { const v=this.getAttribute('default-value'); this.state=validDate(v)?v:null; this.initialized=true; }
    if(!this.trigger) {
      this.trigger=this.ownerDocument.createElement('button'); this.trigger.type='button'; this.trigger.className='af-date-trigger';
      this.trigger.setAttribute('aria-haspopup','dialog'); this.trigger.addEventListener('click',()=>this.toggle());
      this.popup=this.ownerDocument.createElement('div'); this.popup.className='af-date-popup'; this.popup.setAttribute('role','dialog'); this.popup.setAttribute('popover','manual'); identifyFloating(this.popup); this.trigger.setAttribute('aria-controls',this.popup.id);
      this.prepend(this.trigger,this.popup); this.addEventListener('keydown',this.keydown);
      this.addEventListener('focusout',event=>{ if(event.relatedTarget instanceof Node && !this.contains(event.relatedTarget)) this.close(false); });
    }
    this.ownerDocument.addEventListener('pointerdown',this.outside);
    this.ownerDocument.defaultView?.addEventListener('resize',this.position); this.ownerDocument.addEventListener('scroll',this.position,true); this.render();
  }
  disconnectedCallback(): void { this.ownerDocument.removeEventListener('pointerdown',this.outside); this.ownerDocument.defaultView?.removeEventListener('resize',this.position); this.ownerDocument.removeEventListener('scroll',this.position,true); this.close(false); }
  attributeChangedCallback(): void { if(this.locked && this.open) this.close(!this.disabled); else this.render(); }
  private outside = (event: Event): void => { if(this.open && topFloating(this) && !event.composedPath().includes(this)) this.close(false); };
  private close(focus=true): void { this.open=false; floatingVisibility(this,false); this.render(); if(focus) this.trigger?.focus(); }
  private toggle(): void {
    if(this.locked) return;
    if(this.open) { this.close(); return; }
    const value=this.value ?? localToday(this.clock); this.view={year:Number(value.slice(0,4)),month:Number(value.slice(5,7))}; this.focusedDate=value; this.open=true; floatingVisibility(this,true); this.render();
    (this.popup?.querySelector<HTMLButtonElement>('[data-date][tabindex="0"]:not(:disabled)') ?? this.popup?.querySelector<HTMLButtonElement>('[data-date]:not(:disabled)'))?.focus();
  }
  private choose(value:string|null): void {
    if(this.locked || (value!==null && !inBounds(value,{min:this.getAttribute('min'),max:this.getAttribute('max')}))) return;
    const accepted=this.dispatchEvent(new CustomEvent<AfDatePickerChangeDetail>('af-change',{detail:{value},bubbles:true,composed:true,cancelable:true}));
    if(accepted && !this.controlled && !this.hasAttribute('value')) this.state=value;
    this.close();
  }
  private keydown = (event: KeyboardEvent): void => {
    if(event.key==='Escape' && this.open && topFloating(this)) { event.preventDefault(); this.close(); return; }
    if(!this.open) { if(event.key==='ArrowDown' && !this.locked) { event.preventDefault(); this.toggle(); } return; }
    const target=event.target as HTMLElement;
    if (!target.dataset.date) return;
    const current = new Date(`${target.dataset.date}T12:00:00`);
    let next: string | undefined;
    if (event.key === 'PageUp' || event.key === 'PageDown') {
      const view = moveMonth({year:current.getFullYear(),month:current.getMonth()+1}, (event.key === 'PageUp' ? -1 : 1) * (event.shiftKey ? 12 : 1));
      const dates = monthGrid(view).filter(day=>day.inMonth);
      next = dates[Math.min(current.getDate(),dates.length)-1]?.value;
    } else {
      const rtl = this.closest('[dir]')?.getAttribute('dir') === 'rtl' || this.ownerDocument.defaultView?.getComputedStyle(this).direction === 'rtl';
      const delta = ({ArrowLeft:rtl?1:-1,ArrowRight:rtl?-1:1,ArrowUp:-7,ArrowDown:7,Home:-current.getDay(),End:6-current.getDay()} as Record<string,number>)[event.key];
      if (delta === undefined) return;
      current.setDate(current.getDate()+delta); next=localToday(()=>current);
    }
    event.preventDefault();
    if (next) this.focusDay(this.clampDate(next));
  };
  private clampDate(value: string): string {
    if (!validDate(value)) return value;
    const min=this.getAttribute('min'), max=this.getAttribute('max');
    if (validDate(min) && value<min) return min;
    if (validDate(max) && value>max) return max;
    return value;
  }
  private focusDay(value: string): void {
    if (!inBounds(value,{min:this.getAttribute('min'),max:this.getAttribute('max')})) return;
    this.focusedDate=value; this.view={year:Number(value.slice(0,4)),month:Number(value.slice(5,7))}; this.render();
    this.popup?.querySelector<HTMLButtonElement>(`[data-date="${value}"]`)?.focus();
  }
  private position = (): void => { if(this.open && this.trigger && this.popup) positionFloating(this.trigger,this.popup,'bottom',4); };

  private render(): void {
    if(!this.trigger || !this.popup) return;
    const active=this.ownerDocument.activeElement as HTMLElement | null;
    const restore=!!active && this.popup.contains(active);
    const activeDate=active?.dataset.date; const activeLabel=active?.getAttribute('aria-label');
    const label=this.getAttribute('aria-label') || this.getAttribute('label') || 'Date';
    this.trigger.textContent=this.value ?? this.getAttribute('placeholder') ?? 'Pick a date'; this.trigger.setAttribute('aria-label',`${label}: ${this.value ?? 'Pick a date'}`);
    this.trigger.disabled=this.disabled; this.trigger.setAttribute('aria-readonly',String(this.locked)); this.trigger.setAttribute('aria-expanded',String(this.open));
    this.popup.hidden=!this.open; this.popup.setAttribute('aria-label',`${label} calendar`); if(!this.open) { if(typeof this.popup.hidePopover==='function' && this.popup.matches(':popover-open')) this.popup.hidePopover(); return; }
    this.popup.replaceChildren();
    const button=(text:string,name:string,action:()=>void):HTMLButtonElement=>{const b=this.ownerDocument.createElement('button'); b.type='button'; b.textContent=text; b.setAttribute('aria-label',name); b.addEventListener('click',action); return b;};
    const header=this.ownerDocument.createElement('div'); header.className='af-date-header';
    const title=this.ownerDocument.createElement('span'); const d=new Date(0); d.setFullYear(this.view.year,this.view.month-1,1);
    title.textContent=new Intl.DateTimeFormat('en',{month:'long',year:'numeric'}).format(d); title.setAttribute('aria-live','polite');
    const nav=(delta:number)=>{const day=Number((this.focusedDate ?? this.value ?? localToday(this.clock)).slice(8)); this.view=moveMonth(this.view,delta); const dates=monthGrid(this.view).filter(cell=>cell.inMonth); this.focusedDate=this.clampDate(dates[Math.min(day,dates.length)-1]!.value); this.render(); this.popup?.querySelector<HTMLButtonElement>(`[aria-label="${delta===-12?'Previous year':delta===-1?'Previous month':delta===1?'Next month':'Next year'}"]`)?.focus();};
    header.append(button('«','Previous year',()=>nav(-12)),button('‹','Previous month',()=>nav(-1)),title,button('›','Next month',()=>nav(1)),button('»','Next year',()=>nav(12))); this.popup.append(header);
    const grid=this.ownerDocument.createElement('div'); grid.className='af-date-grid';
    for(const day of ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']) { const el=this.ownerDocument.createElement('abbr'); el.textContent=day.slice(0,2); el.setAttribute('aria-label',day); grid.append(el); }
    const today=localToday(this.clock);
    const cells=monthGrid(this.view); const selectable=cells.filter(cell=>inBounds(cell.value,{min:this.getAttribute('min'),max:this.getAttribute('max')}));
    if(!selectable.some(cell=>cell.value===this.focusedDate)) this.focusedDate=selectable.find(cell=>cell.value===this.value)?.value ?? selectable.find(cell=>cell.inMonth)?.value ?? selectable[0]?.value ?? null;
    for(const cell of cells) { const b=button(String(cell.day),cell.value,()=>this.choose(cell.value)); b.dataset.date=cell.value; b.tabIndex=cell.value===this.focusedDate?0:-1; b.addEventListener('focus',()=>{this.focusedDate=cell.value; for(const day of this.popup!.querySelectorAll<HTMLButtonElement>('[data-date]')) day.tabIndex=day===b?0:-1;}); b.dataset.adjacent=String(!cell.inMonth); b.setAttribute('aria-pressed',String(cell.value===this.value)); if(cell.value===today)b.setAttribute('aria-current','date'); b.disabled=!inBounds(cell.value,{min:this.getAttribute('min'),max:this.getAttribute('max')}); grid.append(b); }
    this.popup.append(grid); const todayButton=button('Today','Today',()=>this.choose(today)); todayButton.disabled=!inBounds(today,{min:this.getAttribute('min'),max:this.getAttribute('max')}); this.popup.append(todayButton,button('Clear','Clear date',()=>this.choose(null)));
    if(typeof this.popup.showPopover==='function' && !this.popup.matches(':popover-open')) this.popup.showPopover();
    this.position();
    if(restore) { const candidate=[...this.popup.querySelectorAll<HTMLButtonElement>('button')].find(button=>!button.disabled && (activeDate ? button.dataset.date===this.focusedDate : button.getAttribute('aria-label')===activeLabel)); (candidate ?? this.popup.querySelector<HTMLButtonElement>('[data-date][tabindex="0"]') ?? this.trigger).focus(); }
  }
}
const styles=`af-date-picker{display:inline-block;position:relative;color:var(--foreground,#222);font:inherit}af-date-picker button{box-sizing:border-box;font:inherit;color:inherit;background:var(--background,#fff);border:1px solid var(--border,#ddd);border-radius:var(--radius-sm,calc(var(--radius,.625rem) - 4px));padding:.375rem;cursor:pointer}af-date-picker .af-date-trigger{height:2.25rem;border-radius:var(--radius-md,calc(var(--radius,.625rem) - 2px));padding:0 .75rem;font-size:.875rem;line-height:1.25rem;border-color:var(--input,#ddd);box-shadow:0 1px 2px #0000000d}af-date-picker button:disabled{opacity:.4;cursor:not-allowed}af-date-picker button:focus-visible{outline:2px solid var(--ring,#777);outline-offset:2px}af-date-picker .af-date-popup{position:fixed;inset:auto;margin:0;z-index:50;box-sizing:border-box;width:18rem;max-width:calc(100vw - 16px);max-height:calc(100dvh - 16px);overflow:auto;padding:.75rem;background:var(--popover,var(--background,#fff));color:var(--popover-foreground,var(--foreground,#222));border:1px solid var(--border,#ddd);border-radius:var(--radius-md,calc(var(--radius,.625rem) - 2px));box-shadow:var(--shadow-md,0 4px 6px -1px rgb(0 0 0 / 10%),0 2px 4px -2px rgb(0 0 0 / 10%))}af-date-picker .af-date-popup[hidden]{display:none}af-date-picker .af-date-header{display:flex;align-items:center;justify-content:space-between;gap:.25rem}af-date-picker .af-date-grid{display:grid;grid-template-columns:repeat(7,1fr);margin:.5rem 0;gap:.125rem;text-align:center}af-date-picker .af-date-grid button{border:0}af-date-picker [data-adjacent=true]{color:var(--muted-foreground,#777)}af-date-picker [aria-pressed=true]{background:var(--primary,#222);color:var(--primary-foreground,#fff)}af-date-picker abbr{text-decoration:none;font-size:.75rem}`;
export function registerDatePicker(registry:CustomElementRegistry=customElements,document:Document=globalThis.document):void {
 if(!document.querySelector('style[data-af-date-picker-styles]')) { const style=document.createElement('style'); style.setAttribute('data-af-date-picker-styles',''); style.textContent=styles; document.head.append(style); }
 if(!registry.get('af-date-picker'))registry.define('af-date-picker',AfDatePicker);
}
