import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ArtifactShell from '../ArtifactShell';
import ArtifactSurface, { type ArtifactSurfaceProps } from '../ArtifactSurface';

class FakeEventSource { addEventListener() {} removeEventListener() {} close() {} }
beforeEach(() => { localStorage.clear(); vi.stubGlobal('EventSource', FakeEventSource); vi.stubGlobal('fetch', vi.fn(async () => Response.json({}))); });
afterEach(() => vi.unstubAllGlobals());
const props = (over: Partial<ArtifactSurfaceProps> = {}): ArtifactSurfaceProps => ({
  id:'story1', editId:'edit_1', format:'markup', title:'doc', source:'<p>Hello</p>', content:'', template:null,
  refs:[], version:1, columns:[], compiledCss:null, theme:null, colorMode:'light', ...over,
});

describe('markup view mode is a direct story mount', () => {
  it('renders author prose into the top-level scrolling document without a human iframe', async () => {
    const view=render(<ArtifactSurface {...props()}/>);
    await waitFor(()=>expect(screen.getByText('Hello')).toBeVisible());
    expect(view.container.querySelector('[data-artifact-story-host]')).toBeTruthy();
    expect(view.container.querySelector('iframe[title="artifact"]')).toBeNull();
    expect(screen.getByLabelText('Artifact viewport')).toHaveClass('overflow-visible');
  });
  it('keeps role-gated edit controls in first-party chrome', async () => {
    render(<ArtifactShell role="owner"><ArtifactSurface {...props()}/></ArtifactShell>);
    fireEvent.click(screen.getByLabelText('Open artifact controls'));
    expect(await screen.findByLabelText('Edit artifact')).toBeVisible();
  });
  it('keeps readers read-only',()=>{render(<ArtifactSurface {...props()}/>);expect(screen.queryByLabelText('Edit artifact')).toBeNull();});
  it('retains the isolated standalone document path for captures',()=>{
    render(<ArtifactSurface {...props({captureKey:'signed-export-key'})}/>);
    const frame=screen.getByTitle('artifact');
    expect(frame).toHaveAttribute('src','/a/story1/raw?chrome=0&key=signed-export-key');
    expect(frame.getAttribute('sandbox')).not.toContain('allow-same-origin');
    expect(frame).toHaveAttribute('allow',expect.stringContaining('fullscreen'));
  });
  it('refuses unsafe legacy source as text',async()=>{
    render(<ArtifactSurface {...props({source:'<script>alert(1)</script>'})}/>);
    await waitFor(()=>expect(screen.getByText('<script>alert(1)</script>')).toBeVisible());
    expect(document.querySelector('[data-artifact-story-host] script')).toBeNull();
  });
});
