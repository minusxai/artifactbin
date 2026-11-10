/* @jsxImportSource solid-js */
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@solidjs/testing-library';
import { afterEach, expect, it, vi } from 'vitest';
import WorkspaceCreate from '../WorkspaceCreate';
import { openDocument, replaceDocument } from '@/solid/lib/document-navigation';

vi.mock('@/solid/lib/document-navigation', () => ({ openDocument: vi.fn(), replaceDocument: vi.fn() }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

function open() {
  render(() => <WorkspaceCreate parentId="folder1" onCreated={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: 'Create' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Template' }));
  // The submenu flyout is named by the item that opens it.
  return within(screen.getByRole('menu', { name: 'Template' }));
}
const created = () => { const [url, init] = vi.mocked(fetch).mock.calls[0]!; expect(url).toBe('/api/my/artifacts'); return JSON.parse(init!.body as string); };

it('creates a doc from the first item of the Create menu: unlisted, marked a doc, its body one rich region', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ id: 'doc123' }, { status: 201 })));
  render(() => <WorkspaceCreate parentId="folder1" onCreated={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: 'Create' }));
  const items = within(screen.getByRole('menu', { name: 'Create menu' })).getAllByRole('menuitem');
  expect(items[0]).toHaveAccessibleName('Document');
  fireEvent.click(items[0]!);
  await waitFor(() => expect(openDocument).toHaveBeenCalledWith('/a/doc123'));
  expect(replaceDocument).not.toHaveBeenCalled();
  const body = created();
  expect(body).toMatchObject({ visibility: 'unlisted', parent_id: 'folder1', template: 'doc' });
  expect(body.html).toContain('<title>Untitled document</title>');
  expect(body.html).toContain('data-af-editable="rich-native-v1"');
  expect(screen.queryByRole('menu', { name: 'Create menu' })).not.toBeInTheDocument();
});

it.each([
  ['Article', 'editorial'], ['Presentation', 'deck'],
  ['Dashboard', 'dashboard'], ['Plan', 'plan'], ['Landing page', 'landing'],
  ['Scrollytelling', 'scrolly'], ['App', 'app'],
])('creates %s from a template privately and preserves the current page in browser history', async (label) => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ id: 'new123' }, { status: 201 })));
  const item = open().getByRole('menuitem', { name: label });
  fireEvent.mouseEnter(item.parentElement!);
  expect(item).toBeInTheDocument();
  fireEvent.click(item);
  await waitFor(() => expect(openDocument).toHaveBeenCalledWith('/a/new123'));
  expect(replaceDocument).not.toHaveBeenCalled();
  const body = created();
  expect(body).toMatchObject({ visibility:'private',parent_id:'folder1' });
  expect(body.html).toContain('<!doctype html>');
  expect(body.html).toContain(`Untitled ${label.toLowerCase()}`);
  expect(body.html).not.toContain('data-af-editable');
  expect(body).not.toHaveProperty('markup');
  expect(body).not.toHaveProperty('template');
  expect(screen.queryByRole('menu', { name: 'Create menu' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Create' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Template' }));
  expect(screen.getByRole('menuitem', { name: label })).toBeEnabled();
});

it('reports a failed creation beside the button for retry without navigating', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'unavailable' }, { status: 503 })));
  render(() => <WorkspaceCreate onCreated={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: 'Create' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Document' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not create');
  expect(replaceDocument).not.toHaveBeenCalled();
  expect(openDocument).not.toHaveBeenCalled();
  // Choosing an item closes the menu; reopening it offers the same item again.
  fireEvent.click(screen.getByRole('button', { name: 'Create' }));
  expect(screen.getByRole('menuitem', { name: 'Document' })).toBeEnabled();
});

it('preserves group destination in folder creation and asset editor links', async () => {
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({id:'folder2'})));
 render(()=> <WorkspaceCreate groupId="g1" onCreated={()=>{}}/>);
 fireEvent.click(screen.getByRole('button',{name:'Create'}));
 expect(screen.getByRole('menuitem',{name:'File'})).toHaveAttribute('href','/files/new?group_id=g1');
 expect(screen.getByRole('menuitem',{name:'Dataset'})).toHaveAttribute('href','/datasets/new?group_id=g1');
 fireEvent.click(screen.getByRole('menuitem',{name:'Folder'}));
 fireEvent.input(screen.getByRole('textbox',{name:'Folder name'}),{target:{value:'Reports'}});
 fireEvent.click(screen.getByRole('button',{name:'create folder'}));
 await waitFor(()=>expect(fetch).toHaveBeenCalledWith('/api/my/artifacts',expect.objectContaining({body:JSON.stringify({format:'folder',title:'Reports',parent_id:null,destination:{type:'group',id:'g1'}})})));
});

it('names the folder dialog, keeps the form closed on Escape without a request, and reopens it empty', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ id: 'folder3' })));
  render(() => <WorkspaceCreate onCreated={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: 'Create' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Folder' }));
  const dialog = screen.getByRole('dialog', { name: 'Create new folder' });
  expect(within(dialog).getByRole('textbox', { name: 'Folder name' })).toHaveFocus();
  expect(within(dialog).getByRole('button', { name: 'create folder' })).toBeDisabled();
  fireEvent.keyDown(dialog, { key: 'Escape' });
  expect(screen.queryByRole('dialog', { name: 'Create new folder' })).not.toBeInTheDocument();
  expect(fetch).not.toHaveBeenCalled();
});

it('creates a folder from the dialog form and closes it, calling onCreated once', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ id: 'folder4' })));
  const onCreated = vi.fn();
  render(() => <WorkspaceCreate parentId="p1" onCreated={onCreated} />);
  fireEvent.click(screen.getByRole('button', { name: 'Create' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Folder' }));
  const dialog = screen.getByRole('dialog', { name: 'Create new folder' });
  fireEvent.input(within(dialog).getByRole('textbox', { name: 'Folder name' }), { target: { value: ' Plans ' } });
  fireEvent.submit(within(dialog).getByRole('textbox', { name: 'Folder name' }).closest('form')!);
  await waitFor(() => expect(onCreated).toHaveBeenCalledOnce());
  expect(JSON.parse(vi.mocked(fetch).mock.calls[0]![1]!.body as string)).toEqual({ format: 'folder', title: 'Plans', parent_id: 'p1' });
  expect(screen.queryByRole('dialog', { name: 'Create new folder' })).not.toBeInTheDocument();
});

it('shows a failed folder creation inside the dialog and keeps the name for another try', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'nope' }, { status: 500 })));
  render(() => <WorkspaceCreate onCreated={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: 'Create' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Folder' }));
  const dialog = screen.getByRole('dialog', { name: 'Create new folder' });
  fireEvent.input(within(dialog).getByRole('textbox', { name: 'Folder name' }), { target: { value: 'Plans' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'create folder' }));
  expect(await within(dialog).findByRole('alert')).toHaveTextContent('Could not create the folder');
  expect(within(dialog).getByRole('textbox', { name: 'Folder name' })).toHaveValue('Plans');
  expect(within(dialog).getByRole('button', { name: 'create folder' })).toBeEnabled();
});


it('offers retained artifact, folder and asset creation without retired programs', () => {
 render(() => <WorkspaceCreate onCreated={() => {}} />);
 fireEvent.click(screen.getByRole('button', {name:'Create'}));
 for (const name of ['Document', 'Template', 'Upload HTML', 'Folder', 'File', 'Dataset']) expect(screen.getByRole('menuitem', {name})).toBeInTheDocument();
 expect(screen.queryByRole('menuitem', {name:'Program'})).not.toBeInTheDocument();
});

it('opens HTML intake in the selected folder and group without creating until a file is published', () => {
 vi.stubGlobal('fetch', vi.fn());
 render(() => <WorkspaceCreate parentId="folder1" groupId="g1" onCreated={() => {}} />);
 fireEvent.click(screen.getByRole('button', {name:'Create'}));
 fireEvent.click(screen.getByRole('menuitem', {name:'Upload HTML'}));
 expect(screen.getByRole('dialog', {name:'Upload HTML'})).toBeInTheDocument();
 expect(screen.getByRole('button', {name:'Upload HTML'})).toBeDisabled();
 expect(fetch).not.toHaveBeenCalled();
});
it('offers one native Document entry',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({id:'trial123'},{status:201})));
 render(()=><WorkspaceCreate onCreated={()=>{}}/>);
 fireEvent.click(screen.getByRole('button',{name:'Create'}));
 expect(screen.queryByRole('menuitem',{name:'Document (Tiptap trial)'})).toBeNull();
 fireEvent.click(screen.getByRole('menuitem',{name:'Document'}));
 await waitFor(()=>expect(openDocument).toHaveBeenCalledWith('/a/trial123'));
 expect(created().html).toContain('data-af-editable="rich-native-v1"');
});
