/**
 * The signed-out hero: ONE instruction at a time, chosen by where the
 * visitor's agent runs (the certbot pattern). The page it replaced stacked
 * every path at once — plugin commands, MCP paragraph, one-click document —
 * and read as a wall.
 *
 * What is guarded: every surface is reachable; exactly one card shows; each
 * card carries the thing the reader must take away (install commands from the
 * plugin package, the /mcp URL built from THIS host, the one-click document
 * button); and the pick survives a reload, because a returning visitor has
 * already answered the question.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import GetStarted, { AGENT_FAMILIES, SURFACES } from '@/components/GetStarted';
import { AnthropicIcon, ClaudeAIIcon } from '@/components/brand-icons';
import {
  CODEX_APP_PLUGIN_REF,
  CODEX_APP_PLUGIN_REPO_URL,
  PLUGIN_INSTALL,
  PLUGIN_REPO_URL,
} from '@/lib/plugin-id';

const card = () => screen.getByLabelText('Setup instructions');
const pick = (label: string) => fireEvent.click(screen.getByLabelText(`Use in ${label}`));
const chooseFamily = (label: string) =>
  fireEvent.click(screen.getByLabelText(`Choose ${label} agent family`));
/** The connector URL every MCP-speaking card must hand out. */
const MCP_URL = `${window.location.origin}/mcp`;
const DOCS_DOWNLOAD_URL = `${window.location.origin}/docs?download=true`;

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: vi.fn() } });
});
afterEach(() => vi.unstubAllGlobals());

describe('<GetStarted>', () => {
  it('groups every surface by agent family and leads with Claude Code CLI', () => {
    render(<GetStarted />);
    for (const family of AGENT_FAMILIES) {
      expect(screen.getByLabelText(`Choose ${family.label} agent family`)).toBeInTheDocument();
    }
    expect(AGENT_FAMILIES.map((item) => item.label)).toEqual([
      'Anthropic',
      'OpenAI',
      'Pi',
      'OpenCode',
      'Others',
    ]);
    expect(SURFACES.map(({ family, label }) => [family, label])).toEqual([
      ['anthropic', 'Claude Code CLI'],
      ['anthropic', 'Claude Code App'],
      ['anthropic', 'claude.ai'],
      ['openai', 'Codex CLI'],
      ['openai', 'Codex App'],
      ['openai', 'chatgpt.com'],
      ['pi', 'Pi CLI'],
      ['opencode', 'OpenCode CLI'],
      ['other', 'Any agent'],
    ]);
    const familyButton = screen.getByLabelText('Choose Anthropic agent family');
    const surfaceButton = screen.getByLabelText('Use in Claude Code CLI');
    expect(familyButton).toHaveAttribute('aria-pressed', 'true');
    expect(surfaceButton).toHaveAttribute('aria-pressed', 'true');
    expect(familyButton).toHaveClass('h-9');
    expect(surfaceButton).toHaveClass('h-9');
    expect(screen.getByLabelText('Use in Claude Code App')).toBeInTheDocument();
    expect(screen.getByLabelText('Use in claude.ai')).toBeInTheDocument();
    expect(screen.queryByLabelText('Use in Codex CLI')).not.toBeInTheDocument();
    expect(AGENT_FAMILIES[0].icon).toBe(AnthropicIcon);
    expect(SURFACES.find((item) => item.key === 'claude-ai')?.icon).toBe(ClaudeAIIcon);
  });

  it('auto-selects the first surface whenever the family changes', () => {
    render(<GetStarted />);
    pick('claude.ai');
    chooseFamily('OpenAI');
    expect(screen.getByLabelText('Use in Codex CLI')).toHaveAttribute('aria-pressed', 'true');
    pick('Codex App');
    chooseFamily('Anthropic');
    expect(screen.getByLabelText('Use in Claude Code CLI')).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows the matching icon on every surface choice', () => {
    render(<GetStarted />);
    for (const family of AGENT_FAMILIES) {
      chooseFamily(family.label);
      for (const surface of SURFACES.filter((item) => item.family === family.key)) {
        expect(screen.getByLabelText(`Use in ${surface.label}`).querySelector('svg')).toBeTruthy();
      }
    }
  });

  it('shows exactly one card: Claude Code gets try-it-now first, then the plugin', () => {
    render(<GetStarted />);
    expect(screen.getAllByLabelText('Setup instructions')).toHaveLength(1);
    // Option 1 is NO setup — the one-click document — because trying it must
    // cost less than installing it. The plugin is the upgrade, after an "or".
    const body = card().textContent ?? '';
    expect(screen.getByLabelText('Create a live document for my agent')).toBeInTheDocument();
    // Quoted from the plugin package, never retyped: a stale command here
    // fails in the reader's terminal, where nothing guards it.
    expect(body).toContain(PLUGIN_INSTALL);
    expect(screen.getByLabelText('Copy the plugin install commands')).toBeInTheDocument();
    expect(body.indexOf('create an artifact')).toBeLessThan(body.indexOf(PLUGIN_INSTALL));
    // The two paths are NAMED, so "or" separates option 1 from option 2
    // rather than two unlabeled blobs of instruction — and each says what it
    // IS: no-install offers HTTP skills + tools via API, while the plugin ships
    // MCP tools + skills.
    expect(body.toLowerCase()).toContain('option 1');
    expect(body.toLowerCase()).toContain('option 2');
    expect(body).toContain('Recommended - Install plugin');
    expect(body).toContain('HTTP Skills + Tools via API');
    expect(body.toLowerCase()).toContain('out of the box');
  });

  it('switching the pick swaps the card rather than stacking another', () => {
    render(<GetStarted />);
    pick('claude.ai');
    expect(screen.getAllByLabelText('Setup instructions')).toHaveLength(1);
    expect(card().textContent).not.toContain(PLUGIN_INSTALL);
    expect(card().textContent).toContain(PLUGIN_REPO_URL);
  });

  it('keeps no-install first in Claude Code App, then recommends the numbered plugin flow', () => {
    render(<GetStarted />);
    pick('Claude Code App');
    const body = card().textContent ?? '';
    expect(body).toContain(PLUGIN_REPO_URL);
    expect(body).not.toContain(PLUGIN_INSTALL);
    expect(body.indexOf('HTTP Skills + Tools via API')).toBeLessThan(
      body.indexOf('Recommended - Install plugin'),
    );
    expect(body.toLowerCase()).toContain('option 1');
    expect(body.toLowerCase()).toContain('option 2');
    const firstStep = screen.getByLabelText(
      'Step 1: Under the chat box, click + → Plugins → Manage Plugins',
    );
    expect(firstStep).toBeInTheDocument();
    expect(firstStep).toHaveClass('grid-cols-[1.5rem_minmax(0,1fr)]');
    expect(firstStep).not.toHaveClass('min-h-32');
    expect(
      screen.getByLabelText('Step 2: Add → Marketplace → Add from repository'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Step 3: Artifact Bin → Install')).toBeInTheDocument();
    expect(screen.getByLabelText('Step 4: Connector → Connect')).toBeInTheDocument();
    expect(body).toContain('Make me a quick report about daylight savings');
    expect(screen.getByLabelText('Create a live document for my agent')).toBeInTheDocument();
  });

  it('gives claude.ai the plugin guide without separate HTTP or MCP paths', () => {
    render(<GetStarted />);
    pick('claude.ai');
    const body = card().textContent ?? '';
    expect(body).toContain(PLUGIN_REPO_URL);
    expect(body).not.toContain(MCP_URL);
    expect(
      screen.getByLabelText(`Step 1: https://claude.ai/new#directory/plugins`),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText(`Step 1: https://claude.ai/new#directory/plugins`),
    ).not.toHaveClass('min-h-32');
    expect(screen.getByLabelText('Open Claude plugin directory')).toHaveAttribute(
      'href',
      'https://claude.ai/new#directory/plugins',
    );
    expect(
      screen.getByLabelText('Step 2: + on the right → Add marketplace'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Step 3: Artifact Bin → Install')).toBeInTheDocument();
    expect(screen.getByLabelText('Step 4: Connector → Connect')).toBeInTheDocument();
    expect(body).toContain('Make me a quick report about daylight savings');
    expect(screen.queryByLabelText('Create a live document for my agent')).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Copy the plugin marketplace URL'));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(PLUGIN_REPO_URL);
  });

  it('keeps chatgpt.com on the no-install option for now', () => {
    render(<GetStarted />);
    chooseFamily('OpenAI');
    pick('chatgpt.com');
    expect(screen.getByLabelText('Create a live document for my agent')).toBeInTheDocument();
    expect(card().textContent).toContain('option 1');
    expect(card().textContent).toContain('no installation');
    expect(card().textContent).not.toContain('option 2');
    expect(card().textContent).not.toContain(MCP_URL);
  });

  it('gives Codex App no-install first, then the numbered marketplace flow', () => {
    render(<GetStarted />);
    chooseFamily('OpenAI');
    pick('Codex App');
    const body = card().textContent ?? '';
    expect(body).toContain('HTTP Skills + Tools via API');
    expect(body).toContain('Recommended - Install plugin');
    expect(body).toContain(CODEX_APP_PLUGIN_REPO_URL);
    expect(body).toContain(CODEX_APP_PLUGIN_REF);
    expect(body).not.toContain(MCP_URL);
    expect(screen.getByLabelText('Step 1: Plugins → Add Marketplace')).toBeInTheDocument();
    expect(
      screen.getByLabelText(
        `Step 2: Repository URL → ${CODEX_APP_PLUGIN_REPO_URL}; Git ref → ${CODEX_APP_PLUGIN_REF}`,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText('Step 3: Add marketplace → Try now'),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Copy the Codex App plugin repository URL'));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(CODEX_APP_PLUGIN_REPO_URL);
  });

  it('gives Codex CLI no-install first, then the interactive plugin installer', () => {
    render(<GetStarted />);
    chooseFamily('OpenAI');
    const body = card().textContent ?? '';
    expect(screen.getByLabelText('Create a live document for my agent')).toBeInTheDocument();
    expect(body).toContain('HTTP Skills + Tools via API');
    expect(body).toContain('Recommended - Install plugin');
    expect(body).toContain(PLUGIN_REPO_URL);
    expect(body).not.toContain(MCP_URL);
    const firstStep = screen.getByLabelText(
      'Step 1: Interactive installer → Add marketplace',
    );
    expect(firstStep).toBeInTheDocument();
    expect(firstStep).toHaveClass('grid-cols-[1.5rem_minmax(0,1fr)]');
    expect(firstStep).not.toHaveClass('min-h-32');
    expect(
      screen.getByLabelText('Step 2: Open the marketplace → Artifact Bin → Install'),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText('Step 3: Browser opens automatically → Log in → Authorized'),
    ).toBeInTheDocument();
    expect(body).toContain('Make me a quick report about daylight savings');
  });

  it('gives "others" a no-install path or the MCP server URL', () => {
    render(<GetStarted />);
    chooseFamily('Others');
    expect(screen.getByLabelText('Use in Any agent')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('Create a live document for my agent')).toBeInTheDocument();
    const body = card().textContent ?? '';
    expect(body).toContain('option 1');
    expect(body).toContain('option 2');
    expect(body).toContain('connect the MCP server');
    expect(body).toContain(MCP_URL);
    fireEvent.click(screen.getByLabelText('Copy the connector URL'));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(MCP_URL);
  });

  it.each([
    ['Pi', 'Pi CLI', '~/.pi/agent', '~/.pi/agent/skills/artifact-bin'],
    [
      'OpenCode',
      'OpenCode CLI',
      '~/.config/opencode',
      '~/.config/opencode/skills/artifact-bin',
    ],
  ] as const)(
    'gives %s a no-install path or a global skills install',
    (family, surface, installRoot, installedPath) => {
      render(<GetStarted />);
      chooseFamily(family);
      expect(screen.getByLabelText(`Use in ${surface}`)).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByLabelText('Create a live document for my agent')).toBeInTheDocument();
      const body = card().textContent ?? '';
      const install = `mkdir -p ${installRoot} && curl -fsSL "${DOCS_DOWNLOAD_URL}" | tar -xz -C ${installRoot}`;
      expect(body).toContain('HTTP Skills + Tools via API');
      expect(body).toContain('option 1');
      expect(body).toContain('option 2');
      expect(body).toContain('install the skills');
      expect(body).toContain(installedPath);
      expect(body).toContain(install);
      expect(body).not.toContain(MCP_URL);
      fireEvent.click(screen.getByLabelText(`Copy the ${family} skills install command`));
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(install);
    },
  );

  it('remembers the pick across a reload', () => {
    const first = render(<GetStarted />);
    chooseFamily('OpenAI');
    pick('chatgpt.com');
    first.unmount();
    render(<GetStarted />);
    expect(screen.getByLabelText('Choose OpenAI agent family')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('Use in chatgpt.com')).toHaveAttribute('aria-pressed', 'true');
    expect(card().textContent).toContain('no installation');
    expect(card().textContent).not.toContain(MCP_URL);
  });
});
