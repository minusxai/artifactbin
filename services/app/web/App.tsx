import { Navigate, Route, Routes } from 'react-router';
import { SessionProvider } from './session';
import { Shell } from './Shell';
import { routePages } from './route-pages';
import { NavigationPreloads } from './navigation-preloads';

const { ChatPage, AccountPage, AssetsPage, DatasetEditorPage, FileUploadPage, DocsPage, HomePage, LoginPage, NotFoundPage, ProfilePage, TrashPage } = routePages;

export function App() {
  return (
    <SessionProvider>
      <NavigationPreloads>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route element={<Shell />}>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/chat" element={<ChatPage />} />
          <Route path="/account" element={<AccountPage />} />
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
      </NavigationPreloads>
    </SessionProvider>
  );
}
