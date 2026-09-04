import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AgentLink from '@/components/AgentLink';
import TokensPanel from '@/components/TokensPanel';
import { anonymousPaste } from '@/lib/agent-copy';

const push = vi.fn();
vi.mock('@/lib/navigation', () => ({ useRouter: () => ({ push }) }));

vi.mock('@/components/GetStarted', () => ({
  default: () => <div>anonymous start</div>,
  AGENT_MARKS: [],
}));
vi.mock('@/components/ClaimForm', () => ({ default: () => null }));
vi.mock('@/components/DatasetUpload', () => ({ default: () => null }));
vi.mock('@/components/LoginForm', () => ({ default: () => null }));

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  push.mockClear();
  vi.unstubAllGlobals();
});

describe('<TokensPanel>', () => {
  it('shows lifecycle status and compact relative expiry/use times without the placeholder artifact count', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-01T12:00:00Z'));
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));

    render(<TokensPanel tokens={[
      {
        id: 'tok_active',
        name: 'alpha',
        status: 'active',
        created_at: '2026-09-01T10:00:00Z',
        deleted_at: null,
        expires_at: '2026-09-01T17:15:00Z',
        last_used_at: '2026-09-01T11:56:50Z',
      },
      {
        id: 'tok_expired',
        name: 'old',
        status: 'expired',
        created_at: '2026-08-31T10:00:00Z',
        deleted_at: null,
        expires_at: '2026-09-01T10:00:00Z',
        last_used_at: null,
      },
      {
        id: 'tok_revoked',
        name: 'gone',
        status: 'revoked',
        created_at: '2026-08-30T10:00:00Z',
        deleted_at: '2026-09-01T09:00:00Z',
        expires_at: '2026-09-01T18:00:00Z',
        last_used_at: '2026-09-01T11:00:00Z',
      },
    ]} />);

    expect(screen.getByLabelText('Token alpha active status dot')).toHaveClass('bg-accent');
    expect(screen.getByLabelText('Token alpha status')).toHaveTextContent('active');
    expect(screen.getByLabelText('Token alpha expires')).toHaveTextContent('in 5h');
    expect(screen.getByLabelText('Token alpha last used')).toHaveTextContent('3m ago');
    expect(screen.getByLabelText('Token old status')).toHaveTextContent('expired');
    expect(screen.getByLabelText('Token old expired status dot')).toHaveClass('bg-danger');
    expect(screen.getByLabelText('Token old last used')).toHaveTextContent('never');
    expect(screen.getByLabelText('Token gone revoked status dot')).toHaveClass('bg-faint');
    expect(screen.getAllByLabelText(/^Token row /).map((row) => row.getAttribute('aria-label'))).toEqual([
      'Token row alpha',
      'Token row old',
      'Token row gone',
    ]);
    expect(screen.queryByText('artifacts')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Revoke token old')).toBeEnabled();
  });

  it('renders null expiry and last use as never', () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    render(<TokensPanel tokens={[{
      id: 'tok_web',
      name: 'web',
      status: 'active',
      created_at: '2026-09-01T10:00:00Z',
      deleted_at: null,
      expires_at: null,
      last_used_at: null,
    }]} />);

    expect(screen.getByLabelText('Token web expires')).toHaveTextContent('never');
    expect(screen.getByLabelText('Token web last used')).toHaveTextContent('never');
  });
});

describe('<AgentLink>', () => {
  it('copies the prompt decided by /api/start', async () => {
    const response = {
      id: 'Ab3xK9',
      url: 'http://localhost:3000/a/Ab3xK9',
      token: 'mx_secret',
      prompt: anonymousPaste(window.location.origin, 'Ab3xK9', 'mx_secret'),
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(response) }));
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });

    render(<AgentLink frame={false} />);
    fireEvent.click(screen.getByLabelText('Create a live document for my agent'));

    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      response.prompt,
    ));
  });

  it('does not synthesize a paste when /api/start omits its prompt', async () => {
    const clipboard = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ id: 'Ab3xK9', url: 'http://localhost:3000/a/Ab3xK9', token: 'mx_secret' }),
    }));
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: clipboard } });

    render(<AgentLink frame={false} />);
    fireEvent.click(screen.getByLabelText('Create a live document for my agent'));

    await waitFor(() => expect(screen.getByText('created! copy the prompt from the document page')).toBeInTheDocument());
    expect(clipboard).not.toHaveBeenCalled();
  });
});
