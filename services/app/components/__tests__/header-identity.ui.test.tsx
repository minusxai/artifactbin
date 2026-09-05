/**
 * WHO THE MASTHEAD SAYS YOU ARE.
 *
 * The readout's last identity line was the account's EMAIL, which is the one
 * thing about an account that is neither public, nor clickable, nor what the
 * product addresses you by anywhere else: every document this account owns
 * lives under `/@handle`, the profile is the page that lists them, and the
 * masthead — the one piece of chrome on every page — pointed at none of it.
 *
 * So the HANDLE is the line, and it is a link to the page it names. The email
 * moves into its tooltip rather than a second line: the readout column is
 * already four rows deep on a phone, and "which account am I signed in as" is a
 * question asked once a session, while "take me to my profile" is a thing to
 * click.
 *
 * The fallback is the whole of the back-compat story. A username is assigned
 * lazily at login (lib/users ensureUsername), so an account can be signed in
 * without one for exactly one request — and the session route READS it rather
 * than assigning it, because a GET that writes is a different thing. Absent, the
 * header is what it always was.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import HeaderBar from '@/components/HeaderBar';

afterEach(cleanup);

describe('the masthead identity line', () => {
  it('is the handle, linking to the profile it names', () => {
    render(<HeaderBar email="c@x.io" username="cee_a1b2" stats={null} />);
    const link = screen.getByLabelText('Open your profile');
    expect(link).toHaveAttribute('href', '/@cee_a1b2');
    expect(link).toHaveTextContent('@cee_a1b2');
  });

  it('keeps the email in the handle\u2019s tooltip rather than on a line of its own', async () => {
    render(<HeaderBar email="c@x.io" username="cee_a1b2" stats={null} />);
    // Not a second row: the readout column is already four deep on a phone.
    expect(screen.queryByText('c@x.io')).toBeNull();
    // Reachable, though — the answer to "which account is this" is one hover
    // away rather than gone.
    fireEvent.pointerMove(screen.getByLabelText('Open your profile'), { pointerType: 'mouse' });
    expect(await screen.findByText('c@x.io', {}, { timeout: 3000 })).toBeTruthy();
  });

  it('falls back to the email for an account with no handle yet', () => {
    render(<HeaderBar email="c@x.io" stats={null} />);
    expect(screen.queryByLabelText('Open your profile')).toBeNull();
    expect(screen.getByText('c@x.io')).toBeTruthy();
  });

  it('offers a signed-out visitor the login door, not an identity', () => {
    render(<HeaderBar stats={null} />);
    expect(screen.queryByLabelText('Open your profile')).toBeNull();
    expect(screen.getByLabelText('Log in from header')).toBeTruthy();
  });
});
