/* @jsxImportSource solid-js */
import type { JSX } from 'solid-js';
import ShareLink from '../components/ShareLink';

/** Document chrome's narrow share door. The ACL editor lives in the shared Solid component. */
export function DocumentSharing(props: { id: string; title: string; owner: boolean; editable?: boolean; url?: string }): JSX.Element {
  const cleanUrl = () => {
    const target = new URL(props.url ?? `/a/${encodeURIComponent(props.id)}`, location.origin);
    return target.origin + target.pathname;
  };
  return <ShareLink artifactId={props.id} title={props.title} format="markup" editable={props.owner || props.editable} url={cleanUrl()} />;
}
