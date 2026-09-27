import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { configureTrustedUiFromShell } from '@/components/TrustedUi';
import { App } from './App';
import { captureInitialStory, clearInitialStoryOnRoute } from './initial-story';
import { NavigationBoundary } from './NavigationBoundary';

captureInitialStory();
// The trusted chrome's sheet is the app's own, already loaded by the HTML shell:
// read before anything mounts, so no second copy of it rides in this bundle.
configureTrustedUiFromShell(document);
const router = createBrowserRouter([{ path: '*', element: <NavigationBoundary><App /></NavigationBoundary> }]);
router.subscribe(state => clearInitialStoryOnRoute(state.location.pathname));

createRoot(document.getElementById('root')!).render(
  <RouterProvider router={router} />,
);
