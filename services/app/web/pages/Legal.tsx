/** The two policy pages. Both are the same document renderer over lib/legal. */
import LegalDocument from '@/components/LegalDocument';

export const PrivacyPage = () => <LegalDocument slug="privacy" />;
export const TermsPage = () => <LegalDocument slug="terms" />;
