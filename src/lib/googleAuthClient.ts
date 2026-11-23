import {
  ApiError,
  api,
  saveStoredSession,
  type StoredAuthSession,
} from './api';
import type { AppRole, OrganizerProfile } from '../types/events';

const OAUTH_CHANNEL_NAME = 'eventsapp_google_oauth';
const OAUTH_STORAGE_BRIDGE_KEY = 'eventsapp_google_oauth_result';

interface GoogleOAuthBridgePayload {
  type?: string;
  ok?: boolean;
  session?: StoredAuthSession;
  profile?: OrganizerProfile;
  isNewUser?: boolean;
  mode?: 'signin' | 'signup';
  error?: string;
  ts?: number;
}

export type GoogleOAuthPopupResult =
  | {
      ok: true;
      session: StoredAuthSession;
      profile: OrganizerProfile;
      isNewUser: boolean;
    }
  | {
      ok: false;
      cancelled?: boolean;
      notConfigured?: boolean;
      callbackUrl?: string;
      error: string;
    };

function isTrustedCallbackOrigin(origin: string): boolean {
  if (!origin) return false;
  if (origin === window.location.origin) return true;
  try {
    const parsed = new URL(origin);
    const host = parsed.hostname.toLowerCase();
    return (
      host === 'eventsbyyou.xyz' ||
      host === 'www.eventsbyyou.xyz' ||
      host.endsWith('.run.app') ||
      host === 'localhost' ||
      host === '127.0.0.1'
    );
  } catch {
    return false;
  }
}

export async function startGoogleOAuthPopup(options: {
  mode: 'signin' | 'signup';
  studio?: string;
  appRole?: AppRole;
}): Promise<GoogleOAuthPopupResult> {
  // Open synchronously on user click to prevent browser popup blockers,
  // then navigate the popup directly to Google's authorization URL (never a container SPA route).
  const width = 520;
  const height = 650;
  const left = Math.max(0, Math.round((window.screenX || 0) + (window.outerWidth - width) / 2));
  const top = Math.max(0, Math.round((window.screenY || 0) + (window.outerHeight - height) / 2));
  const popup = window.open(
    '',
    'eventsbyyou_google_oauth',
    `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`
  );

  if (!popup) {
    return {
      ok: false,
      error: 'Popup was blocked by your browser. Please allow popups for this site to continue with Google.',
    };
  }

  try {
    popup.document.title = 'Connecting to Google...';
    popup.document.body.innerHTML =
      '<div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;display:flex;align-items:center;justify-content:center;min-height:90vh;color:#0B0B0B;font-size:14px;">Connecting to Google...</div>';
  } catch {
    // Ignore cross-origin write restrictions
  }

  try {
    localStorage.removeItem(OAUTH_STORAGE_BRIDGE_KEY);
  } catch {
    // Ignore storage errors
  }

  let authUrl = '';
  try {
    const res = await api.auth.getOAuthUrl('google', {
      mode: options.mode,
      studio: options.studio,
      appRole: options.appRole,
      redirectTo: `${window.location.origin}/auth/callback`,
    });
    authUrl = res.url;
    if (!authUrl) {
      throw new Error('Google authorization URL could not be generated.');
    }
  } catch (err) {
    try {
      popup.close();
    } catch {
      // Ignore close error
    }
    const apiErr = err instanceof ApiError ? err : null;
    const message = err instanceof Error ? err.message : 'Unable to start Google Sign-In.';
    return {
      ok: false,
      notConfigured: apiErr?.code === 'GOOGLE_OAUTH_NOT_CONFIGURED' || apiErr?.status === 503,
      callbackUrl: apiErr?.callbackUrl,
      error: message,
    };
  }

  const startedAt = Date.now();

  return await new Promise<GoogleOAuthPopupResult>((resolve) => {
    let settled = false;
    let closeGraceTimer: number | null = null;
    let pollTimer: number | null = null;
    let bc: BroadcastChannel | null = null;

    const cleanup = () => {
      window.removeEventListener('message', onWindowMessage);
      window.removeEventListener('storage', onStorageEvent);
      if (pollTimer !== null) window.clearInterval(pollTimer);
      if (closeGraceTimer !== null) window.clearTimeout(closeGraceTimer);
      if (bc) {
        try {
          bc.close();
        } catch {
          // Ignore close error
        }
      }
      try {
        localStorage.removeItem(OAUTH_STORAGE_BRIDGE_KEY);
      } catch {
        // Ignore storage error
      }
    };

    const finishWithPayload = async (payload: GoogleOAuthBridgePayload) => {
      if (settled) return;
      settled = true;
      cleanup();

      try {
        if (!popup.closed) popup.close();
      } catch {
        // Ignore close error
      }

      if (!payload.ok || !payload.session?.accessToken) {
        resolve({
          ok: false,
          error: payload.error || 'Google authentication did not complete.',
        });
        return;
      }

      try {
        saveStoredSession(payload.session);
        let resolvedProfile = payload.profile;
        if (!resolvedProfile) {
          const sessionRes = await api.auth.getSession();
          resolvedProfile = sessionRes.profile;
        }
        resolve({
          ok: true,
          session: payload.session,
          profile: resolvedProfile,
          isNewUser: Boolean(payload.isNewUser ?? options.mode === 'signup'),
        });
      } catch (err) {
        saveStoredSession(null);
        resolve({
          ok: false,
          error:
            err instanceof Error
              ? err.message
              : 'Google verified your account, but failed to initialize your Studio session.',
        });
      }
    };

    const onWindowMessage = (event: MessageEvent) => {
      if (!isTrustedCallbackOrigin(event.origin)) return;
      const data = event.data as GoogleOAuthBridgePayload | undefined;
      if (!data || data.type !== 'GOOGLE_OAUTH_RESULT') return;
      void finishWithPayload(data);
    };

    const onStorageEvent = (event: StorageEvent) => {
      if (event.key !== OAUTH_STORAGE_BRIDGE_KEY || !event.newValue) return;
      try {
        const data = JSON.parse(event.newValue) as GoogleOAuthBridgePayload;
        if (data?.type === 'GOOGLE_OAUTH_RESULT' && (!data.ts || data.ts >= startedAt - 2000)) {
          void finishWithPayload(data);
        }
      } catch {
        // Ignore malformed bridge payload
      }
    };

    window.addEventListener('message', onWindowMessage);
    window.addEventListener('storage', onStorageEvent);

    try {
      if (typeof BroadcastChannel !== 'undefined') {
        bc = new BroadcastChannel(OAUTH_CHANNEL_NAME);
        bc.onmessage = (event: MessageEvent) => {
          const data = event.data as GoogleOAuthBridgePayload | undefined;
          if (data?.type === 'GOOGLE_OAUTH_RESULT') {
            void finishWithPayload(data);
          }
        };
      }
    } catch {
      bc = null;
    }

    // Navigate the popup directly to Google's authorization page
    try {
      popup.location.replace(authUrl);
      popup.focus();
    } catch {
      settled = true;
      cleanup();
      try {
        popup.close();
      } catch {
        // Ignore
      }
      resolve({
        ok: false,
        error: 'Unable to open Google sign-in window. Please allow popups and try again.',
      });
      return;
    }

    pollTimer = window.setInterval(() => {
      if (settled) return;
      // Also check localStorage bridge in case storage event didn't fire in same frame context
      try {
        const raw = localStorage.getItem(OAUTH_STORAGE_BRIDGE_KEY);
        if (raw) {
          const data = JSON.parse(raw) as GoogleOAuthBridgePayload;
          if (data?.type === 'GOOGLE_OAUTH_RESULT' && (!data.ts || data.ts >= startedAt - 2000)) {
            void finishWithPayload(data);
            return;
          }
        }
      } catch {
        // Ignore
      }
      if (popup.closed && closeGraceTimer === null) {
        closeGraceTimer = window.setTimeout(() => {
          if (settled) return;
          settled = true;
          cleanup();
          resolve({
            ok: false,
            cancelled: true,
            error: 'Google sign-in window was closed before completing.',
          });
        }, 450);
      }
    }, 350);
  });
}
