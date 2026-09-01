/**
 * THE HOSTED SERVICE'S POLICIES, as data.
 *
 * Adapted from MinusX, Inc.'s own privacy policy and terms (minusx.ai/privacy,
 * minusx.ai/terms) — same company, different product — and rewritten to
 * describe what artifactbin ACTUALLY does. The rewrite is the point: a policy
 * inherited whole would promise things this product has no mechanism for
 * (adtech cookies, subscriptions, model training) and stay silent about the
 * things it does that matter most (documents readable by anyone with a link,
 * tokens stored as hashes, a view counter that never keeps a raw IP).
 *
 * Every factual claim below is checkable against the code it describes:
 * lib/tokens (hashed, shown once), lib/codes (hashed, single-use, 5 guesses),
 * lib/analytics (the daily-rotating visitor hash — never a raw IP or UA),
 * lib/artifacts + canReadArtifact (the three visibilities), lib/config (the
 * only third parties: Resend, Mixpanel, an S3-compatible store).
 *
 * ONE SHAPE FOR BOTH DOCUMENTS, so the renderer cannot fork and a section
 * cannot exist in one and be styled differently in the other.
 *
 * SELF-HOSTERS ARE NOT COVERED, and both documents say so in their own words:
 * the software is Apache-2.0, so an instance somebody else runs is somebody
 * else's to answer for. That clause is the one thing MinusX's originals had no
 * reason to contain.
 */

export type LegalSlug = 'privacy' | 'terms';

export interface LegalSection {
  heading: string;
  /** Paragraphs, in order. */
  body?: string[];
  /** A list, rendered after the paragraphs. */
  bullets?: string[];
}

export interface LegalDoc {
  slug: LegalSlug;
  title: string;
  /** Shown under the title; the date the text last changed. */
  updated: string;
  /** The one-paragraph summary a reader gets before the sections. */
  lede: string;
  sections: LegalSection[];
}

const UPDATED = 'August 2026';
const ENTITY = 'MinusX, Inc.';
const SERVICE = 'artifactbin.dev';

const PRIVACY: LegalDoc = {
  slug: 'privacy',
  title: 'Privacy Policy',
  updated: UPDATED,
  lede: `${ENTITY} operates artifactbin, the hosted service at ${SERVICE}. This policy explains what we collect, why, and what you can ask us to do about it. We do not sell your personal information, and we do not train models on your content.`,
  sections: [
    {
      heading: 'Who this covers',
      body: [
        `This policy covers the hosted service at ${SERVICE}, operated by ${ENTITY}, a Delaware corporation.`,
        'artifactbin is open-source software under Apache-2.0. If you or your company run your own instance, we operate nothing, receive nothing, and this policy does not apply to it — the operator of that instance is the one responsible for the data on it.',
      ],
    },
    {
      heading: 'What we collect',
      bullets: [
        'Account: your email address. It is the only credential — we sign you in with a one-time code, so there is no password to store, leak, or reset. We also assign you a username, which you can change.',
        'What you publish: the documents, datasets and images you or your agent publish, every version of them, comments left on them, and who you shared them with.',
        'Agent tokens: stored only as a SHA-256 hash. The token itself is shown once, at creation, and we cannot recover it.',
        'Usage: one analytics row per view, holding the event, the document, your account id if you were signed in, and a guess at whether the reader was a browser or an agent, taken from the user-agent string.',
        'A visitor mark: a salted hash that rotates every day, used to count one person once. We do not store raw IP addresses or user-agent strings against your views, and the mark cannot be reversed or followed across days.',
        'Correspondence: what you send us at our contact addresses.',
        'Payment information: none. The hosted service is free and we collect no card or bank details.',
      ],
    },
    {
      heading: 'How we use it',
      bullets: [
        'To run the service: store your documents and serve them to the people you shared them with.',
        'To sign you in: send the one-time code to your email address.',
        'To show you your own numbers: the view counts and sparklines on your dashboard.',
        'To keep the service up: rate limits, abuse prevention, and debugging from server logs.',
        'To improve the product: aggregate usage patterns, in Mixpanel.',
        'To answer you when you write to us.',
      ],
    },
    {
      heading: 'Your content and AI models',
      body: [
        'We do not use your content to train models, and we do not send it to a model provider.',
        'artifactbin stores and serves what your agent publishes; the agent itself runs on your machine or on your provider, under their terms and their privacy policy, not ours. What your agent reads before it publishes, and what it sends where, is between you and whoever makes it.',
      ],
    },
    {
      heading: 'What is public, and what is not',
      body: [
        'Every document carries a visibility that you control, and it decides who can read it:',
      ],
      bullets: [
        'Private — you, and the email addresses you invite. The default for a document published under an account.',
        'Unlisted — anyone who has the link. Listed nowhere.',
        'Public — anyone who has the link, and listed on your public profile page.',
        'A public or unlisted address is readable by anyone who has it, including search engines that find it. Treat anything you publish as something that can leave your hands, and do not put in it what you would not put on the open web.',
      ],
    },
    {
      heading: 'Cookies and local storage',
      body: [
        'We use cookies to keep you signed in and nothing else. There are no advertising cookies, no ad network, and no cross-site tracking on this service.',
      ],
      bullets: [
        'A session cookie, httpOnly, that identifies your signed-in account.',
        'An agent-session cookie holding token identifiers — never the token secret itself — so a browser that minted a token can find its own drafts.',
        'Your theme choice and a few interface preferences, in your browser’s local storage. These never reach our servers.',
        'We honor Do Not Track: with that signal set, we do not load product analytics.',
      ],
    },
    {
      heading: 'Who else sees it',
      body: ['We share personal information only with the service providers that make the product work:'],
      bullets: [
        'Resend — receives your email address in order to deliver your login code.',
        'Mixpanel — receives product analytics events, including your account id and email if you are signed in.',
        'Our cloud host and an S3-compatible object store — hold the bytes of your documents, datasets and images.',
        'We may disclose information when a court order, subpoena, or law requires it; to enforce our Terms; or to protect the rights, property or safety of our users or the public.',
        'If the company is acquired or merged, information may transfer as part of that transaction, with notice to you beforehand.',
        'We do not sell, rent or trade personal information, to anyone, for any purpose.',
      ],
    },
    {
      heading: 'How long we keep it',
      bullets: [
        'Your account and its content: while your account exists.',
        'A document you delete: removed along with its stored versions.',
        'Analytics rows: kept in de-identified form. The visitor mark rotates daily and is not reversible, so old rows cannot be tied back to a person.',
        'Ask us to delete your account at privacy@minusx.ai and we remove the account and the content it owns, except where we are required to keep something by law.',
      ],
    },
    {
      heading: 'How we protect it',
      body: [
        'Traffic is served over TLS. Tokens are stored as hashes and shown once. Login codes are stored hashed, are single-use, expire, and are capped at five guesses — and they are never returned to the caller by any endpoint. There are no passwords in the system to be leaked. Object storage credentials are scoped to this application’s own prefix. Access by our staff is limited to people who need it to operate the service.',
        'No transmission or storage on the internet is completely secure, and we cannot guarantee that someone will not defeat these measures. If we become aware of a breach affecting your personal information, we will notify you by email or in the product within 72 hours of becoming aware of it.',
      ],
    },
    {
      heading: 'Where your data is held',
      body: [
        'We are based in the United States, and your information is stored and processed there. If you use the service from the European Economic Area, the United Kingdom, Canada or Brazil, you are consenting to that transfer, which we make under appropriate safeguards where the law requires them.',
      ],
    },
    {
      heading: 'Your rights',
      body: [
        'Wherever you live, you can write to privacy@minusx.ai and ask us to show you what we hold, correct it, delete it, restrict what we do with it, object to a use, or hand it to you in a portable form. We will not treat you differently for asking.',
        'If you are in the EEA or the UK, we process your information on these lawful bases: your consent, performance of our agreement with you, compliance with a legal obligation, and our legitimate interest in operating and improving the service. You may withdraw consent at any time.',
        'If you are in California, we do not sell your personal information as that term is defined in the CCPA, and you may exercise your rights to know, delete, and not be discriminated against by writing to the same address.',
        'If you are in Canada or Brazil, the rights PIPEDA and the LGPD give you are exercised the same way, at the same address.',
      ],
    },
    {
      heading: 'Children',
      body: [
        'The service is not for children under 13, and we do not knowingly collect their information. If you believe a child has given us personal information, write to privacy@minusx.ai and we will delete it.',
      ],
    },
    {
      heading: 'Changes to this policy',
      body: [
        'We may update this policy. When we make a material change we will say so by email or in the product before it takes effect, and the date above will change. Continuing to use the service after that means you accept the updated policy.',
      ],
    },
    {
      heading: 'Contact',
      body: [`Privacy Officer, ${ENTITY} — privacy@minusx.ai`],
    },
  ],
};

const TERMS: LegalDoc = {
  slug: 'terms',
  title: 'Terms of Service',
  updated: UPDATED,
  lede: `These terms govern the hosted service at ${SERVICE}, operated by ${ENTITY}. The artifactbin software itself is open source under Apache-2.0 and you are free to run it yourself — these terms are about the instance we run for you.`,
  sections: [
    {
      heading: 'Accepting these terms',
      body: [
        `By using ${SERVICE} — publishing to it, reading a document on it, or creating an account — you agree to these terms. If you do not agree, do not use it.`,
        'We may change these terms. We will give notice of a material change before it takes effect, and continuing to use the service afterwards is how you accept it.',
      ],
    },
    {
      heading: 'Who may use it',
      body: [
        'You must be at least 18 and able to enter a binding contract. If you are agreeing on behalf of a company, you are confirming you have the authority to bind it. You may not use the service if we have previously terminated your access.',
      ],
    },
    {
      heading: 'The software is open source; this service is not the software',
      body: [
        'artifactbin is licensed under Apache-2.0 and the source is public. That license governs what you may do with the code, including running your own instance, and nothing here limits it.',
        `These terms govern only the hosted instance at ${SERVICE}. If you run your own, these terms do not apply to it and we are not responsible for it.`,
      ],
    },
    {
      heading: 'Accounts and agent tokens',
      body: [
        'You sign in with your email address and a one-time code. Keep access to that mailbox secure; anyone who can read it can sign in as you.',
        'An agent token is a credential. Anything published with your token is treated as published by you, and you are responsible for it — including what an agent publishes without your close supervision. Tokens are shown once and stored only as hashes, so we cannot recover one for you; revoke it and mint another instead.',
        'A token minted without an account belongs to whoever holds it until it is claimed by an account. Claiming it transfers the documents it created to that account.',
      ],
    },
    {
      heading: 'What it costs',
      body: [
        'The hosted service is free today, and subject to rate limits that we may adjust to keep it available for everyone. There is no subscription and we collect no payment information. If we ever introduce paid plans, we will give notice before any charge, and the free tier will not become chargeable without your explicit agreement.',
      ],
    },
    {
      heading: 'Acceptable use',
      body: ['Do not use the service to:'],
      bullets: [
        'break the law, or help anyone else break it;',
        'publish material that infringes someone’s copyright, trademark, privacy or other rights;',
        'host phishing pages, malware, or anything designed to deceive or harm the person who opens it — a published document may run its own script, and that capability must not be turned on your readers;',
        'publish content that sexually exploits children, incites violence, or harasses a person;',
        'send spam, or use the service to distribute it;',
        'work around rate limits, quotas, or access controls, or attempt to read documents you were not given access to;',
        'bulk-scrape other people’s documents, or resell access to the service.',
      ],
    },
    {
      heading: 'Your content',
      body: [
        'You keep ownership of everything you publish. You give us the license we need to run the service: to store your content, serve it to the people you have shared it with, and display it back to you.',
        'We do not train models on your content and we do not sell it. We may look at a specific document when you ask us for support, or when we are investigating a report of abuse.',
        'You are responsible for having the rights to what you publish, including the data you upload and the images you import from other sites.',
      ],
    },
    {
      heading: 'Content your agent writes',
      body: [
        'Documents on this service are written by automated systems. We do not check them and we do not warrant that any of it is accurate, complete, current, or fit for a decision. Verify anything you are going to rely on or send to someone else.',
      ],
    },
    {
      heading: 'Our intellectual property',
      body: [
        'The artifactbin and MinusX names and logos are ours. The code is not — it is Apache-2.0, and the license file in the repository says what you may do with it.',
        'If you send us feedback or suggestions, we may use them without owing you anything for them.',
      ],
    },
    {
      heading: 'Availability',
      body: [
        'We aim to keep the service up and we will not always succeed. It is provided without a service-level commitment: we may take it down for maintenance, change how it works, or discontinue features. If we discontinue the hosted service altogether, we will give notice and time to export your content.',
      ],
    },
    {
      heading: 'Suspension and termination',
      body: [
        'You may stop using the service at any time and ask us to delete your account at privacy@minusx.ai.',
        'We may suspend or terminate access for a violation of these terms, for unlawful activity, or where we are required to. Where circumstances allow it, we will tell you why first. On termination your license to use the service ends and we may delete your content, except where we must keep it by law.',
      ],
    },
    {
      heading: 'Disclaimers',
      body: [
        'THE SERVICE IS PROVIDED “AS IS” AND “AS AVAILABLE”, WITHOUT WARRANTIES OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT. WE DO NOT WARRANT THAT THE SERVICE WILL BE UNINTERRUPTED, SECURE, OR ERROR-FREE.',
      ],
    },
    {
      heading: 'Limitation of liability',
      body: [
        'TO THE EXTENT THE LAW ALLOWS, MINUSX WILL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL OR PUNITIVE DAMAGES, OR FOR ANY LOSS OF PROFITS, DATA, OR BUSINESS OPPORTUNITY, ARISING OUT OF YOUR USE OF THE SERVICE.',
        'OUR TOTAL LIABILITY FOR ANY CLAIM RELATING TO THE SERVICE IS LIMITED TO THE GREATER OF ONE HUNDRED US DOLLARS OR THE AMOUNT YOU PAID US IN THE SIX MONTHS BEFORE THE CLAIM AROSE.',
      ],
    },
    {
      heading: 'Indemnification',
      body: [
        'You will indemnify and hold harmless MinusX, its affiliates, and their officers, employees and agents from claims, damages, liabilities and expenses arising out of your use of the service, the content you publish, or your breach of these terms.',
      ],
    },
    {
      heading: 'Copyright complaints',
      body: [
        'We respond to notices under the DMCA. Send them to dmca@minusx.ai with: identification of the work, the address of the material you say infringes it, your contact details, a statement of good-faith belief, a statement that the notice is accurate made under penalty of perjury, and your signature. Counter-notices go to the same address.',
      ],
    },
    {
      heading: 'Governing law and disputes',
      body: [
        'These terms are governed by the laws of the State of Delaware, without regard to its conflict-of-law rules.',
        'Any dispute will be resolved by binding arbitration in Delaware under the Commercial Arbitration Rules of the American Arbitration Association. You and MinusX each waive the right to a jury trial and to bring a claim as a class action or in a representative capacity.',
      ],
    },
    {
      heading: 'Everything else',
      body: [
        'We are not liable for delays or failures caused by events outside our reasonable control. You may not assign these terms without our written consent; we may assign them. If a provision is held invalid, the rest stays in force. Failing to enforce a provision is not a waiver of it. These terms, with the Privacy Policy, are the whole agreement between us about the service.',
      ],
    },
    {
      heading: 'Contact',
      body: ['legal@minusx.ai for these terms · support@minusx.ai for help · privacy@minusx.ai for your data'],
    },
  ],
};

export const LEGAL: Record<LegalSlug, LegalDoc> = { privacy: PRIVACY, terms: TERMS };
