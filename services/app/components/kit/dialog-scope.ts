/**
 * The ARTIFACT scope of the kit's dialog (./dialog): inline documents may
 * cover their own content, but must leave the app's chrome usable. Its own
 * module because every inline story is drawn inside it (lib/story-runtime/
 * inline-composition) while the dialog itself loads only with the documents
 * that draw one.
 */
import { createContext, createElement, type ReactNode } from 'react';

export const ArtifactScope = createContext(false);

/** Inline documents may cover their content, but must leave app chrome usable. */
export function ArtifactDialogScope({ children }: { children: ReactNode }): ReactNode {
  return createElement(ArtifactScope.Provider, { value: true }, children);
}
