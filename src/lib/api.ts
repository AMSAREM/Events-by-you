import type {
  AppRole,
  Attendee,
  BuilderConsoleOverview,
  BuilderDiagnosticFailure,
  BuilderFeatureFlags,
  BuilderTenantInspection,
  BuilderTenantSummary,
  CreatorApp,
  CreatorAppEnvironment,
  CreatorAppLog,
  CreatorAppScope,
  CreatorAppStatus,
  CreatorAppType,
  DisposableRollSettings,
  DisposableShot,
  EventItem,
  OrganizerProfile,
  ScheduleBlock,
  SystemAlert,
  WebhookTriggerEvent,
} from '../types/events';

const SESSION_KEY = 'eventsapp_supabase_session_v1';
const CREATOR_TOKEN_KEY = 'eventsapp_creator_token_v1';

export function getStoredCreatorToken(): string | null {
  try {
    return sessionStorage.getItem(CREATOR_TOKEN_KEY) || null;
  } catch {
    return null;
  }
}

export function saveStoredCreatorToken(token: string | null): void {
  try {
    if (!token) {
      sessionStorage.removeItem(CREATOR_TOKEN_KEY);
    } else {
      sessionStorage.setItem(CREATOR_TOKEN_KEY, token);
    }
  } catch {
    // Ignore storage errors
  }
}

export interface StoredAuthSession {
  accessToken: string;
  refreshToken: string;
  expiresAt?: number;
}

export interface StudioWorkspacePayload {
  profile: OrganizerProfile;
  events: EventItem[];
  attendees: Attendee[];
  scheduleBlocks: ScheduleBlock[];
  alerts: SystemAlert[];
  disposableShots: DisposableShot[];
  rollSettings: Record<string, DisposableRollSettings>;
  creatorApps?: CreatorApp[];
  creatorAppLogs?: CreatorAppLog[];
}

export function getStoredSession(): StoredAuthSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredAuthSession;
    return parsed?.accessToken ? parsed : null;
  } catch {
    return null;
  }
}

export function saveStoredSession(session: StoredAuthSession | null): void {
  try {
    if (!session) {
      localStorage.removeItem(SESSION_KEY);
    } else {
      localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    }
  } catch {
    // Ignore storage quota errors
  }
}

export function extractSessionFromUrlHash(): StoredAuthSession | null {
  try {
    const hash = window.location.hash;
    if (!hash || !hash.includes('access_token=')) return null;
    const params = new URLSearchParams(hash.replace(/^#/, ''));
    const accessToken = params.get('access_token');
    const refreshToken = params.get('refresh_token') || '';
    const expiresIn = Number(params.get('expires_in') || 3600);
    if (!accessToken) return null;
    const session: StoredAuthSession = {
      accessToken,
      refreshToken,
      expiresAt: Math.floor(Date.now() / 1000) + expiresIn,
    };
    saveStoredSession(session);
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
    return session;
  } catch {
    return null;
  }
}

async function refreshStoredSession(): Promise<StoredAuthSession | null> {
  const current = getStoredSession();
  if (!current?.refreshToken) return null;
  try {
    const resp = await fetch(resolveApiUrl('/api/auth/refresh'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: current.refreshToken }),
    });
    if (!resp.ok) {
      saveStoredSession(null);
      return null;
    }
    const data = (await resp.json()) as { session: StoredAuthSession };
    if (data.session?.accessToken) {
      saveStoredSession(data.session);
      return data.session;
    }
    saveStoredSession(null);
    return null;
  } catch {
    return null;
  }
}

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '');

function resolveApiUrl(url: string): string {
  if (!API_BASE_URL || /^https?:\/\//i.test(url)) return url;
  return `${API_BASE_URL}${url.startsWith('/') ? url : `/${url}`}`;
}

async function request<T>(
  url: string,
  options: RequestInit = {},
  authenticated = false,
  retried = false
): Promise<T> {
  const targetUrl = resolveApiUrl(url);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((options.headers as Record<string, string>) || {}),
  };

  if (authenticated) {
    const session = getStoredSession();
    if (!session?.accessToken) {
      throw new Error('Authentication required. Please sign in.');
    }
    headers.Authorization = `Bearer ${session.accessToken}`;
    const creatorToken = getStoredCreatorToken();
    if (creatorToken) {
      headers['X-Creator-Token'] = creatorToken;
    }
  }

  const resp = await fetch(targetUrl, { ...options, headers });

  if (resp.status === 401 && authenticated && !retried) {
    const refreshed = await refreshStoredSession();
    if (refreshed) {
      return request<T>(url, options, true, true);
    }
  }

  const rawText = await resp.text();
  let parsed: ({ error?: string } & Partial<T>) | null = null;
  if (rawText) {
    try {
      parsed = JSON.parse(rawText) as { error?: string } & Partial<T>;
    } catch {
      parsed = null;
    }
  }

  if (!resp.ok) {
    throw new Error(parsed?.error || `Request failed (${resp.status})`);
  }

  if (!parsed || typeof parsed !== 'object') {
    const contentType = resp.headers.get('content-type') || 'unknown';
    if (contentType.toLowerCase().includes('text/html')) {
      throw new Error(
        `Backend API route ${url} returned HTML instead of JSON (HTTP ${resp.status}). This domain is serving the static frontend without the Express server (node server.ts). Deploy full-stack with "npm run build && npm start" or set VITE_API_BASE_URL.`
      );
    }
    throw new Error(
      `Invalid JSON response from ${url} (HTTP ${resp.status}, ${contentType})`
    );
  }

  return parsed as T;
}

export const api = {
  health: () =>
    request<{
      ok: boolean;
      database: string;
      supabaseConfigured: boolean;
      serviceRoleConfigured?: boolean;
      resendConfigured?: boolean;
      arkeselConfigured?: boolean;
      inMemoryFallback?: boolean;
      creatorEmail?: string;
      creatorPasswordConfigured?: boolean;
    }>('/api/health'),

  auth: {
    creatorLogin: (email: string, password: string) =>
      request<{
        requiresOtp: boolean;
        creatorToken: string;
        email?: string;
        phone?: string;
        otpType?: 'signup' | 'email' | 'sms';
        session?: StoredAuthSession;
        profile?: OrganizerProfile;
      }>('/api/auth/creator-login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      }),

    signIn: (identifier: string, password: string, countryGateway = 'GH') =>
      request<{
        requiresOtp: boolean;
        email?: string;
        phone?: string;
        otpType?: 'signup' | 'email' | 'sms';
        channels?: Array<'sms' | 'email'>;
        provider?: string;
        session?: StoredAuthSession;
        profile?: OrganizerProfile;
      }>('/api/auth/signin', {
        method: 'POST',
        body: JSON.stringify({ identifier, password, countryGateway }),
      }),

    signUp: (payload: {
      phone: string;
      email: string;
      password: string;
      name: string;
      studio: string;
      countryGateway: string;
      appRole?: AppRole;
      agreed: boolean;
    }) =>
      request<{
        requiresOtp: boolean;
        phone?: string;
        email?: string;
        otpType?: 'signup' | 'email' | 'sms';
        channels?: Array<'sms' | 'email'>;
        provider?: string;
        session?: StoredAuthSession;
        profile?: OrganizerProfile;
      }>('/api/auth/signup', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),

    verifyOtp: (payload: {
      email?: string;
      phone?: string;
      token: string;
      otpType?: 'signup' | 'email' | 'recovery' | 'sms';
      countryGateway?: string;
    }) =>
      request<{ session: StoredAuthSession; profile: OrganizerProfile }>('/api/auth/verify-otp', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),

    sendOtp: (payload: {
      identifier?: string;
      email?: string;
      phone?: string;
      countryGateway?: string;
    }) =>
      request<{
        ok: boolean;
        email?: string;
        phone?: string;
        channels?: Array<'sms' | 'email'>;
        provider?: string;
      }>(
        '/api/auth/send-otp',
        {
          method: 'POST',
          body: JSON.stringify(payload),
        }
      ),

    resendOtp: (payload: {
      email?: string;
      phone?: string;
      otpType?: 'signup' | 'email' | 'recovery' | 'sms';
      countryGateway?: string;
    }) =>
      request<{
        ok: boolean;
        phone?: string;
        email?: string;
        channels?: Array<'sms' | 'email'>;
        provider?: string;
      }>('/api/auth/resend-otp', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),

    resetPassword: (payload: {
      email?: string;
      phone?: string;
      redirectTo?: string;
      countryGateway?: string;
    }) =>
      request<{
        ok: boolean;
        phone?: string;
        email?: string;
        channels?: Array<'sms' | 'email'>;
        provider?: string;
      }>(
        '/api/auth/reset-password',
        {
          method: 'POST',
          body: JSON.stringify(payload),
        }
      ),

    getOAuthUrl: (provider: 'google' | 'github', redirectTo: string) =>
      request<{ url: string }>(
        `/api/auth/oauth/${provider}?redirectTo=${encodeURIComponent(redirectTo)}`
      ),

    getSession: () => request<{ profile: OrganizerProfile }>('/api/auth/session', {}, true),

    updatePassword: (password: string) =>
      request<{ ok: boolean }>(
        '/api/auth/update-password',
        { method: 'POST', body: JSON.stringify({ password }) },
        true
      ),

    signOut: () =>
      request<{ ok: boolean }>('/api/auth/signout', { method: 'POST' }, Boolean(getStoredSession())),
  },

  public: {
    getEvents: () => request<{ events: EventItem[] }>('/api/public/events'),

    registerAttendee: (
      eventId: string,
      payload: {
        name: string;
        email: string;
        phone: string;
        organization?: string;
        tier?: Attendee['tier'];
        ticketCode?: string;
      }
    ) =>
      request<{ attendee: Attendee; event: EventItem }>(
        `/api/public/events/${encodeURIComponent(eventId)}/register`,
        {
          method: 'POST',
          body: JSON.stringify(payload),
        }
      ),
  },

  studio: {
    bootstrap: () => request<StudioWorkspacePayload>('/api/studio/bootstrap', {}, true),

    seedStarter: () =>
      request<StudioWorkspacePayload>('/api/studio/seed-starter', { method: 'POST' }, true),

    updateProfile: (profile: Partial<OrganizerProfile>) =>
      request<{ profile: OrganizerProfile }>(
        '/api/studio/profile',
        { method: 'PATCH', body: JSON.stringify(profile) },
        true
      ),

    createEvent: (event: EventItem, blocks: ScheduleBlock[]) =>
      request<{ event: EventItem; blocks: ScheduleBlock[] }>(
        '/api/studio/events',
        { method: 'POST', body: JSON.stringify({ event, blocks }) },
        true
      ),

    updateEvent: (event: EventItem) =>
      request<{ event: EventItem }>(
        `/api/studio/events/${encodeURIComponent(event.id)}`,
        { method: 'PATCH', body: JSON.stringify(event) },
        true
      ),

    publishQrPass: (eventId: string, published: boolean) =>
      request<{ event: EventItem }>(
        `/api/studio/events/${encodeURIComponent(eventId)}/qr-pass`,
        { method: 'PATCH', body: JSON.stringify({ published }) },
        true
      ),

    deleteEvent: (eventId: string) =>
      request<{ ok: boolean }>(
        `/api/studio/events/${encodeURIComponent(eventId)}`,
        { method: 'DELETE' },
        true
      ),

    registerAttendee: (eventId: string, attendee: Attendee) =>
      request<{ attendee: Attendee; event: EventItem }>(
        `/api/studio/events/${encodeURIComponent(eventId)}/attendees`,
        { method: 'POST', body: JSON.stringify(attendee) },
        true
      ),

    toggleCheckIn: (attendeeId: string) =>
      request<{ attendee: Attendee }>(
        `/api/studio/attendees/${encodeURIComponent(attendeeId)}/checkin`,
        { method: 'PATCH' },
        true
      ),

    retryPayment: (attendeeId: string) =>
      request<{ attendee: Attendee }>(
        `/api/studio/attendees/${encodeURIComponent(attendeeId)}/retry-payment`,
        { method: 'PATCH' },
        true
      ),

    addScheduleBlock: (block: ScheduleBlock) =>
      request<{ block: ScheduleBlock }>(
        '/api/studio/schedule',
        { method: 'POST', body: JSON.stringify(block) },
        true
      ),

    toggleScheduleBlock: (blockId: string) =>
      request<{ block: ScheduleBlock }>(
        `/api/studio/schedule/${encodeURIComponent(blockId)}/toggle`,
        { method: 'PATCH' },
        true
      ),

    deleteScheduleBlock: (blockId: string) =>
      request<{ ok: boolean }>(
        `/api/studio/schedule/${encodeURIComponent(blockId)}`,
        { method: 'DELETE' },
        true
      ),

    resolveAlert: (alertId: string) =>
      request<{ alert: SystemAlert }>(
        `/api/studio/alerts/${encodeURIComponent(alertId)}/resolve`,
        { method: 'PATCH' },
        true
      ),

    addShot: (shot: DisposableShot) =>
      request<{ shot: DisposableShot }>(
        '/api/studio/camera/shots',
        { method: 'POST', body: JSON.stringify(shot) },
        true
      ),

    toggleLikeShot: (shotId: string) =>
      request<{ shot: DisposableShot }>(
        `/api/studio/camera/shots/${encodeURIComponent(shotId)}/like`,
        { method: 'PATCH' },
        true
      ),

    deleteShot: (shotId: string) =>
      request<{ ok: boolean }>(
        `/api/studio/camera/shots/${encodeURIComponent(shotId)}`,
        { method: 'DELETE' },
        true
      ),

    developRoll: (eventId: string) =>
      request<{ ok: boolean }>(
        `/api/studio/camera/${encodeURIComponent(eventId)}/develop`,
        { method: 'POST' },
        true
      ),

    updateRollSettings: (eventId: string, settings: DisposableRollSettings) =>
      request<{ settings: DisposableRollSettings }>(
        `/api/studio/camera/${encodeURIComponent(eventId)}/settings`,
        { method: 'PUT', body: JSON.stringify(settings) },
        true
      ),

    unlockCreatorConsole: (password: string) =>
      request<{ unlocked: boolean; creatorToken: string | null }>(
        '/api/studio/creator-unlock',
        { method: 'POST', body: JSON.stringify({ password }) },
        true
      ),

    apps: {
      create: (payload: {
        name: string;
        description: string;
        appType: CreatorAppType;
        environment: CreatorAppEnvironment;
        eventId?: string;
        scopes: CreatorAppScope[];
        webhookUrl?: string;
        webhookEvents?: WebhookTriggerEvent[];
        allowedOrigins?: string[];
      }) =>
        request<{ app: CreatorApp; rawSecret: string; webhookSecret: string; log: CreatorAppLog | null }>(
          '/api/studio/apps',
          { method: 'POST', body: JSON.stringify(payload) },
          true
        ),

      update: (
        appId: string,
        patch: {
          name?: string;
          description?: string;
          appType?: CreatorAppType;
          environment?: CreatorAppEnvironment;
          status?: CreatorAppStatus;
          eventId?: string | null;
          scopes?: CreatorAppScope[];
          webhookUrl?: string | null;
          webhookEvents?: WebhookTriggerEvent[];
          allowedOrigins?: string[];
        }
      ) =>
        request<{ app: CreatorApp }>(
          `/api/studio/apps/${encodeURIComponent(appId)}`,
          { method: 'PATCH', body: JSON.stringify(patch) },
          true
        ),

      rotateSecret: (appId: string) =>
        request<{ app: CreatorApp; rawSecret: string; webhookSecret: string; log: CreatorAppLog | null }>(
          `/api/studio/apps/${encodeURIComponent(appId)}/rotate-secret`,
          { method: 'POST' },
          true
        ),

      testWebhook: (appId: string, eventType: WebhookTriggerEvent) =>
        request<{ app: CreatorApp; log: CreatorAppLog }>(
          `/api/studio/apps/${encodeURIComponent(appId)}/test-webhook`,
          { method: 'POST', body: JSON.stringify({ eventType }) },
          true
        ),

      simulateEndpointCall: (appId: string, endpoint: string, method: 'GET' | 'POST') =>
        request<{ app: CreatorApp; log: CreatorAppLog; result: unknown }>(
          `/api/studio/apps/${encodeURIComponent(appId)}/simulate-call`,
          { method: 'POST', body: JSON.stringify({ endpoint, method }) },
          true
        ),

      delete: (appId: string) =>
        request<{ ok: boolean }>(
          `/api/studio/apps/${encodeURIComponent(appId)}`,
          { method: 'DELETE' },
          true
        ),
    },
  },

  builder: {
    overview: () => request<BuilderConsoleOverview>('/api/builder/overview', {}, true),

    clearErrors: () =>
      request<{ ok: boolean }>('/api/builder/errors/clear', { method: 'POST' }, true),

    retrySms: (attendeeId?: string) =>
      request<{ retried: number }>(
        '/api/builder/sms/retry',
        { method: 'POST', body: JSON.stringify(attendeeId ? { attendeeId } : {}) },
        true
      ),

    topUpTenantCredits: (userId: string, amount: number) =>
      request<{ tenant?: BuilderTenantSummary; ok?: boolean; smsCredits?: number }>(
        `/api/builder/tenants/${encodeURIComponent(userId)}/credits`,
        { method: 'POST', body: JSON.stringify({ amount }) },
        true
      ),

    updateTenantPlan: (userId: string, plan: OrganizerProfile['plan']) =>
      request<{ tenant?: BuilderTenantSummary; ok?: boolean; plan?: OrganizerProfile['plan'] }>(
        `/api/builder/tenants/${encodeURIComponent(userId)}/plan`,
        { method: 'POST', body: JSON.stringify({ plan }) },
        true
      ),

    updateTenantRole: (userId: string, appRole: AppRole) =>
      request<{ tenant?: BuilderTenantSummary; ok?: boolean; appRole?: AppRole }>(
        `/api/builder/tenants/${encodeURIComponent(userId)}/role`,
        { method: 'POST', body: JSON.stringify({ appRole }) },
        true
      ),

    suspendTenant: (userId: string) =>
      request<{ tenant?: BuilderTenantSummary; ok?: boolean }>(
        `/api/builder/tenants/${encodeURIComponent(userId)}/suspend`,
        { method: 'POST' },
        true
      ),

    revokeTenantSessions: (userId: string) =>
      request<{ revoked: number }>(
        `/api/builder/tenants/${encodeURIComponent(userId)}/revoke-sessions`,
        { method: 'POST' },
        true
      ),

    inspectTenant: (userId: string) =>
      request<BuilderTenantInspection>(
        `/api/builder/tenants/${encodeURIComponent(userId)}/inspect`,
        {},
        true
      ),

    replayDiagnostic: (diagId: string) =>
      request<{ item: BuilderDiagnosticFailure }>(
        `/api/builder/diagnostics/${encodeURIComponent(diagId)}/replay`,
        { method: 'POST' },
        true
      ),

    updateFlags: (patch: Partial<BuilderFeatureFlags>) =>
      request<{ flags: BuilderFeatureFlags }>(
        '/api/builder/flags',
        { method: 'PATCH', body: JSON.stringify(patch) },
        true
      ),
  },
};
