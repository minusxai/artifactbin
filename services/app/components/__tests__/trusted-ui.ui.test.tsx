import { createContext, useContext, useEffect, StrictMode } from 'react';
import { createPortal } from 'react-dom';
import { render, fireEvent } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TrustedUi, useTrustedPortalContainer } from '../TrustedUi';
import MobileSheet from '../MobileSheet';
import {Tooltip} from '../Tooltip';

const State = createContext('missing');
describe('trusted chrome composition', () => {
  it('keeps controls and portals in one closed root while preserving React context', () => {
    let button: HTMLButtonElement | null = null;
    let dialog: HTMLDivElement | null = null;
    function Content() {
      const value = useContext(State);
      const target = useTrustedPortalContainer();
      return <><button ref={el => { button = el; }} aria-label="Trusted action">{value}</button>
        {target && createPortal(<div ref={el => { dialog = el; }} role="dialog" aria-label="Trusted dialog">Private content</div>, target)}</>;
    }
    const view = render(<State.Provider value="retained"><TrustedUi styles="button { color: blue; }" mode="light"><Content /></TrustedUi></State.Provider>);
    expect(button).not.toBeNull();
    expect(button!.textContent).toBe('retained');
    const root = button!.getRootNode() as ShadowRoot;
    expect(root).toBeInstanceOf(ShadowRoot);
    expect(root.mode).toBe('closed');
    expect(root.host.shadowRoot).toBeNull();
    expect(dialog!.getRootNode()).toBe(root);
    expect(document.querySelector('[aria-label="Trusted action"]')).toBeNull();
    expect(document.body.textContent).not.toContain('Private content');
    expect(root.querySelector('style')?.textContent).toContain('button { color: blue; }');
    const host = root.host;
    view.unmount();
    expect(host.isConnected).toBe(false);
  });

  it('has no trusted portal target outside the boundary', () => {
    let target: HTMLElement | null | undefined;
    function Probe() { target = useTrustedPortalContainer(); return null; }
    render(<Probe />);
    expect(target).toBeNull();
  });

  it('updates theme and trusted styles without replacing controls or portal target, and cleans up', () => {
    let button: HTMLButtonElement | null = null;
    let target: HTMLElement | null = null;
    let mounts = 0, cleanups = 0;
    function Probe() { target = useTrustedPortalContainer(); useEffect(() => { mounts++; return () => { cleanups++; }; }, []); return <button ref={el => { button = el; }}>Action</button>; }
    const view = render(<TrustedUi styles="button{color:blue}" mode="light"><Probe /></TrustedUi>);
    const first = button!, container = target!, root = first.getRootNode() as ShadowRoot;
    expect(container.closest('[data-app-appearance]')?.getAttribute('data-app-appearance')).toBe('light');
    view.rerender(<TrustedUi styles="button{color:red}" mode="dark"><Probe /></TrustedUi>);
    expect(button).toBe(first); expect(target).toBe(container); expect(mounts).toBe(1);
    expect(container.closest('[data-app-appearance]')?.getAttribute('data-app-appearance')).toBe('dark');
    expect(root.querySelector('style')?.textContent).toContain('button{color:red}');
    expect(root.querySelector('style')?.textContent).not.toContain('button{color:blue}');
    view.unmount(); expect(cleanups).toBe(1); expect(container.isConnected).toBe(false); expect(container.childElementCount).toBe(0);
  });

  it('survives strict lifecycle and keeps actual tooltip and mobile-sheet portals private', () => {
    let button: HTMLButtonElement | null = null;
    const close = vi.fn();
    const view = render(<StrictMode><TrustedUi styles="" mode="light"><Tooltip open content="Private tooltip"><button ref={el => { button = el; }}>Tip</button></Tooltip><MobileSheet label="Private sheet" onClose={close}><p>Private sheet contents</p></MobileSheet></TrustedUi></StrictMode>);
    const root = button!.getRootNode() as ShadowRoot;
    expect(root.querySelector('[role="tooltip"]')).not.toBeNull();
    expect(root.querySelector('[aria-label="Private sheet"]')).not.toBeNull();
    expect(document.body.textContent).not.toContain('Private sheet contents');
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
    fireEvent.click(root.querySelector('[aria-label="Close sheet"]')!); expect(close).toHaveBeenCalledOnce();
    view.unmount();
  });

  it('resets inherited styling and custom properties before trusted token definitions', () => {
    let button: HTMLButtonElement | null = null;
    const styles = '[data-trusted-ui-root]{--trusted-ink:blue}button{color:var(--trusted-ink)}';
    const view = render(<section style={{'--author-secret':'hostile',direction:'rtl'} as React.CSSProperties}><TrustedUi styles={styles} mode="light"><button ref={el => { button = el; }}>Safe</button></TrustedUi></section>);
    const root = button!.getRootNode() as ShadowRoot;
    const css = root.querySelector('style')!.textContent!;
    expect(css).toContain('all:initial'); expect(css).toContain('direction:ltr'); expect(css).toContain('unicode-bidi:normal');
    expect(css).toContain('--author-secret:initial;'); expect(css).not.toContain('hostile');
    expect(css).toContain('--trusted-ink:initial;'); expect(css.endsWith(styles)).toBe(true);
    expect(root.querySelector('slot')).toBeNull(); expect(root.querySelector('[part]')).toBeNull();
    view.unmount(); expect(root.childElementCount).toBe(0);
  });
});
