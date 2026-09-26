/**
 * WHERE CODE VIEW GETS ITS RICH EDITOR AND ITS FORMATTER.
 *
 * On the site both are ordinary lazy chunks of this app (the default below).
 * A downloaded offline file does not carry them: it loads them on demand from
 * the site it came from (lib/offline/extras) and provides its own tools, whose
 * reasons say what a reader without a connection gets instead — the plain
 * editor (LazySourceEditor) and a disabled "View formatted" (SourceEditorPane).
 */
import { createContext, useContext, type ComponentType } from 'react';
import type { SourceEditorProps } from './SourceEditor';

export interface SourceEditorTools {
  /** The rich (CodeMirror) editor module. A rejection keeps the plain editor. */
  editor(): Promise<{ default: ComponentType<SourceEditorProps> }>;
  /** The "View formatted" formatter module. */
  formatter(): Promise<{ formatJsxPreview(source: string): Promise<string> }>;
  /** Shown in place of the rich editor when `editor()` failed; null says the generic "Rich editor unavailable." */
  editorFailure: string | null;
  /** Why "View formatted" cannot be used right now, or null when it can. */
  formatterUnavailable: string | null;
}

export const SITE_SOURCE_EDITOR_TOOLS: SourceEditorTools = {
  editor: () => import('@/components/SourceEditor'),
  // Neither readers nor ordinary source editing download the formatter.
  formatter: () => import('@/lib/format-jsx-preview'),
  editorFailure: null,
  formatterUnavailable: null,
};

const Tools = createContext<SourceEditorTools>(SITE_SOURCE_EDITOR_TOOLS);

export const SourceEditorToolsProvider = Tools.Provider;

export function useSourceEditorTools(): SourceEditorTools {
  return useContext(Tools);
}
