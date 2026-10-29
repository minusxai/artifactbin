/* @jsxImportSource solid-js */
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@solidjs/testing-library';
import { afterEach, expect, it, vi } from 'vitest';
import { STORY_TEMPLATE_NAMES } from '@/lib/validation/atlas-schemas';
import { STORY_SYSTEMS } from '@/lib/data/story/story-systems';
import GetStarted from '@/solid/components/GetStarted';
import { App } from '@/solid/App';
import { gettingStarted } from '@/lib/serving/getting-started';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.history.replaceState(null, '', '/'); });
it('serves the human tour with current templates, live design systems and a link to Getting started', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url === '/api/page/session' ? Response.json({ user: null, kind: 'none', onboarded: true }) : Response.json({})));
  window.history.replaceState(null, '', '/docs-human');
  render(() => <App />);
  await vi.dynamicImportSettled();
  const main = await screen.findByRole('main');
  expect(within(screen.getByRole('navigation', { name: 'Workspace' })).getByRole('link', { name: 'Human docs' })).toHaveAttribute('aria-current', 'page');
  for (const system of STORY_SYSTEMS) {
    expect(main).toHaveTextContent(system.label);
    expect(main.querySelector(`[data-design-specimen="${system.name}"] img`)).toHaveAttribute('src', `/design-systems/${system.name}${system.defaultMode === 'dark' ? '-dark' : ''}.webp`);
  }
  expect(main.querySelector('img[src^="/story-themes/"]')).toBeNull();
  expect(main.querySelector('link[href*="design-system"]')).toBeNull();
  for (const template of STORY_TEMPLATE_NAMES) expect(main).toHaveTextContent(template);
  for (const field of ['html', 'dataset', 'image']) expect(main).toHaveTextContent(field);
  expect(main.textContent).not.toMatch(/afbin (?:push|auth)|JSX|visual source editor/);
  expect(main.textContent).not.toContain('/plugin');
  expect(main.textContent).not.toContain('—');
  expect(screen.getByRole('link', { name: 'Getting started guide' })).toHaveAttribute('href', '/getting-started');
  const contents = screen.getByRole('navigation', { name: 'Contents' });
  for (const link of within(contents).getAllByRole('link')) expect(document.getElementById(link.getAttribute('href')!.slice(1))).toBeInTheDocument();
});

it('renders the same Getting started instructions as Markdown, with sidebar and copyable commands', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url === '/api/page/session' ? Response.json({ user: null, kind: 'none', onboarded: true }) : Response.json({})));
  window.history.replaceState(null, '', '/getting-started');
  render(() => <App />);
  const main = await screen.findByRole('main');
  expect(within(main).getByRole('heading', { level: 1, name: 'Getting started' })).toBeInTheDocument();
  expect(screen.getByRole('navigation', { name: 'Workspace' })).toBeInTheDocument();
  expect(within(main).getByRole('link', { name: 'Markdown for agents ↗' })).toHaveAttribute('href', '/llms.txt');
  const guide = gettingStarted(window.location.origin);
  for (const section of guide.sections) {
    expect(document.getElementById(section.id)).toBeInTheDocument();
    for (const block of section.blocks) {
      expect(within(main).getByText(block.text, { normalizer: text => text })).toBeInTheDocument();
      if (block.kind === 'command') expect(within(main).getByRole('button', { name: `Copy ${block.label.toLowerCase()} command` })).toBeInTheDocument();
    }
  }
});

it('offers the author skill and links to installation instructions',()=>{
 render(()=><GetStarted/>);
 expect(screen.getByRole('link',{name:'Download author skill'})).toHaveAttribute('href','/skills/artifactbin.zip');
 expect(screen.getByRole('link',{name:'Installation instructions'})).toHaveAttribute('href','/getting-started');
 expect(document.body.textContent).not.toMatch(/@afbin\/cli|Connect your CLI/);
});

it('company setup panel copies shared recipient defaults and preserves explicit Personal starter destination',async()=>{
 const fetcher=vi.fn(async (url:string)=>url==='/api/deployment'?Response.json({mode:'company',setup_complete:true,is_owner:false,default_group:{id:'grp_team',handle:'company-team',name:'Company',description:'',role:null}}):new Promise<Response>(()=>{}));
 vi.stubGlobal('fetch',fetcher);render(()=> <GetStarted destination={{type:'personal'}}/>);
 await screen.findByRole('button',{name:'Copy deployment setup instructions'});
 expect(document.body.textContent).toContain('GET /api/groups/company-team');expect(document.body.textContent).toContain('PUT /api/me/preferences');expect(document.body.textContent).not.toContain('grp_team');
 fireEvent.click(screen.getByRole('button',{name:'Create a live document for my agent'}));
 expect(fetcher).toHaveBeenCalledWith('/api/start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({destination:{type:'personal'}})});
});

import {DeploymentWelcome} from '@/solid/pages/DeploymentWelcome';
import { agentDiscovery, AGENT_HELP_TITLE } from '@/lib/skills/agent-discovery';
it('shows the shared descriptive guide before skill installation',()=>{
 render(()=><DeploymentWelcome deployment={{mode:'company',setup_complete:false,is_owner:false,default_group:null}}/>);
 const help=agentDiscovery(window.location.origin);
 expect(screen.queryByText(help.instruction)).toBeNull();
 expect(screen.getByRole('link',{name:AGENT_HELP_TITLE})).toHaveAttribute('href',help.url);
 const headings=screen.getAllByRole('heading').map(node=>node.textContent);
 expect(headings.indexOf('AI agents')).toBeLessThan(headings.indexOf('Add the author skill'));
});
