/* @jsxImportSource solid-js */
import { render, cleanup, screen, waitFor } from '@solidjs/testing-library';
import { afterEach, expect, it } from 'vitest';
import { CommentMarkdownField } from '../CommentMarkdownField';
afterEach(cleanup);
it('uses Tiptap for comments without document opt-in',async()=>{
 render(()=><CommentMarkdownField label="Default comment" value="Existing Markdown draft" onChange={()=>{}}/>);
 await waitFor(()=>expect(screen.getByRole('textbox',{name:'Default comment'}).classList.contains('tiptap')).toBe(true));
 expect(screen.getByRole('textbox',{name:'Default comment'}).textContent).toContain('Existing Markdown draft');
});
