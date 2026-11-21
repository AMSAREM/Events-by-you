import { LocalApiError, localFallbackRequest } from './localFallbackApi';
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
  GiftTableAttendantLink,
  GiftTableEntry,
  OrganizerProfile,
  ScheduleBlock,
  SmsBundlePurchase,
  SubscriptionPayment,
  SystemAlert,
  WebhookTriggerEvent,
} from '../types/events';

const SESSION_KEY = 'eventsapp_supabase_session_v1';
const CREATOR_TOKEN_KEY = 'eventsapp_creator_token_v1';

let useLocalFallback = false;

export function isLocalFallbackMode(): boolean {
  return useLocalFallback;
}

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

export interface ArkeselStatusResponse {
  configured: boolean;
  paystackConfigured?: boolean;
  mode: 'live' | 'sandbox';
  live: boolean;
  smsBalance: number | null;
  mainBalance: number | null;
  error: string | null;
  senderId: string;
  isDefaultUnverifiedSender: boolean;
  organizerCredits: number;
  apiInfoUrl: string;
  rechargeUrl: string;
  checkedAt: string;
}

export interface ArkeselBundlePurchaseResponse {
  ok: boolean;
  alreadyCredited?: boolean;
  pendingVerification?: boolean;
  profile: OrganizerProfile;
  purchase?: SmsBundlePurchase;
  bundleId: string;
  bundleName: string;
  addedCredits: number;
  amountGhs: number;
  paymentChannel: string;
  arkeselReference: string;
  portalPurchaseRequired: boolean;
  arkeselStatus: ArkeselStatusResponse;
  message: string;
}

export interface PaystackInitializeResponse {
  ok: boolean;
  reference: string;
  authorizationUrl: string;
  accessCode?: string;
  purchase: SmsBundlePurchase;
  quote: {
    bundleId: string;
    bundleName: string;
    credits: number;
    amountGhs: number;
    unitRateGhs: number;
  };
}

export interface SubscriptionPaystackInitializeResponse {
  ok: boolean;
  reference: string;
  authorizationUrl: string;
  accessCode?: string;
  payment: SubscriptionPayment;
  quote: {
    planId: 'pro' | 'enterprise';
    planName: 'Pro Organizer' | 'Enterprise';
    billingCycle: 'monthly' | 'annual';
    amountUsd: number;
    amountGhs: number;
    durationDays: number;
  };
}

export interface SubscriptionCheckoutResponse {
  ok: boolean;
  alreadyActivated?: boolean;
  activated?: boolean;
  pendingVerification?: boolean;
  profile: OrganizerProfile;
  payment: SubscriptionPayment;
  message: string;
}

function sanitizeTokenValue(raw?: string | null): string {
  if (!raw || typeof raw !== 'string') return '';
  let cleaned = raw.trim().replace(/^['"]|['"]$/g, '').trim();
  if (/^Bearer\s+/i.test(cleaned)) {
    cleaned = cleaned.replace(/^Bearer\s+/i, '').trim();
  }
  cleaned = cleaned.replace(/^['"]|['"]$/g, '').trim();
  if (!cleaned || cleaned === 'null' || cleaned === 'undefined') return '';
  return cleaned;
}

export function getStoredSession(): StoredAuthSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredAuthSession;
    const accessToken = sanitizeTokenValue(parsed?.accessToken);
    if (!accessToken) {
      localStorage.removeItem(SESSION_KEY);
      return null;
    }
    return {
      accessToken,
      refreshToken: sanitizeTokenValue(parsed?.refreshToken),
      expiresAt: parsed?.expiresAt,
    };
  } catch {
    return null;
  }
}

export function saveStoredSession(session: StoredAuthSession | null): void {
  try {
    const accessToken = sanitizeTokenValue(session?.accessToken);
    if (!session || !accessToken) {
      localStorage.removeItem(SESSION_KEY);
    } else {
      localStorage.setItem(
        SESSION_KEY,
        JSON.stringify({
          ...session,
          accessToken,
          refreshToken: sanitizeTokenValue(session.refreshToken),
        })
      );
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
    const accessToken = sanitizeTokenValue(params.get('access_token'));
    const refreshToken = sanitizeTokenValue(params.get('refresh_token'));
    const expiresIn = Number(params.get('expires_in') || 3600);
    if (!accessToken || accessToken.split('.').length !== 3) return null;
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

const RAW_API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').trim().replace(/\/+$/, '');
const API_BASE_URL = RAW_API_BASE_URL.replace(/\/api$/i, '');

export function resolveApiUrl(url: string): string {
  if (!API_BASE_URL || /^https?:\/\//i.test(url)) return url;
  return `${API_BASE_URL}${url.startsWith('/') ? url : `/${url}`}`;
}

async function refreshStoredSession(): Promise<StoredAuthSession | null> {
  const current = getStoredSession();
  if (!current?.refreshToken) return null;
  if (useLocalFallback) {
    try {
      const data = await localFallbackRequest<{ session: StoredAuthSession }>('/api/auth/refresh', {
        method: 'POST',
        body: JSON.stringify({ refreshToken: current.refreshToken }),
      });
      if (data.session?.accessToken) {
        saveStoredSession(data.session);
        return data.session;
      }
      saveStoredSession(null);
      return null;
    } catch {
      saveStoredSession(null);
      return null;
    }
  }

  try {
    const resp = await fetch(resolveApiUrl('/api/auth/refresh'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: current.refreshToken }),
    });
    const contentType = (resp.headers.get('content-type') || '').toLowerCase();
    const rawText = await resp.text();
    let parsed: { session?: StoredAuthSession } | null = null;
    if (rawText) {
      try {
        parsed = JSON.parse(rawText) as { session?: StoredAuthSession };
      } catch {
        parsed = null;
      }
    }
    if (
      (resp.status === 404 || resp.status === 405) && (!parsed || contentType.includes('text/html')) ||
      (!parsed && contentType.includes('text/html'))
    ) {
      useLocalFallback = true;
      return refreshStoredSession();
    }
    if (!resp.ok) {
      saveStoredSession(null);
      return null;
    }
    if (parsed?.session?.accessToken) {
      saveStoredSession(parsed.session);
      return parsed.session;
    }
    saveStoredSession(null);
    return null;
  } catch {
    return null;
  }
}

async function executeLocalFallback<T>(
  url: string,
  options: RequestInit,
  authenticated: boolean,
  retried: boolean,
  accessToken?: string
): Promise<T> {
  try {
    return await localFallbackRequest<T>(url, options, accessToken);
  } catch (err) {
    if (err instanceof LocalApiError && err.status === 401 && authenticated && !retried) {
      const refreshed = await refreshStoredSession();
      if (refreshed) {
        return executeLocalFallback<T>(url, options, true, true, refreshed.accessToken);
      }
    }
    throw err;
  }
}

export class ApiError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

async function request<T>(
  url: string,
  options: RequestInit = {},
  authenticated = false,
  retried = false
): Promise<T> {
  const session = authenticated ? getStoredSession() : null;
  if (authenticated && !session?.accessToken) {
    throw new Error('Authentication required. Please sign in.');
  }

  if (useLocalFallback) {
    return executeLocalFallback<T>(url, options, authenticated, retried, session?.accessToken);
  }

  const targetUrl = resolveApiUrl(url);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((options.headers as Record<string, string>) || {}),
  };

  if (authenticated && session?.accessToken) {
    headers.Authorization = `Bearer ${session.accessToken}`;
    const creatorToken = getStoredCreatorToken();
    if (creatorToken) {
      headers['X-Creator-Token'] = creatorToken;
    }
  }

  let resp: Response;
  try {
    resp = await fetch(targetUrl, { ...options, headers });
  } catch {
    useLocalFallback = true;
    return executeLocalFallback<T>(url, options, authenticated, retried, session?.accessToken);
  }

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

  const contentType = (resp.headers.get('content-type') || 'unknown').toLowerCase();
  const isStaticMissingApi =
    ((resp.status === 404 || resp.status === 405) &&
      (!parsed || contentType.includes('text/html'))) ||
    (!parsed && contentType.includes('text/html'));

  if (isStaticMissingApi) {
    useLocalFallback = true;
    return executeLocalFallback<T>(url, options, authenticated, retried, session?.accessToken);
  }

  if (!resp.ok) {
    const parsedErr = parsed as { error?: string; code?: string } | null;
    const errMsg = parsedErr?.error || `Request failed (${resp.status})`;
    const lowerErr = errMsg.toLowerCase();
    if (
      authenticated &&
      (resp.status === 401 ||
        parsedErr?.code === 'INVALID_SESSION_TOKEN' ||
        lowerErr.includes('invalid jwt') ||
        lowerErr.includes('token is malformed') ||
        lowerErr.includes('invalid number of segment'))
    ) {
      saveStoredSession(null);
      saveStoredCreatorToken(null);
    }
    throw new ApiError(errMsg, resp.status, parsedErr?.code);
  }

  if (!parsed || typeof parsed !== 'object') {
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
      arkeselSenderIdConfigured?: boolean;
      arkeselActiveSenderId?: string;
      smsMode?: 'live' | 'sandbox';
      otpStorage?: string;
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
        smsSenderId?: string;
        smsMessageId?: string;
        smsWarning?: string;
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
        smsSenderId?: string;
        smsMessageId?: string;
        smsWarning?: string;
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
        smsSenderId?: string;
        smsMessageId?: string;
        smsWarning?: string;
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
        smsSenderId?: string;
        smsMessageId?: string;
        smsWarning?: string;
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

    getEventBySlugOrId: (slugOrId: string) =>
      request<{ event: EventItem }>(`/api/public/events/${encodeURIComponent(slugOrId)}`),

    registerAttendee: (
      eventId: string,
      payload: {
        name: string;
        email: string;
        phone: string;
        organization?: string;
        tier?: Attendee['tier'];
        ticketCode?: string;
        validationGroup?: string;
        inviteCodeUsed?: string;
        giftEntry?: Attendee['giftEntry'];
        customResponses?: Record<string, string>;
      }
    ) =>
      request<{
        attendee: Attendee;
        event: EventItem;
        smsCreditsUsed?: number;
        smsCreditsRemaining?: number;
        smsSkippedReason?: string;
      }>(
        `/api/public/events/${encodeURIComponent(eventId)}/register`,
        {
          method: 'POST',
          body: JSON.stringify(payload),
        }
      ),

    lookupPass: (eventId: string, query: string) =>
      request<{ attendee: Attendee }>(
        `/api/public/events/${encodeURIComponent(eventId)}/pass-lookup`,
        {
          method: 'POST',
          body: JSON.stringify({ query }),
        }
      ),

    getCameraRoll: (slugOrId: string, passCode?: string) =>
      request<{
        event: EventItem;
        shots: DisposableShot[];
        rollSettings: DisposableRollSettings;
        verifiedPass?: {
          attendeeName: string;
          ticketCode: string;
          checkedIn: boolean;
          tier: string;
        } | null;
      }>(
        `/api/public/camera/${encodeURIComponent(slugOrId)}${
          passCode?.trim() ? `?pass=${encodeURIComponent(passCode.trim())}` : ''
        }`
      ),

    addCameraShot: (slugOrId: string, shot: DisposableShot) =>
      request<{ shot: DisposableShot }>(
        `/api/public/camera/${encodeURIComponent(slugOrId)}/shots`,
        { method: 'POST', body: JSON.stringify(shot) }
      ),

    toggleLikeCameraShot: (shotId: string) =>
      request<{ shot: DisposableShot }>(
        `/api/public/camera/shots/${encodeURIComponent(shotId)}/like`,
        { method: 'PATCH' }
      ),

    submitGiftTableEntry: (
      slugOrId: string,
      payload: Omit<GiftTableEntry, 'id' | 'eventId' | 'createdAt' | 'recordedVia'>
    ) =>
      request<{ gift: GiftTableEntry; event: EventItem }>(
        `/api/public/events/${encodeURIComponent(slugOrId)}/gifts`,
        { method: 'POST', body: JSON.stringify(payload) }
      ),

    getGiftDeskSession: (slugOrId: string, token: string) =>
      request<{
        event: EventItem;
        attendant: Omit<GiftTableAttendantLink, 'token'>;
      }>(
        `/api/public/events/${encodeURIComponent(slugOrId)}/gift-desk/${encodeURIComponent(token)}`
      ),

    submitGiftDeskEntry: (
      slugOrId: string,
      token: string,
      payload: Omit<
        GiftTableEntry,
        'id' | 'eventId' | 'createdAt' | 'recordedVia' | 'recordedBy' | 'attendantLinkId'
      >
    ) =>
      request<{
        gift: GiftTableEntry;
        event: EventItem;
        attendant: Omit<GiftTableAttendantLink, 'token'>;
      }>(
        `/api/public/events/${encodeURIComponent(slugOrId)}/gift-desk/${encodeURIComponent(token)}`,
        { method: 'POST', body: JSON.stringify(payload) }
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

    getArkeselStatus: () =>
      request<ArkeselStatusResponse>('/api/studio/arkesel/status', {}, true),

    getSmsPurchases: () =>
      request<{
        purchases: SmsBundlePurchase[];
        paystackConfigured: boolean;
        mode: 'live' | 'sandbox';
      }>('/api/studio/sms/purchases', {}, true),

    initializePaystackBundle: (payload: {
      bundleId: string;
      credits: number;
      amountGhs: number;
      callbackUrl?: string;
    }) =>
      request<PaystackInitializeResponse>(
        '/api/studio/sms/paystack/initialize',
        { method: 'POST', body: JSON.stringify(payload) },
        true
      ),

    verifyPaystackBundle: (reference: string) =>
      request<ArkeselBundlePurchaseResponse>(
        `/api/studio/sms/paystack/verify/${encodeURIComponent(reference)}`,
        {},
        true
      ),

    purchaseSmsBundle: (payload: {
      bundleId: string;
      bundleName: string;
      credits: number;
      amountGhs: number;
      paymentChannel: string;
      arkeselReference: string;
    }) =>
      request<ArkeselBundlePurchaseResponse>(
        '/api/studio/sms/purchase-bundle',
        { method: 'POST', body: JSON.stringify(payload) },
        true
      ),

    getSubscriptionPayments: () =>
      request<{
        payments: SubscriptionPayment[];
        paystackConfigured: boolean;
        mode: 'live' | 'sandbox';
      }>('/api/studio/subscription/payments', {}, true),

    initializeSubscriptionPaystack: (payload: {
      planId: 'pro' | 'enterprise';
      planName?: 'Pro Organizer' | 'Enterprise';
      billingCycle: 'monthly' | 'annual';
      amountGhs?: number;
      callbackUrl?: string;
    }) =>
      request<SubscriptionPaystackInitializeResponse>(
        '/api/studio/subscription/paystack/initialize',
        { method: 'POST', body: JSON.stringify(payload) },
        true
      ),

    verifySubscriptionPaystack: (reference: string) =>
      request<SubscriptionCheckoutResponse>(
        `/api/studio/subscription/paystack/verify/${encodeURIComponent(reference)}`,
        {},
        true
      ),

    purchaseSubscription: (payload: {
      planId: 'pro' | 'enterprise';
      planName?: 'Pro Organizer' | 'Enterprise';
      billingCycle: 'monthly' | 'annual';
      amountGhs: number;
      paymentChannel: string;
      receiptReference: string;
    }) =>
      request<SubscriptionCheckoutResponse>(
        '/api/studio/subscription/purchase',
        { method: 'POST', body: JSON.stringify(payload) },
        true
      ),

    downgradeSubscription: () =>
      request<{ ok: boolean; profile: OrganizerProfile; message: string }>(
        '/api/studio/subscription/downgrade',
        { method: 'POST' },
        true
      ),

    deleteAccount: () =>
      request<{ ok: boolean; deletedUserId?: string }>(
        '/api/studio/account',
        { method: 'DELETE', body: JSON.stringify({ confirmation: 'DELETE' }) },
        true
      ),

    testSms: (payload: { phone: string; senderId?: string }) =>
      request<{
        ok: boolean;
        phone: string;
        senderId: string;
        messageId?: string;
        sandbox?: boolean;
        warning?: string;
        smsCredits: number;
      }>(
        '/api/studio/sms/test',
        { method: 'POST', body: JSON.stringify(payload) },
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
      request<{
        attendee: Attendee;
        event: EventItem;
        cameraUrl?: string;
        dispatchedMessage?: string;
        smsCredits?: number;
        smsCreditsUsed?: number;
        smsSkippedReason?: string;
      }>(
        `/api/studio/events/${encodeURIComponent(eventId)}/attendees`,
        { method: 'POST', body: JSON.stringify(attendee) },
        true
      ),

    toggleCheckIn: (attendeeId: string) =>
      request<{
        attendee: Attendee;
        checkInMessageSent?: boolean;
        checkInSmsSent?: boolean;
        cameraUrl?: string;
        dispatchedMessage?: string;
        smsCredits?: number;
        smsCreditsUsed?: number;
        smsSkippedReason?: string;
      }>(
        `/api/studio/attendees/${encodeURIComponent(attendeeId)}/checkin`,
        { method: 'PATCH' },
        true
      ),

    recordGiftTableEntry: (
      eventId: string,
      payload: Omit<GiftTableEntry, 'id' | 'eventId' | 'createdAt' | 'recordedVia'>
    ) =>
      request<{ gift: GiftTableEntry; event: EventItem }>(
        `/api/studio/events/${encodeURIComponent(eventId)}/gifts`,
        { method: 'POST', body: JSON.stringify(payload) },
        true
      ),

    createGiftAttendantLink: (
      eventId: string,
      payload: { attendantName: string; roleLabel?: string; phone?: string }
    ) =>
      request<{ link: GiftTableAttendantLink; event: EventItem }>(
        `/api/studio/events/${encodeURIComponent(eventId)}/gift-links`,
        { method: 'POST', body: JSON.stringify(payload) },
        true
      ),

    toggleGiftAttendantLink: (eventId: string, linkId: string, active?: boolean) =>
      request<{ link: GiftTableAttendantLink; event: EventItem }>(
        `/api/studio/events/${encodeURIComponent(eventId)}/gift-links/${encodeURIComponent(linkId)}`,
        { method: 'PATCH', body: JSON.stringify({ active }) },
        true
      ),

    deleteGiftAttendantLink: (eventId: string, linkId: string) =>
      request<{ ok: boolean; event: EventItem }>(
        `/api/studio/events/${encodeURIComponent(eventId)}/gift-links/${encodeURIComponent(linkId)}`,
        { method: 'DELETE' },
        true
      ),

    retryPayment: (attendeeId: string) =>
      request<{ attendee: Attendee }>(
        `/api/studio/attendees/${encodeURIComponent(attendeeId)}/retry-payment`,
        { method: 'PATCH' },
        true
      ),

    broadcastUpdate: (payload: {
      eventId?: string;
      attendeeIds: string[];
      message: string;
      channel?: 'email' | 'sms' | 'dual';
    }) =>
      request<{
        ok: boolean;
        recipientCount: number;
        sentCount: number;
        creditsUsed?: number;
        smsCredits?: number;
        events: EventItem[];
      }>(
        '/api/studio/broadcast',
        { method: 'POST', body: JSON.stringify(payload) },
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

    syncSmsDlr: () =>
      request<{
        ok: boolean;
        balance: { ok: boolean; balanceCredits?: number; error?: string };
        dlr: { ok: boolean; checked: number; updated: number; error?: string };
        emailDiagnostics?: BuilderConsoleOverview['emailDiagnostics'];
        recentDispatches?: BuilderConsoleOverview['smsTelemetry']['recentDispatches'];
      }>('/api/builder/sms/sync-dlr', { method: 'POST' }, true),

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

    updateTenantRole: (
      userId: string,
      appRole: Extract<AppRole, 'organizer' | 'gate_staff'>
    ) =>
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

    resolveSmsPurchase: (
      purchaseId: string,
      action: 'approve' | 'reject',
      reason?: string
    ) =>
      request<{
        ok: boolean;
        alreadyCredited?: boolean;
        purchase: SmsBundlePurchase;
        smsCredits: number;
      }>(
        `/api/builder/sms-purchases/${encodeURIComponent(purchaseId)}/resolve`,
        { method: 'POST', body: JSON.stringify({ action, reason }) },
        true
      ),

    resolveSubscriptionPurchase: (
      paymentId: string,
      action: 'approve' | 'reject',
      reason?: string
    ) =>
      request<{
        ok: boolean;
        alreadyActivated?: boolean;
        payment: SubscriptionPayment;
        plan?: OrganizerProfile['plan'];
      }>(
        `/api/builder/subscription-purchases/${encodeURIComponent(paymentId)}/resolve`,
        { method: 'POST', body: JSON.stringify({ action, reason }) },
        true
      ),
  },
};
