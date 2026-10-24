import { expect, it } from 'vitest';
import { installHtmlReaderCommands } from '../../html-bridge/reader';

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

it('sets the exact dark attribute and removes it for light while preserving color scheme', () => {
  const mock = createReaderWindow();
  const stop = installHtmlReaderCommands(mock.win, 'https://platform.example');
  mock.deliver({ type: 'mx:reader-mode', mode: 'dark' });
  expect(mock.root.getAttribute('data-af-dark')).toBe('true');
  expect(mock.root.style.colorScheme).toBe('dark');
  mock.deliver({ type: 'mx:reader-mode', mode: 'light' });
  expect(mock.root.hasAttribute('data-af-dark')).toBe(false);
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
