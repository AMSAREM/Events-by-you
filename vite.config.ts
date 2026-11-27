import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import {defineConfig} from 'vite';
import {VitePWA} from 'vite-plugin-pwa';

export default defineConfig(({ command, isSsrBuild }) => {
  return {
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        disable: command === 'serve' && process.env.DISABLE_HMR === 'true',
        registerType: 'autoUpdate',
        includeAssets: [
          'icon.svg',
          'apple-touch-icon.png',
          'pwa-192x192.png',
          'pwa-512x512.png',
          'pwa-maskable-512x512.png',
        ],
        manifest: {
          id: '/',
          name: 'Events By You — Registration & Check-In',
          short_name: 'EventsByYou',
          description:
            'Event registration, Arkesel SMS ticketing, disposable camera, standalone gift table, and offline-ready QR gate check-in.',
          theme_color: '#0D3822',
          background_color: '#FFFFFF',
          display: 'standalone',
          start_url: '/',
          scope: '/',
          icons: [
            {
              src: '/pwa-192x192.png',
              sizes: '192x192',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/pwa-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/pwa-maskable-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,ico,png,svg,woff,woff2}'],
          maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
          navigateFallback: null,
          cleanupOutdatedCaches: true,
          skipWaiting: true,
          clientsClaim: true,
          runtimeCaching: [
            {
              urlPattern: ({ request }) => request.mode === 'navigate',
              handler: 'NetworkFirst',
              options: {
                cacheName: 'pages-cache',
                networkTimeoutSeconds: 4,
                expiration: {
                  maxEntries: 25,
                  maxAgeSeconds: 60 * 60 * 24,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
            {
              urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'google-fonts-cache',
                expiration: {
                  maxEntries: 10,
                  maxAgeSeconds: 60 * 60 * 24 * 365,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
            {
              urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'gstatic-fonts-cache',
                expiration: {
                  maxEntries: 10,
                  maxAgeSeconds: 60 * 60 * 24 * 365,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
            {
              urlPattern: /\/api\/public\/.*/i,
              handler: 'NetworkFirst',
              options: {
                cacheName: 'public-events-api-cache',
                networkTimeoutSeconds: 4,
                expiration: {
                  maxEntries: 30,
                  maxAgeSeconds: 60 * 60 * 24,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
          ],
        },
        devOptions: {
          enabled: false,
          type: 'module',
        },
      }),
      // Copies src/assets into dist/ so root-relative URLs like
      // "/src/assets/images/..." (e.g. generate_image output) still resolve
      // in production builds. Do not remove.
      {
        name: 'copy-unbundled-src-assets',
        apply: 'build',
        closeBundle(error?: Error): void {
          if (error) {
            return;
          }
          const baseDir = import.meta.dirname;
          const distDir = path.resolve(baseDir, 'dist');
          const srcAssets = path.resolve(baseDir, 'src/assets');
          const distAssets = path.resolve(distDir, 'src/assets');
          if (fs.existsSync(distDir) && fs.existsSync(srcAssets)) {
            fs.cpSync(srcAssets, distAssets, {recursive: true, force: true});
          }
        },
      },
    ],
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, '.'),
      },
      dedupe: ['react', 'react-dom', 'react/jsx-runtime', 'react/jsx-dev-runtime'],
    },
    optimizeDeps: {
      include: [
        'react',
        'react-dom',
        'react-dom/client',
        'react/jsx-runtime',
        'react/jsx-dev-runtime',
        'lucide-react',
      ],
    },
    build: isSsrBuild
      ? {}
      : {
          rolldownOptions: {
            output: {
              codeSplitting: {
                groups: [
                  {
                    name: 'vendor-react',
                    test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/,
                    priority: 30,
                  },
                  {
                    name: 'vendor-motion',
                    test: /node_modules[\\/](motion|framer-motion)[\\/]/,
                    priority: 25,
                  },
                  {
                    name: 'vendor-supabase',
                    test: /node_modules[\\/]@supabase[\\/]/,
                    priority: 20,
                  },
                  {
                    name: 'vendor-icons',
                    test: /node_modules[\\/]lucide-react[\\/]/,
                    priority: 15,
                  },
                  {
                    name: 'vendor',
                    test: /node_modules[\\/]/,
                    priority: 10,
                  },
                ],
              },
            },
          },
        },
    ssgOptions: {
      dirStyle: 'flat',
      includedRoutes: () => [
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
      ],
      onPageRendered: (_route, renderedHTML) => {
        if (!renderedHTML.includes('data-rh="true"')) {
          return renderedHTML;
        }
        // Keep only the per-route data-rh="true" tags injected by SeoHead during SSG
        return renderedHTML
          .replace(/<title>[\s\S]*?<\/title>\s*/gi, '')
          .replace(/<meta\s+name=["'](?:description|robots)["'][^>]*>\s*/gi, '')
          .replace(/<link\s+rel=["']canonical["'][^>]*>\s*/gi, '')
          .replace(/<meta\s+(?:property|name)=["'](?:og:|twitter:)[^"']+["'][^>]*>\s*/gi, '')
          .replace(/<script\s+type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>\s*/gi, '');
      },
    },
    server: {
      host: '0.0.0.0',
      port: 3000,
      allowedHosts: true as const,
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
