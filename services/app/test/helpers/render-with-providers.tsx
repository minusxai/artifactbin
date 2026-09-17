/**
 * A plain RTL render: the engine needs no providers at all (the kit is Radix +
 * Tailwind and embeds are provider-free). It keeps the wrapper call shape so a
 * test that needs one later gains it here rather than at every call site.
 */
import type { ReactElement } from 'react';
import { render, type RenderOptions } from '@testing-library/react';

export function renderWithProviders(ui: ReactElement, options: Omit<RenderOptions, 'wrapper'> = {}) {
  return render(ui, options);
}
