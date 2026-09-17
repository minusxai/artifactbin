/**
 * The handle card: shows the account's username (the one in every pretty URL)
 * and lets the owner change it. A rename must report the two refusals the API
 * distinguishes — taken vs invalid — because "it didn't work" is useless when
 * the fix differs.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import UsernameCard from '@/components/UsernameCard';

let reply: { status: number; body: unknown } = { status: 200, body: { username: 'newname' } };
const sent: unknown[] = [];

beforeEach(() => {
  sent.length = 0;
  reply = { status: 200, body: { username: 'newname' } };
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
    sent.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify(reply.body), { status: reply.status });
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('UsernameCard', () => {
  it('shows the current handle and the URL shape it produces', () => {
    render(<UsernameCard username="mxmx_owner" />);
    expect(screen.getByLabelText('Username').getAttribute('value') ?? (screen.getByLabelText('Username') as HTMLInputElement).value).toBe('mxmx_owner');
    expect(screen.getByText(/@mxmx_owner/)).toBeTruthy();
  });

  it('renames, and reflects the name the SERVER settled on', async () => {
    render(<UsernameCard username="mxmx_owner" />);
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'PPSreejith2' } });
    fireEvent.click(screen.getByLabelText('Save username'));
    await waitFor(() => expect(sent).toEqual([{ username: 'PPSreejith2' }]));
    // The server lowercases; the card must show what was stored, not what was typed.
    await waitFor(() => expect((screen.getByLabelText('Username') as HTMLInputElement).value).toBe('newname'));
  });

  it('says TAKEN and INVALID differently — the fixes are different', async () => {
    render(<UsernameCard username="mxmx_owner" />);
    reply = { status: 409, body: { error: 'username_taken' } };
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'someone_else' } });
    fireEvent.click(screen.getByLabelText('Save username'));
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/taken/i));

    reply = { status: 400, body: { error: 'invalid_username' } };
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'no-hyphens' } });
    fireEvent.click(screen.getByLabelText('Save username'));
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/letters, numbers|underscore/i));
  });

  it('renders the handle in the clear — it is a public name, not a secret', () => {
    // TokenInput masks its value like a password; a HANDLE is the most public
    // string the account owns and must never render as dots.
    render(<UsernameCard username="mxmx_owner" />);
    expect((screen.getByLabelText('Username') as HTMLInputElement).className).not.toContain('text-security');
  });

  it('tells the owner that old links keep working — the whole point of id-anchored URLs', () => {
    render(<UsernameCard username="mxmx_owner" />);
    expect(screen.getByText(/keep working/i)).toBeTruthy();
  });

  it('aligns the helper text with the input, not the @ gutter', () => {
    // The @ sits in a fixed gutter; everything under the field starts where
    // the field starts, so the card reads as one column, not a ragged left.
    render(<UsernameCard username="mxmx_owner" />);
    expect((screen.getByText(/your documents live at/i) as HTMLElement).className).toContain('ml-6');
    expect((screen.getByText(/keep working/i) as HTMLElement).className).toContain('ml-6');
  });
});
