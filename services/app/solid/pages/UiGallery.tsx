/* @jsxImportSource solid-js */
/**
 * THE COMPONENT GALLERY (`/dev/ui`, development builds only): every solid/ui component at each size, variant
 * and state, in light or dark. solid/App.tsx registers the route behind `import.meta.env.DEV` and loads this
 * module lazily, so a production bundle contains neither.
 */
import { createSignal, For, onCleanup, Show, type JSX } from 'solid-js';
import Copy from 'lucide-solid/icons/copy';
import Pencil from 'lucide-solid/icons/pencil';
import Trash2 from 'lucide-solid/icons/trash-2';
import { Avatar } from '../ui/Avatar';
import { Button } from '../ui/Button';
import { Checkbox, Switch } from '../ui/Checkbox';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { CopyBlock } from '../ui/CopyBlock';
import { Dialog } from '../ui/Dialog';
import { Field, Input, SearchField, Textarea } from '../ui/Field';
import { Menu, RowMenu } from '../ui/Menu';
import { PageHeader, SectionHeading } from '../ui/PageHeader';
import { ListRow, Panel } from '../ui/Panel';
import { Select } from '../ui/Select';
import { StatusMessage } from '../ui/StatusMessage';
import { Tabs } from '../ui/Tabs';
import { Tooltip } from '../ui/Tooltip';
import { Badge, FormatBadge, MicroLabel } from '../ui/ui';

const SIZES = ['md', 'sm'] as const;
const VARIANTS = ['primary', 'secondary', 'danger', 'ghost', 'link'] as const;
const ROLES = [{ value: 'editor', label: 'Editor' }, { value: 'viewer', label: 'Viewer' }, { value: 'owner', label: 'Owner', hint: 'one per group' }];
const TABS = [{ value: 'csv', label: 'CSV' }, { value: 'sheet', label: 'Google Sheets' }, { value: 'json', label: 'JSON' }, { value: 'pg', label: 'PostgreSQL', disabled: true }];

function Section(props: { title: string; children: JSX.Element }): JSX.Element {
  return <Panel label={props.title} title={props.title}><div class="grid gap-5">{props.children}</div></Panel>;
}
function Row(props: { label: string; children: JSX.Element }): JSX.Element {
  return <div class="grid gap-2 sm:grid-cols-[7rem_minmax(0,1fr)] sm:items-center"><MicroLabel>{props.label}</MicroLabel><div class="flex min-w-0 flex-wrap items-center gap-3">{props.children}</div></div>;
}

export default function UiGallery(): JSX.Element {
  const [appearance, setAppearance] = createSignal<'light' | 'dark'>('light');
  const root = document.documentElement;
  const before = root.getAttribute('data-app-appearance');
  const apply = (mode: 'light' | 'dark') => { setAppearance(mode); root.setAttribute('data-app-appearance', mode); };
  apply('light');
  onCleanup(() => { if (before === null) root.removeAttribute('data-app-appearance'); else root.setAttribute('data-app-appearance', before); });

  const [role, setRole] = createSignal('editor');
  const [query, setQuery] = createSignal('');
  const [checked, setChecked] = createSignal(true);
  const [on, setOn] = createSignal(false);
  const [tab, setTab] = createSignal('csv');
  const [dialog, setDialog] = createSignal<'sm' | 'md' | 'lg' | 'busy' | 'confirm' | null>(null);
  const [selected, setSelected] = createSignal('');

  return <main data-app-appearance={appearance()} class="min-h-screen bg-bg px-4 py-10 text-fg sm:px-8">
    <div class="mx-auto grid max-w-5xl gap-8">
      <PageHeader title="Component gallery" description="Every solid/ui component at each size, variant and state."
        actions={<Tabs label="Appearance" variant="segmented" size="sm" value={appearance()} onChange={(mode) => apply(mode as 'light' | 'dark')} items={[{ value: 'light', label: 'light' }, { value: 'dark', label: 'dark' }]} />} />

      <Section title="Button">
        <For each={SIZES}>{(size) => <>
          <Row label={`${size}`}><For each={VARIANTS}>{(variant) => <Button variant={variant} size={size}>{variant}</Button>}</For></Row>
          <Row label={`${size} disabled`}><For each={VARIANTS}>{(variant) => <Button variant={variant} size={size} disabled>{variant}</Button>}</For></Row>
          <Row label={`${size} icon`}>
            <Tooltip content="copy"><Button variant="secondary" size={size} icon aria-label={`Copy ${size}`}><Copy size={size === 'md' ? 16 : 13} /></Button></Tooltip>
            <Button variant="ghost" size={size} icon aria-label={`Edit ${size}`}><Pencil size={size === 'md' ? 16 : 13} /></Button>
            <Button variant="danger" size={size} icon aria-label={`Delete ${size}`}><Trash2 size={size === 'md' ? 16 : 13} /></Button>
          </Row>
        </>}</For>
      </Section>

      <Section title="Fields">
        <For each={SIZES}>{(size) => <Row label={size}>
          <Input size={size} aria-label={`Input ${size}`} placeholder="Email address" class="max-w-56" />
          <Select size={size} class="w-40" ariaLabel={`Role ${size}`} value={role()} options={ROLES} onChange={setRole} />
          <SearchField size={size} class="w-56" label={`Search ${size}`} value={query()} onValue={setQuery} clearOnEscape />
          <Button size={size}>Invite</Button>
        </Row>}</For>
        <Row label="disabled">
          <Input aria-label="Disabled input" disabled value="read only" class="max-w-56" />
          <Select class="w-40" ariaLabel="Disabled select" value="viewer" options={ROLES} onChange={setRole} disabled />
          <SearchField class="w-56" label="Disabled search" value="" onValue={setQuery} disabled />
        </Row>
        <div class="grid gap-5 sm:grid-cols-2">
          <Field label="Email" hint="Invitations go to this address."><Input type="email" placeholder="you@example.com" /></Field>
          <Field label="New owner" error={selected() ? null : 'Choose a destination.'}><Select value={selected()} options={[{ value: 'personal', label: 'Personal' }, { value: 'team', label: 'Team' }]} placeholder="Choose a destination" onChange={setSelected} /></Field>
          <Field label="Notes" hint="Markdown is fine."><Textarea rows={3} placeholder="Why this change" /></Field>
          <Field label="Chrome notes"><Textarea size="sm" rows={3} placeholder="sm density" /></Field>
        </div>
      </Section>

      <Section title="Toggles and tabs">
        <For each={SIZES}>{(size) => <Row label={size}>
          <Checkbox size={size} label="Likes and follows" checked={checked()} onChange={setChecked} />
          <Checkbox size={size} label="Disabled" checked={false} onChange={setChecked} disabled />
          <Switch size={size} label={`Switch ${size}`} checked={on()} onChange={setOn} />
          <Switch size={size} label={`Disabled switch ${size}`} checked onChange={setOn} disabled />
        </Row>}</For>
        <Checkbox label="Automatically accept invitations from people I follow." description="You can review invitations from everyone else before joining." checked={checked()} onChange={setChecked} />
        <For each={SIZES}>{(size) => <>
          <Row label={`underline ${size}`}><Tabs label={`Source ${size}`} size={size} items={TABS} value={tab()} onChange={setTab} /></Row>
          <Row label={`segmented ${size}`}><Tabs label={`Segmented ${size}`} variant="segmented" size={size} items={TABS} value={tab()} onChange={setTab} /></Row>
        </>}</For>
      </Section>

      <Section title="Menus and overlays">
        <Row label="menu">
          <Menu label="Gallery actions" align="start" items={[
            { label: 'Rename item', text: 'rename', icon: () => <Pencil size={12} />, onSelect: () => {} },
            { label: 'Archive item', text: 'archive (refused)', disabled: true, onSelect: () => {} },
            { label: 'Delete item', text: 'delete', icon: () => <Trash2 size={12} />, danger: true, onSelect: () => setDialog('confirm') },
          ]} trigger={(attrs) => <Button {...attrs} variant="secondary" size="sm">Actions</Button>} />
          <RowMenu name="Quarterly review" items={[{ label: 'Restore Quarterly review', text: 'restore', icon: () => <Pencil size={12} />, onSelect: () => {} }]} />
          <Tooltip content="A tooltip sits above dialogs and menus"><Button variant="ghost" size="sm">Hover for a tooltip</Button></Tooltip>
        </Row>
        <Row label="dialog">
          <Button variant="secondary" onClick={() => setDialog('sm')}>Dialog sm</Button>
          <Button variant="secondary" onClick={() => setDialog('md')}>Dialog md</Button>
          <Button variant="secondary" onClick={() => setDialog('lg')}>Dialog lg</Button>
          <Button variant="secondary" onClick={() => setDialog('busy')}>Busy dialog</Button>
          <Button variant="danger" onClick={() => setDialog('confirm')}>Confirm dialog</Button>
        </Row>
      </Section>

      <Section title="Surfaces and text">
        <div class="grid gap-4 sm:grid-cols-3">
          <Panel padding="none"><p class="text-sm">padding none</p></Panel>
          <Panel padding="sm"><p class="text-sm">padding sm</p></Panel>
          <Panel title="Panel title" actions={<Badge tone="accent">2</Badge>}><ul><ListRow>First row</ListRow><ListRow>Second row</ListRow></ul></Panel>
        </div>
        <Row label="badges"><Badge>default</Badge><Badge tone="accent">accent</Badge><Badge tone="dim">dim</Badge><Badge tone="danger">danger</Badge><FormatBadge format="markup" /><FormatBadge format="dataset" /><MicroLabel>micro label</MicroLabel></Row>
        <SectionHeading>Section heading</SectionHeading>
        <div class="grid gap-3">
          <StatusMessage kind="loading">Loading group…</StatusMessage>
          <StatusMessage kind="empty">No people match your search.</StatusMessage>
          <StatusMessage kind="notice">Saved</StatusMessage>
          <StatusMessage kind="error" action={<Button variant="link">Retry</Button>}>Could not load groups.</StatusMessage>
        </div>
        <Row label="identity"><span class="size-8"><Avatar image={null} initial="A" userId="alice" size={32} /></span><CopyBlock class="min-w-0 flex-1" label="Copy command" text="npm run afbin -- publish page.html" /></Row>
      </Section>
    </div>

    <Show when={dialog() === 'sm' || dialog() === 'md' || dialog() === 'lg' || dialog() === 'busy'}>
      <Dialog size={dialog() === 'busy' ? 'sm' : (dialog() as 'sm' | 'md' | 'lg')} busy={dialog() === 'busy'} title={dialog() === 'busy' ? 'Saving…' : `Dialog ${dialog()}`}
        description="A Select inside a dialog opens above it." onClose={() => setDialog(null)}
        footer={<><Button variant="secondary" onClick={() => setDialog(null)}>Cancel</Button><Button disabled={dialog() === 'busy'} onClick={() => setDialog(null)}>Save</Button></>}>
        <Field label="Role"><Select value={role()} options={ROLES} onChange={setRole} /></Field>
      </Dialog>
    </Show>
    <Show when={dialog() === 'confirm'}>
      <ConfirmDialog title="Delete Quarterly review?" description="It goes to the trash, and you can restore it any time." action="Delete" confirmLabel="Confirm delete" danger onCancel={() => setDialog(null)} onConfirm={() => setDialog(null)} />
    </Show>
  </main>;
}
