import { Navigate, Route, Routes } from 'react-router';
import MixpanelClient from '@/components/MixpanelClient';
import PreviewParams from '@/components/PreviewParams';
import { SessionProvider, useSession } from './session';
import { Shell } from './Shell';
import { AccountPage } from './pages/Account';
import { ArtifactPage } from './pages/Artifact';
import { DocsPage } from './pages/Docs';
import { HomePage } from './pages/Home';
import { PrivacyPage, TermsPage } from './pages/Legal';
import { LoginPage } from './pages/Login';
import { NotFoundPage } from './pages/NotFound';
import { ProfilePage } from './pages/Profile';
import { TokensNewPage } from './pages/TokensNew';
import { TrashPage } from './pages/Trash';

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
          {/* Landing designs under review, side by side. Static paths, so
            * they outrank the `/:user/*` profile route. Delete the losers. */}
          <Route path="/privacy" element={<PrivacyPage />} />
          <Route path="/terms" element={<TermsPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/account" element={<AccountPage />} />
          <Route path="/tokens" element={<Navigate to="/account" replace />} />
          <Route path="/tokens/new" element={<TokensNewPage />} />
          <Route path="/trash" element={<TrashPage />} />
          {/* `/docs` and below are the agent surface, served by the server's
            * docs route — the SPA must not claim them. */}
          <Route path="/docs-human" element={<DocsPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
        <Route path="/a/:id" element={<ArtifactPage />} />
        <Route path="/:user/*" element={<ProfilePage />} />
      </Routes>
    </SessionProvider>
  );
}
