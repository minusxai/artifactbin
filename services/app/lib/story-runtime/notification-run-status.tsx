import {useSyncExternalStore} from 'react';
import {createRoot} from 'react-dom/client';
import type {WriteStatusFeed} from '@/lib/islands/contract';

function NotificationRunStatus({feed}:{feed:WriteStatusFeed}){
 const statuses=useSyncExternalStore(feed.subscribe,feed.current);
 const runs=statuses.filter(status=>status.mutationRunId);
 if(!runs.length)return null;
 return <div role="status" aria-live="polite" className="flex max-w-sm flex-col gap-2 rounded-md border border-edge bg-surface px-3 py-2 font-sans text-sm text-fg shadow-sm" style={{position:'fixed',right:16,bottom:16,zIndex:2147483000}}>
  <span>Saved</span>
  {runs.map(status=><div key={status.id} className="flex items-center gap-2"><a target="_blank" rel="noopener" className="underline" href={`/notifications?run=${encodeURIComponent(status.mutationRunId!)}`}>Notification status ({status.mutation})</a><button type="button" aria-label={`Dismiss notification status for ${status.mutation}`} onClick={()=>feed.dismiss(status.id)}>×</button></div>)}
 </div>;
}

/** Loaded after the first notifying write; never imports the Solid JSX pipeline. */
export function mountNotificationRunStatus(feed:WriteStatusFeed,root:HTMLElement):()=>void{
 const host=root.ownerDocument.createElement('div');host.setAttribute('data-mx-write-status-host','');
 (root.ownerDocument.body??root).appendChild(host);
 const view=createRoot(host);view.render(<NotificationRunStatus feed={feed}/>);
 // The owning React root may be committing its own unmount.
 return ()=>{host.remove();queueMicrotask(()=>view.unmount());};
}
