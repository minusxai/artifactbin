import { render, cleanup, act, fireEvent, waitFor, within } from '@testing-library/react';
import { StrictMode, useState } from 'react';
import { createPortal } from 'react-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TrustedUi, useForegroundComposer, useTrustedPortalContainer, configureTrustedUiStyles, configureTrustedUiFromShell } from '../TrustedUi';
import AnchoredPanel from '../AnchoredPanel';
import MobileSheet from '../MobileSheet';
import { SelectMenu } from '../SelectMenu';
import { Tooltip } from '../Tooltip';
import StoryFormatToolbar from '../views/story/StoryFormatToolbar';
import ShareLink from '../ShareLink';
import { httpBackendWrapper } from '@/test/helpers/artifact-backend';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

function SensitiveDialog() {
  const target = useTrustedPortalContainer();
  return target ? createPortal(<input aria-label="Owning token" value="fake-secret" readOnly />, target) : null;
}

describe('trusted UI CSS boundary', () => {
  it('opens an inner top-layer overlay and closes it on unmount without exposing controls on the host', () => {
    const show = vi.fn(), hide = vi.fn();
    const originalShow = HTMLElement.prototype.showPopover, originalHide = HTMLElement.prototype.hidePopover;
    HTMLElement.prototype.showPopover = show;
    HTMLElement.prototype.hidePopover = hide;
    try {
      const result = render(<TrustedUi overlay><button aria-label="Protected overlay action">Safe</button></TrustedUi>);
      const host = result.container.querySelector('[data-trusted-ui]')!;
      const root = host.shadowRoot!;
      const layer = root.querySelector('[data-trusted-ui-root]');
      expect(layer?.getAttribute('popover')).toBe('manual');
      expect(host.hasAttribute('popover')).toBe(false);
      expect(show).toHaveBeenCalledTimes(1);
      expect(show.mock.instances[0]).toBe(layer);
      expect(root.textContent).toContain(':host::before');
      result.unmount();
      expect(hide).toHaveBeenCalledTimes(1);
    } finally {
      HTMLElement.prototype.showPopover = originalShow;
      HTMLElement.prototype.hidePopover = originalHide;
    }
  });

  it('keeps navigation and composers above a selection portal mounted later', () => {
    const order: HTMLElement[] = [];
    const show = vi.spyOn(HTMLElement.prototype, 'showPopover').mockImplementation(function(this: HTMLElement) { order.push(this); });
    const hide = vi.spyOn(HTMLElement.prototype, 'hidePopover').mockImplementation(function(this: HTMLElement) { const index = order.indexOf(this); if (index >= 0) order.splice(index, 1); });
    try {
      const result = render(<><TrustedUi overlay layer="navigation"><button>Navigation</button></TrustedUi><TrustedUi overlay><button>Composer</button></TrustedUi><TrustedUi overlay layer="selection"><button>Selection</button></TrustedUi></>);
      expect(order.map(root => root.textContent?.match(/Navigation|Composer|Selection/)?.[0])).toEqual(['Selection', 'Composer', 'Navigation']);
      result.unmount();
      expect(order).toEqual([]);
    } finally { show.mockRestore(); hide.mockRestore(); }
  });

  it('fails closed for overlay controls when the browser has no top-layer API', () => {
    const original = HTMLElement.prototype.showPopover;
    delete (HTMLElement.prototype as Partial<HTMLElement>).showPopover;
    try {
      expect(() => render(<TrustedUi overlay><button aria-label="Unsafe fallback">Unsafe</button></TrustedUi>)).toThrow(/popover/i);
      expect(document.querySelector('[aria-label="Unsafe fallback"]')).toBeNull();
    } finally { HTMLElement.prototype.showPopover = original; }
  });
  it('keeps exactly one protected root during StrictMode ref replay', () => {
    const result = render(<StrictMode><TrustedUi><button aria-label="Strict control">Safe</button></TrustedUi></StrictMode>);
    const root = result.container.querySelector('[data-trusted-ui]')!.shadowRoot!;
    expect(root.querySelectorAll('[data-trusted-ui-root]')).toHaveLength(1);
    expect(root.querySelectorAll('style')).toHaveLength(1);
    expect(root.querySelectorAll('button')).toHaveLength(1);
  });
  it('keeps controls and portalled secrets out of the author-selectable document', async () => {
    let control: HTMLButtonElement | null = null;
    const result = render(<TrustedUi><button ref={el => { control = el; }} aria-label="Revoke token">Revoke token</button><SensitiveDialog /></TrustedUi>);
    await act(async () => {});
    expect(control).not.toBeNull();
    expect(control!.getRootNode()).toBeInstanceOf(ShadowRoot);
    const root = control!.getRootNode() as ShadowRoot;
    expect(root.querySelector('[aria-label="Owning token"]')).not.toBeNull();
    expect(document.querySelector('[aria-label="Owning token"]')).toBeNull();
    expect(document.querySelector('[aria-label="Revoke token"]')).toBeNull();
    result.unmount();
    expect(control).toBeNull();
    expect(root.querySelector('input')).toBeNull();
  });

  it('retains the protected root and focused control during an ordinary rerender', async () => {
    let control: HTMLButtonElement | null = null;
    const content = (text: string) => <TrustedUi><button ref={el => { control = el; }} aria-label="Control">{text}</button></TrustedUi>;
    const result = render(content('First'));
    await act(async () => {});
    const before = control!;
    const root = before.getRootNode();
    before.focus();
    result.rerender(content('Second'));
    expect(control).toBe(before);
    expect(control!.getRootNode()).toBe(root);
    expect((root as ShadowRoot).activeElement).toBe(before);
  });

  it('does not change the portal destination outside a protected boundary', () => {
    let target: HTMLElement | undefined;
    function Probe() { target = useTrustedPortalContainer(); return null; }
    render(<Probe />);
    expect(target).toBeUndefined();
  });

  it('installs only registered trusted styles, resets consumed custom properties and follows theme without remount', async () => {
    const authorStyle = document.createElement('style');
    authorStyle.textContent = 'button { background: url(/author-style-probe) }';
    document.head.append(authorStyle);
    configureTrustedUiStyles(':root,:host { --color-fg: black } body { color:var(--color-fg); transform:var(--tw-transform); }');
    const result = render(<TrustedUi><button aria-label="Styled control">Safe</button></TrustedUi>);
    const host = result.container.querySelector('[data-trusted-ui]')!;
    const root = host.shadowRoot!;
    expect(root.textContent).not.toContain('author-style-probe');
    expect(root.textContent).toContain('--tw-transform: initial');
    expect(root.textContent).not.toContain(':root');
    const control = root.querySelector('button');
    await act(async () => { document.documentElement.setAttribute('data-theme', 'dark'); });
    expect(root.querySelector('[data-trusted-ui-root]')?.getAttribute('data-theme')).toBe('dark');
    expect(root.querySelector('button')).toBe(control);
    await act(async () => { configureTrustedUiStyles(':root { --color-fg: blue; }'); });
    expect(root.textContent).toContain('--color-fg: blue');
    result.unmount();
    authorStyle.remove();
    document.documentElement.removeAttribute('data-theme');
    configureTrustedUiStyles('');
  });

  it('takes its sheet from the shell\'s own stylesheet links only — never a <style>, never another origin — as the file\'s exact bytes', async () => {
    const sheet = (link: HTMLLinkElement, cssText: string | null) =>
      Object.defineProperty(link, 'sheet', { configurable: true, get: () => cssText === null ? null : { cssRules: [{ cssText }] } });
    const link = (href: string, cssText: string | null) => {
      const element = document.createElement('link');
      element.rel = 'stylesheet';
      element.href = href;
      sheet(element, cssText);
      document.head.append(element);
      return element;
    };
    // What the server holds, byte for byte — and what CSSOM makes of it: the
    // `border` shorthand beside its overriding longhand serializes EMPTY.
    const files: Record<string, string> = {
      '/assets/index-abc.css': ':root,:host{--color-fg:black}.tab{border:1px solid var(--edge);border-bottom:0}',
      '/assets/late-abc.css': '.late-probe{color:var(--color-fg)}',
    };
    const bytes = deferred<void>();
    const fetched: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (href: string) => {
      const path = new URL(href).pathname;
      fetched.push(path);
      await bytes.promise;
      return path in files ? new Response(files[path]) : new Response('', { status: 404 });
    }));
    const app = link('/assets/index-abc.css', ':root, :host { --color-fg: black; }\n.tab { border-top-color: ; border-bottom: 0px; }');
    const later = link('/assets/late-abc.css', null);
    const foreign = link('https://fonts.example.test/x.css', '.foreign-probe { color: red; }');
    const author = document.createElement('style');
    author.textContent = '.author-style-probe { color: red; }';
    document.head.append(author);
    try {
      configureTrustedUiFromShell(document);
      const result = render(<TrustedUi><button aria-label="Styled control">Safe</button></TrustedUi>);
      const root = result.container.querySelector('[data-trusted-ui]')!.shadowRoot!;
      // At once, before any bytes: the parsed rules stand in, scoped.
      expect(root.textContent).toContain('[data-trusted-ui-root], [data-trusted-ui-root] { --color-fg: black; }');
      expect(root.textContent).toContain('--color-fg: initial');
      expect(fetched.sort()).toEqual(['/assets/index-abc.css', '/assets/late-abc.css']);
      sheet(later, '.late-probe { color: var(--color-fg); }');
      await act(async () => { later.dispatchEvent(new Event('load')); });
      expect(root.textContent).toContain('.late-probe { color: var(--color-fg); }');
      // Then the exact bytes replace them in the mounted root.
      await act(async () => { bytes.resolve(); await bytes.promise; await new Promise(r => setTimeout(r, 0)); });
      expect(root.textContent).toContain('[data-trusted-ui-root],[data-trusted-ui-root]{--color-fg:black}.tab{border:1px solid var(--edge);border-bottom:0}');
      expect(root.textContent).toContain('.late-probe{color:var(--color-fg)}');
      expect(root.textContent).not.toContain('border-top-color: ;');
      expect(root.textContent).not.toContain('author-style-probe');
      expect(root.textContent).not.toContain('foreign-probe');
      result.unmount();
    } finally {
      for (const element of [app, later, foreign, author]) element.remove();
      configureTrustedUiStyles('');
    }
  });

  it('keeps desktop panels, select lists and tooltips in the boundary; keyboard events retain component state', () => {
    window.innerWidth = 1200;
    function Controls() {
      const [value, setValue] = useState('a');
      return <>
        <AnchoredPanel label="Protected panel" open onOpenChange={() => {}} trigger={<button aria-label="Panel trigger">Open</button>}><input aria-label="Panel secret" /></AnchoredPanel>
        <SelectMenu value={value} onChange={setValue} ariaLabel="Choice" options={[{value:'a',label:'A'},{value:'b',label:'B'}]} />
        <Tooltip open content="Protected tip"><button aria-label="Tip trigger">Tip</button></Tooltip>
      </>;
    }
    const result = render(<TrustedUi><Controls /></TrustedUi>);
    const root = result.container.querySelector('[data-trusted-ui]')!.shadowRoot!;
    const q = within(root as unknown as HTMLElement);
    expect(q.getByLabelText('Panel secret')).toBeTruthy();
    expect(root.textContent).toContain('Protected tip');
    const select = q.getByLabelText('Choice');
    fireEvent.keyDown(select, {key:'ArrowDown'});
    expect(q.getByLabelText('Choice options')).toBeTruthy();
    fireEvent.keyDown(select, {key:'ArrowDown'});
    fireEvent.keyDown(select, {key:'Enter'});
    expect(select.textContent).toContain('B');
    expect(q.queryByLabelText('Choice options')).toBeNull();
    expect(document.querySelector('[aria-label="Panel secret"]')).toBeNull();
    expect(document.querySelector('[data-slot="tooltip-content"]')).toBeNull();
  });

  it('keeps mobile sheets protected and removes their Escape listener on unmount', () => {
    const close = vi.fn();
    const result = render(<TrustedUi><MobileSheet label="Protected sheet" onClose={close}><input aria-label="Sheet secret" /></MobileSheet></TrustedUi>);
    const root = result.container.querySelector('[data-trusted-ui]')!.shadowRoot!;
    expect(root.querySelector('[aria-label="Sheet secret"]')).not.toBeNull();
    expect(document.querySelector('[aria-label="Sheet secret"]')).toBeNull();
    fireEvent.keyDown(root.querySelector('input')!, {key:'Escape', composed:true});
    expect(close).toHaveBeenCalledTimes(1);
    result.unmount();
    fireEvent.keyDown(document, {key:'Escape'});
    expect(close).toHaveBeenCalledTimes(1);
  });
});

/**
 * The real product overlays, not a stub: each must live inside the trusted
 * shadow root and never leak its controls onto the host page.
 */
describe('real overlays inside the trusted root', () => {
  it('keeps the actual format toolbar inside its trusted root', async () => {
    const view = render(<TrustedUi overlay><StoryFormatToolbar selection={{kind:'element',path:'0',tag:'div',rect:{x:0,y:100,width:200,height:60},className:'',style:'',ancestors:[]}} onApply={vi.fn()} onApplyLink={vi.fn()} onSelect={vi.fn()} onDelete={vi.fn()} /></TrustedUi>, { wrapper: httpBackendWrapper('doc1') });
    const shadow = view.container.querySelector('[data-trusted-ui]')!.shadowRoot!;
    await waitFor(() => expect(shadow.querySelector('[aria-label="Typography toolbar"]')).not.toBeNull());
    expect(document.querySelector('[aria-label="Typography toolbar"]')).toBeNull();
  });
  
  it('keeps the actual sharing dialog inside its trusted root', async () => {
    vi.stubGlobal('fetch',vi.fn(async () => new Response(JSON.stringify({visibility:'public',shares:[],link_role:'viewer'}))));
    const view = render(<TrustedUi overlay><ShareLink className="" artifactId="Ab3xK9" owner /></TrustedUi>);
    const shadow = view.container.querySelector('[data-trusted-ui]')!.shadowRoot!;
    const button = shadow.querySelector('[aria-label="Share"]') ?? shadow.querySelector('button');
    expect(button).not.toBeNull();
    fireEvent.click(button!);
    await waitFor(() => expect(shadow.querySelector('[role="dialog"]')).not.toBeNull());
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
});

it('raises active composition above navigation and restores ordering without remounting',()=>{
 const order:HTMLElement[]=[];
 const show=vi.spyOn(HTMLElement.prototype,'showPopover').mockImplementation(function(this:HTMLElement){if(!order.includes(this))order.push(this);});
 const hide=vi.spyOn(HTMLElement.prototype,'hidePopover').mockImplementation(function(this:HTMLElement){const index=order.indexOf(this);if(index>=0)order.splice(index,1);});
 function Composer({active}:{active:boolean}){useForegroundComposer(active);return <input aria-label="Draft" defaultValue="preserved"/>;}
 const tree=(active:boolean)=><><TrustedUi overlay><Composer active={active}/></TrustedUi><TrustedUi overlay layer="navigation"><button>Navigation</button></TrustedUi></>;
 const view=render(tree(false));
 const root=view.container.querySelector('[data-trusted-ui]')!.shadowRoot!;
 const input=root.querySelector('input')!;
 expect(order.at(-1)?.textContent).toContain('Navigation');
 view.rerender(tree(true));
 expect(order.at(-1)?.contains(input)).toBe(true);
 view.rerender(tree(false));
 expect(order.at(-1)?.textContent).toContain('Navigation');
 expect(root.querySelector('input')).toBe(input);expect(input.value).toBe('preserved');
 view.unmount();show.mockRestore();hide.mockRestore();
});
