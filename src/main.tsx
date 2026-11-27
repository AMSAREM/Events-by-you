import { ViteReactSSG } from 'vite-react-ssg';
import { STATIC_MARKETING_PATHS } from './lib/seoConfig.ts';
import { routes } from './routes.tsx';
import './index.css';

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  const normalizedPath =
    window.location.pathname.length > 1 && window.location.pathname.endsWith('/')
      ? window.location.pathname.slice(0, -1).toLowerCase()
      : window.location.pathname.toLowerCase();
  const params = new URLSearchParams(window.location.search);
  const isCleanStaticSsrRoute =
    (STATIC_MARKETING_PATHS as readonly string[]).includes(normalizedPath) &&
    !params.has('event') &&
    !params.has('camera');

  if (!isCleanStaticSsrRoute) {
    // Prevent hydrate() against `/` SSG HTML when rendering client routes or dynamic `/e/:slug`
    document.querySelectorAll('[data-server-rendered="true"]').forEach((el) => {
      el.removeAttribute('data-server-rendered');
    });
  }
}

export const createRoot = ViteReactSSG({ routes }, ({ isClient }) => {
  if (isClient && typeof window !== 'undefined' && 'serviceWorker' in navigator) {
    if (import.meta.env.PROD) {
      void import('virtual:pwa-register')
        .then(({ registerSW }) => {
          registerSW({
            immediate: true,
            onRegisteredSW(_swUrl, registration) {
              registration?.update().catch(() => {});
            },
          });
        })
        .catch(() => {});
    } else {
      navigator.serviceWorker
        .getRegistrations()
        .then((regs) => Promise.all(regs.map((r) => r.unregister())))
        .catch(() => {});
    }
  }
});

