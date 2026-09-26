/**
 * A CONTROL WHOSE BACKEND FEATURE IS MISSING says so in place: disabled, with
 * the backend's reason as its accessible description (and a tooltip). With
 * every feature available (online) the same control is enabled and carries no
 * description — nothing changes.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import ImageDialog from '@/components/views/story/ImageDialog';
import { ArtifactBackendProvider } from '@/lib/artifact-backend/context';
import type { ArtifactBackend } from '@/lib/artifact-backend/types';
import { fakeBackend } from '@/test/helpers/artifact-backend';

const OFFLINE = 'Not available in a downloaded file.';

const imageDialog = (backend: ArtifactBackend) => render(
  <ArtifactBackendProvider backend={backend}>
    <ImageDialog mode="insert" onUploadFile={vi.fn()} onImportUrl={vi.fn()} onConfirm={vi.fn()} onClose={vi.fn()} />
  </ArtifactBackendProvider>,
);

describe('the image dialog without web assets', () => {
  it('disables upload and URL import, each described by the reason', () => {
    imageDialog(fakeBackend({ webAssets: OFFLINE }));
    for (const control of [
      screen.getByRole('button', { name: 'choose a file' }),
      screen.getByRole('textbox', { name: 'Image URL' }),
      screen.getByRole('button', { name: 'Import image from URL' }),
    ]) {
      expect(control).toBeDisabled();
      expect(control).toHaveAccessibleDescription(OFFLINE);
    }
  });

  it('is unchanged online', () => {
    imageDialog(fakeBackend());
    for (const control of [
      screen.getByRole('button', { name: 'choose a file' }),
      screen.getByRole('textbox', { name: 'Image URL' }),
      screen.getByRole('button', { name: 'Import image from URL' }),
    ]) {
      expect(control).toBeEnabled();
      expect(control).not.toHaveAccessibleDescription();
    }
  });
});
