// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AfSlideDeck, registerSlideDeck } from './slide-deck';
registerSlideDeck();
const fullscreenDescriptor=Object.getOwnPropertyDescriptor(document,'fullscreenElement');
const exitDescriptor=Object.getOwnPropertyDescriptor(document,'exitFullscreen');
afterEach(()=>{document.body.replaceChildren();vi.restoreAllMocks();if(fullscreenDescriptor)Object.defineProperty(document,'fullscreenElement',fullscreenDescriptor);else delete (document as {fullscreenElement?:Element|null}).fullscreenElement;if(exitDescriptor)Object.defineProperty(document,'exitFullscreen',exitDescriptor);else delete (document as {exitFullscreen?:unknown}).exitFullscreen;});
const tick=async()=>{await Promise.resolve();await Promise.resolve();};
function fixture(attrs='') {
  const host=document.createElement('div');host.innerHTML=`<af-slide-deck ${attrs}><af-slide title="Opening" id="original" data-af-id="slide-one"><h1 data-af-id="heading-one">Hello</h1><input aria-label="Slide input" value="Keep me"></af-slide><af-slide title="Closing"><p>Goodbye</p></af-slide></af-slide-deck>`;document.body.append(host);
  const deck=host.firstElementChild as AfSlideDeck;
  const slides=[...deck.querySelectorAll<HTMLElement>('af-slide')];for(const slide of slides)slide.scrollIntoView=vi.fn();
  return {deck,slides,next:deck.querySelector<HTMLButtonElement>('[aria-label="Next slide"]')!,previous:deck.querySelector<HTMLButtonElement>('[aria-label="Previous slide"]')!};
}
describe('native slide deck',()=>{
  it('keeps authored slides mounted with stable identities and accessible rail/count/chrome',()=>{
    const {deck,slides,next}=fixture();const input=slides[0]!.querySelector('input');
    expect(deck.index).toBe(0);expect(deck.querySelector('[data-af-deck-count]')?.textContent).toBe('1 / 2');
    const rail=deck.querySelector('nav[aria-label="Slides"]')!;expect(rail.querySelectorAll('button')).toHaveLength(2);expect(rail.querySelector('button')?.getAttribute('aria-controls')).toBe('original');
    next.click();expect(deck.index).toBe(1);expect(slides[1]!.scrollIntoView).toHaveBeenCalled();expect(slides[0]!.querySelector('input')).toBe(input);expect(slides[0]!.hidden).toBe(false);expect(slides[0]!.getAttribute('data-af-id')).toBe('slide-one');
  });
  it('waits for controlled author selection and accepts canceled intent',()=>{
    const {deck,next,slides}=fixture('index="0"');const intent=vi.fn();deck.addEventListener('af-change',intent);next.click();expect(deck.index).toBe(0);expect(intent.mock.calls[0]![0].detail).toEqual({value:1});expect(slides[1]!.scrollIntoView).not.toHaveBeenCalled();
    deck.index=1;expect(deck.index).toBe(1);expect(slides[1]!.scrollIntoView).toHaveBeenCalled();deck.removeAttribute('index');deck.index=undefined;deck.addEventListener('af-change',event=>event.preventDefault());deck.querySelector<HTMLButtonElement>('[aria-label="Previous slide"]')!.click();expect(deck.index).toBe(1);
  });
  it('honors defaults, empty decks, boundaries and dynamic slide insertion/removal',async()=>{
    const {deck,slides,next}=fixture('default-index="1"');expect(deck.index).toBe(1);expect(next.disabled).toBe(true);slides[0]!.remove();await tick();expect(deck.index).toBe(0);expect(deck.querySelector('[data-af-deck-count]')?.textContent).toBe('1 / 1');
    slides[1]!.remove();await tick();expect(deck.index).toBe(-1);expect(deck.querySelector('[data-af-deck-count]')?.textContent).toBe('0 / 0');expect(next.disabled).toBe(true);
    const slide=document.createElement('af-slide');slide.textContent='New';deck.append(slide);await tick();expect(deck.index).toBe(0);expect(deck.querySelectorAll('nav button')).toHaveLength(1);
  });
  it('scopes keyboard navigation to one deck and ignores editable/control/modifier keys',()=>{
    const first=fixture(),second=fixture();first.deck.focus();first.deck.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true}));expect(first.deck.index).toBe(1);expect(second.deck.index).toBe(0);
    const input=first.slides[0]!.querySelector('input')!;input.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true}));expect(first.deck.index).toBe(1);
    first.deck.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',ctrlKey:true,bubbles:true}));expect(first.deck.index).toBe(1);
    first.next.dispatchEvent(new KeyboardEvent('keydown',{key:' ',bubbles:true}));expect(first.deck.index).toBe(1);
  });
  it('reports scroll selection as intent, refreshes preview text, and preserves active slide across insertions',async()=>{
    const {deck,slides}=fixture();slides.forEach((slide,index)=>{slide.getBoundingClientRect=()=>({top:index===1?10:-900}) as DOMRect;});window.dispatchEvent(new Event('scroll'));expect(deck.index).toBe(1);
    const inserted=document.createElement('af-slide');inserted.textContent='Inserted';deck.prepend(inserted);await tick();expect(deck.index).toBe(2);
    slides[1]!.querySelector('p')!.textContent='Updated';await tick();expect(deck.querySelector('nav')?.textContent).toContain('Updated');
  });
  it('renders inert safe previews without duplicate identities, controls, scripts or fetching resources',async()=>{
    const {deck,slides}=fixture();slides[0]!.insertAdjacentHTML('beforeend','<img src="/private-image" alt="Diagram"><script>unsafe()</script><af-button id="duplicate" data-af-id="button-original">Action</af-button>');await tick();
    const preview=deck.querySelector('[data-af-deck-preview]')!;expect(preview.hasAttribute('inert')).toBe(true);expect(preview.querySelector('[id],[data-af-id],input,button,script,img,[src],af-button')).toBeNull();expect(preview.textContent).toContain('Diagram');expect(deck.querySelectorAll('[data-af-id="heading-one"]')).toHaveLength(1);
  });
  it('labels slides by title and retains passive vector previews without copied identity',async()=>{
    const {deck,slides}=fixture();expect(slides[0]!.getAttribute('aria-label')).toBe('Opening');slides[0]!.insertAdjacentHTML('beforeend','<svg id="chart" viewBox="0 0 20 20"><path data-af-id="curve" d="M0 0L20 20" stroke="blue"></path></svg>');await tick();const path=deck.querySelector('nav svg path');expect(path?.getAttribute('d')).toBe('M0 0L20 20');expect(path?.hasAttribute('data-af-id')).toBe(false);expect(deck.querySelector('nav [id]')).toBeNull();
  });
  it('keeps the rail focus and authored slide nodes while thumbnails refresh',async()=>{
    const {deck,slides}=fixture();const row=deck.querySelector<HTMLButtonElement>('nav button')!;row.focus();slides[0]!.querySelector('h1')!.textContent='Changed';await tick();expect(document.activeElement).toBe(row);expect(deck.querySelector('nav button')).toBe(row);expect(slides[0]!.id).toBe('original');
  });
  it('does not leak nested decks into the outer count or keyboard intent',()=>{
    const {deck,slides}=fixture();const nested=document.createElement('af-slide-deck') as AfSlideDeck;nested.innerHTML='<af-slide>Nested one</af-slide><af-slide>Nested two</af-slide>';slides[0]!.append(nested);nested.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));expect(nested.index).toBe(1);expect(deck.index).toBe(0);
  });
  it('catches rejected fullscreen requests and keeps the present control usable',async()=>{
    const {deck}=fixture();deck.requestFullscreen=vi.fn().mockRejectedValue(new Error('denied'));const present=deck.querySelector<HTMLButtonElement>('[aria-label="Present"]')!;present.focus();present.click();await tick();expect(deck.requestFullscreen).toHaveBeenCalledTimes(1);expect(document.activeElement).toBe(present);expect(deck.querySelector('[role="status"]')?.textContent).toContain('unavailable');expect(present.disabled).toBe(false);
  });
  it('exits only its own pending fullscreen after disconnect/reconnect',async()=>{
    const {deck}=fixture();let full:Element|null=null;Object.defineProperty(document,'fullscreenElement',{configurable:true,get:()=>full});let resolve!:()=>void;deck.requestFullscreen=vi.fn(()=>new Promise<void>(done=>{resolve=done;}));document.exitFullscreen=vi.fn(async()=>{full=null;document.dispatchEvent(new Event('fullscreenchange'));});const present=deck.querySelector<HTMLButtonElement>('[aria-label="Present"]')!;present.click();deck.remove();document.body.append(deck);expect(present.disabled).toBe(true);full=deck;resolve();await tick();await tick();expect(document.exitFullscreen).toHaveBeenCalledOnce();expect(present.disabled).toBe(false);
  });
  it('captures the opener before native disabled-button blur during fullscreen transitions',async()=>{
    const {deck}=fixture();const present=deck.querySelector<HTMLButtonElement>('[aria-label="Present"]')!;
    let full:Element|null=null;Object.defineProperty(document,'fullscreenElement',{configurable:true,get:()=>full});
    deck.requestFullscreen=vi.fn(async()=>{full=deck;document.dispatchEvent(new Event('fullscreenchange'));});
    document.exitFullscreen=vi.fn(async()=>{full=null;document.dispatchEvent(new Event('fullscreenchange'));});
    const disabledSetter=Object.getOwnPropertyDescriptor(HTMLButtonElement.prototype,'disabled')!.set!;
    vi.spyOn(present,'disabled','set').mockImplementation(value=>{disabledSetter.call(present,value);if(value && document.activeElement===present)deck.focus();});
    present.focus();present.click();await tick();expect(present.disabled).toBe(false);
    present.focus();present.click();await tick();expect(document.activeElement).toBe(present);
  });
  it('tracks fullscreen label/exit focus and detaches listeners on remove/reconnect',async()=>{
    const {deck,next}=fixture();const present=deck.querySelector<HTMLButtonElement>('[aria-label="Present"]')!;let full:Element|null=null;Object.defineProperty(document,'fullscreenElement',{configurable:true,get:()=>full});deck.requestFullscreen=vi.fn(async()=>{full=deck;document.dispatchEvent(new Event('fullscreenchange'));});document.exitFullscreen=vi.fn(async()=>{full=null;document.dispatchEvent(new Event('fullscreenchange'));});present.focus();const restoreStates:boolean[]=[];const focus=present.focus.bind(present);vi.spyOn(present,'focus').mockImplementation(()=>{restoreStates.push(present.disabled);focus();});present.click();await tick();expect(present.getAttribute('aria-label')).toBe('Exit presentation');present.click();await tick();expect(document.activeElement).toBe(present);expect(present.getAttribute('aria-label')).toBe('Present');expect(restoreStates).toEqual([false]);
    deck.remove();next.click();expect(deck.index).toBe(0);document.body.append(deck);next.click();expect(deck.index).toBe(1);
  });
});
