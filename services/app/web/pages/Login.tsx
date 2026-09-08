import LoginForm from '@/components/LoginForm';
import {Navigate,useLocation} from 'react-router';
import {useSession} from '../session';
import {internalRedirectTarget} from '@/lib/safe-redirect';
import {PageStatus} from '../PageStatus';

export function LoginPage() {
  const {session,error,reload}=useSession(),{search}=useLocation();
  if(!session)return <PageStatus label="login" error={error} retry={()=>void reload()}/>;
  if(session.kind==='account'){
    const callback=internalRedirectTarget(new URLSearchParams(search).get('callbackUrl'),window.location.origin);
    return <Navigate to={/^\/(?:login|api|controls)(?:[/?#]|$)/.test(callback)?'/':callback} replace/>;
  }
  return (
    <main className="mx-auto mt-16 max-w-xl px-6"><div className="mx-auto max-w-sm">
      <h1 className="text-base font-semibold"><span className="text-accent">&gt;</span> log in</h1>
      <LoginForm />
    </div></main>
  );
}
