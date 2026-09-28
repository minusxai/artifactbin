/**
 * A PANEL ASKED FOR BEFORE IT EXISTS (components/page-chrome-state `openPageChromeOnceMounted`). On the
 * compiled reader page the served chrome's Settings press is remembered until the app arrives
 * (web/idle-boot takeChromeIntent), and the app performs it as it mounts — before its own panels have
 * mounted to hear a request. The request is kept until the panel that answers it mounts, once; a plain
 * request (`requestPageChrome`) nobody hears is dropped as before.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { useState } from 'react';
import { openPageChromeOnceMounted, requestPageChrome, useOpenOnRequest } from '../page-chrome-state';

function Panel({ which }: { which: 'controls' | 'menu' }) {
  const [open, setOpen] = useState(false);
  useOpenOnRequest(which, open, setOpen);
  return <div aria-label={`${which} panel`} data-open={String(open)} />;
}

afterEach(() => cleanup());

describe('a page chrome request made before its panel mounts', () => {
  it('opens the panel when it mounts, once', () => {
    openPageChromeOnceMounted('controls');
    const first = render(<Panel which="controls" />);
    expect(first.getByLabelText('controls panel').getAttribute('data-open')).toBe('true');
    first.unmount();
    const again = render(<Panel which="controls" />);
    expect(again.getByLabelText('controls panel').getAttribute('data-open')).toBe('false');
  });

  it('is heard at once by a panel already mounted, and leaves nothing pending', () => {
    const view = render(<Panel which="controls" />);
    act(() => openPageChromeOnceMounted('controls'));
    expect(view.getByLabelText('controls panel').getAttribute('data-open')).toBe('true');
    view.unmount();
    expect(render(<Panel which="controls" />).getByLabelText('controls panel').getAttribute('data-open')).toBe('false');
  });

  it('does not open another panel, and a plain request nobody hears is dropped', () => {
    openPageChromeOnceMounted('controls');
    expect(render(<Panel which="menu" />).getByLabelText('menu panel').getAttribute('data-open')).toBe('false');
    cleanup();
    requestPageChrome('menu');
    expect(render(<Panel which="menu" />).getByLabelText('menu panel').getAttribute('data-open')).toBe('false');
  });
});
