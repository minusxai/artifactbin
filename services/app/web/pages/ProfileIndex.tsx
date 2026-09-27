/**
 * A public profile's INDEX page (`/@handle`): the listing inside the app's
 * listing shell. Its own chunk, because the profile ROUTE also serves every
 * pretty document address (`/@handle/<slug>`), and a reader of a document
 * must not download the shelf, its table and its menus to read it
 * (lib/__tests__/reader-bundle-hygiene). The server preloads this chunk beside
 * the route when the address is a profile index (server/app `page`).
 */
import { ListingShell } from '@/components/Listing';
import { ProfileListing, type ProfileListingData } from '@/components/ProfileListing';

export function ProfileIndexPage({ page, stale, onRetry }: { page: ProfileListingData & { authed: boolean; anon: boolean }; stale: boolean; onRetry: () => void }) {
  return (
    <ListingShell authed={page.authed} anon={page.anon}>
      {stale && <button aria-label="Retry profile" onClick={onRetry}>Could not refresh profile. Retry</button>}
      <ProfileListing data={page} />
    </ListingShell>
  );
}

/** The listing is shared with the custom-domain home page (components/ProfileListing). */
export { ProfileListing };
