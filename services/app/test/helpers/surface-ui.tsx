import type { ReactNode } from 'react';
import { BrowserRouter } from 'react-router';
import { render as renderReact,configure } from '@testing-library/react';
import { vi } from 'vitest';

// These integration fixtures await the real lazy runtime, including its cold
// module transform during the parallel full suite. No preload or startup mock.
configure({asyncUtilTimeout:5000});

// These page-contract tests inspect controls without CSS. Real shadow/top-layer
// placement is tested in artifact-trusted-portals and the browser gate.
vi.mock('@/components/TrustedUi', () => ({
  TrustedUi: ({children}:{children:ReactNode}) => children,
  useTrustedPortalContainer: () => undefined,
}));

export function render(ui:ReactNode) {
  const view = renderReact(<BrowserRouter>{ui}</BrowserRouter>);
  return {...view, rerender:(next:ReactNode) => view.rerender(<BrowserRouter>{next}</BrowserRouter>)};
}
