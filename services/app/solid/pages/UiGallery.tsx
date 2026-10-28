/* @jsxImportSource solid-js */
/**
 * THE COMPONENT GALLERY (`/dev/ui`, development builds only): every solid/ui component at each size, variant
 * and state, in light or dark. solid/App.tsx registers the route behind `import.meta.env.DEV` and loads this
 * module lazily, so a production bundle contains neither; the server answers `/dev/ui` only in development
 * (lib/http/app-pages). The appearance is set on this page's <main>, not the document root, the way an editor sets
 * its own: every portalled panel (a listbox, a menu, a tooltip, a dialog) must follow it there.
 */
import { createSignal, For, Show, type JSX } from 'solid-js';
import Copy from 'lucide-solid/icons/copy';
import Pencil from 'lucide-solid/icons/pencil';
import Trash2 from 'lucide-solid/icons/trash-2';
import Bold from 'lucide-solid/icons/bold';
import Italic from 'lucide-solid/icons/italic';
import X from 'lucide-solid/icons/x';
import Globe from 'lucide-solid/icons/globe';
import Link2 from 'lucide-solid/icons/link-2';
import Lock from 'lucide-solid/icons/lock';
import FileUp from 'lucide-solid/icons/file-up';
import History from 'lucide-solid/icons/history';
import MessageSquare from 'lucide-solid/icons/message-square';
import SlidersHorizontal from 'lucide-solid/icons/sliders-horizontal';
import FolderPlus from 'lucide-solid/icons/folder-plus';
import { ColorField, SWATCHES, SwatchPicker } from '../ui/ColorField';
import { Combobox } from '../ui/Combobox';
import { Drawer } from '../ui/Drawer';
import { DropZone } from '../ui/DropZone';
import { FloatingPanel } from '../ui/FloatingPanel';
import { SelectableItem, SelectableList } from '../ui/SelectableList';
import { Slider } from '../ui/Slider';
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from '../ui/Table';
import { ToggleGroup } from '../ui/ToggleGroup';
import { Avatar } from '../ui/Avatar';
import { Button } from '../ui/Button';
import { Checkbox, Switch } from '../ui/Checkbox';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { CopyBlock } from '../ui/CopyBlock';
import { Dialog } from '../ui/Dialog';
import { Disclosure } from '../ui/Disclosure';
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
const VARIANTS = ['primary', 'secondary', 'danger', 'caution', 'ghost', 'link'] as const;
const PEOPLE = [{ id: 'u1', username: 'ada', name: 'Ada Lovelace' }, { id: 'u2', username: 'bob', name: 'Bob Kahn' }, { id: 'u3', username: 'grace', name: 'Grace Hopper' }];
const TOKENS = [{ name: 'ci deploy', status: 'active', used: '2 hours ago' }, { name: 'laptop', status: 'expired', used: '3 weeks ago' }];
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
  const apply = (mode: 'light' | 'dark') => setAppearance(mode);

  const [role, setRole] = createSignal('editor');
  const [query, setQuery] = createSignal('');
  const [checked, setChecked] = createSignal(true);
  const [on, setOn] = createSignal(false);
  const [tab, setTab] = createSignal('csv');
  const [dialog, setDialog] = createSignal<'sm' | 'md' | 'lg' | 'busy' | 'confirm' | 'xl' | 'alert' | null>(null);
  const [selected, setSelected] = createSignal('');
  const [pressed, setPressed] = createSignal<string[]>(['markup']);
  const [panelTab, setPanelTab] = createSignal('selection');
  const [visibility, setVisibility] = createSignal('unlisted');
  const [writes, setWrites] = createSignal('read');
  const [color, setColor] = createSignal(SWATCHES[2]!.value);
  const [brush, setBrush] = createSignal(SWATCHES[0]!.value);
  const [width, setWidth] = createSignal(4);
  const [tile, setTile] = createSignal('tile one');
  const [person, setPerson] = createSignal('');
  const [invited, setInvited] = createSignal<string[]>([]);
  const [version, setVersion] = createSignal(3);
  const [files, setFiles] = createSignal<string[]>([]);
  const [archived, setArchived] = createSignal(false);
  const [drawer, setDrawer] = createSignal(false);
  const [floating, setFloating] = createSignal(false);
  const [mixed, setMixed] = createSignal<boolean | 'mixed'>('mixed');
  const toggle = (format: string) => setPressed((all) => (all.includes(format) ? all.filter((f) => f !== format) : [...all, format]));
  const matches = () => PEOPLE.filter((p) => !invited().includes(p.username) && p.username.includes(person().replace(/^@/, '')));

  return <main data-app-appearance={appearance()} class="min-h-screen bg-bg px-4 py-10 text-fg sm:px-8">
    <div class="mx-auto grid max-w-5xl gap-8">
      <PageHeader title="Component gallery" description="Every solid/ui component at each size, variant and state."
        actions={<Tabs label="Appearance" variant="segmented" size="sm" value={appearance()} onChange={(mode) => apply(mode as 'light' | 'dark')} items={[{ value: 'light', label: 'light' }, { value: 'dark', label: 'dark' }]} />} />

      <Section title="Button">
        <For each={SIZES}>{(size) => <>
          <Row label={`${size}`}><For each={VARIANTS}>{(variant) => <Button variant={variant} size={size}>{variant}</Button>}</For></Row>
          <Row label={`${size} disabled`}><For each={VARIANTS}>{(variant) => <Button variant={variant} size={size} disabled>{variant}</Button>}</For></Row>
          <Row label={`${size} pressed`}>
            <For each={['markup', 'dataset', 'image']}>{(format) => <Button size={size} pressed={pressed().includes(format)} onClick={() => toggle(format)}>{format}</Button>}</For>
            <Button size={size} variant="caution" pressed>read &amp; write</Button>
          </Row>
          <Row label={`${size} link`}><Button href="#links" size={size}>Open artifact →</Button><Button href="#links" variant="secondary" size={size}>Upload another</Button><Button href="#links" variant="secondary" size={size} disabled>Unavailable link</Button></Row>
          <Row label={`${size} icon`}>
            <Tooltip content="copy"><Button variant="secondary" size={size} icon aria-label={`Copy ${size}`}><Copy size={size === 'md' ? 16 : 13} /></Button></Tooltip>
            <Button variant="ghost" size={size} icon aria-label={`Edit ${size}`}><Pencil size={size === 'md' ? 16 : 13} /></Button>
            <Button variant="danger" size={size} icon aria-label={`Delete ${size}`}><Trash2 size={size === 'md' ? 16 : 13} /></Button>
          </Row>
        </>}</For>
        <Row label="xs icon (toolbar)">
          <For each={[['Bold', Bold], ['Italic', Italic]] as const}>{([name, Icon]) => <Tooltip content={name}><Button size="xs" variant="ghost" icon aria-label={name} pressed={name === 'Bold'}><Icon size={13} /></Button></Tooltip>}</For>
          <Button size="xs" variant="ghost" icon aria-label="Close comments"><X size={13} /></Button>
          <Button size="xs" variant="secondary">xs text</Button>
        </Row>
        <Row label="bar (36px)"><Button size="bar" variant="ghost" icon aria-label="Notifications bar"><MessageSquare size={18} /></Button><Button size="bar" variant="secondary">bar text</Button></Row>
        <Row label="nav rows"><div class="grid w-56 gap-1">
          <Button variant="ghost" size="sm" href="#nav" current class="w-full justify-start"><FolderPlus size={14} />current page</Button>
          <Button variant="ghost" size="sm" href="#nav" current={false} class="w-full justify-start"><Pencil size={14} />another page</Button>
        </div></Row>
        <Row label="tile"><div class="grid w-72 grid-cols-2 gap-2"><For each={['tile one', 'tile two']}>{(name) => <Button shape="tile" pressed={tile() === name} aria-label={`Pick ${name}`} onClick={() => setTile(name)} class="w-full">
          <span class="grid aspect-[4/3] place-items-center bg-raised font-mono text-xs text-muted">{name}</span>
        </Button>}</For></div></Row>
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
          <Field label="Code surface" hint="surface=&quot;code&quot;: takes the ground and font it sits on."><div class="flex h-24 rounded-chip bg-raised font-mono text-xs"><Textarea surface="code" wrap="off" value={'<p>Edge-to-edge source</p>'} /></div></Field>
          <Field label="Add people" hint={invited().length ? `Invited: ${invited().map((u) => `@${u}`).join(', ')}` : 'Arrow keys walk the suggestions.'}>
            <Combobox value={person()} onValue={setPerson} options={matches()} optionKey={(p) => p.id} placeholder="@username"
              renderOption={(p) => <span>@{p.username} <span class="text-xs text-muted">{p.name}</span></span>}
              onSelect={(p) => { setInvited([...invited(), p.username]); setPerson(''); }} status={matches().length ? undefined : 'No people found.'} />
          </Field>
          <Field label="Theme color" hint="App title bar, where supported."><ColorField value={color()} onChange={setColor} /></Field>
        </div>
        <For each={SIZES}>{(size) => <Row label={`color ${size}`}><ColorField size={size} ariaLabel={`Text color ${size}`} value={color()} onChange={setColor} class="w-48" /></Row>}</For>
      </Section>

      <Section title="Toggles and tabs">
        <For each={SIZES}>{(size) => <Row label={size}>
          <Checkbox size={size} label="Likes and follows" checked={checked()} onChange={setChecked} />
          <Checkbox size={size} label="Disabled" checked={false} onChange={setChecked} disabled />
          <Checkbox size={size} label="Mixed" checked={mixed() === true} indeterminate={mixed() === 'mixed'} onChange={setMixed} />
          <Checkbox size={size} ariaLabel={`Unlabelled ${size}`} checked={checked()} onChange={setChecked} />
          <Switch size={size} label={`Switch ${size}`} checked={on()} onChange={setOn} />
          <Switch size={size} label={`Disabled switch ${size}`} checked onChange={setOn} disabled />
        </Row>}</For>
        <Checkbox label="Automatically accept invitations from people I follow." description="You can review invitations from everyone else before joining." checked={checked()} onChange={setChecked} />
        <For each={SIZES}>{(size) => <Row label={`disclosure ${size}`}><Disclosure size={size} open={size === 'md'} summary="DNS records" class="w-full">
          <p class={`mt-2 text-muted ${size === 'md' ? 'font-sans text-sm' : 'font-mono text-xs'}`}>Add these two records at your DNS host, then press verify.</p>
        </Disclosure></Row>}</For>
        <For each={SIZES}>{(size) => <>
          <Row label={`underline ${size}`}><Tabs label={`Source ${size}`} size={size} items={TABS} value={tab()} onChange={setTab} /></Row>
          <Row label={`segmented ${size}`}><Tabs label={`Segmented ${size}`} variant="segmented" size={size} items={TABS} value={tab()} onChange={setTab} /></Row>
          <Row label={`pill ${size}`}><Tabs label={`Panel tabs ${size}`} variant="pill" size={size} value={panelTab()} onChange={setPanelTab} items={[
            { value: 'selection', label: 'Selection', icon: () => <SlidersHorizontal size={13} />, badge: true },
            { value: 'history', label: 'History', icon: () => <History size={13} />, disabled: true, disabledReason: 'History is unavailable offline' },
            { value: 'comments', label: 'Comments', icon: () => <MessageSquare size={13} /> },
          ]} /></Row>
        </>}</For>
        <Row label="vertical icons"><Tabs label="Collapsed strip" variant="pill" size="sm" orientation="vertical" iconOnly value={panelTab()} onChange={setPanelTab} items={[
          { value: 'selection', label: 'Selection', icon: () => <SlidersHorizontal size={14} /> },
          { value: 'history', label: 'History', icon: () => <History size={14} /> },
          { value: 'comments', label: 'Comments', icon: () => <MessageSquare size={14} /> },
        ]} /></Row>
        <For each={SIZES}>{(size) => <Row label={`toggles ${size}`}>
          <ToggleGroup label={`Visibility ${size}`} size={size} value={visibility()} onChange={setVisibility} options={[
            { value: 'public', label: 'public', ariaLabel: `Make public ${size}`, icon: () => <Globe size={12} />, tooltip: 'Anyone can find it' },
            { value: 'unlisted', label: 'unlisted', ariaLabel: `Make unlisted ${size}`, icon: () => <Link2 size={12} />, tooltip: 'Anyone with the link' },
            { value: 'private', label: 'private', ariaLabel: `Make private ${size}`, icon: () => <Lock size={12} />, tooltip: 'Only people you add' },
          ]} />
          <ToggleGroup label={`Writes ${size}`} size={size} value={writes()} onChange={setWrites} options={[{ value: 'read', label: 'read-only' }, { value: 'readwrite', label: 'read & write', tone: 'caution' }]} />
        </Row>}</For>
        <Row label="swatches"><SwatchPicker label="Brush colors" options={SWATCHES} value={brush()} onChange={setBrush} custom size="sm" /></Row>
        <Row label="slider"><Slider label="Brush thickness" min={1} max={16} value={width()} onChange={setWidth} valueText={(v) => `${v} px`} class="w-72" /><Slider label="Chrome slider" size="sm" min={0} max={100} value={width() * 6} onChange={(v) => setWidth(Math.round(v / 6))} class="w-72" /></Row>
      </Section>

      <Section title="Menus and overlays">
        <Row label="menu">
          <Menu label="Gallery actions" align="start" items={[
            { label: 'Rename item', text: 'rename', icon: () => <Pencil size={12} />, onSelect: () => {} },
            { label: 'Archive item', text: 'archive (refused)', disabled: true, onSelect: () => {} },
            { label: 'Show archived', text: 'show archived', checked: archived(), onSelect: () => setArchived(!archived()) },
            { separator: true },
            { label: 'Delete item', text: 'delete', icon: () => <Trash2 size={12} />, danger: true, onSelect: () => setDialog('confirm') },
          ]} trigger={(attrs) => <Button {...attrs} variant="secondary" size="sm">Actions</Button>} />
          <span class="w-48"><Menu label="Create menu" align="start" width="trigger" items={[
            { label: 'Artifact', text: 'Artifact', items: [{ label: 'Doc', text: 'Doc', onSelect: () => {} }, { label: 'Deck', text: 'Deck', onSelect: () => {} }, { label: 'Dashboard', text: 'Dashboard', onSelect: () => {} }] },
            { label: 'Folder', text: 'Folder', icon: () => <FolderPlus size={12} />, onSelect: () => {} },
            { label: 'Program', text: 'Program', href: '#menus' },
            { section: 'assets', items: [{ label: 'File', text: 'File', href: '#menus' }, { label: 'Dataset', text: 'Dataset', href: '#menus' }] },
          ]} trigger={(attrs) => <Button {...attrs} class="w-full">Create</Button>} /></span>
          <RowMenu name="Quarterly review" items={[{ label: 'Restore Quarterly review', text: 'restore', icon: () => <Pencil size={12} />, onSelect: () => {} }]} />
          <Tooltip content="A tooltip sits above dialogs and menus"><Button variant="ghost" size="sm">Hover for a tooltip</Button></Tooltip>
        </Row>
        <Row label="dialog">
          <Button variant="secondary" onClick={() => setDialog('sm')}>Dialog sm</Button>
          <Button variant="secondary" onClick={() => setDialog('md')}>Dialog md</Button>
          <Button variant="secondary" onClick={() => setDialog('lg')}>Dialog lg</Button>
          <Button variant="secondary" onClick={() => setDialog('busy')}>Busy dialog</Button>
          <Button variant="secondary" onClick={() => setDialog('xl')}>Dialog xl (top, close)</Button>
          <Button variant="secondary" onClick={() => setDialog('alert')}>Alert dialog</Button>
          <Button variant="danger" onClick={() => setDialog('confirm')}>Confirm dialog</Button>
        </Row>
        <Row label="panels">
          <Button variant="secondary" onClick={() => setDrawer(true)}>Drawer</Button>
          <Button variant="secondary" onClick={() => setFloating(!floating())}>{floating() ? 'Hide' : 'Show'} floating panel</Button>
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
          <StatusMessage kind="caution" aria-label="Write access">Anyone with view access may run this dataset's writes.</StatusMessage>
          <StatusMessage kind="error" action={<Button variant="link">Retry</Button>}>Could not load groups.</StatusMessage>
        </div>
        <Row label="caution"><Badge tone="caution">read &amp; write</Badge></Row>
        <For each={['md', 'sm'] as const}>{(density) => <Panel padding="none"><Table label={`Connections ${density}`} density={density}>
          <TableHead><TableHeaderCell>name</TableHeaderCell><TableHeaderCell>status</TableHeaderCell><TableHeaderCell>last used</TableHeaderCell><TableHeaderCell align="right">actions</TableHeaderCell></TableHead>
          <TableBody>
            <For each={TOKENS}>{(token) => <TableRow aria-label={`Token row ${token.name}`}><TableCell class="font-mono">{token.name}</TableCell><TableCell><Badge tone={token.status === 'active' ? 'accent' : 'danger'}>{token.status}</Badge></TableCell><TableCell class="text-muted">{token.used}</TableCell><TableCell align="right"><Button size="sm" variant="danger">Revoke</Button></TableCell></TableRow>}</For>
            <TableRow interactive={false}><TableCell colSpan={4} align="center" class="text-muted">No more tokens.</TableCell></TableRow>
          </TableBody>
        </Table></Panel>}</For>
        <div class="grid gap-4 sm:grid-cols-2">
          <Panel padding="sm" title="Versions"><SelectableList label="Versions">
            <For each={[3, 2, 1]}>{(v) => <SelectableItem label={`Preview version ${v}`} title={`v${v}${v === 3 ? ' · current' : ''}`} meta={`@ada · ${v} days ago`} trailing={v === 2 ? 'title change' : undefined}
              selected={version() === v} onSelect={() => setVersion(v)}>{version() === v && v !== 3 ? <Button size="sm" variant="secondary">Restore v{v}</Button> : null}</SelectableItem>}</For>
          </SelectableList></Panel>
          <Panel padding="sm" title="Drop zone">
            <DropZone label="Choose a file" size="sm" title="Drop a file here, or click to choose one" hint="Images, pdf, video, audio and text" icon={() => <FileUp size={22} />} onFiles={(list) => setFiles(list.map((f) => f.name))} />
            <Show when={files().length}><p class="mt-2 text-xs text-muted">Chose {files().join(', ')}</p></Show>
          </Panel>
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
    <Show when={dialog() === 'xl'}>
      <Dialog size="xl" align="top" body="flush" title="Social preview" label="Social preview stage" closeLabel="Close social preview" description="A flush body scrolls between a fixed header and footer." onClose={() => setDialog(null)}
        footer={<><Button variant="secondary" onClick={() => setDialog(null)}>Cancel</Button><Button onClick={() => setDialog(null)}>Save</Button></>}>
        <div class="grid gap-3 border-y border-edge bg-raised p-6"><For each={Array.from({ length: 12 }, (_, i) => i + 1)}>{(i) => <p class="text-sm text-muted">Stage line {i}</p>}</For></div>
      </Dialog>
    </Show>
    <Show when={dialog() === 'alert'}>
      <Dialog role="alertdialog" dismissible={false} align="top" size="lg" title="Your text needs recovery" description="Escape and the backdrop do not close this; only an action does." onClose={() => setDialog(null)}
        footer={<><Button variant="secondary" onClick={() => setDialog(null)}>Copy uncommitted text</Button><Button variant="danger" onClick={() => setDialog(null)}>Discard and restore</Button></>}>
        <Textarea aria-label="Uncommitted text" readOnly rows={4} value="Some text that could not be applied." />
      </Dialog>
    </Show>
    <Show when={drawer()}>
      <Drawer label="Gallery menu" role="navigation" top={0} scrimLabel="Close panel" onClose={() => setDrawer(false)}>
        <SelectableList label="Pages"><SelectableItem label="Artifacts" href="#top" title="Artifacts" selected /><SelectableItem label="Schedules" href="#top" title="Schedules" meta="2 running" /></SelectableList>
      </Drawer>
    </Show>
    <Show when={floating()}>
      <FloatingPanel label="New comment" position={{ left: 24, top: 96 }} width={300} onClose={() => setFloating(false)} class="p-3">
        <Field label="Comment"><Textarea size="sm" rows={3} placeholder="Escape closes this card" /></Field>
      </FloatingPanel>
    </Show>
    <Show when={dialog() === 'confirm'}>
      <ConfirmDialog title="Delete Quarterly review?" description="It goes to the trash, and you can restore it any time." action="Delete" confirmLabel="Confirm delete" danger onCancel={() => setDialog(null)} onConfirm={() => setDialog(null)} />
    </Show>
  </main>;
}
