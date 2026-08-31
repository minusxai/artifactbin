'use client';

/**
 * The signed-out hero: pick the agent family, then the surface where it runs, and
 * get the ONE instruction that matters there. Modeled on installer widgets:
 * a stable parent row narrows a contextual child row, and the picked surface
 * decides the single setup card below.
 *
 * Family marks are inlined in their proper brand colors
 * (components/brand-icons); selection is carried by the row background and
 * label, not the mark.
 *
 * The connector URL is built from window.location, never hardcoded: the same
 * page serves localhost, staging, and production, and a copied URL that names
 * the wrong host fails in the reader's client where nothing guards it. The
 * install commands come from lib/plugin-id, same reason.
 */
import { Bot } from 'lucide-react';
import { useEffect, useState } from 'react';
import AgentLink from '@/components/AgentLink';
import {
  AnthropicIcon,
  ChatGPTIcon,
  ClaudeAIIcon,
  ClaudeCodeIcon,
  CodexIcon,
  OpenCodeIcon,
  PiIcon,
} from '@/components/brand-icons';
import CopyBlock from '@/components/CopyBlock';
import { Badge, MicroLabel } from '@/components/ui';
import {
  CODEX_APP_PLUGIN_REF,
  CODEX_APP_PLUGIN_REPO_URL,
  PLUGIN_INSTALL,
  PLUGIN_REPO_URL,
} from '@/lib/plugin-id';

/** Every distinct mark represented by the connector. The closed NextSteps
 * rail uses this complete set instead of repeating the same glyph for CLI and
 * app variants of one product. */
export const AGENT_MARKS = [
  { key: 'anthropic', icon: AnthropicIcon, iconSize: 20 },
  { key: 'claude-code', icon: ClaudeCodeIcon, iconSize: 18 },
  { key: 'claude-ai', icon: ClaudeAIIcon, iconSize: 18 },
  { key: 'openai', icon: ChatGPTIcon, iconSize: 20 },
  { key: 'codex', icon: CodexIcon, iconSize: 20 },
  { key: 'pi', icon: PiIcon, iconSize: 23 },
  { key: 'opencode', icon: OpenCodeIcon, iconSize: 20 },
  { key: 'other', icon: Bot, iconSize: 20 },
] as const;

/** The stable parent row that drives the family picker. */
export const AGENT_FAMILIES = [
  { key: 'anthropic', label: 'Anthropic', icon: AnthropicIcon, iconSize: 20 },
  { key: 'openai', label: 'OpenAI', icon: ChatGPTIcon, iconSize: 20 },
  { key: 'pi', label: 'Pi', icon: PiIcon, iconSize: 23 },
  { key: 'opencode', label: 'OpenCode', icon: OpenCodeIcon, iconSize: 20 },
  { key: 'other', label: 'Others', icon: Bot, iconSize: 20 },
] as const;

export type AgentFamilyKey = (typeof AGENT_FAMILIES)[number]['key'];

/** Each surface names exactly one setup card and its parent agent family. Keeping
 * the relationship on the surface makes filtering and auto-selection share
 * one source of truth. */
export const SURFACES = [
  {
    key: 'claude-code',
    family: 'anthropic',
    label: 'Claude Code CLI',
    icon: ClaudeCodeIcon,
    iconSize: 18,
  },
  {
    key: 'claude-code-app',
    family: 'anthropic',
    label: 'Claude Code App',
    icon: ClaudeCodeIcon,
    iconSize: 18,
  },
  { key: 'claude-ai', family: 'anthropic', label: 'claude.ai', icon: ClaudeAIIcon, iconSize: 18 },
  { key: 'codex', family: 'openai', label: 'Codex CLI', icon: CodexIcon, iconSize: 20 },
  { key: 'codex-app', family: 'openai', label: 'Codex App', icon: CodexIcon, iconSize: 20 },
  { key: 'chatgpt', family: 'openai', label: 'chatgpt.com', icon: ChatGPTIcon, iconSize: 18 },
  { key: 'pi', family: 'pi', label: 'Pi CLI', icon: PiIcon, iconSize: 21 },
  { key: 'opencode', family: 'opencode', label: 'OpenCode CLI', icon: OpenCodeIcon, iconSize: 18 },
  { key: 'other', family: 'other', label: 'Any agent', icon: Bot, iconSize: 18 },
] as const satisfies readonly {
  key: string;
  family: AgentFamilyKey;
  label: string;
  icon: React.ElementType;
  iconSize: number;
}[];

export type SurfaceKey = (typeof SURFACES)[number]['key'];

/** A returning visitor has already answered the question; keep their answer. */
const STORE = 'mx_surface';

const isSurface = (v: string | null): v is SurfaceKey => SURFACES.some((s) => s.key === v);

/** Matches AgentLink's status line exactly — the two option foot lines sit a
 * block apart and must read as the same voice. */
const FOOT = 'mt-1.5 font-mono text-[11px] text-muted';
const HTTP_OPTION_NOTE = 'HTTP Skills + Tools via API; paste this in your agent and watch it cook!';
const PICKER_GROUP = 'grid gap-px overflow-hidden rounded-[4px] border border-edge bg-edge';
const PICKER_BUTTON =
  'flex h-9 cursor-pointer items-center justify-center gap-1 px-1.5 py-0.5 font-mono text-[10px] leading-[1.1] transition-colors duration-150 focus-visible:z-10';

/** An option's masthead: badge + title left, the what-it-is note flushed
 * right — one row, no separate foot line. */
function OptionHeader({ n, title, note }: { n: number; title: string; note: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <span className="flex items-baseline gap-2">
        <Badge tone="accent">option {n}</Badge>
        <span className="font-mono text-[11px] tracking-[0.14em] text-fg uppercase">{title}</span>
      </span>
      <span className="font-mono text-[11px] text-muted">{note}</span>
    </div>
  );
}

function HttpOption({ n = 1 }: { n?: number }) {
  return (
    <>
      <OptionHeader n={n} title="no installation" note={HTTP_OPTION_NOTE} />
      <AgentLink frame={false} docsLink={false} />
    </>
  );
}

function OrDivider() {
  return (
    <div aria-hidden className="my-4 flex items-center gap-3">
      <span className="h-px flex-1 bg-edge" />
      <span className="font-mono text-[11px] tracking-[0.14em] text-faint uppercase">or</span>
      <span className="h-px flex-1 bg-edge" />
    </div>
  );
}

function PluginGuideHeader({ n }: { n?: number }) {
  return n === undefined ? (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <span className="font-mono text-[11px] tracking-[0.14em] text-fg uppercase">
        Recommended - Install plugin
      </span>
      <span className="font-mono text-[11px] text-muted">skills + tools together; install once</span>
    </div>
  ) : (
    <OptionHeader
      n={n}
      title="Recommended - Install plugin"
      note="skills + tools together; install once"
    />
  );
}

const CLAUDE_AI_PLUGIN_DIRECTORY = 'https://claude.ai/new#directory/plugins';

function PluginListStep({
  n,
  label,
  ariaLabel,
  children,
}: {
  n: number;
  label: React.ReactNode;
  ariaLabel: string;
  children?: React.ReactNode;
}) {
  return (
    <li
      aria-label={`Step ${n}: ${ariaLabel}`}
      className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-2.5 border-t border-edge py-2.5 last:border-b"
    >
      <span className="pt-0.5 font-mono text-[10px] text-faint">0{n}</span>
      <div className="min-w-0">
        <p className="font-mono text-xs leading-relaxed text-fg">{label}</p>
        {children && <div className="mt-2">{children}</div>}
      </div>
    </li>
  );
}

function ClaudePluginInstallGuide({ surface }: { surface: 'app' | 'web' }) {
  const web = surface === 'web';

  return (
    <>
      {web ? <PluginGuideHeader /> : <PluginGuideHeader n={2} />}
      <ol aria-label="Plugin installation steps" className="mt-3">
        {web ? (
          <PluginListStep
            n={1}
            ariaLabel={CLAUDE_AI_PLUGIN_DIRECTORY}
            label={
              <a
                href={CLAUDE_AI_PLUGIN_DIRECTORY}
                target="_blank"
                rel="noreferrer"
                aria-label="Open Claude plugin directory"
                className="break-all text-accent hover:underline"
              >
                {CLAUDE_AI_PLUGIN_DIRECTORY} ↗
              </a>
            }
          />
        ) : (
          <PluginListStep
            n={1}
            ariaLabel="Under the chat box, click + → Plugins → Manage Plugins"
            label="Under the chat box, click + → Plugins → Manage Plugins"
          />
        )}
        <PluginListStep
          n={2}
          ariaLabel={web ? '+ on the right → Add marketplace' : 'Add → Marketplace → Add from repository'}
          label={web ? '+ on the right → Add marketplace' : 'Add → Marketplace → Add from repository'}
        >
          <CopyBlock
            text={PLUGIN_REPO_URL}
            label="Copy the plugin marketplace URL"
            className="mt-0"
          />
        </PluginListStep>
        <PluginListStep n={3} ariaLabel="Artifact Bin → Install" label="Artifact Bin → Install" />
        <PluginListStep n={4} ariaLabel="Connector → Connect" label="Connector → Connect" />
      </ol>
      <p className={FOOT}>
        then ask Claude:{' '}
        <span className="text-fg">“Make me a quick report about daylight savings”</span>
      </p>
    </>
  );
}

function CodexCliPluginGuide() {
  return (
    <>
      <PluginGuideHeader n={2} />
      <ol aria-label="Plugin installation steps" className="mt-3">
        <PluginListStep
          n={1}
          ariaLabel="Interactive installer → Add marketplace"
          label="/plugins → Interactive installer → Add marketplace"
        >
          <CopyBlock
            text={PLUGIN_REPO_URL}
            label="Copy the plugin marketplace URL"
            className="mt-0"
          />
        </PluginListStep>
        <PluginListStep
          n={2}
          ariaLabel="Open the marketplace → Artifact Bin → Install"
          label="Open the marketplace → Artifact Bin → Install"
        />
        <PluginListStep
          n={3}
          ariaLabel="Browser opens automatically → Log in → Authorized"
          label="Browser opens automatically → Log in → Authorized"
        />
      </ol>
      <p className={FOOT}>
        then ask Codex:{' '}
        <span className="text-fg">“Make me a quick report about daylight savings”</span>
      </p>
    </>
  );
}

function CodexAppPluginGuide() {
  return (
    <>
      <PluginGuideHeader n={2} />
      <ol aria-label="Plugin installation steps" className="mt-3">
        <PluginListStep
          n={1}
          ariaLabel="Plugins → Add Marketplace"
          label="Plugins → Add Marketplace"
        />
        <PluginListStep
          n={2}
          ariaLabel={`Repository URL → ${CODEX_APP_PLUGIN_REPO_URL}; Git ref → ${CODEX_APP_PLUGIN_REF}`}
          label={
            <>
              Repository URL <span className="text-faint">·</span> Git ref →{' '}
              <span className="text-accent">{CODEX_APP_PLUGIN_REF}</span>
            </>
          }
        >
          <CopyBlock
            text={CODEX_APP_PLUGIN_REPO_URL}
            label="Copy the Codex App plugin repository URL"
            className="mt-0"
          />
        </PluginListStep>
        <PluginListStep
          n={3}
          ariaLabel="Add marketplace → Try now"
          label="Add marketplace → Try now"
        />
      </ol>
      <p className={FOOT}>
        then ask Codex:{' '}
        <span className="text-fg">“Make me a quick report about daylight savings”</span>
      </p>
    </>
  );
}

function SkillsInstallGuide({
  agent,
  docsUrl,
  installRoot,
  installedPath,
}: {
  agent: 'Pi' | 'OpenCode';
  docsUrl: string;
  installRoot: string;
  installedPath: string;
}) {
  const install = `mkdir -p ${installRoot} && curl -fsSL "${docsUrl}" | tar -xz -C ${installRoot}`;

  return (
    <>
      <HttpOption />
      <OrDivider />
      <OptionHeader
        n={2}
        title="install the skills"
        note={`global ${agent} skills folder; install once`}
      />
      <CopyBlock text={install} label={`Copy the ${agent} skills install command`} />
      <p className={FOOT}>
        {agent} discovers <span className="text-fg">{installedPath}</span> automatically — restart{' '}
        {agent} if it is already running
      </p>
    </>
  );
}

function Card({ surface, mcpUrl, docsUrl }: { surface: SurfaceKey; mcpUrl: string; docsUrl: string }) {
  switch (surface) {
    case 'claude-code':
      // Trying it must cost less than installing it: the no-setup document
      // leads, and the plugin is the upgrade after the "or".
      return (
        <>
          <HttpOption />
          <OrDivider />
          <OptionHeader
            n={2}
            title="Recommended - Install plugin"
            note="ships MCP tools + skills out of the box; no HTTP wrangling"
          />
          <CopyBlock
            text={PLUGIN_INSTALL}
            label="Copy the plugin install commands"
            trailer='# then just ask: "make me a 5-slide deck about healthy living on artifact-bin"'
          />
        </>
      );
    case 'claude-code-app':
      return (
        <>
          <HttpOption />
          <OrDivider />
          <ClaudePluginInstallGuide surface="app" />
        </>
      );
    case 'codex':
      return (
        <>
          <HttpOption />
          <OrDivider />
          <CodexCliPluginGuide />
        </>
      );
    case 'codex-app':
      return (
        <>
          <HttpOption />
          <OrDivider />
          <CodexAppPluginGuide />
        </>
      );
    case 'chatgpt':
      return <HttpOption />;
    case 'claude-ai':
      return <ClaudePluginInstallGuide surface="web" />;
    case 'pi':
      return (
        <SkillsInstallGuide
          agent="Pi"
          docsUrl={docsUrl}
          installRoot="~/.pi/agent"
          installedPath="~/.pi/agent/skills/artifact-bin"
        />
      );
    case 'opencode':
      return (
        <SkillsInstallGuide
          agent="OpenCode"
          docsUrl={docsUrl}
          installRoot="~/.config/opencode"
          installedPath="~/.config/opencode/skills/artifact-bin"
        />
      );
    case 'other':
      return (
        <>
          <HttpOption />
          <OrDivider />
          <OptionHeader
            n={2}
            title="connect the MCP server"
            note="for any MCP-compatible agent"
          />
          <CopyBlock text={mcpUrl} label="Copy the connector URL" />
          <p className={FOOT}>paste it into your agent’s MCP settings, then approve the connection</p>
        </>
      );
  }
}

export default function GetStarted({
  heading = true,
  frame = true,
}: {
  heading?: boolean;
  /** false = no panel chrome, for hosts that already draw a card around it. */
  frame?: boolean;
}) {
  const [surface, setSurface] = useState<SurfaceKey>('claude-code');
  // Empty until hydration, so server and client render the same relative URL;
  // the absolute one lands with the first client paint.
  const [origin, setOrigin] = useState('');

  const activeSurface = SURFACES.find((item) => item.key === surface) ?? SURFACES[0];
  const activeFamily =
    AGENT_FAMILIES.find((item) => item.key === activeSurface.family) ?? AGENT_FAMILIES[0];
  const visibleSurfaces = SURFACES.filter((item) => item.family === activeFamily.key);
  const surfaceColumns =
    visibleSurfaces.length > 2
      ? 'grid-cols-2 sm:grid-cols-3'
      : visibleSurfaces.length === 2
        ? 'grid-cols-2'
        : 'grid-cols-1';

  useEffect(() => {
    setOrigin(window.location.origin);
    try {
      const saved = localStorage.getItem(STORE);
      if (isSurface(saved)) setSurface(saved);
    } catch {
      /* private mode */
    }
  }, []);

  const pick = (key: SurfaceKey) => {
    setSurface(key);
    try {
      localStorage.setItem(STORE, key);
    } catch {
      /* private mode */
    }
  };

  /** An installer-style parent choice always lands on a valid default. */
  const pickFamily = (key: AgentFamilyKey) => {
    const first = SURFACES.find((item) => item.family === key);
    if (first) pick(first.key);
  };

  return (
    <section aria-label="Get started">
      {/* Off where the host page brings its own section header (/docs/human). */}
      {heading && (
        <h2 className="mb-3">
          <MicroLabel>getting started</MicroLabel>
        </h2>
      )}
      <div className={frame ? 'rounded-[6px] border border-edge bg-surface px-4 py-4' : undefined}>
      <p className="font-mono text-xs text-fg">
        <span className="text-accent">$</span> choose your agent ...
        <span aria-hidden className="caret ml-1 inline-block h-3 w-[7px] translate-y-[2px] bg-accent" />
      </p>
      <div className="mt-3 grid grid-cols-[3.75rem_minmax(0,1fr)] items-stretch gap-x-2 gap-y-1.5">
        <span className="flex items-center font-mono text-[10px] tracking-[0.12em] text-faint uppercase">
          family
        </span>
        <div
          role="group"
          aria-label="Agent families"
          className={`${PICKER_GROUP} grid-cols-3 sm:grid-cols-5`}
        >
          {AGENT_FAMILIES.map((item) => (
            <button
              key={item.key}
              aria-label={`Choose ${item.label} agent family`}
              aria-pressed={item.key === activeFamily.key}
              onClick={() => pickFamily(item.key)}
              className={`${PICKER_BUTTON} ${
                item.key === activeFamily.key
                  ? 'bg-accent-soft text-accent'
                  : 'bg-surface text-muted hover:bg-raised hover:text-fg'
              }`}
            >
              <span className="shrink-0 text-fg">
                <item.icon size={item.iconSize} />
              </span>
              <span className="min-w-0 max-h-[2.2em] overflow-hidden text-center">{item.label}</span>
            </button>
          ))}
        </div>

        <span className="flex items-center font-mono text-[10px] tracking-[0.12em] text-faint uppercase">
          surface
        </span>
        <div
          role="group"
          aria-label="Agent surfaces"
          className={`${PICKER_GROUP} ${surfaceColumns}`}
        >
          {visibleSurfaces.map((item) => (
            <button
              key={item.key}
              aria-label={`Use in ${item.label}`}
              aria-pressed={item.key === surface}
              onClick={() => pick(item.key)}
              className={`${PICKER_BUTTON} ${
                item.key === surface
                  ? 'bg-accent-soft text-accent'
                  : 'bg-surface text-muted hover:bg-raised hover:text-fg'
              }`}
            >
              <span className="shrink-0 text-fg">
                <item.icon size={item.iconSize} />
              </span>
              <span className="min-w-0 max-h-[2.2em] overflow-hidden text-center">{item.label}</span>
            </button>
          ))}
        </div>
      </div>
      {/* Keyed so the reveal replays on every pick — the swap should read as
        * an answer arriving, not text quietly mutating in place. */}
      <div key={surface} aria-label="Setup instructions" className="reveal mt-4 border-t border-edge pt-4">
        <Card
          surface={surface}
          mcpUrl={`${origin}/mcp`}
          docsUrl={`${origin}/docs?download=true`}
        />
      </div>
      </div>
    </section>
  );
}
