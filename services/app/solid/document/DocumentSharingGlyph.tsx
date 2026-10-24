/* @jsxImportSource solid-js */
import type {JSX} from 'solid-js';
import type {Visibility} from '@artifactbin/contracts';
import {sharingIconFor,VISIBILITY_ICON_NODES} from '@/lib/workspace/visibility-icons';
/** Owner-only presentation never belongs to the anonymous reader startup graph. */
export interface DocumentSharingGlyphProps {visibility:Visibility;invited:boolean}
export function DocumentSharingGlyph(props: DocumentSharingGlyphProps): JSX.Element {
  const nodes = () => VISIBILITY_ICON_NODES[sharingIconFor({ visibility: props.visibility, hasInvitedUsers: props.invited })];
  return <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
    innerHTML={nodes().map(([tag, attrs]) => `<${tag} ${Object.entries(attrs).filter(([name]) => name !== 'key').map(([name, value]) => `${name}="${value}"`).join(' ')}/>`).join('')} />;
}

