/* @jsxImportSource solid-js */
import '@testing-library/jest-dom/vitest';
/**
 * The dataset editor's EXPOSURE seam: which schemas and tables the document
 * publishes, and the save itself — including the artifact controls the editor
 * shares with every other format.
 */
import { cleanup, fireEvent, screen, waitFor, within } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { change, click, editor, installDatasetFetch, pick, savedDefinition, state } from '@/solid/test/dataset-catalog';

vi.mock('@/solid/lib/session', () => ({ useSession: () => ({ session: () => state.viewerSession }) }));
beforeEach(installDatasetFetch);
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('dataset editor — exposure and saving', () => {
  it('keeps an existing dataset default schema immutable', async () => {
    editor(true); await screen.findByDisplayValue('Orders'); expect(screen.getByLabelText('Default schema')).toBeDisabled();
  });

  it('preserves edited title after a version conflict', async () => {
    editor(true); await screen.findByDisplayValue('Orders'); change('Dataset title','New title'); state.failSave=true; click('Save dataset');
    await waitFor(() => expect(screen.getByLabelText('Dataset error')).toHaveTextContent('Version conflict')); expect(screen.getByLabelText('Dataset title')).toHaveValue('New title');
    expect(state.calls.find(c => c.method === 'PATCH')?.body.expectedState).toBe('state-7');
  });

  it('adds stored JSON rows in a named table', async () => {
    editor(); change('Dataset title', 'Orders'); click('JSON'); click('Add JSON table'); change('Stored schema 1','main'); change('Stored table name 1','rows'); change('Stored rows 1','[{"id":1}]'); pick('Default schema','main'); click('Save dataset');
    await waitFor(() => expect(savedDefinition()).toMatchObject({kind:'stored',defaultSchema:'main',tables:[{schema:'main',name:'rows',rows:[{id:1}]}]}));
  });

  it.each(['', '   '])('requires a dataset title instead of saving %j', async title => {
    editor(); change('Dataset title', 'Orders'); click('JSON'); click('Add JSON table');
    change('Stored table name 1', 'orders'); change('Stored rows 1', '[{"id":1}]');
    change('Dataset title', title);
    expect(screen.getByLabelText('Dataset title')).toBeRequired();
    expect(screen.getByLabelText('Save dataset')).toBeDisabled();
    click('Save dataset');
    expect(state.calls.some(c => c.url === '/api/my/artifacts' && c.method === 'POST')).toBe(false);
    change('Dataset title', 'Quarterly sales');
    expect(screen.getByLabelText('Save dataset')).toBeEnabled(); click('Save dataset');
    await waitFor(() => expect(state.calls.find(c => c.url === '/api/my/artifacts' && c.method === 'POST')?.body.title).toBe('Quarterly sales'));
  });

  it('opens stored dataset editing on source controls within the workspace layout', async () => {
    state.loadedCatalog = {kind:'stored',defaultSchema:'public',refreshSeconds:0,tables:[{schema:'public',name:'rows',columns:[{name:'id',type:'number'}],objectKey:'private/object'}]};
    editor(true);
    await waitFor(() => expect(screen.getByLabelText('Dataset title')).toHaveValue('Orders'));
    expect(screen.getByLabelText('Dataset title')).toBeVisible();
    expect(screen.getByRole('tab', {name:'Source & models'})).toHaveAttribute('aria-selected', 'true');
    expect(within(screen.getByRole('tablist', {name:'Dataset workspace'})).getAllByRole('tab').map(button => button.textContent)).toEqual(['Source & models', 'Data preview', 'Data actions', 'Sharing']);
    expect(screen.getByRole('navigation', {name:'Workspace'})).toBeInTheDocument();
    expect(screen.getByLabelText('Access policies')).not.toBeVisible();
    change('Dataset title', 'Unsaved title');
    fireEvent.click(screen.getByRole('tab', {name:'Sharing'}));
    fireEvent.click(await screen.findByRole('link', {name:'Manage access policies'}));
    expect(screen.getByRole('tab', {name:'Data actions'})).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByLabelText('Dataset title')).toHaveValue('Unsaved title');
  });

  it('saves from the toolbar after previewing changes and offers cancel without saving', async () => {
    editor(true);
    await screen.findByDisplayValue('Orders');
    change('Dataset title', 'Renamed orders');
    fireEvent.click(screen.getByRole('tab', {name: 'Data preview'}));
    const toolbar = screen.getByRole('banner', {name: 'Dataset toolbar'});
    expect(within(toolbar).getByRole('link', {name: 'Cancel editing'})).toHaveAttribute('href', '/a/data-1');
    expect(screen.getAllByLabelText('Save dataset')).toHaveLength(1);
    fireEvent.click(within(toolbar).getByRole('button', {name: 'Save dataset'}));
    await waitFor(() => expect(state.calls.find(c => c.url === '/api/my/artifacts/data-1' && c.method === 'PATCH')?.body.title).toBe('Renamed orders'));
  });

  it('saves a JSON dataset without a chosen default schema, taking the first table’s', async () => {
    editor(); change('Dataset title', 'Orders'); click('JSON'); click('Add JSON table'); change('Stored schema 1','main'); change('Stored table name 1','rows'); change('Stored rows 1','[{"id":1}]'); click('Save dataset');
    await waitFor(() => expect(savedDefinition()).toMatchObject({kind:'stored',defaultSchema:'main',tables:[{schema:'main',name:'rows',rows:[{id:1}]}]}));
  });

  it('lists the JSON tables a reader will get, since there is nothing to whitelist', async () => {
    editor(); change('Dataset title', 'Orders');
    expect(screen.getByLabelText('Exposed tables')).toHaveTextContent(/name a table in step 1/i);
    click('JSON'); click('Add JSON table'); change('Stored schema 1','main'); change('Stored table name 1','rows');
    expect(screen.getByLabelText('Exposed tables')).toHaveTextContent('main.rows');
    expect(screen.getByLabelText('Exposed tables')).toHaveTextContent('all columns');
    expect(screen.queryByLabelText('Source exposure')).not.toBeInTheDocument();
  });

  it('retains stored object data when another table is added without restating its rows', async () => {
    state.loadedCatalog={kind:'stored',defaultSchema:'public',refreshSeconds:0,tables:[{schema:'public',name:'rows',columns:[{name:'id',type:'number'}],objectKey:'private/object'}]};
    editor(true); await waitFor(() => expect(screen.getByLabelText('Dataset title')).toHaveValue('Orders'));
    click('Add JSON table'); change('Stored table name 2','extra'); change('Stored rows 2','[{"id":2}]'); click('Save dataset');
    await waitFor(() => expect(savedDefinition()?.tables).toEqual([{schema:'public',name:'rows',columns:[{name:'id',type:'number'}]},{schema:'public',name:'extra',rows:[{id:2}]}]));
  });

  it('embeds artifact sharing in its own tab without a toolbar share button or dialog', async () => {
    editor(true);
    await screen.findByDisplayValue('Orders');
    expect(screen.queryByLabelText('Open artifact controls')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', {name:'Share'})).toBeNull();
    fireEvent.click(screen.getByRole('tab', {name:'Sharing'}));
    expect(await screen.findByRole('region', {name:'Sharing'})).toBeVisible();
    expect(screen.queryByRole('dialog', {name:'Sharing'})).toBeNull();
    expect(screen.queryByRole('button', {name:'Save dataset'})).toBeNull();
    expect(await screen.findByLabelText('Make private')).toBeVisible();
    expect(screen.getByLabelText('Invite email')).toBeInTheDocument();
  });

  it('renames a dataset without attempting to replace its protected rows', async () => {
    editor(true);
    await screen.findByDisplayValue('Orders');
    change('Dataset title','Renamed');
    click('Save dataset');
    await waitFor(()=>expect(state.calls.some(c=>c.method==='PATCH')).toBe(true));
    const saved=state.calls.find(c=>c.method==='PATCH')!;
    expect(saved.body.title).toBe('Renamed');
    expect(saved.body).not.toHaveProperty('dataset');
  });
});
