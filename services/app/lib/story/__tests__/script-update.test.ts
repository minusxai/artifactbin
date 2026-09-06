import { expect, it } from 'vitest';
import { storyUpdateParts } from '../update-parts';

it('carries script replacement and removal separately from data declarations', () => {
  const first = storyUpdateParts('<Helmet><script>{`mx.params.set("n",1)`}</script></Helmet><p>One</p>');
  const second = storyUpdateParts('<Helmet><script>{`mx.params.set("n",2)`}</script></Helmet><p>Two</p>');
  expect(first).toHaveProperty('authorScript', 'mx.params.set("n",1)');
  expect(second).toHaveProperty('authorScript', 'mx.params.set("n",2)');
  expect(second?.declarations).toBe(first?.declarations);
  expect(storyUpdateParts('<p>No script</p>')).toHaveProperty('authorScript', null);
});
