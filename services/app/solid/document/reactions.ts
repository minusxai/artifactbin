/**
 * A READER'S REACTION — like or follow — sent through its door: the document bar's like/follow controls
 * (solid/document/DocumentChrome) and the controls panel's LikeAction send through here, so a sign-in refusal
 * navigates to login with the reaction as the carried intent, and an answer tells the page data it changed.
 */
import { loginHref } from '@/lib/http/login-href';
import { refusedForSignIn } from '@/lib/story/reader/sign-in-required';
import { pageDataChanged } from '@/solid/lib/page-data-events';
import { apiFetch } from '../lib/api';

type Navigate = (href: string) => void;
const navigateAway: Navigate = (href) => window.location.assign(href);

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
