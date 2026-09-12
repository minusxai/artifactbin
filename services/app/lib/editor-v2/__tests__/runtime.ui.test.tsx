import { Grid, GridItem } from '@/components/kit/grid';
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { useEffect } from 'react';
import { renderStoryNodes } from '@/lib/story-ui/interpreter';
import { createFrameEditSession } from '@/lib/story-runtime/edit/session';
import { parseJsxOrThrow } from '@/test/helpers/jsx';

describe('prose integration preserves the served runtime', () => {
  it('keeps a live component mounted while entering edit and replacing adjacent prose', () => {
    const parsed = parseJsxOrThrow('<div><p id="a">one</p><p id="b">two</p><Question id="q" /></div>');
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
    const p = parseJsxOrThrow(source);
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
  const parsed = parseJsxOrThrow(
    '<Grid id="grid" mode="flow"><GridItem id="column" w={6}><p id="p">Text</p><Question id="live" /></GridItem></Grid>',
  );
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

it('keeps a dragged text range from selecting its common layout ancestor', () => {
  const parsed = parseJsxOrThrow(
    '<div id="root"><p id="a">first paragraph</p><Grid mode="flow"><GridItem><h2 id="b">column heading</h2></GridItem></Grid></div>',
  );
  const session = createFrameEditSession({
    win: window,
    requestRender: () => {},
    channel: { nonce: 'x'.repeat(32), post: () => {}, innerHtmlOf: (el) => el.innerHTML },
  });
  session.setNodes(parsed.nodes);
  const view = render(
    <>
      {renderStoryNodes(parsed.nodes, {
        components: { Grid, GridItem },
        decorateElement: session.decorate,
        decorateChildren: session.decorateChildren,
      })}
    </>,
  );
  const a = view.container.querySelector('#a')!,
    b = view.container.querySelector('#b')!;
  const range = document.createRange();
  range.setStart(a.firstChild!, 3);
  range.setEnd(b.firstChild!, 6);
  window.getSelection()!.removeAllRanges();
  window.getSelection()!.addRange(range);
  fireEvent(document, new Event('selectionchange'));
  fireEvent.click(view.container.querySelector('#root')!);
  expect(window.getSelection()!.toString()).toContain('column');
  expect(view.queryByRole('button', { name: 'Resize selected block' })).toBeNull();
  expect(document.querySelector('[data-mx-node-chrome]')).toHaveStyle({ display: 'none' });
  session.dispose();
});


it('reports the actual source block for hover, click, and caret selection in formatted JSX', () => {
  const parsed = parseJsxOrThrow(`<section id="root">
    <p id="eyebrow">Notes</p>
    <h1 id="heading">Try making a copy</h1>
    <p id="body">Use <strong>Fork</strong> to copy.</p>
    <blockquote id="quote">
      <h2 id="subheading">Details</h2>
      <p id="nested">Nested paragraph</p>
    </blockquote>
    <ul id="list"><li id="item">An item</li></ul>
  </section>`);
  const post = vi.fn();
  const session = createFrameEditSession({
    win: window, requestRender: () => {},
    channel: { nonce: 'x'.repeat(32), post, innerHtmlOf: (el) => el.innerHTML },
  });
  session.setNodes(parsed.nodes);
  const view = render(<>{renderStoryNodes(parsed.nodes, {
    components: {}, decorateElement: session.decorate, decorateChildren: session.decorateChildren,
  })}</>);
  try {
    window.getSelection()!.removeAllRanges();
    for (const [id, tag] of [['eyebrow', 'p'], ['heading', 'h1'], ['body', 'p'], ['subheading', 'h2'], ['nested', 'p'], ['item', 'li']]) {
      const el = view.container.querySelector(`#${id}`)!;
      fireEvent.pointerOver(el);
      expect(el.closest('[data-mx-edit-hover]'), id).not.toBeNull();
      fireEvent.click(el);
      expect(post.mock.calls.filter(([m]) => m.type === 'mx:selection').at(-1)?.[0], id)
        .toMatchObject({ selection: { nodeId: id, tag } });
      const text = el.querySelector('p')?.firstChild ?? el.firstChild!;
      window.getSelection()!.setBaseAndExtent(text, 0, text, 0);
      fireEvent(document, new Event('selectionchange'));
      expect(post.mock.calls.filter(([m]) => m.type === 'mx:selection').at(-1)?.[0], id)
        .toMatchObject({ selection: { nodeId: id, tag } });
    }
  } finally {
    window.getSelection()!.removeAllRanges();
    session.dispose();
  }
});
