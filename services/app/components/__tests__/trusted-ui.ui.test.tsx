import { createContext, useContext } from 'react';
import { createPortal } from 'react-dom';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TrustedUi, useTrustedPortalContainer } from '../TrustedUi';

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
});
