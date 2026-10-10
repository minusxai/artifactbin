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
  fireEvent.click(screen.getByRole('menuitem', { name: 'Artifact' }));
  return within(screen.getByRole('menu', { name: 'Artifact types' }));
}

it.each([
  ['Blank document', 'doc'], ['Article', 'editorial'], ['Presentation', 'deck'],
  ['Dashboard', 'dashboard'], ['Plan', 'plan'], ['Landing page', 'landing'],
  ['Scrollytelling', 'scrolly'], ['App', 'app'],
])('creates %s privately and preserves the current page in browser history', async (label, template) => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ id: 'new123' }, { status: 201 })));
  fireEvent.click(open().getByRole('menuitem', { name: label }));
  await waitFor(() => expect(openDocument).toHaveBeenCalledWith(`/a/new123${template === 'doc' ? '/edit' : ''}`));
  expect(replaceDocument).not.toHaveBeenCalled();
  const [url, init] = vi.mocked(fetch).mock.calls[0];
  expect(url).toBe('/api/my/artifacts');
  expect(JSON.parse(init!.body as string)).toMatchObject({ template, visibility: 'private', parent_id: 'folder1' });
  if (template === 'doc') expect(JSON.parse(init!.body as string).markup).toContain('<Markdown id="body"');
  expect(screen.queryByRole('menu', { name: 'Create menu' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Create' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Artifact' }));
  expect(screen.getByRole('menuitem', { name: label })).toBeEnabled();
});

it('keeps a failed creation in the menu for retry without navigating', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'unavailable' }, { status: 503 })));
  fireEvent.click(open().getByRole('menuitem', { name: 'Blank document' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not create');
  expect(replaceDocument).not.toHaveBeenCalled();
  expect(openDocument).not.toHaveBeenCalled();
  expect(screen.getByRole('menuitem', { name: 'Blank document' })).toBeEnabled();
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
