import type { DesignTheme, EventItem } from '../src/types/events.ts';
import { getCategoryPreset } from '../src/data/initialData.ts';
import { getContrastTextColor, normalizeHexColor } from '../src/lib/themeColors.ts';
import {
  buildEventSeoPayload,
  formatPriceGhsLabel,
  isPublicIndexableEvent,
  NOINDEX_ROUTE_SEO,
} from '../src/lib/seoConfig.ts';
import { formatEventDateSpan, formatEventDurationBadge } from '../src/lib/eventDates.ts';

export function escapeXml(str: string): string {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function escapeHtml(str: string): string {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function serializeJsonLdSafe(data: Record<string, unknown> | Record<string, unknown>[]): string {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}

function wrapLines(text: string, maxChars: number, maxLines: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxChars) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      current = word;
      if (lines.length === maxLines) break;
    }
  }
  if (current && lines.length < maxLines) {
    lines.push(current);
  }
  if (lines.length === maxLines && words.join(' ').length > lines.join(' ').length) {
    lines[maxLines - 1] = lines[maxLines - 1].replace(/[.,;:\s]*$/, '') + '…';
  }
  return lines;
}

const OG_THEME_PALETTE: Record<
  DesignTheme,
  {
    bg: string;
    cardBg: string;
    border: string;
    accent: string;
    accentText: string;
    textPrimary: string;
    textMuted: string;
  }
> = {
  'editorial-ivory': {
    bg: '#161412',
    cardBg: '#F6F1E9',
    border: '#D7CEC1',
    accent: '#161412',
    accentText: '#F6F1E9',
    textPrimary: '#161412',
    textMuted: '#635C52',
  },
  'obsidian-gold': {
    bg: '#09090B',
    cardBg: '#121216',
    border: '#D4AF37',
    accent: '#D4AF37',
    accentText: '#09090B',
    textPrimary: '#FFFFFF',
    textMuted: '#A1A1AA',
  },
  'swiss-grid': {
    bg: '#0B0B0B',
    cardBg: '#FFFFFF',
    border: '#E5E5EA',
    accent: '#0B0B0B',
    accentText: '#FFFFFF',
    textPrimary: '#0B0B0B',
    textMuted: '#52525B',
  },
  'warm-monochrome': {
    bg: '#141416',
    cardBg: '#1C1C20',
    border: '#3F3F46',
    accent: '#F4F4F5',
    accentText: '#0B0B0B',
    textPrimary: '#FFFFFF',
    textMuted: '#A1A1AA',
  },
};

export function buildEventOgSvg(event: EventItem, baseUrl: string): string {
  const preset = getCategoryPreset(event.category);
  const theme: DesignTheme = event.designTheme || preset.designTheme || 'obsidian-gold';
  const basePalette = OG_THEME_PALETTE[theme];
  const customBrand = normalizeHexColor(event.brandColor ?? event.extraDataConfig?.brandColor);
  const palette = customBrand
    ? {
        ...basePalette,
        border: customBrand,
        accent: customBrand,
        accentText: getContrastTextColor(customBrand),
      }
    : basePalette;

  const titleLines = wrapLines(event.title, 30, 3);
  const subtitleLines = wrapLines(event.subtitle || 'Hosted with Events By You', 58, 2);
  const inviteShort = `${baseUrl.replace(/^https?:\/\//, '')}/e/${event.slug || event.id}`;
  const priceLabel = event.ticketPrice > 0 ? `GHS ${event.ticketPrice} PASS` : 'FREE RSVP PASS';
  const extraFeatureLabel =
    event.extraDataConfig?.enableGiftTable
      ? 'VALIDATION + GIFT TABLE + QR'
      : event.validationConfig?.enabled
        ? 'VALIDATED RSVP + QR PASS'
        : 'INSTANT SMS + QR PASS';

  // Deterministic geometric pattern seed for poster crest
  const seedStr = `${event.id}-${event.slug}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < seedStr.length; i++) {
    hash ^= seedStr.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }

  const miniSquares: string[] = [];
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      const bit = ((hash >>> ((r * 9 + c) % 24)) + r * 3 + c * 5) % 3 === 0;
      const isCorner = (r < 3 && c < 3) || (r < 3 && c > 5) || (r > 5 && c < 3);
      if (isCorner || bit) {
        miniSquares.push(
          `<rect x="${c * 14}" y="${r * 14}" width="11" height="11" rx="2" fill="${palette.textPrimary}" opacity="${isCorner ? 1 : 0.85}" />`
        );
      }
    }
  }

  const embeddedFlyer =
    event.flyerUrl && /^data:image\/(png|jpe?g|webp);base64,/i.test(event.flyerUrl)
      ? event.flyerUrl
      : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
      <path d="M 40 0 L 0 0 0 40" fill="none" stroke="${palette.border}" stroke-width="0.6" stroke-opacity="0.22" />
    </pattern>
    <clipPath id="cardClip">
      <rect x="36" y="36" width="1128" height="558" rx="32" />
    </clipPath>
  </defs>

  <rect width="1200" height="630" fill="${palette.bg}" />
  <rect width="1200" height="630" fill="url(#grid)" />

  <!-- Outer Editorial Frame -->
  <rect x="36" y="36" width="1128" height="558" rx="32" fill="${palette.cardBg}" stroke="${palette.border}" stroke-width="2" />
  ${
    embeddedFlyer
      ? `<image href="${escapeXml(embeddedFlyer)}" x="36" y="36" width="1128" height="558" preserveAspectRatio="xMidYMid slice" opacity="0.16" clip-path="url(#cardClip)" />`
      : ''
  }
  <rect x="52" y="52" width="1096" height="526" rx="22" fill="none" stroke="${palette.border}" stroke-opacity="0.35" stroke-width="1" />

  <!-- Top Strip: Category Pill & Price Seal -->
  <g transform="translate(84, 84)">
    <rect x="0" y="0" width="150" height="38" rx="19" fill="${palette.accent}" />
    <text x="75" y="24" text-anchor="middle" font-family="'Plus Jakarta Sans', 'Inter', Arial, sans-serif" font-size="13" font-weight="700" letter-spacing="2" fill="${palette.accentText}">${escapeXml(event.category.toUpperCase())}</text>

    <rect x="164" y="0" width="230" height="38" rx="19" fill="none" stroke="${palette.border}" stroke-opacity="0.7" stroke-width="1.5" />
    <text x="279" y="24" text-anchor="middle" font-family="'JetBrains Mono', monospace" font-size="12" font-weight="600" letter-spacing="1" fill="${palette.textPrimary}">${escapeXml(extraFeatureLabel)}</text>
  </g>

  <g transform="translate(920, 84)">
    <rect x="0" y="0" width="196" height="38" rx="19" fill="${palette.accent}" fill-opacity="0.14" stroke="${palette.border}" stroke-opacity="0.55" stroke-width="1.5" />
    <text x="98" y="24" text-anchor="middle" font-family="'JetBrains Mono', monospace" font-size="13" font-weight="700" fill="${palette.textPrimary}">${escapeXml(priceLabel)}</text>
  </g>

  <!-- Left Content Column -->
  <text x="84" y="168" font-family="'JetBrains Mono', monospace" font-size="14" font-weight="600" letter-spacing="3" fill="${palette.textMuted}">${escapeXml((event.organizer || 'EVENTS BY YOU').toUpperCase())} PRESENTS</text>

  ${titleLines
    .map(
      (line, idx) =>
        `<text x="84" y="${230 + idx * 60}" font-family="'Plus Jakarta Sans', 'Inter', Arial, sans-serif" font-size="50" font-weight="800" letter-spacing="-1.2" fill="${palette.textPrimary}">${escapeXml(line)}</text>`
    )
    .join('\n  ')}

  ${subtitleLines
    .map(
      (line, idx) =>
        `<text x="84" y="${418 + idx * 28}" font-family="'DM Sans', Arial, sans-serif" font-size="20" font-weight="400" fill="${palette.textMuted}">${escapeXml(line)}</text>`
    )
    .join('\n  ')}

  <!-- Right Check-In QR Seal Card -->
  <g transform="translate(888, 168)">
    <rect x="0" y="0" width="228" height="278" rx="24" fill="${palette.bg}" stroke="${palette.border}" stroke-opacity="0.5" stroke-width="1.5" />
    <rect x="46" y="34" width="136" height="136" rx="14" fill="${palette.cardBg}" />
    <g transform="translate(52, 40)">
      ${miniSquares.join('')}
    </g>
    <text x="114" y="205" text-anchor="middle" font-family="'Plus Jakarta Sans', Arial, sans-serif" font-size="15" font-weight="700" fill="#FFFFFF">RSVP &amp; CHECK-IN</text>
    <text x="114" y="229" text-anchor="middle" font-family="'JetBrains Mono', monospace" font-size="12" fill="#A1A1AA">${escapeXml(event.registered + ' / ' + event.capacity + ' PASSES')}</text>
    <text x="114" y="255" text-anchor="middle" font-family="'JetBrains Mono', monospace" font-size="11" font-weight="600" fill="${palette.accent}">${escapeXml(event.status.toUpperCase())}</text>
  </g>

  <!-- Footer Event Meta Bar -->
  <line x1="84" y1="490" x2="1116" y2="490" stroke="${palette.border}" stroke-opacity="0.4" stroke-width="1" />

  <text x="84" y="524" font-family="'JetBrains Mono', monospace" font-size="12" font-weight="600" letter-spacing="1.5" fill="${palette.textMuted}">DATE &amp; TIME</text>
  <text x="84" y="550" font-family="'Plus Jakarta Sans', Arial, sans-serif" font-size="18" font-weight="700" fill="${palette.textPrimary}">${escapeXml(`${formatEventDateSpan(event.isoDate, event.endIsoDate, event.date)} · ${event.time}`)}</text>

  <text x="470" y="524" font-family="'JetBrains Mono', monospace" font-size="12" font-weight="600" letter-spacing="1.5" fill="${palette.textMuted}">VENUE</text>
  <text x="470" y="550" font-family="'Plus Jakarta Sans', Arial, sans-serif" font-size="18" font-weight="700" fill="${palette.textPrimary}">${escapeXml(`${event.venue}, ${event.city}`)}</text>

  <text x="1116" y="550" text-anchor="end" font-family="'JetBrains Mono', monospace" font-size="14" font-weight="600" fill="${palette.textMuted}">${escapeXml(inviteShort)}</text>
</svg>`;
}

export type PublicEventSubPath = 'top' | 'checkin' | 'gifts' | 'camera';

function replaceRootContainer(html: string, innerHtml: string): string {
  const openMatch = /<div\b[^>]*\bid=["']root["'][^>]*>/i.exec(html);
  if (!openMatch || openMatch.index === undefined) return html;
  const openStart = openMatch.index;
  const contentStart = openStart + openMatch[0].length;
  const tagRegex = /<\/?div\b[^>]*>/gi;
  tagRegex.lastIndex = contentStart;
  let depth = 1;
  let match: RegExpExecArray | null;
  while ((match = tagRegex.exec(html)) !== null) {
    if (match[0].startsWith('</')) {
      depth -= 1;
      if (depth === 0) {
        const closeEnd = match.index + match[0].length;
        return `${html.slice(0, openStart)}<div id="root">${innerHtml}</div>${html.slice(closeEnd)}`;
      }
    } else if (!match[0].endsWith('/>')) {
      depth += 1;
    }
  }
  return html;
}

function replaceHeadAndRoot(
  html: string,
  opts: {
    title: string;
    description: string;
    robots: string;
    canonicalUrl: string;
    ogTags: string[];
    jsonLd?: Record<string, unknown> | Record<string, unknown>[];
    rootInnerHtml: string;
  }
): string {
  const safeTitle = escapeXml(opts.title);
  const safeDesc = escapeXml(opts.description);
  const safeRobots = escapeXml(opts.robots);
  const safeUrl = escapeXml(opts.canonicalUrl);

  let updated = html;

  // Strip ALL pre-existing title, description, robots, canonical, OG, Twitter, and JSON-LD tags
  // (including data-rh="true" tags produced by vite-react-ssg / react-helmet-async)
  updated = updated.replace(/<title\b[^>]*>[\s\S]*?<\/title>\s*/gi, '');
  updated = updated.replace(/<meta\b[^>]*\bname=["'](?:description|robots)["'][^>]*>\s*/gi, '');
  updated = updated.replace(/<link\b[^>]*\brel=["']canonical["'][^>]*>\s*/gi, '');
  updated = updated.replace(/<meta\b[^>]*\b(?:property|name)=["'](?:og:|twitter:)[^"']+["'][^>]*>\s*/gi, '');
  updated = updated.replace(/<script\b[^>]*\btype=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>\s*/gi, '');

  const headInjections = [
    `    <title>${safeTitle}</title>`,
    `    <meta name="description" content="${safeDesc}" />`,
    `    <meta name="robots" content="${safeRobots}" />`,
    `    <link rel="canonical" href="${safeUrl}" />`,
    ...opts.ogTags,
    opts.jsonLd ? `    <script type="application/ld+json">${serializeJsonLdSafe(opts.jsonLd)}</script>` : '',
  ]
    .filter(Boolean)
    .join('\n');

  updated = updated.replace(/<\/head>/i, `${headInjections}\n  </head>`);
  updated = replaceRootContainer(updated, opts.rootInnerHtml);

  return updated;
}

export function injectEventMetaTags(
  html: string,
  event: EventItem & { unlisted?: boolean; visibility?: string },
  baseUrl: string,
  subPath: PublicEventSubPath = 'top'
): string {
  const cleanOrigin = baseUrl.replace(/\/+$/, '');
  const cleanSlug = encodeURIComponent(event.slug || event.id);
  const seo = buildEventSeoPayload(event, cleanOrigin, subPath);
  const canonicalUrl = `${cleanOrigin}${seo.path}`;
  const ogImageUrl = seo.ogImage || `${cleanOrigin}/api/og/event/${cleanSlug}`;
  const priceGhs = formatPriceGhsLabel(event.ticketPrice);
  const indexable = isPublicIndexableEvent(event) && subPath !== 'camera';

  const safeTitle = escapeXml(seo.title);
  const safeDesc = escapeXml(seo.description);
  const safeUrl = escapeXml(canonicalUrl);
  const safeImg = escapeXml(ogImageUrl);

  const ogTags = [
    `    <meta property="og:title" content="${safeTitle}" />`,
    `    <meta property="og:description" content="${safeDesc}" />`,
    `    <meta property="og:type" content="website" />`,
    `    <meta property="og:url" content="${safeUrl}" />`,
    `    <meta property="og:site_name" content="Events By You" />`,
    `    <meta property="og:locale" content="en_GH" />`,
    `    <meta property="og:image" content="${safeImg}" />`,
    `    <meta name="twitter:card" content="summary_large_image" />`,
    `    <meta name="twitter:title" content="${safeTitle}" />`,
    `    <meta name="twitter:description" content="${safeDesc}" />`,
    `    <meta name="twitter:image" content="${safeImg}" />`,
  ];

  // Semantic plain HTML block (strictly public event metadata; never attendee PII)
  const venueDisplay =
    event.venueFormat === 'virtual'
      ? `Online (${event.city || 'Ghana'})`
      : [event.venue, event.city].filter(Boolean).join(', ');

  const subheading =
    subPath === 'checkin'
      ? 'Gate Check-In & Pass Lookup'
      : subPath === 'gifts'
        ? 'Event Gift Table & Registry Portal'
        : subPath === 'camera'
          ? '35mm Event Disposable Camera'
          : 'Official Event Invitation & Registration';

  const rootInnerHtml = [
    `<main data-ssr-event="true" style="max-width:760px;margin:48px auto;padding:24px;font-family:system-ui,-apple-system,sans-serif;color:#0B0B0B;">`,
    `<p style="font-size:12px;text-transform:uppercase;letter-spacing:0.08em;color:#52525B;margin:0 0 8px;">${escapeHtml(event.category || 'Event')} · ${escapeHtml(subheading)}</p>`,
    `<h1 style="font-size:32px;line-height:1.15;margin:0 0 12px;">${escapeHtml(event.title)}</h1>`,
    event.subtitle
      ? `<p style="font-size:16px;line-height:1.6;color:#3F3F46;margin:0 0 20px;">${escapeHtml(event.subtitle)}</p>`
      : '',
    `<dl style="display:grid;gap:10px;background:#F5F5F7;padding:16px 20px;border-radius:16px;margin:0 0 20px;">`,
    `<div><dt style="font-size:12px;color:#71717A;">Hosted By</dt><dd style="margin:2px 0 0;font-weight:600;">${escapeHtml(event.organizer || 'Events By You Organiser')}</dd></div>`,
    `<div><dt style="font-size:12px;color:#71717A;">Date &amp; Time</dt><dd style="margin:2px 0 0;font-weight:600;">${escapeHtml([formatEventDateSpan(event.isoDate, event.endIsoDate, event.date), event.time, formatEventDurationBadge(event)].filter(Boolean).join(' · ') || 'Upcoming')}</dd></div>`,
    `<div><dt style="font-size:12px;color:#71717A;">Venue</dt><dd style="margin:2px 0 0;font-weight:600;">${escapeHtml(venueDisplay || 'TBA')}</dd></div>`,
    `<div><dt style="font-size:12px;color:#71717A;">Ticket Price</dt><dd style="margin:2px 0 0;font-weight:600;">${escapeHtml(priceGhs)}</dd></div>`,
    `</dl>`,
    `<nav aria-label="Event links" style="display:flex;flex-wrap:wrap;gap:12px;font-size:14px;">`,
    `<a href="/e/${cleanSlug}">Event Overview &amp; Registration</a>`,
    `<a href="/e/${cleanSlug}/checkin">Check-In</a>`,
    event.extraDataConfig?.enableGiftTable !== false
      ? `<a href="/e/${cleanSlug}/gifts">Gift Table</a>`
      : '',
    `<a href="/">Events By You Home</a>`,
    `</nav>`,
    !indexable ? `<p style="margin-top:16px;font-size:12px;color:#71717A;">Unlisted or private preview.</p>` : '',
    `</main>`,
  ]
    .filter(Boolean)
    .join('');

  return replaceHeadAndRoot(html, {
    title: seo.title,
    description: seo.description,
    robots: seo.robots,
    canonicalUrl,
    ogTags,
    jsonLd: seo.jsonLd,
    rootInnerHtml,
  });
}

export function injectNotFoundSsrHtml(
  html: string,
  baseUrl: string,
  requestedPath = '/404'
): string {
  const cleanOrigin = baseUrl.replace(/\/+$/, '');
  const cleanPath = requestedPath.startsWith('/') ? requestedPath : `/${requestedPath}`;
  const canonicalUrl = `${cleanOrigin}${cleanPath}`;
  const seo = NOINDEX_ROUTE_SEO.notFound;
  const fallbackImg = `${cleanOrigin}/src/assets/images/flyer_corporate_gala_1795075792816.jpg`;

  const ogTags = [
    `    <meta property="og:title" content="${escapeXml(seo.title)}" />`,
    `    <meta property="og:description" content="${escapeXml(seo.description)}" />`,
    `    <meta property="og:type" content="website" />`,
    `    <meta property="og:url" content="${escapeXml(canonicalUrl)}" />`,
    `    <meta property="og:site_name" content="Events By You" />`,
    `    <meta property="og:locale" content="en_GH" />`,
    `    <meta property="og:image" content="${escapeXml(fallbackImg)}" />`,
    `    <meta name="twitter:card" content="summary_large_image" />`,
    `    <meta name="twitter:title" content="${escapeXml(seo.title)}" />`,
    `    <meta name="twitter:description" content="${escapeXml(seo.description)}" />`,
  ];

  const rootInnerHtml = [
    `<main data-ssr-not-found="true" style="max-width:560px;margin:64px auto;padding:24px;font-family:system-ui,-apple-system,sans-serif;color:#0B0B0B;text-align:center;">`,
    `<p style="font-size:12px;font-weight:700;letter-spacing:0.08em;color:#71717A;text-transform:uppercase;">404 · Not Found</p>`,
    `<h1 style="font-size:28px;margin:8px 0 12px;">Event Not Found (404)</h1>`,
    `<p style="font-size:15px;line-height:1.6;color:#52525B;margin:0 0 20px;">${escapeHtml(seo.description)}</p>`,
    `<a href="/" style="display:inline-block;padding:10px 20px;border-radius:999px;background:#0B0B0B;color:#FFFFFF;text-decoration:none;font-size:13px;font-weight:600;">Back to Events By You Home</a>`,
    `</main>`,
  ].join('');

  return replaceHeadAndRoot(html, {
    title: seo.title,
    description: seo.description,
    robots: 'noindex, nofollow',
    canonicalUrl,
    ogTags,
    rootInnerHtml,
  });
}
