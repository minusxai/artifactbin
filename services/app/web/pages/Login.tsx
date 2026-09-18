import { useEffect } from 'react';
import { useLocation } from 'react-router';
import { useSession } from '../session';
import { loginRedirectTarget } from '@/lib/safe-redirect';
import LoginForm from '@/components/LoginForm';

export function LoginPage() {
  const { session, sessionError } = useSession();
  const { search } = useLocation();
  const signedIn = !!session?.user;
  useEffect(() => {
    // Full navigation also supports auth-owned destinations such as OAuth consent.
    if (signedIn) window.location.replace(loginRedirectTarget(new URLSearchParams(search).get('callbackUrl'), window.location.origin));
  }, [signedIn, search]);
  if (signedIn || (!session && !sessionError)) return null;

  return (
    <main className="mx-auto mt-16 max-w-xl px-6"><div className="mx-auto max-w-sm">
      <h1 className="text-base font-semibold"><span className="text-accent">&gt;</span> log in</h1>
      <LoginForm />
    </div></main>
  );
}
