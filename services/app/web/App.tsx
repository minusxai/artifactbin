import {NotificationProvider} from '@/components/NotificationCenter';
import { Navigate, Route, Routes } from 'react-router';
import { SessionProvider } from './session';
import { Shell } from './Shell';
import { routePages } from './route-pages';
import { NavigationPreloads } from './navigation-preloads';
import { OnboardingGate } from './OnboardingGate';

const { ChatPage, AccountPage, AssetsPage, DatasetEditorPage, FileUploadPage, DocsPage, HomePage, LoginPage, NotFoundPage, ProfilePage, StartPage, TrashPage, WelcomePage } = routePages;

export function App() {
  return (
    <SessionProvider>
    <NotificationProvider>
      <NavigationPreloads>
      {/* Around the WHOLE table: a new account is intercepted wherever it
        * landed, not only on the routes somebody remembered to guard. */}
      <OnboardingGate>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/start" element={<StartPage />} />
        <Route element={<Shell />}>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/chat" element={<ChatPage />} />
          <Route path="/account" element={<AccountPage />} />
          <Route path="/welcome" element={<WelcomePage />} />
          <Route path="/assets" element={<AssetsPage />} />
          <Route path="/datasets/new" element={<DatasetEditorPage />} />
          <Route path="/files/new" element={<FileUploadPage />} />
          <Route path="/tokens" element={<Navigate to="/account" replace />} />
          <Route path="/trash" element={<TrashPage />} />
          {/* `/docs` and below are the agent surface, served by the server's
            * docs route — the SPA must not claim them. */}
          <Route path="/docs-human" element={<DocsPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
        <Route path="/a/:id/edit" element={<ProfilePage />} />
        <Route path="/a/:id" element={<ProfilePage />} />
        <Route path="/:user/*" element={<ProfilePage />} />
      </Routes>
      </OnboardingGate>
      </NavigationPreloads>
    </NotificationProvider>
    </SessionProvider>
  );
}
