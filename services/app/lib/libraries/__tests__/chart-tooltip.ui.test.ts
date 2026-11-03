import {afterEach,expect,it} from 'vitest';
import {tooltipHandler} from '../chart-tooltip';

type Handler = ReturnType<typeof tooltipHandler>;
const card = () => document.querySelector<HTMLElement>('.af-vega-tooltip');
function chart() {
 const container = document.createElement('div'); document.body.append(container);
 return {container, scene: {element: () => container}};
}
const move = (x: number, y: number) => new MouseEvent('mousemove', {clientX: x, clientY: y});
function show(handler: Handler, value: unknown, x = 20, y = 20) {
 const {container, scene} = chart(); handler.call({}, scene, move(x, y), {}, value); return {container, scene};
}
afterEach(() => { document.body.replaceChildren(); document.head.querySelectorAll('style').forEach(s => s.remove()); });

it('shows a themed card on the first hover, titled by field, with no native title attribute', () => {
 const handler = tooltipHandler();
 const {container} = show(handler, {title: 'Show HN: a chart', Points: '470', Comments: '1,204'});
 const el = card()!;
 expect(el).not.toBeNull(); expect(el.getAttribute('role')).toBe('tooltip');
 expect(el.parentElement).toBe(document.body);
 expect(el.querySelector('.af-vega-tooltip-title')?.textContent).toBe('Show HN: a chart');
 expect([...el.querySelectorAll('tr')].map(row => [...row.cells].map(cell => cell.textContent))).toEqual([['Points', '470'], ['Comments', '1,204']]);
 expect(container.hasAttribute('title')).toBe(false);
 const css = document.head.querySelector('style[data-af-vega-tooltip-styles]')?.textContent ?? '';
 for (const token of ['--popover', '--popover-foreground', '--border', '--muted-foreground', '--font-body', '--radius']) expect(css).toContain(token);
});

it('writes every field as text, never markup', () => {
 const handler = tooltipHandler();
 show(handler, {'<b>key</b>': '<img src=x onerror="alert(1)">', 'A & B': '"quoted" & <i>x</i>'});
 const el = card()!;
 expect(el.querySelector('img,b,i,script')).toBeNull();
 expect(el.textContent).toContain('<img src=x onerror="alert(1)">'); expect(el.textContent).toContain('<b>key</b>');
 show(handler, '<svg onload=alert(1)>');
 expect(card()!.querySelector('svg')).toBeNull(); expect(card()!.textContent).toBe('<svg onload=alert(1)>');
});

it('stays inside the viewport near every edge', () => {
 const handler = tooltipHandler();
 const {scene} = show(handler, {Value: '1'});
 const el = card()!;
 Object.defineProperty(el, 'getBoundingClientRect', {value: () => ({width: 200, height: 80, left: 0, top: 0, right: 200, bottom: 80, x: 0, y: 0})});
 for (const [x, y] of [[window.innerWidth - 2, window.innerHeight - 2], [1, 1], [window.innerWidth / 2, window.innerHeight - 10]]) {
  handler.call({}, scene, move(x, y), {}, {Value: '1'});
  const left = parseFloat(el.style.left), top = parseFloat(el.style.top);
  expect(left).toBeGreaterThanOrEqual(0); expect(left + 200).toBeLessThanOrEqual(window.innerWidth);
  expect(top).toBeGreaterThanOrEqual(0); expect(top + 80).toBeLessThanOrEqual(window.innerHeight);
 }
});

it('dismisses on Escape, on an outside press, on leaving the chart and on scroll', () => {
 const handler = tooltipHandler();
 const {container, scene} = show(handler, {Value: '1'});
 const reopen = () => { handler.call({}, scene, move(10, 10), {}, {Value: '1'}); expect(card()).not.toBeNull(); };
 document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', bubbles: true})); expect(card()).not.toBeNull();
 document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true})); expect(card()).toBeNull();
 reopen(); container.dispatchEvent(new Event('pointerdown', {bubbles: true})); expect(card()).not.toBeNull();
 document.body.dispatchEvent(new Event('pointerdown', {bubbles: true})); expect(card()).toBeNull();
 reopen(); container.dispatchEvent(new Event('pointerleave')); expect(card()).toBeNull();
 reopen(); document.dispatchEvent(new Event('scroll')); expect(card()).toBeNull();
});

it('removes the card and its listeners when Vega hides or finalizes (a null value)', () => {
 const handler = tooltipHandler();
 const {scene} = show(handler, {Value: '1'});
 const added: string[] = [], removed: string[] = [];
 const add = document.addEventListener.bind(document), remove = document.removeEventListener.bind(document);
 document.addEventListener = ((...args: Parameters<typeof add>) => { added.push(args[0]); return add(...args); }) as typeof add;
 document.removeEventListener = ((...args: Parameters<typeof remove>) => { removed.push(args[0]); return remove(...args); }) as typeof remove;
 try {
  handler.call({}, scene, null, null, null); expect(card()).toBeNull();
  expect(removed.sort()).toEqual(['keydown', 'pointercancel', 'pointerdown', 'scroll']);
  handler.call({}, scene, move(5, 5), {}, {Value: '2'}); expect(card()!.textContent).toContain('2');
  handler.call({}, scene, move(5, 5), {}, ''); expect(card()).toBeNull();
  expect(added.sort()).toEqual(['keydown', 'pointercancel', 'pointerdown', 'scroll']); expect(removed).toHaveLength(8);
 } finally { delete (document as Partial<Document>).addEventListener; delete (document as Partial<Document>).removeEventListener; }
});

it('keeps one card per view while the pointer moves between marks', () => {
 const handler = tooltipHandler();
 const {scene} = show(handler, {Value: '1'});
 handler.call({}, scene, move(30, 30), {}, {Value: '2'});
 expect(document.querySelectorAll('.af-vega-tooltip')).toHaveLength(1);
 expect(card()!.textContent).toContain('2');
});
