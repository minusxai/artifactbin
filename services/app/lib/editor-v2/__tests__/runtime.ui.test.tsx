import { Grid, GridItem } from '@/components/kit/grid';
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { useEffect } from 'react';
import { parseJsx } from '@/lib/jsx';
import { renderStoryNodes } from '@/lib/story-ui/interpreter';
import { createFrameEditSession } from '@/lib/story-runtime/edit/session';

describe('prose integration preserves the served runtime', () => {
  it('keeps a live component mounted while entering edit and replacing adjacent prose', () => {
    const parsed = parseJsx('<div><p id="a">one</p><p id="b">two</p><Question id="q" /></div>');
    if (!parsed.ok) throw Error(parsed.error);
    const mounted = vi.fn(),
      unmounted = vi.fn(),
      post = vi.fn();
    const Question = () => {
      useEffect(() => {
        mounted();
        return unmounted;
      }, []);
      return <div>Live data</div>;
    };
    const options = { components: { Question } };
    const view = render(<>{renderStoryNodes(parsed.nodes, options)}</>);
    const session = createFrameEditSession({
      win: window,
      requestRender: () => {},
      channel: {
        nonce: 'x'.repeat(32),
        post,
        innerHtmlOf: (el) => el.innerHTML,
      },
    });
    session.setNodes(parsed.nodes);
    view.rerender(
      <>
        {renderStoryNodes(parsed.nodes, {
          ...options,
          decorateElement: session.decorate,
          decorateChildren: session.decorateChildren,
        })}
      </>,
    );
    expect(mounted).toHaveBeenCalledTimes(1);
    expect(unmounted).not.toHaveBeenCalled();
    const editor = view.getByRole('textbox');
    expect(editor.querySelectorAll('p')).toHaveLength(2);
    fireEvent.paste(editor, {
      clipboardData: {
        getData: (type: string) => (type === 'text/html' ? '<p>new</p>' : 'new'),
        files: [],
      },
    });
    expect(post.mock.calls.some(([m]) => m.type === 'mx:flow-edit')).toBe(true);
    expect(unmounted).not.toHaveBeenCalled();
    session.dispose();
  });
});

it('keeps the prose editor mounted across changed source renders with live siblings', () => {
  const read = (source: string) => {
    const p = parseJsx(source);
    if (!p.ok) throw Error(p.error);
    return p.nodes;
  };
  const first = read('<div id="root"><p id="a">one</p><p id="b">two</p><Question id="q" /></div>');
  const session = createFrameEditSession({
    win: window,
    requestRender: () => {},
    channel: {
      nonce: 'x'.repeat(32),
      post: () => {},
      innerHtmlOf: (el) => el.innerHTML,
    },
  });
  const options = {
    components: { Question: () => <div>Live</div> },
    decorateElement: session.decorate,
    decorateChildren: session.decorateChildren,
  };
  session.setNodes(first);
  const view = render(<>{renderStoryNodes(first, options)}</>);
  const editor = view.getByRole('textbox'),
    p = view.container.querySelector('#a');
  const next = read('<div id="root"><p id="a">one changed</p><p id="b">two</p><Question id="q" /></div>');
  session.setNodes(next);
  view.rerender(<>{renderStoryNodes(next, options)}</>);
  expect(view.getByRole('textbox')).toBe(editor);
  expect(view.container.querySelector('#a')).toBe(p);
  session.dispose();
});

it('retains live islands inside flow columns when entering editing', () => {
  const parsed = parseJsx(
    '<Grid id="grid" mode="flow"><GridItem id="column" w={6}><p id="p">Text</p><Question id="live" /></GridItem></Grid>',
  );
  if (!parsed.ok) throw Error(parsed.error);
  const mounted = vi.fn(),
    unmounted = vi.fn();
  const Question = () => {
    useEffect(() => {
      mounted();
      return unmounted;
    }, []);
    return <div>Column data</div>;
  };
  const options = { components: { Grid, GridItem, Question } };
  const view = render(<>{renderStoryNodes(parsed.nodes, options)}</>);
  const session = createFrameEditSession({
    win: window,
    requestRender: () => {},
    channel: { nonce: 'x'.repeat(32), post: () => {}, innerHtmlOf: (el) => el.innerHTML },
  });
  session.setNodes(parsed.nodes);
  view.rerender(
    <>
      {renderStoryNodes(parsed.nodes, {
        ...options,
        decorateElement: session.decorate,
        decorateChildren: session.decorateChildren,
      })}
    </>,
  );
  expect(mounted).toHaveBeenCalledTimes(1);
  expect(unmounted).not.toHaveBeenCalled();
  expect(view.getByRole('textbox')).toHaveTextContent('Text');
  session.dispose();
});
