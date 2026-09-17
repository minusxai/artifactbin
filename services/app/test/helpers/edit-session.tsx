/**
 * The frame half of in-place editing, driven the way a user drives it — one
 * rig for the three `lib/story-runtime/edit/__tests__/session-*.ui.test.tsx`
 * files.
 *
 * Documents are rendered through the REAL interpreter with the session's own
 * decorator, so what those files assert is what a document actually does — not
 * a hand-built DOM that happens to agree with the code.
 */
import { vi } from 'vitest';
import { render } from '@testing-library/react';
import { parseJsx, type JsxNode } from '@/lib/jsx';
import { renderStoryNodes } from '@/lib/story-ui/interpreter';
import type { PristineChannel } from '@/lib/story-runtime/pristine';
import { createFrameEditSession } from '@/lib/story-runtime/edit/session';
import { Video } from '@/components/kit/video';
import type { ReactElement } from 'react';

export const NONCE = 'f'.repeat(32);
export const SRC = '<div className="p-8"><h1 className="t">Title</h1>'
  + '<p className="lede">hello world</p>'
  + '<div className="box"><span>nested</span></div></div>';

export const nodesOf = (src: string): JsxNode[] => {
  const p = parseJsx(src);
  if (!p.ok) throw new Error('fixture does not parse');
  return p.nodes;
};

/** Everything the session posted, and the channel it posts on. */
export const env = {
  posted: [] as Array<Record<string, unknown>>,
  channel: null as unknown as PristineChannel,
};

const makeChannel = (): PristineChannel => ({
  nonce: NONCE,
  post: (m) => { env.posted.push(m as Record<string, unknown>); },
  innerHtmlOf: (el) => el.innerHTML,
  isParent: () => true,
  isFromParent: () => true,
});

export const sent = (type: string) => env.posted.filter((m) => m.type === type);
export const last = (type: string) => sent(type).at(-1);

/**
 * A stand-in for the component registry — the real embeds are not what these
 * files are about, EXCEPT <Video>, which is the real kit card: whether it
 * renders its link while editing is the thing being asserted.
 */
const COMPONENTS = {
  Question: (props: Record<string, unknown>) => <div {...props} aria-label="Question embed" />,
  Video: Video as unknown as (props: Record<string, unknown>) => ReactElement,
};

/** Every session listens on `document`; one left alive leaks into the next test. */
const live: Array<{ dispose(): void }> = [];

export function mount(src = SRC, requestRender = vi.fn()) {
  const nodes = nodesOf(src);
  const session = createFrameEditSession({ win: window, channel: env.channel, requestRender });
  live.push(session);
  session.setNodes(nodes);
  const view = render(<>{renderStoryNodes(nodes, { components: COMPONENTS, decorateElement: session.decorate })}</>);
  const at = (path: string) => view.container.querySelector(`[data-mx-ast="${path}"]`) as HTMLElement;
  return { session, view, at, requestRender, nodes };
}

/** Call from `beforeEach`. */
export function installEditSession() {
  env.posted = [];
  env.channel = makeChannel();
  document.body.innerHTML = '';
}

/** Call from `afterEach`. */
export function disposeEditSessions() {
  while (live.length) live.pop()!.dispose();
}
