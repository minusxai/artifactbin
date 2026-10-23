import { expect, it } from 'vitest';
import { installHtmlReaderCommands } from '../../html-bridge/reader';
it('refuses synthetic reader commands even with a forged parent and platform origin', () => {
  const stop = installHtmlReaderCommands(window, 'https://platform.example');
  document.documentElement.removeAttribute('data-af-dark');
  window.dispatchEvent(new MessageEvent('message', { origin: 'https://platform.example', source: window.parent, data: { type: 'mx:reader-mode', mode: 'dark' } }));
  expect(document.documentElement.hasAttribute('data-af-dark')).toBe(false);
  stop();
});
