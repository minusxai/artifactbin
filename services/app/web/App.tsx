import {NotificationProvider} from '@/components/NotificationCenter';
import { Navigate, Route, Routes } from 'react-router';
import { SessionProvider } from './session';
import { Shell } from './Shell';
import { routePages } from './route-pages';
import { NavigationPreloads } from './navigation-preloads';
import { OnboardingGate } from './OnboardingGate';
import { useEffect } from 'react';

const { NotFoundPage, ProfilePage } = routePages;

/** A guarded React navigation to a Solid-owned URL completes as a document navigation. */
function LeaveToSolid() {
  useEffect(() => { window.location.reload(); }, []);
  return null;
}

export function App() {
  return (
    <SessionProvider>
    <NotificationProvider>
      <NavigationPreloads>
      {/* Around the WHOLE table: a new account is intercepted wherever it
        * landed, not only on the routes somebody remembered to guard. */}
      <OnboardingGate>
      <Routes>
        <Route path="/" element={<LeaveToSolid />} />
        <Route path="/start" element={<LeaveToSolid />} />
        <Route element={<Shell />}>
          <Route path="/login" element={<LeaveToSolid />} />
          <Route path="/chat" element={<LeaveToSolid />} />
          <Route path="/notifications" element={<LeaveToSolid />} />
          <Route path="/account" element={<LeaveToSolid />} />
          <Route path="/welcome" element={<LeaveToSolid />} />
          <Route path="/assets" element={<LeaveToSolid />} />
          <Route path="/datasets/new" element={<LeaveToSolid />} />
          <Route path="/files/new" element={<LeaveToSolid />} />
          <Route path="/tokens" element={<Navigate to="/account" replace />} />
          {/* `/docs` and below are the agent surface, served by the server's
            * docs route — the SPA must not claim them. */}
          <Route path="/docs-human" element={<LeaveToSolid />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
        <Route path="/a/:id/edit" element={<ProfilePage />} />
        <Route path="/a/:id" element={<ProfilePage />} />
        <Route path="/:user" element={<LeaveToSolid />} />
        <Route path="/:user/*" element={<ProfilePage />} />
      </Routes>
      </OnboardingGate>
      </NavigationPreloads>
    </NotificationProvider>
    </SessionProvider>
  );
}
