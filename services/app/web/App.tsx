import { Navigate, Route, Routes } from 'react-router';
import MixpanelClient from '@/components/MixpanelClient';
import PreviewParams from '@/components/PreviewParams';
import { SessionProvider, useSession } from './session';
import { Shell } from './Shell';
import { AccountPage } from './pages/Account';
import { ArtifactPage } from './pages/Artifact';
import { DocsPage } from './pages/Docs';
import { HomePage } from './pages/Home';
import { LoginPage } from './pages/Login';
import { NotFoundPage } from './pages/NotFound';
import { ProfilePage } from './pages/Profile';
import { TokensNewPage } from './pages/TokensNew';

function Analytics() {
  const { session } = useSession();
  return session ? <MixpanelClient token={session.mixpanel.token} host={session.mixpanel.host} /> : null;
}

export function App() {
  return (
    <SessionProvider>
      <Analytics />
      <PreviewParams />
      <Routes>
        <Route element={<Shell />}>
          <Route path="/" element={<HomePage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/account" element={<AccountPage />} />
          <Route path="/tokens" element={<Navigate to="/account" replace />} />
          <Route path="/tokens/new" element={<TokensNewPage />} />
          <Route path="/docs" element={<Navigate to="/docs/human" replace />} />
          <Route path="/docs/human" element={<DocsPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
        <Route path="/a/:id" element={<ArtifactPage />} />
        <Route path="/:user/*" element={<ProfilePage />} />
      </Routes>
    </SessionProvider>
  );
}
