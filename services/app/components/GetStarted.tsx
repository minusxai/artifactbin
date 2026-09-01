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
import { BookOpen, Bot, Cable, ChevronDown, Zap } from 'lucide-react';
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
import { Badge } from '@/components/ui';
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
const HTTP_OPTION_NOTE = 'skills + tools over HTTP; works with any agent';
/** What installing buys, as three marks rather than a sentence. The first two
 * are what lands on disk; the third is why it is worth landing. */
const INSTALL_BENEFITS = [
  { icon: BookOpen, label: 'installed skills' },
  { icon: Cable, label: 'mcp tools' },
  { icon: Zap, label: '1.5\u00d7 token efficient' },
] as const;
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

function OrDivider() {
  return (
    <div aria-hidden className="my-3 flex items-center gap-3">
      <span className="h-px flex-1 bg-edge" />
      <span className="font-mono text-[11px] tracking-[0.14em] text-faint uppercase">or</span>
      <span className="h-px flex-1 bg-edge" />
    </div>
  );
}

/** An install guide's own masthead. No option badge: the two paths are
 * numbered once, by the outer structure, and a guide that renumbered itself
 * used to say "option 2" inside something already labelled option 2. */
function GuideHeader({ title, note }: { title: string; note: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <span className="font-mono text-[11px] tracking-[0.14em] text-fg uppercase">{title}</span>
      <span className="font-mono text-[11px] text-muted">{note}</span>
    </div>
  );
}

function PluginGuideHeader() {
  return <GuideHeader title="Install plugin" note="skills + tools together; install once" />;
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
      <PluginGuideHeader />
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
        <PluginListStep n={3} ariaLabel="artifactbin → Install" label="artifactbin → Install" />
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
      <PluginGuideHeader />
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
          ariaLabel="Open the marketplace → artifactbin → Install"
          label="Open the marketplace → artifactbin → Install"
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
      <PluginGuideHeader />
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
      <GuideHeader
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

/**
 * What INSTALLING looks like on the chosen surface — and only that. The
 * no-installation path used to live inside every branch of this switch, which
 * meant nine copies of one decision and a card that answered a question the
 * reader had already been asked above it.
 */
function InstallCard({ surface, mcpUrl, docsUrl }: { surface: SurfaceKey; mcpUrl: string; docsUrl: string }) {
  switch (surface) {
    case 'claude-code':
      return (
        <>
          <GuideHeader
            title="Install plugin"
            note="ships MCP tools + skills out of the box; no HTTP wrangling"
          />
          <CopyBlock
            text={PLUGIN_INSTALL}
            label="Copy the plugin install commands"
            trailer='# then just ask: "make me a 5-slide deck about healthy living on artifactbin"'
          />
        </>
      );
    case 'claude-code-app':
      return <ClaudePluginInstallGuide surface="app" />;
    case 'codex':
      return <CodexCliPluginGuide />;
    case 'codex-app':
      return <CodexAppPluginGuide />;
    case 'chatgpt':
      // The one surface with nothing to install. Saying so is the answer;
      // re-showing the no-installation path would pretend it is a choice.
      return (
        <>
          <GuideHeader title="nothing to install" note="chatgpt.com takes no plugin or skills" />
          <p className={FOOT}>
            Use the no-installation path above — paste the instruction into the chat and it will
            read the docs and publish.
          </p>
        </>
      );
    case 'claude-ai':
      return <ClaudePluginInstallGuide surface="web" />;
    case 'pi':
      return (
        <SkillsInstallGuide
          agent="Pi"
          docsUrl={docsUrl}
          installRoot="~/.pi/agent"
          installedPath="~/.pi/agent/skills/artifactbin"
        />
      );
    case 'opencode':
      return (
        <SkillsInstallGuide
          agent="OpenCode"
          docsUrl={docsUrl}
          installRoot="~/.config/opencode"
          installedPath="~/.config/opencode/skills/artifactbin"
        />
      );
    case 'other':
      return (
        <>
          <GuideHeader title="connect the MCP server" note="for any MCP-compatible agent" />
          <CopyBlock text={mcpUrl} label="Copy the connector URL" />
          <p className={FOOT}>paste it into your agent’s MCP settings, then approve the connection</p>
        </>
      );
  }
}

export default function GetStarted({
  heading = true,
  frame = true,
  reveal = false,
}: {
  heading?: boolean;
  /** false = no panel chrome, for hosts that already draw a card around it. */
  frame?: boolean;
  /** Show the agent instruction rather than only copying it (AgentLink). */
  reveal?: boolean;
}) {
  const [surface, setSurface] = useState<SurfaceKey>('claude-code');
  const [installOpen, setInstallOpen] = useState(false);
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
      <div className={frame ? 'rounded-[6px] border border-edge bg-surface px-4 py-3.5' : undefined}>
        {/* The panel names itself. It used to open with a terminal prompt —
          * `$ choose your agent ...` — which described the widget below it
          * rather than saying what this block IS. */}
        {heading && (
          <p className="mb-2.5 font-mono text-[11px] tracking-[0.14em] text-fg uppercase text-muted">
            Getting started
          </p>
        )}

        {/* PATH ONE. Trying it must cost less than installing it, so the
          * no-setup document leads and needs no choice made first. */}
        <OptionHeader n={1} title="no installation" note={HTTP_OPTION_NOTE} />
        <AgentLink frame={false} docsLink={false} reveal={reveal} />

        <OrDivider />

        {/* PATH TWO, FOLDED. The nine-surface picker used to be the first
          * thing on the page: a form to fill in before the reader knew what
          * they were choosing between, and irrelevant to everyone taking path
          * one. It opens when someone asks for it. */}
        <button
          aria-label="Install for my agent"
          aria-expanded={installOpen}
          onClick={() => setInstallOpen((open) => !open)}
          // A DOOR, NOT A CAPTION. Option 1 is a solid button and option 2
          // was bare text on the panel's own ground: offered as equal choices,
          // drawn as a button beside a footnote. It gets its own raised
          // ground, and the border arrives on hover so it is a target without
          // being a box inside a box.
          className="group/inst w-full cursor-pointer rounded-[5px] border border-transparent bg-raised px-3 py-2 text-left transition-colors hover:border-accent/40 hover:bg-comment"
        >
          <span className="flex w-full flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
            <span className="flex items-center gap-2.5">
              <Badge tone="accent">option 2</Badge>
              <span className="font-mono text-[11px] tracking-[0.14em] text-fg uppercase">
                install for your agent
              </span>
            </span>
            <span className="flex min-w-0 flex-1 items-center justify-end gap-3">
              <span
                aria-hidden
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-accent/40 bg-accent-soft text-accent transition-colors group-hover/inst:border-accent group-hover/inst:bg-accent group-hover/inst:text-bg"
              >
                <ChevronDown
                  size={15}
                  className={`transition-transform duration-200 ${installOpen ? 'rotate-180' : ''}`}
                />
              </span>
            </span>
          </span>

          <span className="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            {/* WHICH agents, in their own marks — the row promises a per-agent
              * setup and this is the shortest way to show it is kept. Held
              * BACK at rest: eight brand marks at full saturation are a scatter
              * of unrelated colours, and the row's job at rest is to be one
              * thing. They come up together when the row is engaged. */}
            <span
              aria-hidden
              className="flex items-center gap-3 text-fg opacity-55 transition-opacity duration-200 group-hover/inst:opacity-100"
            >
              {AGENT_MARKS.map((mark) => (
                <mark.icon key={mark.key} size={mark.iconSize - 3} />
              ))}
            </span>
            {/* Three facts, so three objects. Separated only by whitespace
              * they scanned as one run-on phrase. */}
            <span className="flex flex-wrap items-center gap-1.5">
              {INSTALL_BENEFITS.map((benefit, index) => (
                <span
                  key={benefit.label}
                  className={`items-center gap-1.5 rounded-[3px] border border-edge px-1.5 py-1 font-mono text-[10px] whitespace-nowrap text-muted ${
                    // The last one is the reason; the other two are the parts.
                    // A phone keeps the reason and drops the inventory.
                    index === INSTALL_BENEFITS.length - 1 ? 'inline-flex' : 'hidden sm:inline-flex'
                  }`}
                >
                  <benefit.icon size={11} className="shrink-0 text-accent" />
                  {benefit.label}
                </span>
              ))}
            </span>
          </span>
        </button>

        {installOpen && (
          <div className="reveal mt-2.5">
            <div className="grid grid-cols-[3.75rem_minmax(0,1fr)] items-stretch gap-x-2 gap-y-1.5">
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
                    <span className="min-w-0 max-h-[2.2em] overflow-hidden text-center">
                      {item.label}
                    </span>
                  </button>
                ))}
              </div>

              <span className="flex items-center font-mono text-[10px] tracking-[0.12em] text-faint uppercase">
                surface
              </span>
              <div role="group" aria-label="Agent surfaces" className={`${PICKER_GROUP} ${surfaceColumns}`}>
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
                    <span className="min-w-0 max-h-[2.2em] overflow-hidden text-center">
                      {item.label}
                    </span>
                  </button>
                ))}
              </div>
            </div>
            {/* Keyed so the reveal replays on every pick — the swap should read
              * as an answer arriving, not text quietly mutating in place. */}
            <div
              key={surface}
              aria-label="Setup instructions"
              className="reveal mt-3 border-t border-edge pt-3"
            >
              <InstallCard
                surface={surface}
                mcpUrl={`${origin}/mcp`}
                docsUrl={`${origin}/docs?download=true`}
              />
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
