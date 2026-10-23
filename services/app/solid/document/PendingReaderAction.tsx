/* @jsxImportSource solid-js */
import {onCleanup} from 'solid-js';
import {Button} from '../ui/Button';
export interface PendingReaderActionProps {label:string;readyLabel:string}
/** Keep the requested control visible; move its keyboard focus to the loaded action. */
export function PendingReaderAction(props:PendingReaderActionProps){
 let button!:HTMLButtonElement;
 onCleanup(()=>{
  const root=button.getRootNode() as Document|ShadowRoot;
  if(root.activeElement!==button)return;
  queueMicrotask(()=>{
   const next=[...root.querySelectorAll<HTMLButtonElement>('button[aria-label]')].find(node=>node.getAttribute('aria-label')===props.readyLabel);
   if(next?.isConnected)next.focus();
  });
 });
 return <Button ref={button} variant="secondary" size="sm" aria-label={props.label} aria-busy="true" aria-disabled="true" onClick={event=>event.preventDefault()}>Copy for agent…</Button>;
}
