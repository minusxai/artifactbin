/**
 * <af-date-picker>: date field with a calendar popup.
 * Usage: import '@afbin/date-picker';  (registers the tags; this .ts is the readable contract)
 * Props: value ("YYYY-MM-DD" or null), default-value, label, aria-label, min, max, disabled,
 *   readonly, placeholder, show-year-navigation, show-clear.
 * Events: af-change (bubbles, cancelable) with event.detail.value.
 * Examples:
 *   <af-date-picker label="Due" min="2026-01-01"></af-date-picker>
 * Gotchas: reflect your Apollo value back for controlled use; it never persists data. An explicit
 *   aria-label names the trigger verbatim and the current value becomes its description.
 */
import { registerComponent } from './register-component';
import { floatingVisibility, identifyFloating, positionFloating,
  topFloating } from './floating-position';
import { calendarBody, calendarIcon, clampDate, inBounds, keyTarget, localToday,
  moveMonth, sameDay, validDate, type CalendarMonth, type DateBounds } from './date-calendar';
import { datePickerStyles } from './date-picker-styles';
export interface AfDatePickerChangeDetail { value: string | null }
interface DatePickerClock { clock: () => Date }
/** An explicit aria-label names the trigger verbatim; its current value is a description. */
export interface AfDatePickerContract { label: string; value: string | null; disabled: boolean;
  showYearNavigation: boolean; showClear: boolean }
/** Author-owned controlled value, or viewer-local default; never persists data. */
export class AfDatePicker extends HTMLElement implements DatePickerClock, AfDatePickerContract {
  /** Inject local time for deterministic viewer behavior. */
  clock: () => Date = () => new Date();
  private focusedDate: string | null = null;
  static observedAttributes = ['value','label','aria-label','min','max','disabled','readonly',
    'read-only','placeholder','show-year-navigation','show-clear'];
  private controlled = false; private propertyValue: string | null = null;
  private state: string | null = null; private initialized = false;
  private labelNode?: HTMLSpanElement; private trigger?: HTMLButtonElement;
  private valueNode?: HTMLSpanElement; private popup?: HTMLDivElement;
  private view: CalendarMonth = {year:2024,month:1};
  private open = false;
  get value(): string | null {
    const v=this.controlled ? this.propertyValue
      : this.hasAttribute('value') ? this.getAttribute('value') : this.state;
    return validDate(v) ? v : null;
  }
  set value(value: string | null) {
    this.controlled=true; this.propertyValue=validDate(value)?value:null; this.render();
  }
  get disabled(): boolean { return this.hasAttribute('disabled'); }
  set disabled(value: boolean) { this.toggleAttribute('disabled',value); }
  get showYearNavigation(): boolean { return this.hasAttribute('show-year-navigation'); }
  set showYearNavigation(value: boolean) { this.toggleAttribute('show-year-navigation',value); }
  get showClear(): boolean { return this.hasAttribute('show-clear'); }
  set showClear(value: boolean) { this.toggleAttribute('show-clear',value); }
  get label(): string { return this.getAttribute('label') ?? ''; }
  set label(value: string) { this.setAttribute('label',value); }
  private get locked(): boolean { return this.disabled || this.hasAttribute('readonly') ||
    this.hasAttribute('read-only'); }
  private get bounds(): DateBounds { return {min:this.getAttribute('min'),
    max:this.getAttribute('max')}; }
  connectedCallback(): void {
    // Properties set before upgrade shadow the accessors; replay them through the setters.
    for(const name of ['value','showYearNavigation','showClear'] as const) {
      if(!Object.prototype.hasOwnProperty.call(this,name)) continue;
      const value=this[name]; delete (this as unknown as Record<string,unknown>)[name];
      (this as unknown as Record<string,unknown>)[name]=value;
    }
    if(!this.initialized) {
      const v=this.getAttribute('default-value'); this.state=validDate(v)?v:null;
      this.initialized=true;
    }
    if(!this.trigger) {
      const doc=this.ownerDocument;
      this.labelNode=doc.createElement('span'); this.labelNode.className='af-date-label';
      this.trigger=doc.createElement('button'); this.trigger.type='button';
      this.trigger.className='af-date-trigger';
      this.valueNode=doc.createElement('span'); this.valueNode.className='af-date-value';
      this.trigger.append(this.valueNode,calendarIcon(doc));
      this.trigger.setAttribute('aria-haspopup','dialog');
      this.trigger.addEventListener('click',()=>this.toggle());
      this.popup=doc.createElement('div'); this.popup.className='af-date-popup';
      this.popup.setAttribute('role','dialog'); this.popup.setAttribute('popover','manual');
      this.popup.setAttribute('align','start'); identifyFloating(this.popup);
      this.trigger.setAttribute('aria-controls',this.popup.id);
      this.prepend(this.trigger,this.popup); this.addEventListener('keydown',this.keydown);
      this.addEventListener('focusout',event=>{ if(event.relatedTarget instanceof Node &&
        !this.contains(event.relatedTarget)) this.close(false); });
    }
    this.ownerDocument.addEventListener('pointerdown',this.outside);
    this.ownerDocument.defaultView?.addEventListener('resize',this.position);
    this.ownerDocument.addEventListener('scroll',this.position,true); this.render();
  }
  disconnectedCallback(): void {
    this.ownerDocument.removeEventListener('pointerdown',this.outside);
    this.ownerDocument.defaultView?.removeEventListener('resize',this.position);
    this.ownerDocument.removeEventListener('scroll',this.position,true); this.close(false);
  }
  attributeChangedCallback(): void {
    if(this.locked && this.open) this.close(!this.disabled); else this.render();
  }
  // Only the topmost floating layer reacts to outside presses and Escape.
  private outside = (event: Event): void => {
    if(this.open && topFloating(this) && !event.composedPath().includes(this)) this.close(false);
  };
  private close(focus=true): void {
    this.open=false; floatingVisibility(this,false); this.render(); if(focus) this.trigger?.focus();
  }
  private toggle(): void {
    if(this.locked) return;
    if(this.open) { this.close(); return; }
    const value=this.value ?? localToday(this.clock);
    this.view={year:Number(value.slice(0,4)),month:Number(value.slice(5,7))};
    this.focusedDate=value; this.open=true; floatingVisibility(this,true); this.render();
    (this.popup?.querySelector<HTMLButtonElement>('[data-date][tabindex="0"]:not(:disabled)') ??
      this.popup?.querySelector<HTMLButtonElement>('[data-date]:not(:disabled)'))?.focus();
  }
  private choose(value:string|null): void {
    if(this.locked || (value!==null && !inBounds(value,this.bounds))) return;
    const accepted=this.dispatchEvent(new CustomEvent<AfDatePickerChangeDetail>('af-change',
      {detail:{value},bubbles:true,composed:true,cancelable:true}));
    // Only an uncontrolled picker keeps the choice; a canceled event leaves it unchanged.
    if(accepted && !this.controlled && !this.hasAttribute('value')) this.state=value;
    this.close();
  }
  private keydown = (event: KeyboardEvent): void => {
    if(event.key==='Escape' && this.open && topFloating(this)) {
      event.preventDefault(); this.close(); return;
    }
    if(!this.open) {
      if(event.key==='ArrowDown' && !this.locked) { event.preventDefault(); this.toggle(); }
      return;
    }
    const target=event.target as HTMLElement;
    if (!target.dataset.date) return;
    const next=keyTarget(target.dataset.date,event,()=>
      this.closest('[dir]')?.getAttribute('dir') === 'rtl' ||
      this.ownerDocument.defaultView?.getComputedStyle(this).direction === 'rtl');
    if (next === undefined) return;
    event.preventDefault(); this.focusDay(clampDate(next,this.bounds));
  };
  private focusDay(value: string): void {
    if (!inBounds(value,this.bounds)) return;
    this.focusedDate=value;
    this.view={year:Number(value.slice(0,4)),month:Number(value.slice(5,7))}; this.render();
    this.popup?.querySelector<HTMLButtonElement>(`[data-date="${value}"]`)?.focus();
  }
  private position = (): void => {
    if(!this.open || !this.trigger || !this.popup) return;
    positionFloating(this.trigger,this.popup,'bottom',4);
  };
  // Month/year arrows keep the day of month (clamped to bounds) and keep focus on the arrow.
  private nav(delta:number,name:string): void {
    const day=Number((this.focusedDate ?? this.value ?? localToday(this.clock)).slice(8));
    this.view=moveMonth(this.view,delta);
    this.focusedDate=clampDate(sameDay(this.view,day)!,this.bounds); this.render();
    this.popup?.querySelector<HTMLButtonElement>(`[aria-label="${name}"]`)?.focus();
  }
  private render(): void {
    if(!this.trigger || !this.popup) return;
    const doc=this.ownerDocument; const active=doc.activeElement as HTMLElement | null;
    const restore=!!active && this.popup.contains(active);
    const activeDate=active?.dataset.date; const activeLabel=active?.getAttribute('aria-label');
    const label=this.getAttribute('aria-label') || this.getAttribute('label') || 'Date';
    const visibleLabel=this.getAttribute('label') ?? '';
    if(visibleLabel) { this.labelNode!.textContent=visibleLabel;
      if(this.labelNode!.parentElement!==this) this.insertBefore(this.labelNode!,this.trigger);
    } else this.labelNode?.remove();
    this.valueNode!.textContent=this.value ?? this.getAttribute('placeholder') ?? 'Pick a date';
    const explicitLabel=this.getAttribute('aria-label');
    this.trigger.setAttribute('aria-label',
      explicitLabel ?? `${label}: ${this.value ?? 'Pick a date'}`);
    if(explicitLabel===null) this.trigger.removeAttribute('aria-description');
    else this.trigger.setAttribute('aria-description',this.valueNode!.textContent);
    this.trigger.disabled=this.disabled;
    this.trigger.setAttribute('aria-readonly',String(this.locked));
    this.trigger.setAttribute('aria-expanded',String(this.open));
    this.popup.hidden=!this.open; this.popup.setAttribute('aria-label',`${label} calendar`);
    if(!this.open) { if(typeof this.popup.hidePopover==='function' &&
      this.popup.matches(':popover-open')) this.popup.hidePopover(); return; }
    // The open popup is rebuilt on every render; focus is restored at the end.
    this.popup.replaceChildren();
    this.focusedDate=calendarBody(doc,this.popup,{view:this.view,focused:this.focusedDate,
      value:this.value,today:localToday(this.clock),bounds:this.bounds,
      years:this.showYearNavigation,clear:this.showClear},{choose:value=>this.choose(value),
      focus:value=>{ this.focusedDate=value; },nav:(delta,name)=>this.nav(delta,name)});
    if(typeof this.popup.showPopover==='function' &&
      !this.popup.matches(':popover-open')) this.popup.showPopover();
    this.position();
    if(restore) {
      const candidate=[...this.popup.querySelectorAll<HTMLButtonElement>('button')].find(button=>
        !button.disabled && (activeDate ? button.dataset.date===this.focusedDate :
          button.getAttribute('aria-label')===activeLabel));
      (candidate ?? this.popup.querySelector<HTMLButtonElement>('[data-date][tabindex="0"]') ??
        this.trigger).focus();
    }
  }
}
registerComponent({
  styleKey: 'af-date-picker-styles',
  styles: datePickerStyles,
  elements: { 'af-date-picker': AfDatePicker },
});
