/**
 * The browser editor's inline story tree. Published readers use the compiled
 * page; edit mode still mounts this composition with its CSS and dialog scope.
 *
 * The CSS assembly and the node isolation are part of the same contract
 * (lib/story/inline-css), so neither side can drift into a second way of
 * joining the stylesheets.
 *
 * No Solid port exists or is needed: the compiled-DOM path (components/IslandStory +
 * lib/story-runtime/edit/session.tsx) dissolved this composition's role into server-side CSS
 * assembly (lib/story/prepared-page.server) plus island adoption, rather than a tree render this
 * shape wraps. This file's only caller is EditorStoryRuntime (the live-interpreted editor tree)
 * and it is dead once that tree is retired.
 */
import type { ReactNode } from 'react';
import { ArtifactDialogScope } from '@/components/kit/dialog';
import { StoryRuntimeApp, type StoryRuntimeAppProps } from './StoryRuntimeApp';
import type { StoryIslandData } from './contract';

// The CSS assembly lives beside the CSS policy (lib/story/inline-css). The
// server applies it once per version (lib/story/prepared-page.server); the
// browser renders that result as it is and loads the policy only on demand
// (./inline-sheet), so this tree imports no CSS parser.

/**
 * What only a browser render wires in: the live store, the asset relay, edit
 * decorators, registry overrides and the first-commit signal. None of them may
 * change the FIRST render's markup — the store serves the island's snapshot to
 * a hydrating render, edit decorators arrive only after an owner asks — so the
 * server can render without them and still match.
 */
export type InlineStoryWiring = Omit<StoryRuntimeAppProps, keyof StoryIslandData>;

export function InlineStoryComposition({ data, css, wiring }: { data: StoryIslandData; css: string; wiring?: InlineStoryWiring }): ReactNode {
  return <><style>{css}</style><ArtifactDialogScope><StoryRuntimeApp {...data} {...wiring} /></ArtifactDialogScope></>;
}
