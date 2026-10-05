import { reviewStateFor } from '@/lib/story-runtime/review-state';
/**
 * COMMENTING ON A RUNTIME INSTANCE: the exact typed row behind a cell, and an
 * ordinary area refinement in the geometry reports.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseJsxOrThrow } from '@/test/helpers/jsx';
import { STORY_SELECTION_MESSAGE, type StoryAnnotationsMessage } from '@/lib/story-runtime/contract';
import { disposeAnnotateSession, env, installAnnotateSession, layouts, rectOf, state } from '@/test/helpers/annotate-session';

beforeEach(installAnnotateSession);
afterEach(disposeAnnotateSession);

describe('runtime instance targeting', () => {
  it('resolves the exact typed row and falls back to owner after removal', () => {
    document.body.innerHTML='<div id="table" data-mx-ast="0"><table><tbody><tr><td id="cell">Alice</td><td id="other">Bob</td></tr></tbody></table></div>';
    const target={kind:'table' as const,rowKey:1,columnKey:'name'};
    const cell=document.getElementById('cell')!;cell.setAttribute('data-mx-comment-owner','table');cell.setAttribute('data-mx-comment-target',JSON.stringify(target));
    const other=document.getElementById('other')!;other.setAttribute('data-mx-comment-owner','table');other.setAttribute('data-mx-comment-target',JSON.stringify({...target,rowKey:'1'}));
    vi.spyOn(cell,'getBoundingClientRect').mockReturnValue({x:10,y:20,width:30,height:40} as DOMRect);
    const parsed=parseJsxOrThrow('<DataTable id="table" rows={[]} />');env.session.setNodes(parsed.nodes);
    const message:StoryAnnotationsMessage={...state('on'),pins:[{id:'cell-comment',path:'0',key:'table',nodeId:'table',range:{v:1,kind:'target',target}}]};
    env.session.update(message);
    expect(layouts().at(-1)).toMatchObject({positions:[{id:'cell-comment',status:'exact',rect:{x:10,y:20}}]});
    expect(cell).toHaveAttribute('data-mx-annotated');expect(other).not.toHaveAttribute('data-mx-annotated');
    cell.remove();env.session.update(message);
    expect(layouts().at(-1)).toMatchObject({positions:[{id:'cell-comment',status:'missing'}]});
    expect(document.getElementById('table')).toHaveAttribute('data-mx-annotated');expect(other).not.toHaveAttribute('data-mx-annotated');
  });
});

it('retains ordinary area refinement in geometry reports for the same owner', () => {
  document.body.innerHTML='<section id="section" data-mx-ast="0"></section>';
  const owner=document.getElementById('section')!;
  rectOf(owner,{x:20,y:40,width:200,height:100});
  const parsed=parseJsxOrThrow('<section id="section" />');env.session.setNodes(parsed.nodes);
  const range={v:1 as const,kind:'area' as const,box:{x:0.1,y:0.2,w:0.5,h:0.4}};
  env.session.update({...state('on'),pins:[],selectedPath:'0',selected:{kind:'element',path:'0',nodeId:'section',tag:'section',rect:{x:0,y:0,width:200,height:100},className:'',style:'',ancestors:[],range}});
  expect(env.posted.filter((message)=>message.type===STORY_SELECTION_MESSAGE).at(-1)).toMatchObject({selection:{nodeId:'section',range,rect:{x:20,y:40}}});
});


it('captures local state on selection and restores it before highlighting, once per opened thread', () => {
  const parsed = parseJsxOrThrow('<p id="payment" />'); env.session.setNodes(parsed.nodes);
  document.body.innerHTML = '<p id="payment" data-mx-ast="0">Payment declined</p>';
  const element = document.getElementById('payment')!;
  rectOf(element, { x: 10, y: 20, width: 100, height: 30 });
  let screen = 'payment'; const restore = vi.fn(value => { screen = String(value); });
  const unregister = reviewStateFor(document).register({ id: 'screen', get: () => screen, restore });
  try {
    env.session.update({ ...state('on'), pins: [] }); env.session.select('0');
    const selection = env.posted.filter(message => message.type === STORY_SELECTION_MESSAGE).at(-1)?.selection as { viewState?: unknown };
    expect(selection.viewState).toEqual({ v: 1, components: { screen: 'payment' } });
    screen = 'plans';
    const opened = { ...state('on'), openId: 'saved', pins: [{ id: 'saved', path: '0', key: 'payment', nodeId: 'payment', viewState: selection.viewState }] } as StoryAnnotationsMessage;
    env.session.update(opened);
    expect(screen).toBe('payment'); expect(element).toHaveAttribute('data-mx-annotation-open');
    screen = 'plans'; env.session.update(opened);
    expect(screen).toBe('plans'); expect(restore).toHaveBeenCalledTimes(1);
    env.session.update({ ...opened, openId: null }); env.session.update(opened);
    expect(screen).toBe('payment'); expect(restore).toHaveBeenCalledTimes(2);
    screen = 'plans'; env.session.update({ ...opened, viewStateRequest: 1 });
    expect(screen).toBe('payment'); expect(restore).toHaveBeenCalledTimes(3);
  } finally { unregister(); }
});
