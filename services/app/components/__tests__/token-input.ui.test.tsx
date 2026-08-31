/**
 * Token fields must be INVISIBLE to the browser's password manager.
 *
 * A password-typed field reads to Chrome as a site credential, and a page it
 * re-renders reads as "the saved credential for this site changed" — an
 * "Update password?" bubble on refresh. An mx_ token is not a password: the
 * fields mask their value with CSS (-webkit-text-security) and switch
 * autofill off instead.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import ClaimForm from '@/components/ClaimForm';
import TokenBrowser from '@/components/TokenBrowser';

const assertManagerBlind = (input: HTMLInputElement) => {
  expect(input.type).toBe('text');
  expect(input.autocomplete).toBe('off');
  expect(input.className).toContain('text-security');
};

describe('token fields', () => {
  it('keeps the home-page token browser out of the password manager', () => {
    render(<TokenBrowser />);
    assertManagerBlind(screen.getByLabelText('Token'));
  });

  it('keeps the claim form out of the password manager', () => {
    render(<ClaimForm />);
    assertManagerBlind(screen.getByLabelText('Token to claim'));
  });
});
