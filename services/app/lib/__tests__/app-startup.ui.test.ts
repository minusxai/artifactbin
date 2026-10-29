import { expect, it } from 'vitest';
import { agentDiscovery, agentDiscoveryBody } from '@/lib/agent-copy/agent-discovery';

it('paints a named product loading status before JavaScript and keeps help in the no-script fallback', () => {
  const host = document.createElement('div');
  host.innerHTML = agentDiscoveryBody(agentDiscovery('https://example.test'));
  const startup = host.querySelector('[data-app-startup]')!;
  expect(startup.querySelector('[role="status"]')?.textContent).toBe('Loading artifactbin…');
  expect(startup.querySelector('img')?.getAttribute('src')).toBe('/logo-128.png');
  expect(startup.querySelector('noscript')?.textContent).toContain('JavaScript');
  const visible = startup.cloneNode(true) as Element;
  visible.querySelector('noscript')?.remove();
  expect(visible.textContent).not.toMatch(/Agent guide|authentication|operations/);
  expect(visible.querySelector('a')?.textContent).toBe('Reload');
  expect(host.querySelectorAll('[data-app-startup]')).toHaveLength(1);
});
