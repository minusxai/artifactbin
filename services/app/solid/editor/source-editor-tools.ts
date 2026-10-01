/**
 * Where code view gets its rich editor and its formatter.
 * On the site both are lazy chunks (the default below); an offline file would provide its own.
 * The rich editor chunk is solid/editor/SourceEditor plus lib/source-editor/codemirror, and the
 * latter imports no framework.
 */
import { createContext, useContext, type Component } from 'solid-js';
import type { SourceEditorProps } from './SourceEditor';

export interface SourceEditorTools {
  /** The rich (CodeMirror) editor module. */
  editor(): Promise<{ default: Component<SourceEditorProps> }>;
  /** The "View formatted" formatter module. */
  formatter(): Promise<{ formatJsxPreview(source: string): Promise<string> }>;
  /** Why "View formatted" cannot be used right now, or null when it can. */
  formatterUnavailable: string | null;
}

export const SITE_SOURCE_EDITOR_TOOLS: SourceEditorTools = {
  editor: () => import('./SourceEditor'),
  formatter: () => import('@/lib/workspace/format-jsx-preview'),
  formatterUnavailable: null,
};

const Tools = createContext<SourceEditorTools>(SITE_SOURCE_EDITOR_TOOLS);

export const SourceEditorToolsProvider = Tools.Provider;

export function useSourceEditorTools(): SourceEditorTools {
  return useContext(Tools);
}
