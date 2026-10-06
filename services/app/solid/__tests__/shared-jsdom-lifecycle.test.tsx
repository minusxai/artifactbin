/* @jsxImportSource solid-js */
import { render } from '@solidjs/testing-library';
import { expect, it } from 'vitest';
import { cleanupSharedJsdom } from '@/test/setup/shared-jsdom-lifecycle';

it('disposes mounted roots and settles an abandoned lazy page before returning the shared environment', async () => {
  render(() => <p>Mounted page</p>);
  let completed = false;
  // This intentional fixture import models a route abandoned during its asynchronous module load.
  const pending = import('./fixtures/delayed-page').then(() => { completed = true; });
  await cleanupSharedJsdom();
  expect(document.body.textContent).not.toContain('Mounted page');
  expect(completed).toBe(true);
  await pending;
});
