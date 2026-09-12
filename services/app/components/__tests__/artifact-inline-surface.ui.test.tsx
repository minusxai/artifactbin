/**
 * One seam: `ArtifactSurface` renders the authored document inline, in the
 * parent page, with no full-document `/raw` frame. Liveness, first paint,
 * the no-frame contract, live adoption and the viewport boundary were five
 * files sharing one `test/helpers/{surface-ui,inline-surface}` setup.
 */
import { beforeEach,afterEach,describe,it,expect,vi } from 'vitest';
import { act,screen,fireEvent,waitFor } from '@testing-library/react';
import { render } from '@/test/helpers/surface-ui';
import { setupSurface,surfaceProps,SurfaceEvents } from '@/test/helpers/inline-surface';
import ArtifactSurface, { type ArtifactSurfaceProps } from '../ArtifactSurface';
import ArtifactShell from '../ArtifactShell';
import { parseJsx } from '@/lib/jsx';
import type { ArtifactLiveEvent } from '@/lib/story/live';

afterEach(()=>vi.unstubAllGlobals());

describe('the inline document surface', () => {
 beforeEach(setupSurface);

 it('reveals the top-level document after its lazy runtime mounts, without a full-document frame',async()=>{
  const view=render(<ArtifactSurface {...surfaceProps()} />);
  expect(await screen.findByText('Document body')).toBeInTheDocument();
  expect(view.container.querySelector('[data-mx-inline-story]')).not.toBeNull();
  expect(screen.queryByTitle('artifact')).toBeNull();
  expect(screen.queryByLabelText('Loading document')).toBeNull();
 });

 it('keeps the document ground dark during and after runtime startup',async()=>{
  render(<ArtifactSurface {...surfaceProps({colorMode:'dark'})} />);
  const viewport=screen.getByLabelText('Artifact viewport');
  const ground=viewport.style.background;
  expect(ground).not.toBe('');
  await screen.findByText('Document body');
  expect(viewport.style.background).toBe(ground);
  expect(viewport.querySelector('[data-mx-inline-story]')).toHaveClass('dark');
 });

 it('renders authored DOM in the parent, never a full-document /raw iframe',async()=>{
  const view=render(<ArtifactSurface {...surfaceProps()} />);await screen.findByText('Document body');
  expect(view.container.querySelector('[data-mx-inline-story] p')).toHaveTextContent('Document body');
  expect(view.container.querySelector('[data-mx-inline-story] iframe')).toBeNull();
  expect(view.container.querySelector('iframe[src*="/raw"]')).toBeNull();
  expect(view.container.innerHTML).not.toContain('/raw?key=');
 });

 it('keeps owner controls while readers cannot enter editing',async()=>{
  const view=render(<ArtifactSurface {...surfaceProps()} />);await screen.findByText('Document body');
  expect(screen.queryByLabelText('Edit artifact')).toBeNull();view.unmount();
  render(<ArtifactShell role="owner"><ArtifactSurface {...surfaceProps()} /></ArtifactShell>);
  await screen.findByText('Document body');fireEvent.click(screen.getByLabelText('Open artifact controls'));
  expect(screen.getByLabelText('Edit artifact')).toBeInTheDocument();
 });

 it.each(['visibilitychange','pageshow'])('preserves document DOM on %s instead of probing or replacing a full-document frame',async(type)=>{
  const view=render(<ArtifactSurface {...surfaceProps()} />);
  const paragraph=await screen.findByText('Document body');
  const root=view.container.querySelector('[data-mx-inline-story]');
  const post=vi.spyOn(window,'postMessage');
  act(()=>{document.dispatchEvent(new Event(type));window.dispatchEvent(new Event(type));});
  expect(screen.getByText('Document body')).toBe(paragraph);
  expect(view.container.querySelector('[data-mx-inline-story]')).toBe(root);
  expect(post).not.toHaveBeenCalled();post.mockRestore();
 });

 it('closes the owned stream and removes document DOM and styles on unmount',async()=>{
  const view=render(<ArtifactSurface {...surfaceProps()} />);await screen.findByText('Document body');
  const stream=SurfaceEvents.last;view.unmount();
  expect(stream.close).toHaveBeenCalled();
  expect(document.querySelector('[data-mx-inline-story]')).toBeNull();
 });
});

describe('adopting a new version into the live surface', () => {
 let served:ArtifactLiveEvent;
 function version(source:string,over:Partial<ArtifactLiveEvent>={}):ArtifactLiveEvent{
  const parsed=parseJsx(source);if(!parsed.ok)throw Error(parsed.error);
  return {editId:'edit_2',version:2,format:'markup',title:'Document',source,content:null,theme:null,colorMode:null,template:null,nodes:parsed.nodes,...over} as ArtifactLiveEvent;
 }
 beforeEach(()=>{setupSurface();vi.stubGlobal('fetch',vi.fn(async(url:string)=>{
  if(String(url).endsWith('/events/frame'))return new Response(JSON.stringify(served));
  throw Error('unexpected fetch '+url);
 }));});
 async function update(over:Partial<ArtifactLiveEvent>={}){
  served=version('<p>Second version</p>',over);
  await act(async()=>{SurfaceEvents.last.onmessage?.({data:JSON.stringify({editId:served.editId,version:served.version,by:null})} as MessageEvent);});
 }

 it('adopts a new version into the existing DOM root without a frame, paint handshake or loading flash',async()=>{
  const view=render(<ArtifactSurface {...surfaceProps()} />);await screen.findByText('Document body');
  const root=view.container.querySelector('[data-mx-inline-story]');
  await update();await screen.findByText('Second version');
  expect(view.container.querySelector('[data-mx-inline-story]')).toBe(root);
  expect(screen.queryByLabelText('Loading document')).toBeNull();
  expect(screen.queryByText('Document body')).toBeNull();
 });

 it('updates owned styles and color mode together with source',async()=>{
  const view=render(<ArtifactSurface {...surfaceProps()} />);await screen.findByText('Document body');
  await update({compiledCss:'.changed{color:red}',authorCss:'.authored{margin:3px}',theme:'modernist' as never,colorMode:'dark'});
  await screen.findByText('Second version');
  const root=view.container.querySelector('[data-mx-inline-story]')!;
  expect(root).toHaveClass('dark');expect(root).toHaveAttribute('data-theme','modernist');
  expect(root.querySelector('style')?.textContent).toContain('.changed');
  expect(root.querySelector('style')?.textContent).toContain('.authored');
 });

 it('ignores an invalid replacement rather than discarding the still-readable document',async()=>{
  const view=render(<ArtifactSurface {...surfaceProps()} />);await screen.findByText('Document body');
  const root=view.container.querySelector('[data-mx-inline-story]');
  await update({source:'<not valid',nodes:undefined});
  await waitFor(()=>expect(fetch).toHaveBeenCalled());
  expect(view.container.querySelector('[data-mx-inline-story]')).toBe(root);
  expect(screen.getByText('Document body')).toBeInTheDocument();
 });
});

/**
 * The frame gets the whole artifact viewport, and the PARENT page carries no
 * credit bar of its own. It never should have: the reader's attribution lives
 * inside the served document (lib/story/reader-chrome), where the author's
 * handle is the byline — and the strip this test was written for is retired.
 */
describe('the artifact viewport boundary', () => {
 /** A bare stream stub: this block only mounts, it never emits. */
 class FakeEventSource {
  /** The named `data` channel (a dataset under the document changed). */
  listeners: Record<string, Array<(e: MessageEvent) => void>> = {};
  addEventListener(type: string, fn: (e: MessageEvent) => void) { (this.listeners[type] ??= []).push(fn); }
  removeEventListener(type: string, fn: (e: MessageEvent) => void) { this.listeners[type] = (this.listeners[type] ?? []).filter((f) => f !== fn); }
  emitData(payload: unknown) { for (const fn of this.listeners.data ?? []) fn({ data: JSON.stringify(payload) } as MessageEvent); }
  onmessage: ((e: MessageEvent) => void) | null = null;
  close() {}
 }

 const footerProps: ArtifactSurfaceProps = {
  id: 'story1', editId: 'edit_1', format: 'dataset', title: 'doc',
  source: null, template: null, refs: [], version: 1,
  content: '<p>hi</p>', columns: [], compiledCss: null, theme: null, colorMode: null,
 };

 beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('EventSource', FakeEventSource);
 });

 it('uses document-owned page scrolling without a duplicate credit footer', () => {
  render(<ArtifactSurface {...footerProps} format="markup" source="<p>doc</p>" />);

  expect(screen.getByLabelText('Artifact viewport')).toHaveClass('relative', 'min-h-screen');
  expect(screen.queryByTitle('artifact')).toBeNull();
  expect(screen.queryByLabelText('Artifact credits')).not.toBeInTheDocument();
 });

 it('does not add the fixed artifact viewport to data-tier pages', () => {
  render(<ArtifactSurface {...footerProps} />);
  expect(screen.queryByLabelText('Artifact viewport')).not.toBeInTheDocument();
 });
});
