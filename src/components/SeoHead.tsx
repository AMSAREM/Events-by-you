import React, { useEffect } from 'react';
import { Head } from 'vite-react-ssg';
import { CANONICAL_ORIGIN } from '../lib/seoConfig';

export interface SeoHeadProps {
  path: string;
  title: string;
  description: string;
  robots?: 'index, follow' | 'noindex, nofollow';
  ogType?: 'website' | 'article';
  ogImage?: string;
  jsonLd?: Record<string, unknown> | Record<string, unknown>[];
}

function resolveCanonicalUrl(path: string): string {
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  if (cleanPath === '/') {
    return `${CANONICAL_ORIGIN}/`;
  }
  return `${CANONICAL_ORIGIN}${cleanPath.replace(/\/+$/, '')}`;
}

function resolveAbsoluteImageUrl(ogImage?: string): string | undefined {
  const trimmed = ogImage?.trim();
  if (!trimmed) return undefined;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith('/')) return `${CANONICAL_ORIGIN}${trimmed}`;
  return `${CANONICAL_ORIGIN}/${trimmed}`;
}

export const SeoHead: React.FC<SeoHeadProps> = ({
  path,
  title,
  description,
  robots = 'index, follow',
  ogType = 'website',
  ogImage,
  jsonLd,
}) => {
  const canonicalUrl = resolveCanonicalUrl(path);
  const resolvedOgImage = resolveAbsoluteImageUrl(ogImage);
  const twitterCard = resolvedOgImage ? 'summary_large_image' : 'summary';
  const serializedJsonLd = jsonLd ? JSON.stringify(jsonLd) : null;

  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.title = title;

    // Remove static fallback tags from index.html that do not carry data-rh="true"
    // so client navigation never leaves duplicate meta/canonical/json-ld entries.
    const staticSelector = [
      'meta[name="description"]:not([data-rh])',
      'meta[name="robots"]:not([data-rh])',
      'link[rel="canonical"]:not([data-rh])',
      'meta[property^="og:"]:not([data-rh])',
      'meta[name^="twitter:"]:not([data-rh])',
      'script[type="application/ld+json"]:not([data-rh])',
    ].join(', ');

    document.head.querySelectorAll(staticSelector).forEach((node) => {
      node.parentNode?.removeChild(node);
    });
  }, [title, description, path, robots, ogType, resolvedOgImage, serializedJsonLd]);

  return (
    <Head>
      <title>{title}</title>
      <meta name="description" content={description} />
      <meta name="robots" content={robots} />
      <link rel="canonical" href={canonicalUrl} />

      <meta property="og:type" content={ogType} />
      <meta property="og:title" content={title} />
      <meta property="og:description" content={description} />
      <meta property="og:url" content={canonicalUrl} />
      <meta property="og:site_name" content="Events By You" />
      <meta property="og:locale" content="en_GH" />
      {resolvedOgImage ? <meta property="og:image" content={resolvedOgImage} /> : null}

      <meta name="twitter:card" content={twitterCard} />
      <meta name="twitter:title" content={title} />
      <meta name="twitter:description" content={description} />
      {resolvedOgImage ? <meta name="twitter:image" content={resolvedOgImage} /> : null}

      {serializedJsonLd ? (
        <script type="application/ld+json">{serializedJsonLd}</script>
      ) : null}
    </Head>
  );
};
