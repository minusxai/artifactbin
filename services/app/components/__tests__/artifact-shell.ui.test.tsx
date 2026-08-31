/**
 * The shell answers ONE question — does this browser own the artifact — and
 * everything above it (the top bar's actions, the editor) gates on that.
 *
 * The answer now arrives with the page: BOTH kinds of owner (an account
 * session, and an anonymous browser holding the agent-session cookie) are
 * resolved server-side by lib/viewer's `isOwner`. The old client probe —
 * a bearer `GET /api/artifacts` to test a localStorage token — is gone with
 * the token itself, so this component must make NO request at all. That is
 * what these tests pin: a stubbed fetch that throws on any call.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import ArtifactShell, { useArtifactOwner } from '../ArtifactShell';


let calls: string[];

beforeEach(() => {
  calls = [];
  localStorage.clear();
  vi.stubGlobal('fetch', (async (url: string) => {
    calls.push(String(url));
    throw new Error(`the shell must not fetch: ${url}`);
  }) as unknown as typeof fetch);
});

afterEach(() => vi.unstubAllGlobals());

// The shell renders no chrome of its own, so the ownership signal IS what a
// test can see: a probe under it reports what the context says.
const Flag = () => <span aria-label="owner flag">{useArtifactOwner() ? 'owner' : 'viewer'}</span>;
const DOC = <><p>the document</p><Flag /></>;

describe('ArtifactShell', () => {
  it('knows an owner immediately, without probing', async () => {
    render(<ArtifactShell role="owner">{DOC}</ArtifactShell>);
    expect(screen.getByText('the document')).toBeInTheDocument();
    expect(screen.getByLabelText('owner flag')).toHaveTextContent('owner');
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toEqual([]);
  });

  it('renders the bare document for a reader, without probing', async () => {
    render(<ArtifactShell role="viewer">{DOC}</ArtifactShell>);
    expect(screen.getByText('the document')).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toEqual([]);
    expect(screen.getByLabelText('owner flag')).toHaveTextContent('viewer');
  });

  it('ignores a leftover localStorage token — a credential there no longer means anything', async () => {
    localStorage.setItem('mx_tokens', JSON.stringify(['mx_secret']));
    localStorage.setItem('mx_token', 'mx_secret');
    render(<ArtifactShell role="viewer">{DOC}</ArtifactShell>);
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toEqual([]);
    expect(screen.getByLabelText('owner flag')).toHaveTextContent('viewer');
  });
});

/**
 * The shell is the ONE source of the ownership signal: everything below it
 * (the top bar's actions, the surface's edit/ref buttons) gates on
 * useArtifactOwner() rather than probing again.
 */
const Probe = () => <p>{useArtifactOwner() ? 'owner-yes' : 'owner-no'}</p>;

describe('useArtifactOwner', () => {
  it('is true under an owner', () => {
    render(<ArtifactShell role="owner"><Probe /></ArtifactShell>);
    expect(screen.getByText('owner-yes')).toBeInTheDocument();
  });

  it('is false under a reader', () => {
    render(<ArtifactShell role="viewer"><Probe /></ArtifactShell>);
    expect(screen.getByText('owner-no')).toBeInTheDocument();
  });
});
