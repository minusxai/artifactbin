import LoginForm from '@/components/LoginForm';

export function LoginPage() {
  return (
    <main className="mx-auto mt-16 max-w-xl px-6"><div className="mx-auto max-w-sm">
      <h1 className="text-base font-semibold"><span className="text-accent">&gt;</span> log in</h1>
      <LoginForm />
    </div></main>
  );
}
