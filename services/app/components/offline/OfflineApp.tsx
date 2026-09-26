/**
 * THE OFFLINE FILE'S PAGE — what a downloaded `.html` mounts
 * (lib/offline/entry.tsx), read-only in this version.
 *
 * The same InlineStoryRuntime the app renders a document with, fed from the
 * file instead of the server:
 *  - rows come from the snapshot (lib/offline/snapshot-transport), so a filter
 *    the download precomputed still works and one it did not says so;
 *  - Values the download could not precompute are FROZEN: their controls are
 *    disabled with OFFLINE_FILTER_REASON;
 *  - every write is refused by name (OFFLINE_MUTATION_REASON), so no button
 *    waits on an access check nobody will answer;
 *  - what needs a server to draw at all — maps, managed frames — holds its
 *    space with a "Needs a connection" stand-in linking to the live document.
 *
 * Structured for the editing/comments/Save workstream to slot in: the top bar
 * is its own component with room for actions, and the runtime's controller is
 * already captured here.
 */
import { createContext, useCallback, useContext, useMemo, useRef, type ComponentType, type ReactNode } from 'react';
import { InlineStoryRuntime, type InlineStoryController } from '@/lib/story-runtime/InlineStoryRuntime';
import type { StoryIslandData } from '@/lib/story-runtime/contract';
import type { PreparedStoryRuntime } from '@/lib/story/prepared-runtime';
import type { StoryThemeName } from '@/lib/validation/atlas-schemas';
import { managedFrameLayout } from '@/lib/story/managed-frame-layout';
import { deckGlHeight } from '@/components/kit/deck-gl';
import { TrustedUi } from '@/components/TrustedUi';
import { OFFLINE_FILTER_REASON, OFFLINE_MUTATION_REASON, type ArtifactFile } from '@/lib/offline/file-format';
import { createSnapshotTransport } from '@/lib/offline/snapshot-transport';

/** Where "Open live version" goes, for the stand-ins drawn deep inside the document. */
const LiveUrl = createContext<string>('');

/** What a placeholder says in place of an embed that needs the server. */
export const NEEDS_CONNECTION = 'Needs a connection';

function NeedsConnection({ label, height, id, ast }: { label: string; height: number; id?: unknown; ast?: unknown }) {
  const liveUrl = useContext(LiveUrl);
  return (
    <div
      id={typeof id === 'string' ? id : undefined}
      data-mx-ast={typeof ast === 'string' ? ast : undefined}
      role="figure"
      aria-label={`${label}: ${NEEDS_CONNECTION.toLowerCase()}`}
      data-afbin-offline-placeholder=""
      style={{
        height, width: '100%', boxSizing: 'border-box', display: 'flex', alignItems: 'center', justifyContent: 'center',
        border: '1px dashed var(--border, rgba(128,128,128,0.4))', borderRadius: 8,
        background: 'color-mix(in srgb, var(--muted-foreground, gray) 6%, transparent)',
        color: 'var(--muted-foreground, graytext)', font: '500 13px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif',
      }}
    >
      <span>{NEEDS_CONNECTION} · <a href={liveUrl} rel="noreferrer" target="_blank" style={{ color: 'inherit', textDecoration: 'underline' }}>Open live version</a></span>
    </div>
  );
}

/*
 * Module-level and therefore STABLE: StoryRuntimeApp rebuilds its registry
 * when this object changes, and a rebuilt registry remounts every embed.
 */
const OFFLINE_COMPONENTS: Readonly<Record<string, ComponentType<Record<string, unknown>>>> = {
  DeckGL: (props) => (
    <NeedsConnection label={typeof props.title === 'string' && props.title ? props.title : 'Map'} height={deckGlHeight(props.height)} id={props.id} ast={props['data-mx-ast']} />
  ),
  Iframe: (props) => {
    const { label, pixels } = managedFrameLayout(props.title, props.height);
    return <NeedsConnection label={label} height={pixels} id={props.id} ast={props['data-mx-ast']} />;
  },
};

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const formatWhen = (iso: string) => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : dateFormat.format(date);
};

export function OfflineTopBar({ file, children }: { file: ArtifactFile; children?: ReactNode }) {
  return (
    <TrustedUi>
      <header aria-label="Offline copy" className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-edge bg-surface px-4 py-2 font-sans text-xs text-muted">
        <span>Offline copy of <strong className="font-medium text-fg">{file.metadata.title}</strong></span>
        <span aria-hidden="true">·</span>
        <span>data as of <time dateTime={file.snapshot.at}>{formatWhen(file.snapshot.at)}</time></span>
        <span aria-hidden="true">·</span>
        <a href={file.liveUrl} rel="noreferrer" className="text-fg underline underline-offset-2">Open live version</a>
        {children ? <span className="ml-auto flex items-center gap-2">{children}</span> : null}
      </header>
    </TrustedUi>
  );
}

const DOCUMENT_GROUND = { light: '#ffffff', dark: '#0b0b0c' } as const;

export function OfflineApp({ file }: { file: ArtifactFile }) {
  const controller = useRef<InlineStoryController | null>(null);
  /*
   * The store starts from the SNAPSHOT's state, whatever the island carried:
   * the transport answers "unchanged" by comparing with those same base
   * values, so both sides must agree on what the base is.
   */
  const data = useMemo<StoryIslandData>(() => {
    const flow = file.island.dataflow?.flow;
    return flow ? { ...file.island, dataflow: { flow, state: file.snapshot.state } } : file.island;
  }, [file]);
  const prepared = useMemo<PreparedStoryRuntime>(() => ({
    data, baseCss: file.css.base, compiledCss: file.css.compiled, authorCss: file.css.author, authorScript: null,
    theme: file.metadata.theme as StoryThemeName | null, title: file.metadata.title,
  }), [data, file]);
  const transportFactory = useCallback(() => {
    const transport = createSnapshotTransport(data.dataflow?.flow ?? { values: [], queries: [] }, file.snapshot);
    return Object.assign(transport, { dispose() {} });
  }, [data, file]);
  const frozenValues = useMemo(() => Object.fromEntries(file.snapshot.frozen.map((name) => [name, OFFLINE_FILTER_REASON])), [file]);
  const onController = useCallback((next: InlineStoryController | null) => { controller.current = next; }, []);
  return (
    <LiveUrl.Provider value={file.liveUrl}>
      <OfflineTopBar file={file} />
      <main aria-label={file.metadata.title} style={{ background: DOCUMENT_GROUND[data.colorMode === 'dark' ? 'dark' : 'light'], minHeight: '100vh' }}>
        <InlineStoryRuntime
          data={data}
          prepared={prepared}
          transportFactory={transportFactory}
          writesUnavailable={OFFLINE_MUTATION_REASON}
          frozenValues={frozenValues}
          components={OFFLINE_COMPONENTS}
          onController={onController}
        />
      </main>
    </LiveUrl.Provider>
  );
}

/** What the file shows when it cannot be read (ArtifactFileError's reader-facing message). */
export function OfflineFileError({ message }: { message: string }) {
  return (
    <p role="alert" style={{ font: '14px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif', padding: '48px 16px', textAlign: 'center', margin: 0 }}>
      {message}
    </p>
  );
}
