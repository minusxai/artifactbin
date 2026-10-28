/* @jsxImportSource solid-js */
import '@testing-library/jest-dom/vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@solidjs/testing-library';
import {afterEach,expect,it,vi} from 'vitest';
import {MAX_DOCUMENT_BYTES} from '@artifactbin/contracts';
import HtmlUpload from '../HtmlUpload';
import {openDocument} from '@/solid/lib/document-navigation';
vi.mock('@/solid/lib/document-navigation',()=>({openDocument:vi.fn()}));
afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.clearAllMocks();});
const html='<!doctype html><html><head><title>Field notes</title></head><body><h1>Field notes</h1></body></html>';
function open(){vi.stubGlobal('fetch',vi.fn(async()=>Response.json({id:'native1'},{status:201})));const close=vi.fn();render(()=><HtmlUpload parentId="folder1" destination={{type:'group',id:'group1'}} onClose={close}/>);return close;}
function choose(file?:File){fireEvent.change(document.querySelector('input[type=file]')!,{target:{files:file?[file]:[]}});}
it('publishes the selected HTML unchanged through the native door into the selected workspace',async()=>{open();choose(new File([html],'field.HTML',{type:'text/html'}));await screen.findByText('field.HTML');fireEvent.click(screen.getByRole('button',{name:'Upload HTML'}));await waitFor(()=>expect(openDocument).toHaveBeenCalledWith('/a/native1'));expect(fetch).toHaveBeenCalledWith('/api/my/artifacts',expect.objectContaining({body:JSON.stringify({html,visibility:'private',parent_id:'folder1',destination:{type:'group',id:'group1'}})}));});
it.each([['bad.jsx','<h1>old</h1>','Choose an .html or .htm file.'],['empty.html','   ','The HTML file is empty.']])('refuses %s without publishing',async(name,text,error)=>{open();choose(new File([text],name));expect(await screen.findByRole('alert')).toHaveTextContent(error);expect(fetch).not.toHaveBeenCalled();});
it('refuses oversized HTML before reading or publishing',async()=>{open();const f=new File(['x'],'big.html');Object.defineProperty(f,'size',{value:MAX_DOCUMENT_BYTES+1});choose(f);expect(await screen.findByRole('alert')).toHaveTextContent('2 MB');expect(fetch).not.toHaveBeenCalled();});
it('cancels without creating an artifact and ignores an empty file-picker selection',()=>{const close=open();choose();expect(screen.getByRole('button',{name:'Upload HTML'})).toBeDisabled();fireEvent.click(screen.getByRole('button',{name:'Cancel'}));expect(close).toHaveBeenCalledOnce();expect(fetch).not.toHaveBeenCalled();});
it('keeps the selected file after an authentication failure and never navigates',async()=>{open();vi.mocked(fetch).mockResolvedValue(Response.json({error:'unauthorized'},{status:401}));choose(new File([html],'field.htm'));await screen.findByText('field.htm');fireEvent.click(screen.getByRole('button',{name:'Upload HTML'}));expect(await screen.findByRole('alert')).toHaveTextContent('Sign in');expect(screen.getByText('field.htm')).toBeVisible();expect(openDocument).not.toHaveBeenCalled();});
