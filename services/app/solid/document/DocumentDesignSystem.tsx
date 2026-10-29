/* @jsxImportSource solid-js */
/**
 * THE OWNER'S DESIGN-SYSTEM CONTROL for an HTML page (D4), in the bar's controls panel: the 13 systems the platform
 * stylesheet carries. Picking switches the open frame at once (the parent posts `mx:design-system`; the core flips
 * <html data-af-design-system>) and saves the choice as page metadata (`theme`, no new version). Other open readers
 * see it when they next load the page.
 */
import { createSignal, Show, type JSX } from 'solid-js';
import ThemePicker from '../editor/ThemePicker';
import { writeBrowserArtifact } from '@/lib/artifact-backend/browser-artifact-write';
import type { StoryDesignName } from '@/lib/validation';
import { HTML_SYSTEM_MODES } from '@/lib/validation/html-system-modes';

/** The mode a system opens in: the viewer's own pick still wins (the page decides). */
const modeOf = (name: string | null): 'light' | 'dark' => (name && HTML_SYSTEM_MODES[name]) || 'light';

/** What the reader page lends the control: the page's current system, the frame transport and the viewer's own mode pick. */
export interface DesignSystemHost { value: string | null; colorMode: 'light' | 'dark'; send: (command: unknown) => void; pick: () => 'light' | 'dark' | null }

export function DocumentDesignSystem(props: { id: string; host: DesignSystemHost }): JSX.Element {
  // A page with no system has no platform stylesheet linked yet (lib/html-runtime assembleHtmlPage): it reloads once saved.
  const styled = !!props.host.value;
  const [value, setValue] = createSignal<string | null>(props.host.value);
  const [problem, setProblem] = createSignal<string | null>(null);
  const apply = (name: string | null) => { if (name && styled) props.host.send({ type: 'mx:design-system', name, mode: props.host.pick() ?? modeOf(name) }); };
  const pick = async (name: StoryDesignName | null) => {
    const before = value();
    setProblem(null); setValue(name); apply(name);
    const response = await writeBrowserArtifact(props.id, { theme: name }).catch(() => null);
    if (response?.ok) { if (!styled || !name) window.location.reload(); return; }
    setValue(before); apply(before);
    setProblem(response?.status === 409 ? 'The page changed; reload and try again.' : 'Could not save the design system.');
  };
  return <div class="space-y-1">
    <ThemePicker value={value() as StoryDesignName | null} colorMode={props.host.colorMode} onPick={(name) => void pick(name)} />
    <Show when={problem()}><p role="alert" class="font-sans text-xs text-danger">{problem()}</p></Show>
  </div>;
}
