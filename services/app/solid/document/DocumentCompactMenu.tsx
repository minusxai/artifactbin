/* @jsxImportSource solid-js */
import type { Accessor, JSX } from 'solid-js';
import Ellipsis from 'lucide-solid/icons/ellipsis';
import { REPO_URL } from '@/lib/http/urls';
import { artifactAppPath } from '@/lib/document-serving/artifact-pwa';
import { Menu, type MenuEntry } from '../ui/Menu';
import { Button } from '../ui/Button';
import type { DocumentChromeProps } from './DocumentChrome';
/** Compact-only menu data and positioning stay outside the wide reader's startup graph. */
export interface DocumentCompactMenuProps {
 page: DocumentChromeProps;
 like: Accessor<DocumentChromeProps['like']>;
 follow: Accessor<NonNullable<DocumentChromeProps['follow']> | null>;
 onLike: () => Promise<void>;
 onFollow: () => Promise<void>;
}
export function DocumentCompactMenu(input: DocumentCompactMenuProps): JSX.Element {
 const props=input.page, like=input.like, follow=input.follow;
 const username=()=>props.author?.username??null;
 const reading=()=>!props.archived;
 const toggleFollow=input.onFollow, toggleLike=input.onLike;
 const membershipLabel=()=>props.membership==='joined'?'Joined — view people':props.membership==='pending'?'Pending — view request':'Join artifact';
 const archivedBanner=(version:number,head:number)=>`Version ${version} of ${head} · read-only`;
  const compactItems = (): MenuEntry[] => {
    const items: MenuEntry[] = [];
    const handle = username();
    if (handle) {
      items.push({ label: `View @${handle}'s profile`, text: `@${handle}`, href: `/@${handle}` });
      const state = follow();
      if (state) items.push({ label: `${state.following ? 'Unfollow' : 'Follow'} @${handle}`, text: state.following ? 'Unfollow author' : 'Follow author', onSelect: () => void toggleFollow() });
    }
    if (reading()) {
      items.push({ label: like().liked ? 'Unlike' : 'Like', text: `${like().liked ? 'Unlike' : 'Like'}${like().count ? ` · ${like().count}` : ''}`, onSelect: () => void toggleLike() });
      if (props.canFork) items.push({ label: 'Fork artifact', text: 'Fork artifact', onSelect: props.onFork });
      if (props.install) items.push({ label: 'Install app', text: 'Install app', href: `${artifactAppPath(props.id)}?install=1` });
      if (props.owner) items.push({ label: 'Share', text: 'Share', onSelect: props.onShare });
      if (props.membership) items.push({ label: membershipLabel(), text: props.membership === 'joined' ? 'View people' : props.membership === 'pending' ? 'View pending request' : 'Join artifact', onSelect: props.onMembership });
    }
    if (props.archived) items.push({ label: archivedBanner(props.archived.version, props.archived.head), text: archivedBanner(props.archived.version, props.archived.head), disabled: true });
    items.push({ label: 'Star artifactbin on GitHub', text: 'Star artifactbin on GitHub', href: REPO_URL, target: '_blank' });
    return items;
  };
 return <Menu label="Artifact actions" items={compactItems()} trigger={attrs => <Button {...attrs} variant="ghost" size="bar" icon aria-label="More artifact actions"><Ellipsis size={20} stroke-width={1.5} /></Button>} />;
}
