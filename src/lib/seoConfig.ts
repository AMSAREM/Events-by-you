import type { EventItem } from '../types/events.ts';
import { formatEventDateSpan, isMultiDayEvent } from './eventDates.ts';

export const CANONICAL_ORIGIN = 'https://www.eventsbyyou.xyz';

export const STATIC_MARKETING_PATHS = [
  '/',
  '/features',
  '/pricing',
  '/how-it-works',
  '/faq',
  '/about',
  '/contact',
  '/blog',
  '/terms',
  '/privacy',
] as const;

export type StaticMarketingPath = (typeof STATIC_MARKETING_PATHS)[number];

export interface SeoConfigEntry {
  path: string;
  title: string;
  description: string;
  robots: 'index, follow' | 'noindex, nofollow';
  ogType: 'website' | 'article';
  ogImage?: string;
  jsonLd?: Record<string, unknown> | Record<string, unknown>[];
}

export const FAQ_ITEMS = [
  {
    question: 'How fast are SMS ticket passes delivered across Ghana networks?',
    answer:
      'Events By You routes transactional passes through Arkesel v2 direct carrier connections across MTN Ghana, Telecel, and AT in under 3.2 seconds, paired with Resend email pass delivery.',
  },
  {
    question: 'Does gate QR check-in still work if venue WiFi or mobile data drops?',
    answer:
      'Yes. Events By You is an installable Progressive Web App that caches the verified attendee manifest in IndexedDB so volunteer gate scanners validate passes and block duplicates offline.',
  },
  {
    question: 'How much does Events By You cost in Ghana Cedis (GHS)?',
    answer:
      'The Starter tier is GHS 0 forever for 1 active event with 20 starter SMS credits. Pro Organizer starts at $15/mo billed annually (approx. GHS 230/mo) or $19/mo monthly (approx. GHS 290/mo), with prepaid SMS bundles from GHS 25.',
  },
  {
    question: 'Why is the Gift Table on a separate /e/slug/gifts link?',
    answer:
      'Separating the Gift Table from registration and gate check-in lets appointed gift table attendants record Mobile Money transfers, cash envelopes, and registry pledges without accessing the organiser studio.',
  },
  {
    question: 'How does the 35mm Event Disposable Camera unlock for attendees?',
    answer:
      'Checked-in guests receive an exclusive camera pass link on their pass and SMS confirmation. Each verified guest pass unlocks 5 film shots on the shared event roll without app store downloads.',
  },
  {
    question: 'How do organisers protect private or invitation-only events?',
    answer:
      'Organisers can enable circle validation (such as Family, Friends, or VIP), require an invite code, enforce one unique E.164 phone registration per guest, or keep events in draft status until ready.',
  },
] as const;

export const BLOG_ARTICLES = [
  {
    slug: 'sub-3s-sms-ticketing-ghana',
    title: 'Why Sub-3s SMS Ticket Delivery Beats Email Attachments at Accra Venues',
    date: '2026-11-10',
    isoDate: '2026-11-10',
    readTime: '4 min read',
    category: 'Telecom & Delivery',
    excerpt:
      'How GSM-7 optimized Arkesel SMS tokens eliminate entrance bottlenecks when guests arrive at conference centres without mobile data or PDF viewers.',
    takeaways: [
      'Feature phones and low-signal basements still receive plain SMS tokens reliably.',
      'Auto-normalizing local numbers like 024 412 3456 to +233 prevents bounce failures.',
      'Custom Ghana NCA-compliant Sender IDs increase guest open and gate trust rates.',
    ],
  },
  {
    slug: 'offline-qr-turnstile-anti-passback',
    title: 'Preventing Gate Passback at 2,000-Guest Church Conventions & Concerts',
    date: '2026-11-02',
    isoDate: '2026-11-02',
    readTime: '5 min read',
    category: 'Gate Operations',
    excerpt:
      'A practical guide to equipping volunteer ushers with offline-ready PWA camera scanners and strict single-entry QR token verification.',
    takeaways: [
      'Each QR pass encodes a unique server-verified token burned on first scan.',
      'IndexedDB offline manifests keep check-in velocity near 45 guests per minute per gate.',
      'Duplicate scan attempts flash an instant visual warning for gatekeepers.',
    ],
  },
  {
    slug: 'separating-gift-desk-from-organiser-studio',
    title: 'Separating the Wedding Gift Desk Ledger from Your Organiser Studio',
    date: '2026-10-21',
    isoDate: '2026-10-21',
    readTime: '3 min read',
    category: 'Weddings & Memorials',
    excerpt:
      'Appoint dedicated gift table personnel with scoped desk links (/e/slug/gifts?desk=...) while keeping sensitive attendee lists and billing private.',
    takeaways: [
      'Gift table attendants only view and record pledges attributed to their appointed desk.',
      'Organisers export reconciled GHS and USD cash, MoMo, and registry ledgers in Studio.',
      'Gate check-in stays fast because gift pledging lives cleanly on its own portal.',
    ],
  },
  {
    slug: '35mm-disposable-camera-guest-rolls',
    title: 'Running a Shared 35mm Event Disposable Camera Roll Without App Downloads',
    date: '2026-10-12',
    isoDate: '2026-10-12',
    readTime: '4 min read',
    category: 'Guest Experience',
    excerpt:
      'Turn every guest pass into 5 curated shots on Kodak Gold, Ilford B&W, Fuji C200, or CineStill 800T film presets—with optional darkroom reveal.',
    takeaways: [
      'Check-in passes automatically scope the 5-shot quota per verified attendee.',
      'Darkroom mode builds anticipation before releasing the developed gallery.',
      'Export full A4 contact-sheet printouts directly from the film lab view.',
    ],
  },
] as const;

export const MARKETING_SEO: Record<StaticMarketingPath, SeoConfigEntry> = {
  '/': {
    path: '/',
    title: 'Events By You — Event Registration & SMS Passes in Ghana',
    description:
      'Create weddings, church programs, concerts, and summits in Ghana with instant Arkesel SMS passes, QR gate check-in, and standalone gift tables online.',
    robots: 'index, follow',
    ogType: 'website',
    jsonLd: [
      {
        '@context': 'https://schema.org',
        '@type': 'WebApplication',
        name: 'Events By You',
        url: `${CANONICAL_ORIGIN}/`,
        applicationCategory: 'BusinessApplication',
        operatingSystem: 'All',
        inLanguage: 'en-GH',
        description:
          'Event registration, ticketing, Arkesel SMS pass delivery, standalone gift table, 35mm disposable camera, and offline QR gate check-in.',
        offers: {
          '@type': 'Offer',
          price: '0',
          priceCurrency: 'GHS',
        },
      },
      {
        '@context': 'https://schema.org',
        '@type': 'Organization',
        name: 'Events By You',
        url: CANONICAL_ORIGIN,
        email: 'support@eventsbyyou.xyz',
        areaServed: ['GH', 'NG', 'KE', 'RW'],
      },
    ],
  },
  '/features': {
    path: '/features',
    title: 'Platform Features — QR Check-In & SMS | Events By You',
    description:
      'Explore Arkesel SMS passes, offline QR gate scanners, circle RSVP validation, 35mm guest disposable cameras, and standalone gift tables on Events By You.',
    robots: 'index, follow',
    ogType: 'website',
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: 'Events By You Platform',
      applicationCategory: 'EventManagementApplication',
      operatingSystem: 'Web, iOS PWA, Android PWA',
      url: `${CANONICAL_ORIGIN}/features`,
      featureList: [
        'Fullscreen Check-In & QR Pass Screen',
        'Guest Circle Validation & Custom RSVP Forms',
        '35mm Event Disposable Camera Roll',
        'Standalone Gift Table & Appointed Desk Portal',
        'Arkesel v2 SMS & Resend Email Delivery',
        'Offline IndexedDB Gate Scanner PWA',
      ],
    },
  },
  '/pricing': {
    path: '/pricing',
    title: 'Pricing Plans in GHS & USD | Events By You Ticketing',
    description:
      'Start hosting events free or upgrade to Pro Organizer in GHS or USD for custom SMS Sender IDs, unlimited attendees, CSV exports, and branded gate passes.',
    robots: 'index, follow',
    ogType: 'website',
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: 'Events By You Organiser Plans',
      description:
        'Starter and Pro Organizer event registration, SMS ticketing, and QR check-in subscriptions in Ghana.',
      url: `${CANONICAL_ORIGIN}/pricing`,
      offers: [
        {
          '@type': 'Offer',
          name: 'Free Starter Tier',
          price: '0',
          priceCurrency: 'GHS',
          availability: 'https://schema.org/InStock',
        },
        {
          '@type': 'Offer',
          name: 'Pro Organizer Monthly',
          price: '290',
          priceCurrency: 'GHS',
          availability: 'https://schema.org/InStock',
        },
        {
          '@type': 'Offer',
          name: 'Pro Organizer Annual Monthly Equivalent',
          price: '230',
          priceCurrency: 'GHS',
          availability: 'https://schema.org/InStock',
        },
      ],
    },
  },
  '/how-it-works': {
    path: '/how-it-works',
    title: 'How It Works — 3-Step Event Setup | Events By You GH',
    description:
      'Publish a branded /e/slug event page in two minutes, deliver Arkesel SMS and email QR passes in seconds, and scan guests offline at the venue gate.',
    robots: 'index, follow',
    ogType: 'website',
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'HowTo',
      name: 'How to launch and check in an event with Events By You',
      description:
        'Create an event slug, distribute validated RSVP & gift links, and verify QR tickets offline.',
      step: [
        {
          '@type': 'HowToStep',
          position: 1,
          name: 'Create & Publish in 2 Minutes',
          text: 'Upload your event flyer, set venue schedule blocks, configure custom forms, and generate a clean /e/slug URL.',
        },
        {
          '@type': 'HowToStep',
          position: 2,
          name: 'Collect Validated RSVPs & Gift Pledges',
          text: 'Attendees normalize phone numbers to E.164 format, validate their guest circle, and use the standalone gift table link.',
        },
        {
          '@type': 'HowToStep',
          position: 3,
          name: 'Deliver SMS QR Passes & Scan Offline',
          text: 'Dispatch Arkesel SMS and Resend email passes in under 3.2 seconds and scan entries with anti-passback protection.',
        },
      ],
    },
  },
  '/faq': {
    path: '/faq',
    title: 'Frequently Asked Questions | Events By You Ghana Help',
    description:
      'Answers on Arkesel SMS ticketing in Ghana, offline QR gate check-in, standalone gift desk portals, disposable guest film rolls, and GHS billing plans.',
    robots: 'index, follow',
    ogType: 'website',
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: FAQ_ITEMS.map((item) => ({
        '@type': 'Question',
        name: item.question,
        acceptedAnswer: {
          '@type': 'Answer',
          text: item.answer,
        },
      })),
    },
  },
  '/about': {
    path: '/about',
    title: 'About Events By You — Ghana Event Infrastructure Hub',
    description:
      'Learn how Events By You powers reliable registration, Ghana NCA-aligned SMS delivery, and offline gate check-in for weddings, churches, and summits.',
    robots: 'index, follow',
    ogType: 'website',
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'AboutPage',
      name: 'About Events By You',
      url: `${CANONICAL_ORIGIN}/about`,
      mainEntity: {
        '@type': 'Organization',
        name: 'Events By You Inc.',
        foundingLocation: 'Accra, Ghana',
        areaServed: ['Ghana', 'Nigeria', 'Kenya', 'Rwanda'],
      },
    },
  },
  '/contact': {
    path: '/contact',
    title: 'Contact Support & Sales | Events By You Ghana Studio',
    description:
      'Reach the Events By You team in Accra for organiser onboarding, Arkesel Sender ID registration, enterprise summits, and dedicated event gate support.',
    robots: 'index, follow',
    ogType: 'website',
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'ContactPage',
      name: 'Contact Events By You',
      url: `${CANONICAL_ORIGIN}/contact`,
      mainEntity: {
        '@type': 'Organization',
        name: 'Events By You Inc.',
        email: 'support@eventsbyyou.xyz',
      },
    },
  },
  '/blog': {
    path: '/blog',
    title: 'Event Guides & Organiser Blog | Events By You Ghana',
    description:
      'Playbooks for Ghanaian event organisers covering fast SMS ticket delivery, QR turnstile anti-passback, separate gift desks, and 35mm disposable rolls.',
    robots: 'index, follow',
    ogType: 'website',
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'Blog',
      name: 'Events By You Organiser Blog',
      url: `${CANONICAL_ORIGIN}/blog`,
      blogPost: BLOG_ARTICLES.map((post) => ({
        '@type': 'BlogPosting',
        headline: post.title,
        datePublished: post.isoDate,
        description: post.excerpt,
      })),
    },
  },
  '/terms': {
    path: '/terms',
    title: 'Terms & Conditions of Service | Events By You Ghana',
    description:
      'Read the Events By You terms of service covering organiser accounts, multi-tenant data isolation, Arkesel SMS compliance, billing, and uptime rules.',
    robots: 'index, follow',
    ogType: 'website',
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'WebPage',
      name: 'Terms & Conditions of Service',
      url: `${CANONICAL_ORIGIN}/terms`,
    },
  },
  '/privacy': {
    path: '/privacy',
    title: 'Privacy & Data Protection Policy | Events By You GH',
    description:
      'Review how Events By You protects guest registration data, E.164 phone numbers, disposable camera photos, and tenant isolation across Ghana events.',
    robots: 'index, follow',
    ogType: 'website',
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'WebPage',
      name: 'Privacy & Data Protection Policy',
      url: `${CANONICAL_ORIGIN}/privacy`,
    },
  },
};

export const NOINDEX_ROUTE_SEO = {
  signin: {
    path: '/signin',
    title: 'Organiser Sign In | Events By You Ghana Event Studio',
    description:
      'Sign in to your Events By You organiser workspace to manage events, dispatch Arkesel SMS passes, scan gate QR tickets, and track attendance live.',
    robots: 'noindex, nofollow' as const,
    ogType: 'website' as const,
  },
  signup: {
    path: '/signup',
    title: 'Create Organiser Account | Events By You Ghana Studio',
    description:
      'Register for an Events By You organiser studio account to launch event RSVP pages, custom SMS Sender IDs, offline QR check-in, and gift table portals.',
    robots: 'noindex, nofollow' as const,
    ogType: 'website' as const,
  },
  resetPassword: {
    path: '/reset-password',
    title: 'Reset Organiser Password | Events By You Ghana Studio',
    description:
      'Recover access to your Events By You organiser account with verified Arkesel SMS or email one-time password authentication in Ghana.',
    robots: 'noindex, nofollow' as const,
    ogType: 'website' as const,
  },
  verifyOtp: {
    path: '/verify-otp',
    title: 'Verify One-Time Code | Events By You Organiser Access',
    description:
      'Enter your six-digit verification code sent via Arkesel SMS or email to complete organiser authentication in Events By You Studio.',
    robots: 'noindex, nofollow' as const,
    ogType: 'website' as const,
  },
  studio: {
    path: '/studio',
    title: 'Organiser Creator Studio | Events By You Ghana Portal',
    description:
      'Manage live events, Arkesel SMS broadcasts, gate check-in scans, disposable film rolls, CSV guest exports, and billing inside Events By You Studio.',
    robots: 'noindex, nofollow' as const,
    ogType: 'website' as const,
  },
  camera: {
    path: '/camera',
    title: 'Event 35mm Disposable Camera | Events By You Moments',
    description:
      'Capture and view authentic 35mm film-style moments from an Events By You gathering using your verified attendee check-in pass and camera film roll.',
    robots: 'noindex, nofollow' as const,
    ogType: 'website' as const,
  },
  notFound: {
    path: '/404',
    title: 'Page Not Found (404) | Events By You Ghana Ticketing',
    description:
      'The requested page or event could not be found on Events By You. Explore upcoming gatherings, pricing plans, and organiser tools in Ghana.',
    robots: 'noindex, nofollow' as const,
    ogType: 'website' as const,
  },
};

export function clampSeoLength(input: string, max: number): string {
  const clean = input.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const slice = clean.slice(0, max - 1);
  const lastSpace = slice.lastIndexOf(' ');
  return `${(lastSpace > Math.floor(max * 0.55) ? slice.slice(0, lastSpace) : slice).trim()}…`;
}

export function formatPriceGhsLabel(ticketPrice: number): string {
  const numeric = Number(ticketPrice) || 0;
  if (numeric <= 0) return 'Free Entry (GHS 0.00)';
  return `GHS ${numeric.toLocaleString('en-GH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function isPublicIndexableEvent(
  event: EventItem & { unlisted?: boolean; visibility?: string }
): boolean {
  if (!event) return false;
  if (event.status === 'draft') return false;
  if (event.unlisted === true || event.visibility === 'unlisted') return false;
  return true;
}

export function resolveEventFlyerImageUrl(event: EventItem, baseUrl: string): string {
  const cleanOrigin = baseUrl.replace(/\/+$/, '');
  const cleanSlug = encodeURIComponent(event.slug || event.id);
  const rawFlyer = (event.flyerUrl || '').trim();
  if (rawFlyer) {
    if (/^https?:\/\//i.test(rawFlyer)) {
      return rawFlyer;
    }
    if (rawFlyer.startsWith('/')) {
      return `${cleanOrigin}${rawFlyer}`;
    }
  }
  return `${cleanOrigin}/api/og/event/${cleanSlug}`;
}

export function buildEventSeoPayload(
  event: EventItem & { unlisted?: boolean; visibility?: string },
  baseUrl: string,
  subPath: 'top' | 'checkin' | 'gifts' | 'camera' = 'top'
): SeoConfigEntry {
  const cleanOrigin = baseUrl.replace(/\/+$/, '');
  const cleanSlug = encodeURIComponent(event.slug || event.id);
  const pathSuffix =
    subPath === 'checkin'
      ? `/e/${cleanSlug}/checkin`
      : subPath === 'gifts'
        ? `/e/${cleanSlug}/gifts`
        : subPath === 'camera'
          ? `/e/${cleanSlug}/camera`
          : `/e/${cleanSlug}`;
  const canonicalUrl = `${cleanOrigin}${pathSuffix}`;
  const priceGhs = formatPriceGhsLabel(event.ticketPrice);
  const suffixLabel =
    subPath === 'checkin'
      ? 'Check-In'
      : subPath === 'gifts'
        ? 'Gift Table'
        : 'Events By You';

  const displayDate = formatEventDateSpan(event.isoDate, event.endIsoDate, event.date);
  const rawTitle = `${event.title} (${event.city}) | ${suffixLabel}`;
  const title =
    rawTitle.length >= 50 && rawTitle.length <= 60
      ? rawTitle
      : clampSeoLength(
          rawTitle.length < 50
            ? `${event.title} — ${displayDate} · ${event.city} | ${suffixLabel}`
            : rawTitle,
          60
        );

  const rawDesc =
    `${event.organizer} hosts ${event.title} on ${displayDate}${event.time ? ` at ${event.time}` : ''} at ${event.venue}, ${event.city}. ` +
    `Tickets: ${priceGhs}. ${event.subtitle || 'Register online for instant SMS & QR passes.'}`;
  const description = clampSeoLength(rawDesc, 160);

  const indexable = isPublicIndexableEvent(event) && subPath !== 'camera';
  const flyerImage = resolveEventFlyerImageUrl(event, cleanOrigin);

  const attendanceMode =
    event.venueFormat === 'virtual'
      ? 'https://schema.org/OnlineEventAttendanceMode'
      : event.venueFormat === 'hybrid'
        ? 'https://schema.org/MixedEventAttendanceMode'
        : 'https://schema.org/OfflineEventAttendanceMode';

  const eventStatus =
    event.status === 'past'
      ? 'https://schema.org/EventScheduled'
      : 'https://schema.org/EventScheduled';

  const location =
    event.venueFormat === 'virtual'
      ? {
          '@type': 'VirtualLocation',
          url: canonicalUrl,
        }
      : {
          '@type': 'Place',
          name: event.venue,
          address: {
            '@type': 'PostalAddress',
            addressLocality: event.city,
            addressCountry: 'GH',
          },
        };

  const jsonLd: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Event',
    name: event.title,
    description: event.subtitle || description,
    startDate: event.isoDate || undefined,
    ...(isMultiDayEvent(event) && event.endIsoDate ? { endDate: event.endIsoDate } : {}),
    eventAttendanceMode: attendanceMode,
    eventStatus,
    image: [flyerImage],
    url: canonicalUrl,
    location,
    organizer: {
      '@type': 'Organization',
      name: event.organizer || 'Events By You Organiser',
      url: canonicalUrl,
    },
    offers: {
      '@type': 'Offer',
      url: `${cleanOrigin}/e/${cleanSlug}?tab=register`,
      price: String(Number(event.ticketPrice) > 0 ? Number(event.ticketPrice) : 0),
      priceCurrency: 'GHS',
      availability:
        event.registered < event.capacity
          ? 'https://schema.org/InStock'
          : 'https://schema.org/SoldOut',
    },
  };

  return {
    path: pathSuffix,
    title,
    description,
    robots: indexable ? 'index, follow' : 'noindex, nofollow',
    ogType: 'website',
    ogImage: flyerImage,
    jsonLd,
  };
}
