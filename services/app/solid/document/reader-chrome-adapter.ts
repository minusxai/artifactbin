/**
 * THE SERVED RAIL, DRIVEN BY THE APP — one adapter for the reader chrome (lib/story/reader/reader-chrome) wherever
 * the app holds it: solid/pages/Document adopts the served chrome, solid/pages/Starter draws it.
 *
 *  - `wireReaderChrome` delegates the rail's presses (controls/menu toggle their panel here; every other
 *    action and the mode choice go to the page), closes the open panel on Escape, and keeps each panel
 *    trigger's `aria-expanded` and label in step with the panel however it closed.
 *  - `toggleReaction` is the rail's like/follow press: the same door, sign-in answer and page-data signal
 *    as the controls panel's LikeAction (both send through `sendReaction`).
 */
import { createEffect, type Accessor } from 'solid-js';
import { loginHref } from '@/lib/http/login-href';
import { READER_CHROME_HIDDEN_CLASS } from '@/lib/story/reader/reader-chrome';
import { refusedForSignIn } from '@/lib/story/reader/sign-in-required';
import { pageDataChanged } from '@/web/page-data-events';
import { apiFetch } from '../lib/api';
import { closeOnEscape } from '../lib/close-on-escape';

export type ReaderPanel = 'controls' | 'menu' | 'notifications';
type Navigate = (href: string) => void;

export interface ReaderChromeHandlers {
  panel: Accessor<ReaderPanel | null>;
  setPanel(next: ReaderPanel | null): void;
  /** Every rail action but the controls/menu triggers: like, follow, comment, fork, share, edit, … */
  onAction(name: string): void | Promise<void>;
  /** A `data-mx-mode-choice` press (a served chrome that draws its own appearance choice). */
  onMode?(mode: 'light' | 'dark'): void;
}

export interface ReaderChromeWiring {
  /** Run a rail action as if pressed (a carried sign-in intent, the membership pill opening controls). */
  act(name: string): Promise<void>;
  dispose(): void;
}

const TOGGLES = ['controls', 'menu'] as const;
const navigateAway: Navigate = (href) => window.location.assign(href);

/** Say on each panel trigger under `root` whether its panel is open (a redrawn chrome starts closed). */
export function syncPanelTriggers(root: HTMLElement, open: ReaderPanel | null): void {
  for (const name of TOGGLES) {
    const trigger = root.querySelector<HTMLElement>(`[data-mx-reader-trigger="${name}"]`);
    trigger?.setAttribute('aria-expanded', String(open === name));
    trigger?.setAttribute('aria-label', `${open === name ? 'Close' : 'Open'} ${name === 'controls' ? 'artifact controls' : 'menu'}`);
  }
}

/**
 * Wire the rail inside `root` — the chrome itself, or the stable element a redrawn chrome is drawn into.
 * Call it under a reactive owner (the trigger sync is an effect of `handlers.panel`).
 */
export function wireReaderChrome(root: HTMLElement, handlers: ReaderChromeHandlers): ReaderChromeWiring {
  const act = async (name: string) => {
    if (name === 'controls' || name === 'menu') {
      // The rail shows itself first; a page whose scroll sampler follows the panel then has the last word.
      const chrome = root.matches('[data-mx-reader-chrome]') ? root : root.querySelector<HTMLElement>('[data-mx-reader-chrome]');
      chrome?.classList.remove(READER_CHROME_HIDDEN_CLASS);
      chrome?.setAttribute('data-mx-reader-state', 'shown');
      handlers.setPanel(handlers.panel() === name ? null : name);
      return;
    }
    if (name) await handlers.onAction(name);
  };
  const click = (event: MouseEvent) => {
    const target = (event.target as Element).closest<HTMLElement>('[data-mx-reader-action],[data-mx-reader-trigger],[data-mx-mode-choice]');
    if (!target || !root.contains(target) || target.closest('[data-mx-title-editor]')) return;
    event.preventDefault();
    const choice = target.getAttribute('data-mx-mode-choice');
    if (choice === 'light' || choice === 'dark') { handlers.onMode?.(choice); return; }
    void act(target.getAttribute('data-mx-reader-action') ?? target.getAttribute('data-mx-reader-trigger') ?? '');
  };
  root.addEventListener('click', click);
  const stopEscape = closeOnEscape(() => handlers.setPanel(null));
  // The triggers say whether their panel is open, however it closed (scrim, Escape, an action inside it).
  createEffect(() => syncPanelTriggers(root, handlers.panel()));
  return { act, dispose: () => { root.removeEventListener('click', click); stopEscape(); } };
}

/**
 * Send a reaction (`on` = it is set now, so this press removes it). A sign-in refusal navigates to login
 * with the reaction as the carried intent; any other failure answers null and changes nothing.
 */
export async function sendReaction<T>(href: string, on: boolean, intent: 'like' | 'follow', navigate: Navigate = navigateAway): Promise<T | null> {
  try {
    const response = await apiFetch(href, on ? 'DELETE' : 'POST');
    if (await refusedForSignIn(response)) { navigate(loginHref(window.location, intent)); return null; }
    if (!response.ok) return null;
    const answer = await response.json() as T;
    pageDataChanged();
    return answer;
  } catch { return null; /* Keep the server's last known state. */ }
}

/** The rail's like/follow press: a signed-out reader goes to login; an answer redraws the control in place. */
export async function toggleReaction(chrome: HTMLElement, name: 'like' | 'follow', href: string | null, options: { signedIn: boolean; navigate?: Navigate }): Promise<void> {
  const navigate = options.navigate ?? navigateAway;
  if (!options.signedIn) { navigate(loginHref(window.location, name)); return; }
  if (!href || href.includes('/undefined/')) return;
  const control = chrome.querySelector<HTMLElement>(`[data-mx-reader-action="${name}"]`);
  const flag = name === 'like' ? 'data-mx-liked' : 'data-mx-following';
  const answer = await sendReaction<{ liked?: boolean; following?: boolean; count: number }>(href, control?.getAttribute(flag) === 'true', name, navigate);
  if (!answer || !control) return;
  const now = (name === 'like' ? answer.liked : answer.following) === true;
  // Drawn as lib/story/reader/reader-chrome draws the new state: label and tip agree, follow says so in words.
  const label = name === 'like' ? now ? 'Unlike' : 'Like' : `${now ? 'Unfollow' : 'Follow'} @${control.getAttribute('data-mx-author') ?? ''}`;
  control.setAttribute(flag, String(now));
  control.setAttribute('aria-label', label);
  control.setAttribute('data-mx-tip', label);
  if (name === 'follow') { control.textContent = now ? 'following' : 'follow'; return; }
  const count = control.querySelector('[data-mx-reader-count]');
  if (count) count.textContent = answer.count > 0 ? String(answer.count) : '';
}
