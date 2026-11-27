import { Component, type ErrorInfo, type ReactNode } from 'react';
import type { RouteRecord } from 'vite-react-ssg';
import App from './App.tsx';
import { OfflineIndicator } from './components/PWAInstallButton.tsx';
import { STATIC_MARKETING_PATHS } from './lib/seoConfig.ts';

interface BoundaryState {
  hasError: boolean;
}

class RootErrorBoundary extends Component<{ children: ReactNode }, BoundaryState> {
  state: BoundaryState = { hasError: false };

  static getDerivedStateFromError(): BoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, _info: ErrorInfo) {
    const msg = error?.message || '';
    const isStaleChunkOrHookError =
      msg.includes('useState') ||
      msg.includes('Invalid hook call') ||
      msg.includes('Failed to fetch dynamically imported module') ||
      msg.includes('Importing a module script failed');

    if (isStaleChunkOrHookError && typeof window !== 'undefined') {
      const key = 'eventsbyyou_chunk_reload_at';
      const lastReload = Number(window.sessionStorage.getItem(key) || '0');
      const now = Date.now();
      if (!lastReload || now - lastReload > 15_000) {
        window.sessionStorage.setItem(key, String(now));
        window.location.reload();
      }
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-dvh w-full bg-[#F5F5F7] text-[#0B0B0B] flex items-center justify-center p-6">
          <div className="max-w-sm w-full bg-white border border-[#E5E5EA] rounded-[24px] p-6 text-center space-y-3 shadow-sm">
            <h1 className="font-display text-lg font-bold">Reload needed</h1>
            <p className="text-xs text-[#71717A] leading-relaxed">
              A newer version of the app was loaded. Refresh once to sync everything cleanly.
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="px-5 py-2.5 rounded-full bg-[#0B0B0B] text-white text-xs font-semibold hover:bg-neutral-800 transition-colors"
            >
              Refresh App
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const appElement = (
  <RootErrorBoundary>
    <App />
    <OfflineIndicator />
  </RootErrorBoundary>
);

export const routes: RouteRecord[] = [
  ...STATIC_MARKETING_PATHS.map((path) => ({
    path,
    element: appElement,
  })),
  { path: '/signin', element: appElement },
  { path: '/signup', element: appElement },
  { path: '/reset-password', element: appElement },
  { path: '/verify-otp', element: appElement },
  { path: '/studio', element: appElement },
  { path: '/studio/*', element: appElement },
  { path: '/camera', element: appElement },
  { path: '/e/*', element: appElement },
  { path: '*', element: appElement },
];
