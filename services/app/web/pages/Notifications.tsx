import {Navigate} from 'react-router';
import {Settings} from 'lucide-react';
import {PeopleInbox} from '@/components/PeopleInbox';
import {useSession} from '../session';

export function NotificationsPage(){
 const {session}=useSession();
 if(session&&session.kind!=='account')return <Navigate to="/login?callbackUrl=/notifications" replace/>;
 return <main className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
  <div className="mb-5 flex items-center justify-between gap-4"><div><h1 className="text-xl font-semibold">Notifications</h1><p className="mt-1 text-sm text-muted">Invitations, conversations and activity.</p></div><a href="/account#notifications" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg"><Settings size={16}/>Settings</a></div>
  <div className="overflow-hidden rounded-lg border border-edge bg-surface"><PeopleInbox/></div>
 </main>;
}
