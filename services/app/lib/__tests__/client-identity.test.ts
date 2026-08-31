/**
 * Every User-Agent below was taken from real nginx logs on the production box,
 * not invented — including the one that matters most: Node-based clients send a
 * bare `node`, which names a RUNTIME and not an agent.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { ARTIFACTBIN_AGENT_HEADER, identifyClient, describeClient, logClientIdentity } from '@/lib/client-identity';

const byUa = (userAgent: string) => identifyClient({ userAgent });

afterEach(() => vi.restoreAllMocks());

describe(`${ARTIFACTBIN_AGENT_HEADER} — explicit HTTP agent identity`, () => {
  it('wins over a runtime user-agent when it names a supported harness', () => {
    const id = identifyClient({ agentHeader: 'codex', userAgent: 'curl/8.7.1' });
    expect(id).toMatchObject({ harness: 'codex', label: 'codex', source: 'agent-header' });
  });

  it('accepts human-readable spelling but ignores unknown declarations', () => {
    expect(identifyClient({ agentHeader: 'Claude Code', userAgent: 'node' }).harness).toBe('claude-code');
    expect(identifyClient({ agentHeader: 'definitely-not-an-agent', userAgent: 'codex-mcp-client/1' }).harness).toBe('codex');
  });
});

describe('User-Agent — what it can and cannot tell us', () => {
  it('identifies OpenAI harnesses, which brand themselves', () => {
    expect(byUa('openai-mcp/1.0.0').harness).toBe('chatgpt');
    expect(byUa('codex-mcp-client/0.147.0').harness).toBe('codex');
  });

  it('does NOT pretend a bare runtime UA is an agent', () => {
    // 17 hits of exactly this in production. It is Node's default fetch UA, so
    // it cannot separate Claude Code from any other Node script — guessing here
    // would be worse than admitting it.
    expect(byUa('node').harness).toBe('script');
    expect(byUa('Python/3.12 aiohttp/3.13.5').harness).toBe('script');
    expect(byUa('python-httpx/0.28.1').harness).toBe('script');
  });

  it('buckets humans and tools honestly', () => {
    expect(byUa('curl/8.7.1').harness).toBe('curl');
    expect(byUa('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/150.0.0.0').harness).toBe('browser');
  });

  it('falls back to unknown rather than guessing', () => {
    expect(byUa('something-nobody-has-seen/1').harness).toBe('unknown');
    expect(identifyClient({}).harness).toBe('unknown');
    expect(identifyClient({ userAgent: '   ' }).source).toBe('none');
  });
});

describe('clientInfo — the channel that actually names the agent', () => {
  it('identifies Claude Code, which the User-Agent cannot', () => {
    const id = identifyClient({ userAgent: 'node', clientInfo: { name: 'claude-code', version: '2.1.0' } });
    expect(id.harness).toBe('claude-code');
    expect(id.version).toBe('2.1.0');
    expect(id.source).toBe('clientInfo');
  });

  it('OVERRIDES the user-agent, because a runtime UA cannot separate agents', () => {
    // The exact case: both Claude Code and a random script send `node`.
    expect(identifyClient({ userAgent: 'node', clientInfo: { name: 'cursor-vscode' } }).harness).toBe('cursor');
    expect(byUa('node').harness).toBe('script');
  });

  it('keeps an unrecognised clientInfo name as the label, still preferring it', () => {
    const id = identifyClient({ userAgent: 'node', clientInfo: { name: 'some-new-agent', version: '9' } });
    expect(id.harness).toBe('unknown');
    expect(id.label).toBe('some-new-agent'); // the client named itself; keep it for logs
    expect(id.source).toBe('clientInfo');
  });

  it('recognises the other common MCP clients', () => {
    const of = (name: string) => identifyClient({ clientInfo: { name } }).harness;
    expect(of('ChatGPT')).toBe('chatgpt');
    expect(of('Visual Studio Code')).toBe('vscode');
    expect(of('Windsurf')).toBe('windsurf');
    expect(of('claude-ai')).toBe('claude-web');
  });

  it('ignores non-string junk instead of throwing', () => {
    expect(identifyClient({ clientInfo: { name: 42 as unknown as string } }).source).toBe('none');
    expect(identifyClient({ clientInfo: null, userAgent: null }).harness).toBe('unknown');
  });
});

describe('logging', () => {
  it('emits one readable line and returns the identity', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const id = logClientIdentity('mcp:initialize', { userAgent: 'node', clientInfo: { name: 'claude-code', version: '2.1.0' } });
    expect(id.harness).toBe('claude-code');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(String(spy.mock.calls[0][0])).toContain('claude-code');
    expect(String(spy.mock.calls[0][0])).toContain('mcp:initialize');
  });

  it('describes compactly', () => {
    expect(describeClient(identifyClient({ userAgent: 'openai-mcp/1.0.0' }))).toBe('chatgpt (openai-mcp/1.0.0, via user-agent)');
  });
});
