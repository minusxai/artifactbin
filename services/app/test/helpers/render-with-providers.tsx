/**
 * ADAPTED from minusx test/helpers/render-with-providers.tsx: their helper
 * wraps Redux + Chakra; the ported engine needs neither (kit is Radix +
 * Tailwind, embeds are provider-free), so this is plain
 * RTL render with the same call shape so ported tests import unchanged.
 */
import type { ReactElement } from 'react';
import { render, type RenderOptions } from '@testing-library/react';

export function renderWithProviders(ui: ReactElement, options: Omit<RenderOptions, 'wrapper'> = {}) {
  return render(ui, options);
}
