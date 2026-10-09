import { afterEach, beforeEach, expect, it } from 'vitest';
import { parseJsxOrThrow } from '@/test/helpers/jsx';
import { STORY_SELECTION_MESSAGE } from '@/lib/story-runtime/contract';
import { NONCE, disposeAnnotateSession, env, installAnnotateSession, state } from '@/test/helpers/annotate-session';

beforeEach(installAnnotateSession);
afterEach(disposeAnnotateSession);

it('does not issue a comment selection packet for a witness that conflicts with the current source node', () => {
  const nodes = parseJsxOrThrow('<div><p id="bug-10-report">Item 10 report</p><h3 id="bug-11-heading">11. Resolve from the hover preview</h3></div>').nodes;
  document.body.innerHTML = '<main><div data-mx-ast="0"><h3 id="bug-11-heading" data-mx-ast="0.0" data-mx-source-node-id="bug-11-heading">11. Resolve from the hover preview</h3></div></main>';
  env.session.setNodes(nodes);
  env.session.update({ ...state('on'), pins: [], pick: 'block' });
  const heading = document.querySelector('h3')!;
  heading.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
  heading.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  expect(env.posted.filter((message) => message.type === STORY_SELECTION_MESSAGE && message.nonce === NONCE)).toEqual([]);
});
