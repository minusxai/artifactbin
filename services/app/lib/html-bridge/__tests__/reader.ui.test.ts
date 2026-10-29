import { expect, it } from 'vitest';
import { applyHtmlReaderAppearance, installHtmlReaderCommands } from '../reader';

it('refuses synthetic reader commands even with a forged parent and platform origin', () => {
  const stop = installHtmlReaderCommands(window, 'https://platform.example');
  document.documentElement.removeAttribute('data-af-dark');
  window.dispatchEvent(new MessageEvent('message', { origin: 'https://platform.example', source: window.parent, data: { type: 'mx:reader-mode', mode: 'dark' } }));
  expect(document.documentElement.hasAttribute('data-af-dark')).toBe(false);
  stop();
});

function createReaderWindow() {
  let listener: ((event: MessageEvent) => void) | undefined;
  const parent = {} as Window;
  const root = {
    attrs: new Map<string, string>(),
    style: { colorScheme: '' },
    setAttribute(name: string, value: string) { this.attrs.set(name, value); },
    removeAttribute(name: string) { this.attrs.delete(name); },
    hasAttribute(name: string) { return this.attrs.has(name); },
    getAttribute(name: string) { return this.attrs.get(name) ?? null; },
    toggleAttribute(name: string, force?: boolean) {
      if (force) this.attrs.set(name, '');
      else this.attrs.delete(name);
      return !!force;
    },
  };
  const win = {
    parent,
    document: { documentElement: root, getElementById: () => null },
    location: { hash: '' },
    addEventListener: (_type: string, callback: (event: MessageEvent) => void) => { listener = callback; },
    removeEventListener: (_type: string, callback: (event: MessageEvent) => void) => { if (listener === callback) listener = undefined; },
  } as unknown as Window;
  return {
    win,
    root,
    deliver(data: unknown, options: { trusted?: boolean; source?: MessageEventSource | null; origin?: string } = {}) {
      listener?.({
        isTrusted: options.trusted ?? true,
        source: options.source === undefined ? parent : options.source,
        origin: options.origin ?? 'https://platform.example',
        data,
      } as MessageEvent);
    },
    hasListener: () => listener !== undefined,
  };
}

it('sets the exact dark attribute, explicitly false for light, while preserving color scheme', () => {
  const mock = createReaderWindow();
  const stop = installHtmlReaderCommands(mock.win, 'https://platform.example');
  mock.deliver({ type: 'mx:reader-mode', mode: 'dark' });
  expect(mock.root.getAttribute('data-af-dark')).toBe('true');
  expect(mock.root.style.colorScheme).toBe('dark');
  mock.deliver({ type: 'mx:reader-mode', mode: 'light' });
  expect(mock.root.getAttribute('data-af-dark')).toBe('false');
  expect(mock.root.style.colorScheme).toBe('light');
  stop();
});

it('ignores invalid or untrusted reader commands without changing the mode', () => {
  const mock = createReaderWindow();
  const stop = installHtmlReaderCommands(mock.win, 'https://platform.example');
  mock.root.setAttribute('data-af-dark', 'true');
  mock.root.style.colorScheme = 'dark';
  mock.deliver({ type: 'mx:reader-mode', mode: 'sepia' });
  mock.deliver({ type: 'mx:reader-mode', mode: 'light' }, { trusted: false });
  mock.deliver({ type: 'mx:reader-mode', mode: 'light' }, { source: {} as Window });
  mock.deliver({ type: 'mx:reader-mode', mode: 'light' }, { origin: 'https://other.example' });
  expect(mock.root.getAttribute('data-af-dark')).toBe('true');
  expect(mock.root.style.colorScheme).toBe('dark');
  stop();
});

it('removes the message listener on cleanup and keeps the frame hash contract', () => {
  const mock = createReaderWindow();
  const stop = installHtmlReaderCommands(mock.win, 'https://platform.example');
  mock.deliver({ type: 'mx:frame-hash', hash: '#section-1' });
  expect(mock.win.location.hash).toBe('#section-1');
  stop();
  expect(mock.hasListener()).toBe(false);
  mock.deliver({ type: 'mx:reader-mode', mode: 'dark' });
  expect(mock.root.hasAttribute('data-af-dark')).toBe(false);
});

it('switches the design system live on the owner command, keeping the given mode, and ignores malformed names', () => {
  const mock = createReaderWindow();
  const stop = installHtmlReaderCommands(mock.win, 'https://platform.example');
  mock.deliver({ type: 'mx:design-system', name: 'nocturne', mode: 'dark' });
  expect(mock.root.getAttribute('data-af-design-system')).toBe('nocturne');
  expect(mock.root.getAttribute('data-af-dark')).toBe('true');
  mock.deliver({ type: 'mx:design-system', name: 'Not A System"]', mode: 'light' });
  mock.deliver({ type: 'mx:design-system', name: 'redline' });
  expect(mock.root.getAttribute('data-af-design-system')).toBe('nocturne');
  expect(mock.root.getAttribute('data-af-dark')).toBe('true');
  stop();
});

it('applies only well-formed reader modes and design-system names, refusing everything else untouched', () => {
  const root = document.documentElement;
  root.removeAttribute('data-af-dark'); root.removeAttribute('data-af-design-system'); root.style.colorScheme = '';
  expect(applyHtmlReaderAppearance(document, { type: 'mx:reader-mode', mode: 'dark' })).toBe(true);
  expect(root.getAttribute('data-af-dark')).toBe('true'); expect(root.style.colorScheme).toBe('dark');
  expect(applyHtmlReaderAppearance(document, { type: 'mx:design-system', name: 'paper-2', mode: 'light' })).toBe(true);
  expect(root.getAttribute('data-af-design-system')).toBe('paper-2'); expect(root.getAttribute('data-af-dark')).toBe('false');
  for (const command of [null, 'dark', { type: 'mx:reader-mode', mode: 'sepia' }, { type: 'mx:reader-mode' }, { type: 'other', mode: 'dark' },
    { type: 'mx:design-system', name: 'Paper', mode: 'dark' }, { type: 'mx:design-system', name: '1paper', mode: 'dark' },
    { type: 'mx:design-system', name: 'a'.repeat(65), mode: 'dark' }, { type: 'mx:design-system', name: 'x"]{}', mode: 'dark' }, { type: 'mx:design-system', mode: 'dark' }])
    expect(applyHtmlReaderAppearance(document, command)).toBe(false);
  expect(root.getAttribute('data-af-design-system')).toBe('paper-2'); expect(root.getAttribute('data-af-dark')).toBe('false');
});
