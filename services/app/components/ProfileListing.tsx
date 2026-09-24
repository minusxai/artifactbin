/**
 * A PUBLIC PROFILE'S LISTING — everything inside the page's shell, as one
 * component, so the pages that draw it render the same pieces rather than each
 * composing them by hand:
 *
 *  - `/@handle`, the app's profile page (web/pages/Profile), in the SPA;
 *  - `/` on the owner's verified custom domain (server/custom-host), rendered
 *    once on the server with no script at all.
 *
 * `surface` is the one switch between them. `'domain'` draws the same hero and
 * the same shelf, less what needs the app behind it: no Follow (a session and
 * `/api`), no shelf toolbar (search, filters and the view toggle are script),
 * no folder tiles (a folder's page is not served on the domain), and every
 * address is one the domain answers (`/`, `/<id>-<slug>`).
 */
import { ListingHero, NothingHere, type ListingSurface } from '@/components/Listing';
import Shelf from '@/components/Shelf';
import { canonicalArtifactPath, domainPostPath } from '@/lib/urls';

type ProfileFile = Record<string, unknown> & { id: string; format: string };

export interface ProfileListingData {
  handle: string;
  owner?: { id: string; image?: string | null };
  follow?: { following: boolean; count: number };
  authed?: boolean;
  files: ProfileFile[];
}

/**
 * Count documents and folders: the assets band is withheld below, so counting
 * datasets would promise rows that are not there.
 */
export function ProfileListing({ data, surface = 'app' }: { data: ProfileListingData; surface?: ListingSurface }) {
  const domain = surface === 'domain';
  // Folders are ROWS in this listing (`format: 'folder'`), reached at their
  // own address, so there is no derived folder panel and no path crumb to draw.
  // The domain serves documents only, so a folder there would be a dead link.
  const files = domain ? data.files.filter((a) => a.format !== 'folder') : data.files;
  return (
    <>
      <ListingHero
        handle={data.handle}
        label="public index"
        count={files.filter((a) => a.format === 'markup' || a.format === 'folder').length}
        noun="public artifact"
        surface={surface}
        // Everyone's, owner included: the route ships `owner` on both branches.
        {...(data.owner ? { owner: { id: data.owner.id, image: data.owner.image ?? null } } : {})}
        // The follow control is the STRANGER's half: the route ships `follow`
        // on that branch alone, and it needs the owner's id to act on.
        {...(!domain && data.owner && data.follow ? { follow: { userId: data.owner.id, ...data.follow, signedIn: !!data.authed } } : {})}
      />
      {files.length === 0 ? <NothingHere /> : <ProfileShelf handle={data.handle} files={files} surface={surface} />}
    </>
  );
}

/**
 * The owner's own profile root is the dashboard's shelf asked a different
 * question — same account, same root. Never the row verbs: `actions` stays
 * `share`, because a page whose whole point is handing someone a link should
 * not be where a document is edited or deleted.
 */
function ProfileShelf({ handle, files, surface }: { handle: string; files: ProfileFile[]; surface: ListingSurface }) {
  const address = (a: ProfileFile) => {
    const doc = a as unknown as { id: string; title: string | null };
    return surface === 'domain' ? domainPostPath(doc) : canonicalArtifactPath(doc, handle);
  };
  return (
    <Shelf
      actions="share"
      showVisibility={false}
      assets={false}
      dates="absolute"
      surface={surface}
      rows={files.map((a) => ({ ...a, url: address(a) }) as never)}
    />
  );
}
