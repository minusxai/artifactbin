/**
 * A READER'S REACTION — like or follow — sent through its door: the document bar's like/follow controls
 * (solid/document/DocumentChrome) and the controls panel's LikeAction send through here, so a sign-in refusal
 * navigates to login with the reaction as the carried intent, and an answer tells the page data it changed.
 */
import { loginHref } from '@/lib/http/login-href';
import { refusedForSignIn } from '@artifactbin/contracts/sign-in-required';
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

export async function toggleDocumentLike(signedIn: boolean, id: string, liked: boolean) {
  if (!signedIn) { navigateAway(loginHref(window.location, 'like')); return null; }
  return sendReaction<{ liked: boolean; count: number }>(`/api/my/artifacts/${encodeURIComponent(id)}/like`, liked, 'like');
}

export async function toggleDocumentFollow(signedIn: boolean, userId: string, following: boolean) {
  if (!signedIn) { navigateAway(loginHref(window.location, 'follow')); return null; }
  return sendReaction<{ following: boolean; count: number }>(`/api/users/${encodeURIComponent(userId)}/follow`, following, 'follow');
}
