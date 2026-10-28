/* @jsxImportSource solid-js */
import { afterEach, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/dom';
import { createSignal } from 'solid-js';
import { createHttpBackend } from '@/lib/artifact-backend/http';
import type { ArtifactBackend } from '@/lib/artifact-backend/types';
import { fireEvent, render } from '../../__tests__/helpers';
import { replaceComment } from './comment-input';
import { CommentMarkdownField } from '../CommentMarkdownField';
import { CommentMentionPicker } from '../CommentMentionPicker';
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const people = [{user_id:'usr_asha',username:'asha',name:'Asha'},{user_id:'usr_lee',username:'lee',name:'Lee'}];
const backend = () => ({unavailable:()=>null,members:vi.fn(async()=>({people,mentions:{}}))}) as unknown as ArtifactBackend;

it('offers only people, preserves stable identity and never requests agent sessions', async () => {
 const fetch = vi.fn(async(_url:RequestInfo|URL)=>Response.json({people,mentions:{}}));vi.stubGlobal('fetch',fetch);
 const select=vi.fn();
 render(()=><CommentMentionPicker backend={createHttpBackend('doc1')} artifactId="doc1" query="as" onSelect={select}/>);
 fireEvent.click(await screen.findByLabelText('Mention @asha'));
 expect(select).toHaveBeenCalledWith('[@asha](/people/usr_asha)');
 expect(fetch.mock.calls.map(call=>String(call[0]))).toEqual(['/api/my/artifacts/doc1/members?query=as']);
 expect(screen.queryByRole('link',{name:/agent/i})).toBeNull();
 expect(screen.queryByText('Mention an agent')).toBeNull();
});
it('navigates person choices with wrapping and selects without submitting the comment', async()=>{
 const submit=vi.fn(),escape=vi.fn();
 render(()=>{const [value,change]=createSignal('');return <div onKeyDown={escape}><CommentMarkdownField label="Draft" artifactId="doc1" backend={backend()} value={value()} onChange={change} onSubmit={()=>submit(value())}/></div>;});
 const field=screen.getByLabelText('Draft');replaceComment(field,'@');
 await screen.findByLabelText('Mention @asha');
 fireEvent.keyDown(field,{key:'ArrowUp'});fireEvent.keyDown(field,{key:'Enter'});
 expect(field.textContent).toBe('@lee');expect(submit).not.toHaveBeenCalled();
 fireEvent.keyDown(field,{key:'Enter',ctrlKey:true});expect(submit).toHaveBeenCalledWith('[@lee](/people/usr_lee)');
 replaceComment(field,'@');await screen.findByLabelText('Mention @asha');escape.mockClear();
 fireEvent.keyDown(field,{key:'Escape'});expect(screen.queryByLabelText('Mention people')).toBeNull();expect(escape).not.toHaveBeenCalled();
});
it('treats @ as plain text in offline files and preserves the draft',()=>{
 const members=vi.fn();const offline={unavailable:()=> 'Mentions need a connection.',members} as unknown as ArtifactBackend;
 render(()=>{const [value,change]=createSignal('');return <CommentMarkdownField label="Draft" artifactId="doc1" backend={offline} value={value()} onChange={change}/>;});
 expect(screen.getByLabelText('Draft')).toHaveAttribute('aria-placeholder','Write a comment ...');
 replaceComment(screen.getByLabelText('Draft'),'thanks @Asha');expect(screen.getByLabelText('Draft').textContent).toBe('thanks @Asha');expect(members).not.toHaveBeenCalled();
});
it('keeps empty people results clear without offering agent management',async()=>{
 const empty={unavailable:()=>null,members:async()=>({people:[],mentions:{}})} as unknown as ArtifactBackend;
 render(()=><CommentMentionPicker backend={empty} artifactId="doc1" query="missing" onSelect={()=>{}}/>);
 await waitFor(()=>expect(screen.getByText('No matching followers or members.')).toBeTruthy());
 expect(screen.queryByRole('link',{name:/agent/i})).toBeNull();
});
