// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
afterEach(() => document.body.replaceChildren());
it('coordinates nested tooltip Escape across independently evaluated helper copies', async () => {
 await import('./popover');
 const first = await import('./floating-position');
 vi.resetModules();
 await import('./tooltip');
 const second = await import('./floating-position');
 expect(first.floatingVisibility).not.toBe(second.floatingVisibility);
 const host = document.createElement('div');
 host.innerHTML = '<af-popover default-open><af-popover-trigger><button>Open settings</button></af-popover-trigger><af-popover-content><af-popover-title>Settings</af-popover-title><input aria-label="Setting"><af-tooltip><af-tooltip-trigger><button>Help</button></af-tooltip-trigger><af-tooltip-content>Details</af-tooltip-content></af-tooltip></af-popover-content></af-popover>';
 document.body.append(host);
 const popover = host.querySelector('af-popover')!; const tooltip = host.querySelector('af-tooltip')!;
 host.querySelector<HTMLButtonElement>('af-tooltip-trigger button')!.focus();
 expect(popover.getAttribute('data-state')).toBe('open'); expect(tooltip.getAttribute('data-state')).toBe('open');
 document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',cancelable:true}));
 expect(tooltip.getAttribute('data-state')).toBe('closed'); expect(popover.getAttribute('data-state')).toBe('open');
 expect(second.topFloating(popover as HTMLElement)).toBe(true);
 popover.remove(); expect(first.topFloating(popover as HTMLElement)).toBe(false);
});
