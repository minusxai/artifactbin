/* @jsxImportSource solid-js */
import { render, cleanup, screen, waitFor } from '@solidjs/testing-library';
import { afterEach, expect, it } from 'vitest';
import { CommentMarkdownField } from '../CommentMarkdownField';
import { TiptapComments, isTiptapDocument } from '../comment-editor-trial';
afterEach(cleanup);
it('only real native regions select the trial, never text or legacy markup',()=>{
 expect(isTiptapDocument('<article data-af-editable="rich"></article>')).toBe(false);
 expect(isTiptapDocument('<script>rich-native-v1</script>')).toBe(false);
 expect(isTiptapDocument('<article data-af-editable="rich-native-v1"></article>')).toBe(true);
});
it.each([false,true])('comment mount follows document opt-in %s',async native=>{
 render(()=><TiptapComments.Provider value={()=>native}><CommentMarkdownField label="Draft" value="Draft text" onChange={()=>{}}/></TiptapComments.Provider>);
 await waitFor(()=>expect(screen.getByRole('textbox',{name:'Draft'}).classList.contains('tiptap')).toBe(native));
});
