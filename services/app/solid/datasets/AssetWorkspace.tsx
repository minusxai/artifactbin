/* @jsxImportSource solid-js */
import type { JSX } from 'solid-js';
import { Database, FileText } from 'lucide-solid';
import Share2 from 'lucide-solid/icons/share-2';
import Table2 from 'lucide-solid/icons/table-2';
import SlidersHorizontal from 'lucide-solid/icons/sliders-horizontal';
import { EditorViewTabs } from '../editor/EditorChrome';

export type AssetSection = 'asset' | 'source' | 'data' | 'actions' | 'sharing';
const sections = {
  asset: { label: 'Asset', Icon: FileText },
  source: { label: 'Source & models', Icon: Database },
  data: { label: 'Data preview', Icon: Table2 },
  actions: { label: 'Data actions', Icon: SlidersHorizontal },
  sharing: { label: 'Sharing', Icon: Share2 },
};

/** Asset and dataset pages share the artifact editor's tabs and workspace geometry. */
export function AssetWorkspace(props: {
  workspace: 'Asset' | 'Dataset';
  tabs: AssetSection[];
  active: AssetSection;
  onSelect: (section: AssetSection) => void;
  actions?: JSX.Element;
  children: JSX.Element;
}): JSX.Element {
  return <div class="min-w-0">
    <header aria-label={`${props.workspace} toolbar`} class="sticky top-11 z-30 flex min-h-11 flex-wrap items-center justify-between gap-x-2 border-b border-edge bg-surface px-2 sm:px-3">
      <EditorViewTabs label={`${props.workspace} workspace`} tabs={props.tabs.map(key => {
        const {label, Icon} = sections[key];
        return {key, label, aria: label, tip: label, icon: <Icon size={16} stroke-width={1.6} />, active: props.active === key, choose: () => props.onSelect(key)};
      })} />
      {props.actions}
    </header>
    <main class="workspace-page">{props.children}</main>
  </div>;
}
