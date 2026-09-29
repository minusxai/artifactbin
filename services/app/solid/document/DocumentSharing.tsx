/* @jsxImportSource solid-js */
import { onCleanup, onMount, type JSX } from 'solid-js';
import ShareLink from '../components/ShareLink';

/** Document chrome's narrow share door. The ACL editor lives in the shared Solid component. */
export function DocumentSharing(props: { id: string; title: string; owner: boolean; editable?: boolean; url?: string }): JSX.Element {
  let root!: HTMLSpanElement;
  onMount(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      const close = root.querySelector<HTMLButtonElement>('[aria-label="Close sharing"]');
      if (close) { event.preventDefault(); close.click(); }
    };
    window.addEventListener('keydown', escape);
    onCleanup(() => window.removeEventListener('keydown', escape));
  });
  const cleanUrl = () => {
    const target = new URL(props.url ?? `/a/${encodeURIComponent(props.id)}`, location.origin);
    return target.origin + target.pathname;
  };
  return <span ref={root}><ShareLink artifactId={props.id} title={props.title} format="markup" editable={props.owner || props.editable} url={cleanUrl()} /></span>;
}
