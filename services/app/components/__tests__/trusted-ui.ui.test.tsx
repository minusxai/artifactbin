import { render, cleanup, act, fireEvent, within } from '@testing-library/react';
import { StrictMode, useState } from 'react';
import { createPortal } from 'react-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TrustedUi, useTrustedPortalContainer, configureTrustedUiStyles } from '../TrustedUi';
import AnchoredPanel from '../AnchoredPanel';
import MobileSheet from '../MobileSheet';
import { SelectMenu } from '../SelectMenu';
import { Tooltip } from '../Tooltip';

afterEach(cleanup);

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
