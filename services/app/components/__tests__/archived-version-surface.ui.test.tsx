/**
 * AN OLDER VERSION, ON THE APP PAGE — `/a/<id>?version=2`.
 *
 * The surface renders the archived document exactly as it renders the head, and
 * differs in one direction only: nothing on it acts on the artifact. Editing
 * writes to the HEAD, a comment anchors to a node in the head, and like, fork
 * and share belong to the artifact rather than to this snapshot — so an owner,
 * who has every one of those controls on the head, must be shown none of them
 * here, and told which version they are looking at instead.
 *
 * Pinned through the OWNER's render on purpose: a reader who never had the
 * controls proves nothing about turning them off.
 */
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { render } from '@/test/helpers/surface-ui';
import { setupSurface, surfaceProps } from '@/test/helpers/inline-surface';
import ArtifactSurface from '../ArtifactSurface';
import ArtifactShell from '../ArtifactShell';
import { archivedBanner } from '@/lib/story/reader-chrome';

afterEach(() => vi.unstubAllGlobals());

const asOwner = (props: Parameters<typeof ArtifactSurface>[0]) => (
  <ArtifactShell role="owner"><ArtifactSurface {...props} /></ArtifactShell>
);

describe('the app page showing an archived version', () => {
  beforeEach(setupSurface);

  it('says which version it is, and offers the owner none of the artifact controls', async () => {
    const view = render(asOwner(surfaceProps({ archived: { version: 2, head: 7 }, source: '<p>Version two</p>' })));
    expect(await screen.findByText('Version two')).toBeInTheDocument();

    // The one line an archived render adds.
    expect(view.container.querySelector('[data-mx-archived-version]')).toHaveTextContent(archivedBanner(2, 7));
    expect(archivedBanner(2, 7)).toBe('Version 2 of 7 · read-only');

    // …and the rail draws none of the doors that act on the artifact.
    for (const action of ['like', 'comment', 'fork', 'edit', 'share']) {
      expect(view.container.querySelector(`[data-mx-reader-action="${action}"]`), action).toBeNull();
    }
    // Edit is not reachable from the controls panel either.
    fireEvent.click(screen.getByLabelText('Open artifact controls'));
    expect(screen.queryByLabelText('Edit artifact')).toBeNull();
  });

  it('draws the head with every one of them, so the absence above is the version and not the fixture', async () => {
    const view = render(asOwner(surfaceProps({ source: '<p>Version seven</p>' })));
    expect(await screen.findByText('Version seven')).toBeInTheDocument();
    expect(view.container.querySelector('[data-mx-archived-version]')).toBeNull();
    for (const action of ['like', 'comment', 'edit', 'share']) {
      expect(view.container.querySelector(`[data-mx-reader-action="${action}"]`), action).not.toBeNull();
    }
    fireEvent.click(screen.getByLabelText('Open artifact controls'));
    expect(screen.getByLabelText('Edit artifact')).toBeInTheDocument();
  });
});
