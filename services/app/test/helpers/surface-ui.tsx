import type { ReactNode } from 'react';
import { BrowserRouter } from 'react-router';
import { render as renderReact } from '@testing-library/react';
import { vi } from 'vitest';

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
