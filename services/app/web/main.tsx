import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router';
import trustedCss from '@/app/globals.css?inline';
import { configureTrustedUiStyles } from '@/components/TrustedUi';
import { App } from './App';
import { captureInitialStory, clearInitialStoryOnRoute } from './initial-story';
import { NavigationBoundary } from './NavigationBoundary';

captureInitialStory();
configureTrustedUiStyles(trustedCss);
const router = createBrowserRouter([{ path: '*', element: <NavigationBoundary><App /></NavigationBoundary> }]);
router.subscribe(state => clearInitialStoryOnRoute(state.location.pathname));

createRoot(document.getElementById('root')!).render(
  <RouterProvider router={router} />,
);
