import { artifactIdFromPath } from '@artifactbin/utils/artifact-reference';
import { artifactViewPath } from './urls';

/** Whether the (edit-suffix-stripped) path names an artifact at all — `/a/<id>` or `/@user/<id>[-slug]`. */
const namesArtifact = (pathname: string): boolean => artifactIdFromPath(artifactViewPath(pathname)) !== null;

/**
 * Whole-document Solid ownership; artifact aliases keep the React reader. A folder or dataset is
 * Solid-owned at EITHER address shape — `/a/<id>[/edit]` or its healed pretty form
 * `/@user/<id>[-slug][/edit]` (server/app documentPreparation renders every format at the owner's
 * pretty address once they have a username, so the bare `/a/` shape alone would miss the common case).
 */
export function isSolidPage(pathname: string, status = 200, artifactFormat?: string): boolean {
  const isEdit = /\/edit\/?$/.test(pathname);
  if (status === 200 && artifactFormat === 'folder' && !isEdit && namesArtifact(pathname)) return true;
  if (status === 200 && artifactFormat === 'dataset' && isEdit && namesArtifact(pathname)) return true;
  return status === 404 || ['/', '/assets', '/datasets/new', '/files/new', '/trash', '/chat', '/login', '/start', '/welcome', '/notifications', '/account', '/docs-human'].includes(pathname)
    || /^\/@[^/]+\/?$/.test(pathname);
}
