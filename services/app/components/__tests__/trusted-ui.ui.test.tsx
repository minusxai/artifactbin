import { render, cleanup, act } from '@testing-library/react';
import { createPortal } from 'react-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { TrustedUi, useTrustedPortalContainer } from '../TrustedUi';

afterEach(cleanup);

function SensitiveDialog() {
  const target = useTrustedPortalContainer();
  return target ? createPortal(<input aria-label="Owning token" value="fake-secret" readOnly />, target) : null;
}

describe('trusted UI CSS boundary', () => {
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
});
