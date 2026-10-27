/* @jsxImportSource solid-js */
import {it,expect,vi} from 'vitest';
import {render,fireEvent,screen,waitFor} from '@solidjs/testing-library';
import {createSignal} from 'solid-js';
import {CommentReactions} from '../CommentReactions';
import {ANN} from './annotation-rig';
it('announces the count and selected state, then removes only after confirmed success',async()=>{
 const onReact=vi.fn(async(active:boolean)=>{setComment({...comment(),reactions:active?[{kind:'thumbs_up',count:3,viewer_reacted:true}]:[{kind:'thumbs_up',count:2,viewer_reacted:false}]});});
 const [comment,setComment]=createSignal({...ANN.thread[0]!,reactions:[{kind:'thumbs_up' as const,count:3,viewer_reacted:true}]});
 render(()=><CommentReactions comment={comment()} signedIn unavailable={null} onSignIn={()=>{}} onReact={onReact}/>);
 const button=screen.getByRole('button',{name:'Remove thumbs-up reaction (3)'});
 expect(button).toHaveAttribute('aria-pressed','true');
 fireEvent.click(button);
 await waitFor(()=>expect(onReact).toHaveBeenCalledWith(false));
 expect(screen.getByRole('button',{name:'React with thumbs up (2)'})).toHaveAttribute('aria-pressed','false');
});
it('retains the confirmed count and selection when a write fails and makes retry possible',async()=>{
 const onReact=vi.fn().mockRejectedValue(Error('network'));
 render(()=><CommentReactions comment={{...ANN.thread[0]!,reactions:[{kind:'thumbs_up',count:1,viewer_reacted:true}]}} signedIn unavailable={null} onSignIn={()=>{}} onReact={onReact}/>);
 fireEvent.click(screen.getByRole('button',{name:'Remove thumbs-up reaction (1)'}));
 expect(await screen.findByRole('alert')).toHaveTextContent('Could not update your reaction. Try again.');
 expect(screen.getByRole('button',{name:'Remove thumbs-up reaction (1)'})).toHaveAttribute('aria-pressed','true');
 expect(screen.getByRole('button',{name:'Remove thumbs-up reaction (1)'})).not.toBeDisabled();
});
it('uses sign-in for guests and refuses downloaded-file writes',()=>{
 const onReact=vi.fn(),onSignIn=vi.fn();
 const view=render(()=><CommentReactions comment={ANN.thread[0]!} signedIn={false} unavailable={null} onSignIn={onSignIn} onReact={onReact}/>);
 fireEvent.click(screen.getByRole('button',{name:'Sign in to react'}));expect(onSignIn).toHaveBeenCalledOnce();expect(onReact).not.toHaveBeenCalled();view.unmount();
 render(()=><CommentReactions comment={ANN.thread[0]!} signedIn unavailable="Downloaded files are read-only. Open original to make changes." onSignIn={onSignIn} onReact={onReact}/>);
 expect(screen.getByRole('button',{name:'Downloaded files are read-only. Open original to make changes.'})).toBeDisabled();
});
