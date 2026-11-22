import React from 'react';
import { Head } from 'vite-react-ssg';
import { CANONICAL_ORIGIN } from '../lib/seoConfig';

interface SeoHeadProps {
  title: string;
  description: string;
  path?: string;
  canonicalUrl?: string;
  robots?: 'index, follow' | 'noindex, nofollow';
  ogType?: 'website' | 'article';
  ogImage?: string;
  jsonLd?: Record<string, unknown> | Record<string, unknown>[];
}

function resolveCanonicalOrigin(): string {
  if (typeof window !== 'undefined' && window.location?.origin) {
    const origin = window.location.origin;
    if (origin.includes('eventsbyyou.xyz')) {
      return origin.replace(/\/+$/, '');
    }
  }
  return CANONICAL_ORIGIN;
}

function serializeJsonLdSafe(data: Record<string, unknown> | Record<string, unknown>[]): string {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}

export const SeoHead: React.FC<SeoHeadProps> = ({
  title,
  description,
  path = '/',
  canonicalUrl,
  robots = 'index, follow',
  ogType = 'website',
  ogImage,
  jsonLd,
}) => {
  const origin = resolveCanonicalOrigin();
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const resolvedCanonical =
    canonicalUrl || `${origin}${normalizedPath === '/' ? '/' : normalizedPath}`;
  const resolvedImage = ogImage || `${origin}/src/assets/images/flyer_corporate_gala_1795075792816.jpg`;

  return (
    <Head>
      <title>{title}</title>
      <meta name="description" content={description} />
      <meta name="robots" content={robots} />
      <link rel="canonical" href={resolvedCanonical} />
      <meta property="og:title" content={title} />
      <meta property="og:description" content={description} />
      <meta property="og:type" content={ogType} />
      <meta property="og:url" content={resolvedCanonical} />
      <meta property="og:site_name" content="Events By You" />
      <meta property="og:locale" content="en_GH" />
      <meta property="og:image" content={resolvedImage} />
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={title} />
      <meta name="twitter:description" content={description} />
      <meta name="twitter:image" content={resolvedImage} />
      {jsonLd ? (
        <script type="application/ld+json">{serializeJsonLdSafe(jsonLd)}</script>
      ) : null}
    </Head>
  );
};
