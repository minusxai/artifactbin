// FIRST: the address bar holds the canonical path before anything below reads it.
import './heal-address';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { configureTrustedUiFromShell } from '@/components/TrustedUi';
import { App } from './App';
import { captureInitialStory, clearInitialStoryOnRoute, initialDocumentStory, initialStoryIsCompiled } from './initial-story';
import { NavigationBoundary } from './NavigationBoundary';
import { preloadDocumentReader } from './route-pages';

captureInitialStory();
// The trusted chrome's sheet is the app's own, already loaded by the HTML shell:
// read before anything mounts, so no second copy of it rides in this bundle.
configureTrustedUiFromShell(document);
const router = createBrowserRouter([{ path: '*', element: <NavigationBoundary><App /></NavigationBoundary> }]);
router.subscribe(state => clearInitialStoryOnRoute(state.location.pathname));

const render = () => createRoot(document.getElementById('root')!).render(
  <RouterProvider router={router} />,
);
// A server-rendered document is already on screen: render once its reader's
// code is here (preloaded by the head), so it takes over in one commit. A
// failed download renders anyway, and the route boundary offers its Retry.
// A compiled story needs no interpreter to be adopted: that code loads when edit mode is entered.
if (initialDocumentStory()) void preloadDocumentReader({ interpreter: !initialStoryIsCompiled() }).catch(() => {}).then(render);
else render();
