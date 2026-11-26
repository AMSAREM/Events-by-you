import {
  INITIAL_ALERTS,
  INITIAL_ATTENDEES,
  INITIAL_DISPOSABLE_SHOTS,
  INITIAL_EVENTS,
  INITIAL_PROFILE,
  INITIAL_ROLL_SETTINGS,
  INITIAL_SCHEDULE,
  normalizePhoneE164,
  validateStrictEmail,
  validateStrictPassword,
  validateStrictPhoneE164,
} from '../data/initialData';
import { appendPoweredByLine, calculateSmsCredits, resolveEventMessage } from './eventMessages';
import { resolveAuthoritativeSmsBundle, validateReceiptReference } from './smsBundles';
import {
  DEFAULT_SHARED_SENDER_ID,
  PLAN_MRR_USD,
  computePlanExpiresAtIso,
  getEffectiveEventCapacity,
  getPlanEntitlements,
  hasCustomMessageOverrides,
  hasCustomSenderIdValue,
  isActiveEventStatus,
  resolveAuthoritativeSubscriptionQuote,
} from './subscriptionPlans';
import {
  buildValidatedPollOptions,
  normalizePollStatus,
  sanitizePollForPublic,
  sanitizePublicExtraDataConfig,
} from './polls';
import {
  createStarterPlanningConfig,
  sanitizeEventPlanningConfig,
} from './planningTemplates';
import type {
  AppRole,
  Attendee,
  BuilderConsoleOverview,
  BuilderDiagnosticFailure,
  BuilderErrorEntry,
  BuilderEventTrafficRow,
  BuilderFeatureFlags,
  BuilderSmsQueueItem,
  BuilderTenantInspection,
  BuilderTenantSummary,
  BuilderTenantUnitEconomics,
  CreatorApp,
  CreatorAppEnvironment,
  CreatorAppLog,
  CreatorAppScope,
  CreatorAppStatus,
  CreatorAppType,
  DisposableRollSettings,
  DisposableShot,
  EventItem,
  EventPoll,
  GiftTableAttendantLink,
  GiftTableEntry,
  OrganizerProfile,
  ScheduleBlock,
  SmsBundlePurchase,
  SubscriptionPayment,
  SystemAlert,
  WebhookTriggerEvent,
} from '../types/events';

const STORAGE_KEY = 'eventsapp_local_backend_v1';
const SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const CREATOR_EMAIL = 'amoakoimml@gmail.com';

export class LocalApiError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

interface LocalUser {
  id: string;
  email: string;
  passwordHash: string | null;
  profile: OrganizerProfile;
  suspended: boolean;
  lastLoginAt: string;
  createdAt: string;
}

interface LocalSession {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  lastActivityAt: number;
  userId: string;
}

interface PendingSignup {
  phone: string;
  email: string;
  password: string;
  name: string;
  studio: string;
  countryGateway: string;
  appRole: Extract<AppRole, 'organizer' | 'gate_staff'>;
  createdAt: number;
  expiresAt: number;
}

interface StoredCreatorAppRecord extends CreatorApp {
  organizerId: string;
  secretPrefix: string;
  webhookSecret: string;
}

interface LocalDatabase {
  users: Record<string, LocalUser>;
  sessions: Record<string, LocalSession>;
  pendingSignups: Record<string, PendingSignup>;
  events: Array<EventItem & { organizerId: string }>;
  attendees: Attendee[];
  scheduleBlocks: ScheduleBlock[];
  alerts: Array<SystemAlert & { organizerId: string }>;
  disposableShots: DisposableShot[];
  rollSettings: Record<string, DisposableRollSettings>;
  creatorApps: StoredCreatorAppRecord[];
  creatorAppLogs: CreatorAppLog[];
  smsPurchases: SmsBundlePurchase[];
  subscriptionPayments: SubscriptionPayment[];
  flags: BuilderFeatureFlags;
  recentErrors: BuilderErrorEntry[];
  duplicateBlocksByEvent: Record<string, number>;
  diagnosticFailures: BuilderDiagnosticFailure[];
  gatewayBalanceCredits: number;
}

function randomHex(bytes = 12): string {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const arr = new Uint8Array(bytes);
    crypto.getRandomValues(arr);
    return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
  }
  let out = '';
  for (let i = 0; i < bytes; i++) {
    out += Math.floor(Math.random() * 256)
      .toString(16)
      .padStart(2, '0');
  }
  return out;
}

function hashString(input: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `${(h2 >>> 0).toString(16).padStart(8, '0')}${(h1 >>> 0).toString(16).padStart(8, '0')}`;
}

function hashPassword(password: string): string {
  return `pw_${hashString(`eventsapp-pw:${password}`)}`;
}

function createInitialDb(): LocalDatabase {
  const creatorId = 'usr-primary-creator';

  const creatorProfile: OrganizerProfile = {
    ...INITIAL_PROFILE,
    name: 'Apps Creator',
    firstName: 'Creator',
    role: 'Apps Creator',
    appRole: 'creator',
    email: CREATOR_EMAIL,
    studio: 'Apps Creator Console',
    plan: 'Pro Organizer',
    smsCredits: 0,
    capacityAlertThreshold: 90,
    timezone: 'Africa/Accra',
    twoFactorEnabled: false,
    senderId: 'EVENTSAPP',
  };

  const users: Record<string, LocalUser> = {
    [creatorId]: {
      id: creatorId,
      email: CREATOR_EMAIL,
      passwordHash: null,
      profile: creatorProfile,
      suspended: false,
      lastLoginAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    },
  };

  return {
    users,
    sessions: {},
    pendingSignups: {},
    events: [],
    attendees: [],
    scheduleBlocks: [],
    alerts: [],
    disposableShots: [],
    rollSettings: {},
    creatorApps: [],
    creatorAppLogs: [],
    smsPurchases: [],
    subscriptionPayments: [],
    flags: {
      publicRegistrationsPaused: false,
      pausedEventIds: [],
      smsMode: 'sandbox',
      signupsEnabled: true,
      starterSeedingEnabled: false,
    },
    recentErrors: [],
    duplicateBlocksByEvent: {},
    diagnosticFailures: [],
    gatewayBalanceCredits: 0,
  };
}

let memoryFallbackCache: LocalDatabase | null = null;

function loadDb(): LocalDatabase {
  if (memoryFallbackCache) return memoryFallbackCache;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as LocalDatabase;
      if (parsed && typeof parsed === 'object' && parsed.users) {
        if (!Array.isArray(parsed.smsPurchases)) {
          parsed.smsPurchases = [];
        }
        if (!Array.isArray(parsed.subscriptionPayments)) {
          parsed.subscriptionPayments = [];
        }
        memoryFallbackCache = parsed;
        return parsed;
      }
    }
  } catch {
    // Ignore storage read errors
  }
  const initial = createInitialDb();
  memoryFallbackCache = initial;
  saveDb(initial);
  return initial;
}

function saveDb(db: LocalDatabase): void {
  memoryFallbackCache = db;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
  } catch {
    // Ignore quota errors in restricted browsing modes
  }
}

function findUserByEmail(db: LocalDatabase, email: string): LocalUser | null {
  const target = email.trim().toLowerCase();
  return Object.values(db.users).find((u) => u.email.toLowerCase() === target) ?? null;
}

function findUserByPhone(db: LocalDatabase, phone: string, gateway = 'GH'): LocalUser | null {
  const normalized = normalizePhoneE164(phone, gateway);
  if (!normalized) return null;
  return (
    Object.values(db.users).find(
      (u) => u.profile.phone && normalizePhoneE164(u.profile.phone, gateway) === normalized
    ) ?? null
  );
}

function createSession(db: LocalDatabase, userId: string): LocalSession {
  const accessToken = `loc_acc_${randomHex(16)}`;
  const refreshToken = `loc_ref_${randomHex(16)}`;
  const expiresAt = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60;
  const session: LocalSession = {
    accessToken,
    refreshToken,
    expiresAt,
    lastActivityAt: Date.now(),
    userId,
  };
  db.sessions[accessToken] = session;
  saveDb(db);
  return session;
}

function getSessionResponse(session: LocalSession) {
  return {
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
    expiresAt: session.expiresAt,
  };
}

function getAuthenticatedUser(
  db: LocalDatabase,
  accessToken?: string | null,
  exemptIdleTimeout = false
): LocalUser {
  if (!accessToken) {
    throw new LocalApiError('Authentication required. Please sign in.', 401);
  }
  const sess = db.sessions[accessToken];
  if (!sess) {
    throw new LocalApiError('Session expired. Please sign in again.', 401);
  }
  const now = Date.now();
  const idleTimedOut = !exemptIdleTimeout && now - sess.lastActivityAt > SESSION_IDLE_TIMEOUT_MS;
  if (sess.expiresAt * 1000 < now || idleTimedOut) {
    delete db.sessions[accessToken];
    saveDb(db);
    throw new LocalApiError('Session timed out after 30 minutes of inactivity. Sign in again.', 401);
  }
  const user = db.users[sess.userId];
  if (!user || user.suspended) {
    throw new LocalApiError('Session expired or account suspended.', 401);
  }
  sess.lastActivityAt = now;
  saveDb(db);
  return user;
}

function getEffectiveRole(user: LocalUser): AppRole {
  if (user.email.trim().toLowerCase() === CREATOR_EMAIL) {
    return 'creator';
  }
  return user.profile.appRole === 'gate_staff' ? 'gate_staff' : 'organizer';
}

function requireRoles(user: LocalUser, allowed: AppRole[]): void {
  const role = getEffectiveRole(user);
  if (!allowed.includes(role)) {
    throw new LocalApiError('Access denied for your account role.', 403);
  }
}

function estimateShotBytes(dataUrl: string): number {
  if (!dataUrl) return 0;
  if (dataUrl.startsWith('data:')) {
    return Math.round((dataUrl.length * 3) / 4);
  }
  return 420 * 1024;
}

function loadUserWorkspace(db: LocalDatabase, userId: string) {
  const user = db.users[userId];
  if (!user) throw new LocalApiError('User not found.', 404);
  const events = db.events
    .filter((e) => e.organizerId === userId)
    .map(({ organizerId: _org, ...rest }) => rest);
  const evtIds = new Set(events.map((e) => e.id));
  const attendees = db.attendees.filter((a) => evtIds.has(a.eventId));
  const scheduleBlocks = db.scheduleBlocks.filter((b) => evtIds.has(b.eventId));
  const alerts = db.alerts
    .filter((al) => al.organizerId === userId)
    .map(({ organizerId: _org, ...rest }) => rest);
  const disposableShots = db.disposableShots.filter((s) => evtIds.has(s.eventId));
  const rollSettings: Record<string, DisposableRollSettings> = {};
  for (const eid of evtIds) {
    if (db.rollSettings[eid]) rollSettings[eid] = db.rollSettings[eid];
  }
  const creatorApps = db.creatorApps
    .filter((a) => a.organizerId === userId)
    .map(({ organizerId: _org, webhookSecret: _ws, ...rest }) => rest);
  const appIds = new Set(creatorApps.map((a) => a.id));
  const creatorAppLogs = db.creatorAppLogs.filter((l) => appIds.has(l.appId));

  return {
    profile: user.profile,
    events,
    attendees,
    scheduleBlocks,
    alerts,
    disposableShots,
    rollSettings,
    creatorApps,
    creatorAppLogs,
  };
}

function buildTenantSummary(db: LocalDatabase, u: LocalUser): BuilderTenantSummary {
  const uEvts = db.events.filter((e) => e.organizerId === u.id);
  const evtIds = new Set(uEvts.map((e) => e.id));
  const uAtts = db.attendees.filter((a) => evtIds.has(a.eventId));
  const uShots = db.disposableShots.filter((s) => evtIds.has(s.eventId));
  const bytes = uShots.reduce((acc, s) => acc + estimateShotBytes(s.dataUrl), 0);
  return {
    id: u.id,
    name: u.profile.name,
    email: u.email,
    studio: u.profile.studio,
    appRole: getEffectiveRole(u),
    plan: u.profile.plan,
    smsCredits: u.profile.smsCredits,
    eventsCount: uEvts.length,
    attendeesCount: uAtts.length,
    shotsCount: uShots.length,
    storageMb: Number((bytes / (1024 * 1024)).toFixed(2)),
    suspended: u.suspended,
    lastLoginAt: u.lastLoginAt,
    createdAt: u.createdAt,
  };
}

function seedStarterForUser(db: LocalDatabase, userId: string, organizerName: string): void {
  const hasExisting = db.events.some((e) => e.organizerId === userId);
  if (hasExisting) return;
  const suffix = `-${userId.slice(0, 8)}`;
  for (const evt of INITIAL_EVENTS) {
    const id = `${evt.id}${suffix}`;
    db.events.push({
      ...evt,
      id,
      slug: `${evt.slug}${suffix}`,
      organizer: organizerName || evt.organizer,
      organizerId: userId,
    });
  }
  for (const att of INITIAL_ATTENDEES) {
    db.attendees.push({
      ...att,
      id: `${att.id}${suffix}`,
      eventId: `${att.eventId}${suffix}`,
    });
  }
  for (const blk of INITIAL_SCHEDULE) {
    db.scheduleBlocks.push({
      ...blk,
      id: `${blk.id}${suffix}`,
      eventId: `${blk.eventId}${suffix}`,
    });
  }
  for (const al of INITIAL_ALERTS) {
    db.alerts.push({
      ...al,
      id: `${al.id}${suffix}`,
      eventId: al.eventId ? `${al.eventId}${suffix}` : undefined,
      organizerId: userId,
    });
  }
  for (const [eid, cfg] of Object.entries(INITIAL_ROLL_SETTINGS)) {
    db.rollSettings[`${eid}${suffix}`] = { ...cfg };
  }
  for (const shot of INITIAL_DISPOSABLE_SHOTS) {
    db.disposableShots.push({
      ...shot,
      id: `${shot.id}${suffix}`,
      eventId: `${shot.eventId}${suffix}`,
    });
  }
}

export async function localFallbackRequest<T>(
  url: string,
  options: RequestInit = {},
  accessToken?: string | null
): Promise<T> {
  const db = loadDb();
  const parsedUrl = new URL(url, 'http://localhost');
  const path = parsedUrl.pathname.replace(/^\/api/, '');
  const method = (options.method || 'GET').toUpperCase();
  const headerBag = (options.headers || {}) as Record<string, string>;
  const exemptCheckInTimeout =
    headerBag['X-CheckIn-Active'] === '1' ||
    headerBag['x-checkin-active'] === '1' ||
    /\/checkin$/i.test(path);

  let body: Record<string, unknown> = {};
  if (typeof options.body === 'string' && options.body.trim()) {
    try {
      body = JSON.parse(options.body) as Record<string, unknown>;
    } catch {
      body = {};
    }
  }

  // Health
  if (method === 'GET' && path === '/health') {
    return {
      ok: true,
      database: 'browser-local',
      supabaseConfigured: false,
      arkeselConfigured: false,
      arkeselSenderIdConfigured: Boolean(db.flags.arkeselSenderId),
      arkeselActiveSenderId: db.flags.arkeselSenderId || 'EVENTSAPP',
      smsMode: db.flags.smsMode,
      otpStorage: 'browser-local',
      inMemoryFallback: true,
      creatorEmail: CREATOR_EMAIL,
      creatorPasswordConfigured: false,
    } as T;
  }

  // Auth: Creator login
  if (method === 'POST' && path === '/auth/creator-login') {
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    if (!email || !password) {
      throw new LocalApiError('Creator email and password are required.', 400);
    }
    if (email !== CREATOR_EMAIL) {
      throw new LocalApiError(`Apps Creator login is restricted to ${CREATOR_EMAIL}.`, 401);
    }
    let user = findUserByEmail(db, CREATOR_EMAIL);
    if (!user) {
      const fresh = createInitialDb();
      user = findUserByEmail(fresh, CREATOR_EMAIL)!;
      db.users[user.id] = user;
    }
    if (!user.passwordHash) {
      user.passwordHash = hashPassword(password);
    }
    user.lastLoginAt = new Date().toISOString();
    const session = createSession(db, user.id);
    saveDb(db);
    return {
      requiresOtp: false,
      creatorToken: `loc_creator_${user.id}`,
      session: getSessionResponse(session),
      profile: user.profile,
    } as T;
  }

  // Auth: Sign in
  if (method === 'POST' && path === '/auth/signin') {
    const rawIdentifier = String(body.identifier || body.phone || body.email || '').trim();
    const password = String(body.password || '');
    const countryGateway = String(body.countryGateway || 'GH');
    if (!rawIdentifier || !password) {
      throw new LocalApiError('Mobile phone number (or email) and password are required.', 400);
    }
    const isEmail = rawIdentifier.includes('@');
    const user = isEmail
      ? findUserByEmail(db, rawIdentifier)
      : findUserByPhone(db, rawIdentifier, countryGateway);
    if (!user) {
      throw new LocalApiError(
        isEmail
          ? 'Invalid email or password. Create a free account or use a 6-digit code.'
          : 'Invalid mobile number or password. Create a free account or use a 6-digit SMS code.',
        401
      );
    }
    if (user.suspended) {
      throw new LocalApiError('This organiser account has been suspended. Contact support.', 403);
    }
    if (user.passwordHash && user.passwordHash !== hashPassword(password)) {
      throw new LocalApiError('Invalid login credentials.', 401);
    }
    if (!user.passwordHash) {
      user.passwordHash = hashPassword(password);
    }
    user.lastLoginAt = new Date().toISOString();
    const session = createSession(db, user.id);
    saveDb(db);
    return {
      requiresOtp: false,
      session: getSessionResponse(session),
      profile: user.profile,
    } as T;
  }

  // Auth: Sign up
  if (method === 'POST' && path === '/auth/signup') {
    if (!db.flags.signupsEnabled) {
      throw new LocalApiError(
        'New organiser signups are temporarily paused by platform administrator.',
        403
      );
    }
    const trimmedName = String(body.name || '').trim();
    if (trimmedName.length < 2) {
      throw new LocalApiError('Full name must be at least 2 characters.', 400);
    }
    const gateway = String(body.countryGateway || 'GH');
    const phoneCheck = validateStrictPhoneE164(String(body.phone || ''), gateway);
    if (!phoneCheck.ok) {
      throw new LocalApiError(phoneCheck.error, 400);
    }
    const emailCheck = validateStrictEmail(String(body.email || ''));
    if (!emailCheck.ok) {
      throw new LocalApiError(emailCheck.error, 400);
    }
    const pwCheck = validateStrictPassword(String(body.password || ''));
    if (!pwCheck.ok) {
      throw new LocalApiError(pwCheck.error, 400);
    }
    if (body.agreed === false) {
      throw new LocalApiError(
        'You must agree to the Terms & Conditions and NCA SMS regulations to register.',
        400
      );
    }
    if (findUserByPhone(db, phoneCheck.normalized, gateway)) {
      throw new LocalApiError(
        `An account with phone number ${phoneCheck.normalized} already exists. Please sign in instead.`,
        409
      );
    }
    if (findUserByEmail(db, emailCheck.normalized)) {
      throw new LocalApiError(
        `An account with email ${emailCheck.normalized} already exists. Please sign in instead.`,
        409
      );
    }
    const studio =
      String(body.studio || '').trim() || `${trimmedName.split(' ')[0]}'s Events`;
    const role: Extract<AppRole, 'organizer' | 'gate_staff'> =
      body.appRole === 'gate_staff' ? 'gate_staff' : 'organizer';
    const pending: PendingSignup = {
      phone: phoneCheck.normalized,
      email: emailCheck.normalized,
      password: String(body.password || ''),
      name: trimmedName,
      studio,
      countryGateway: gateway,
      appRole: role,
      createdAt: Date.now(),
      expiresAt: Date.now() + 15 * 60 * 1000,
    };
    db.pendingSignups[phoneCheck.normalized] = pending;
    db.pendingSignups[emailCheck.normalized] = pending;
    saveDb(db);
    return {
      requiresOtp: true,
      phone: phoneCheck.normalized,
      email: emailCheck.normalized,
      otpType: 'sms',
      channels: ['sms', 'email'],
      provider: 'browser-local',
    } as T;
  }

  // Auth: Send / Resend / Reset OTP
  if (method === 'POST' && (path === '/auth/send-otp' || path === '/auth/resend-otp' || path === '/auth/reset-password')) {
    const gateway = String(body.countryGateway || 'GH');
    const rawTarget = String(body.phone || body.identifier || body.email || '').trim();
    if (!rawTarget) {
      throw new LocalApiError('Mobile phone number or email address is required.', 400);
    }
    let resolvedPhone: string | undefined;
    let resolvedEmail: string | undefined;
    if (!rawTarget.includes('@')) {
      const check = validateStrictPhoneE164(rawTarget, gateway);
      if (!check.ok) throw new LocalApiError(check.error, 400);
      const pending = db.pendingSignups[check.normalized];
      const existing = findUserByPhone(db, check.normalized, gateway);
      if (!pending && !existing) {
        throw new LocalApiError(
          `No registered account found for ${check.normalized}. Create a free account first.`,
          404
        );
      }
      resolvedPhone = check.normalized;
      resolvedEmail = pending?.email || existing?.email;
    } else {
      const check = validateStrictEmail(rawTarget);
      if (!check.ok) throw new LocalApiError(check.error, 400);
      const pending = db.pendingSignups[check.normalized];
      const existing = findUserByEmail(db, check.normalized);
      if (!pending && !existing) {
        throw new LocalApiError(
          `No registered account found for ${check.normalized}. Create a free account first.`,
          404
        );
      }
      resolvedEmail = check.normalized;
      resolvedPhone = pending?.phone || existing?.profile.phone;
    }
    return {
      ok: true,
      phone: resolvedPhone,
      email: resolvedEmail,
      channels: [
        ...(resolvedPhone ? (['sms'] as const) : []),
        ...(resolvedEmail ? (['email'] as const) : []),
      ],
      provider: 'browser-local',
    } as T;
  }

  // Auth: Verify OTP
  if (method === 'POST' && path === '/auth/verify-otp') {
    const token = String(body.token || '').trim();
    if (!/^\d{6}$/.test(token)) {
      throw new LocalApiError('Enter a valid 6-digit verification code.', 400);
    }
    const gateway = String(body.countryGateway || 'GH');
    const cleanEmail = body.email ? String(body.email).trim().toLowerCase() : '';
    const cleanPhone = body.phone ? normalizePhoneE164(String(body.phone), gateway) : '';

    const pending =
      (cleanPhone && db.pendingSignups[cleanPhone]) ||
      (cleanEmail && db.pendingSignups[cleanEmail]) ||
      null;

    if (pending) {
      const newId = `usr-${randomHex(8)}`;
      const firstName = pending.name.split(' ')[0] || 'Organiser';
      const newUser: LocalUser = {
        id: newId,
        email: pending.email,
        passwordHash: hashPassword(pending.password),
        profile: {
          ...INITIAL_PROFILE,
          name: pending.name,
          firstName,
          role: pending.appRole === 'gate_staff' ? 'Gate Check-In Staff' : 'Lead Organiser',
          appRole: pending.appRole,
          email: pending.email,
          phone: pending.phone,
          phoneVerified: true,
          studio: pending.studio,
          plan: 'Starter',
          smsCredits: 0,
          senderId: 'EVENTSAPP',
        },
        suspended: false,
        lastLoginAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      };
      db.users[newId] = newUser;
      delete db.pendingSignups[pending.phone];
      delete db.pendingSignups[pending.email];
      const session = createSession(db, newId);
      saveDb(db);
      return { session: getSessionResponse(session), profile: newUser.profile } as T;
    }

    const existing =
      (cleanPhone && findUserByPhone(db, cleanPhone, gateway)) ||
      (cleanEmail && findUserByEmail(db, cleanEmail)) ||
      null;
    if (!existing) {
      throw new LocalApiError('Account not found for verification.', 404);
    }
    if (existing.suspended) {
      throw new LocalApiError('This organiser account has been suspended.', 403);
    }
    if (cleanPhone) {
      existing.profile.phone = cleanPhone;
      existing.profile.phoneVerified = true;
    }
    existing.lastLoginAt = new Date().toISOString();
    const session = createSession(db, existing.id);
    saveDb(db);
    return { session: getSessionResponse(session), profile: existing.profile } as T;
  }

  // Auth: OAuth
  if (method === 'GET' && path.startsWith('/auth/oauth/')) {
    throw new LocalApiError(
      'Google Sign-In requires the backend server with GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET (or Supabase Google Auth).',
      503
    );
  }

  // Auth: Refresh
  if (method === 'POST' && path === '/auth/refresh') {
    const refreshToken = String(body.refreshToken || '');
    const oldEntry = Object.values(db.sessions).find((s) => s.refreshToken === refreshToken);
    if (!oldEntry) {
      throw new LocalApiError('Could not refresh session.', 401);
    }
    const user = db.users[oldEntry.userId];
    if (!user || user.suspended) {
      throw new LocalApiError('Could not refresh session.', 401);
    }
    delete db.sessions[oldEntry.accessToken];
    const next = createSession(db, user.id);
    return { session: getSessionResponse(next), profile: user.profile } as T;
  }

  // Auth: Sign out
  if (method === 'POST' && path === '/auth/signout') {
    if (accessToken && db.sessions[accessToken]) {
      delete db.sessions[accessToken];
      saveDb(db);
    }
    return { ok: true } as T;
  }

  // Auth: Get session
  if (method === 'GET' && path === '/auth/session') {
    const user = getAuthenticatedUser(db, accessToken, exemptCheckInTimeout);
    return { profile: user.profile } as T;
  }

  // Auth: Update password
  if (method === 'POST' && path === '/auth/update-password') {
    const user = getAuthenticatedUser(db, accessToken);
    const password = String(body.password || '');
    const check = validateStrictPassword(password);
    if (!check.ok) throw new LocalApiError(check.error, 400);
    user.passwordHash = hashPassword(password);
    saveDb(db);
    return { ok: true } as T;
  }

  // Public events
  const sanitizePublicEventItem = (raw: EventItem & { organizerId?: string }): EventItem => {
    const owner = raw.organizerId ? db.users[raw.organizerId] : undefined;
    const whiteLabel = getPlanEntitlements(owner?.profile).whiteLabelPublicEvent;
    const { organizerId: _org, ...rest } = raw;
    if (!rest.extraDataConfig) return { ...rest, checkedIn: 0, whiteLabel };
    return {
      ...rest,
      checkedIn: 0,
      whiteLabel,
      extraDataConfig: sanitizePublicExtraDataConfig(rest.extraDataConfig),
    };
  };

  if (method === 'GET' && path === '/public/events') {
    const events = db.events
      .filter((e) => e.status === 'live' || e.status === 'upcoming')
      .map((e) => sanitizePublicEventItem(e));
    const eventIds = new Set(events.map((e) => e.id));
    const scheduleBlocks = db.scheduleBlocks.filter((b) => eventIds.has(b.eventId));
    return { events, scheduleBlocks } as T;
  }

  const publicEventMatch = path.match(/^\/public\/events\/([^/]+)$/);
  if (method === 'GET' && publicEventMatch) {
    const target = decodeURIComponent(publicEventMatch[1]).trim().toLowerCase();
    const matched = db.events.find(
      (e) =>
        (e.status === 'live' || e.status === 'upcoming') &&
        (e.id.toLowerCase() === target || e.slug.toLowerCase() === target)
    );
    if (!matched) {
      throw new LocalApiError('Event invitation not found or no longer active.', 404);
    }
    const scheduleBlocks = db.scheduleBlocks.filter((b) => b.eventId === matched.id);
    return { event: sanitizePublicEventItem(matched), scheduleBlocks } as T;
  }

  const publicRegMatch = path.match(/^\/public\/events\/([^/]+)\/register$/);
  if (method === 'POST' && publicRegMatch) {
    const eventId = decodeURIComponent(publicRegMatch[1]);
    if (db.flags.publicRegistrationsPaused || db.flags.pausedEventIds.includes(eventId)) {
      throw new LocalApiError(
        'Public registration for this event is temporarily paused by the organizer.',
        403
      );
    }
    const name = String(body.name || '').trim();
    const email = String(body.email || '').trim();
    const phone = String(body.phone || '').trim();
    if (!name || !phone) {
      throw new LocalApiError('Full name and mobile phone number are required.', 400);
    }
    const evt = db.events.find(
      (e) => e.id === eventId && (e.status === 'live' || e.status === 'upcoming')
    );
    if (!evt) {
      throw new LocalApiError('Event not found or not open for registration.', 404);
    }
    if (evt.qrPassPublished === false) {
      throw new LocalApiError(
        'Check-in QR passes have not been published by the event creator yet.',
        403
      );
    }
    if (evt.validationConfig?.requireInviteCode && evt.validationConfig.inviteCode?.trim()) {
      const expected = evt.validationConfig.inviteCode.trim().toLowerCase();
      const given = String(body.inviteCodeUsed || '').trim().toLowerCase();
      if (given !== expected) {
        throw new LocalApiError('Invalid invitation passcode for this event.', 403);
      }
    }
    const preOwner = db.users[evt.organizerId];
    const effectiveCap = getEffectiveEventCapacity(evt.capacity, preOwner?.profile);
    if (evt.registered >= effectiveCap) {
      throw new LocalApiError(
        `Event capacity reached (${effectiveCap}/${effectiveCap} seats). Organizer plan limit prevents additional registrations.`,
        403
      );
    }
    const normalizedPhone = normalizePhoneE164(phone);
    const duplicate = db.attendees.find(
      (a) =>
        a.eventId === eventId &&
        a.phone.replace(/\s+/g, '') === normalizedPhone.replace(/\s+/g, '')
    );
    if (duplicate) {
      db.duplicateBlocksByEvent[eventId] = (db.duplicateBlocksByEvent[eventId] ?? 0) + 1;
      saveDb(db);
      throw new LocalApiError(
        `Duplicate shield: ${normalizedPhone} already holds a pass for ${evt.title}`,
        409
      );
    }
    const finalCode =
      String(body.ticketCode || '').trim() ||
      `#EVT-2026-${Math.floor(1000 + Math.random() * 8999)}`;
    const origin =
      typeof window !== 'undefined' && window.location?.origin
        ? window.location.origin
        : 'https://eventsbyyou.xyz';
    const resolvedMsg = resolveEventMessage({
      type: 'confirmation',
      event: evt,
      attendeeName: name,
      ticketCode: finalCode,
      originOverride: origin,
      includeGuestInCameraUrl: true,
    });
    const smsCost = Math.max(1, calculateSmsCredits(resolvedMsg.text));
    const owner = Object.values(db.users).find((u) => u.id === evt.organizerId);
    let smsStatus: Attendee['smsStatus'] = 'Pending';
    let smsCreditsUsed = 0;
    let smsCreditsRemaining = owner?.profile.smsCredits ?? 0;
    let smsSkippedReason: string | undefined;

    if (owner && owner.profile.smsCredits >= smsCost) {
      owner.profile.smsCredits -= smsCost;
      smsStatus = 'Arkesel Sent';
      smsCreditsUsed = smsCost;
      smsCreditsRemaining = owner.profile.smsCredits;
      evt.smsDispatched += 1;
    } else {
      smsSkippedReason = 'Organizer SMS bundle balance is 0 (no purchased SMS credits remaining).';
    }

    const attendee: Attendee = {
      id: `att-${Date.now()}-${Math.floor(100 + Math.random() * 899)}`,
      eventId,
      name,
      email,
      phone: normalizedPhone,
      organization: String(body.organization || '').trim() || 'Fast Pass Attendee',
      tier: (body.tier as Attendee['tier']) || 'General',
      checkedIn: false,
      ticketCode: finalCode,
      smsStatus,
      paymentStatus: 'paid',
      validationGroup: body.validationGroup ? String(body.validationGroup).trim() : undefined,
      inviteCodeUsed: body.inviteCodeUsed ? String(body.inviteCodeUsed).trim() : undefined,
      giftEntry: body.giftEntry as Attendee['giftEntry'],
      customResponses: body.customResponses as Record<string, string> | undefined,
    };
    db.attendees.unshift(attendee);
    evt.registered += 1;
    evt.revenue += evt.ticketPrice;
    saveDb(db);
    return {
      attendee,
      event: sanitizePublicEventItem(evt),
      smsCreditsUsed,
      smsCreditsRemaining,
      smsSkippedReason,
    } as T;
  }

  const publicLookupMatch = path.match(/^\/public\/events\/([^/]+)\/pass-lookup$/);
  if (method === 'POST' && publicLookupMatch) {
    const target = decodeURIComponent(publicLookupMatch[1]).trim().toLowerCase();
    const raw = String(body.query || '').trim();
    if (!raw) throw new LocalApiError('Enter your pass code, phone number, or email.', 400);
    const evt = db.events.find(
      (e) =>
        (e.status === 'live' || e.status === 'upcoming') &&
        (e.id.toLowerCase() === target || e.slug.toLowerCase() === target)
    );
    if (!evt) throw new LocalApiError('Event not found or no longer active.', 404);
    const cleanLower = raw.toLowerCase();
    const cleanCode = cleanLower.replace(/^#/, '');
    const digitsOnly = raw.replace(/\D/g, '');
    const normalizedLookupPhone = digitsOnly.length >= 9 ? normalizePhoneE164(raw) : '';
    const match = db.attendees.find((att) => {
      if (att.eventId !== evt.id) return false;
      const attCode = att.ticketCode.toLowerCase().replace(/^#/, '');
      const attPhone = att.phone.replace(/\s+/g, '');
      const attDigits = att.phone.replace(/\D/g, '');
      return (
        attCode === cleanCode ||
        att.email.toLowerCase() === cleanLower ||
        (normalizedLookupPhone && attPhone === normalizedLookupPhone) ||
        (digitsOnly.length >= 9 && attDigits.endsWith(digitsOnly.slice(-9)))
      );
    });
    if (!match) {
      throw new LocalApiError(
        `No registered pass found for "${raw}". Use New Guest Check-In to validate your circle and generate a QR pass.`,
        404
      );
    }
    return { attendee: match } as T;
  }

  const publicGiftMatch = path.match(/^\/public\/events\/([^/]+)\/gifts$/);
  if (method === 'POST' && publicGiftMatch) {
    const target = decodeURIComponent(publicGiftMatch[1]).trim().toLowerCase();
    const evt = db.events.find(
      (e) => e.id.toLowerCase() === target || e.slug.toLowerCase() === target
    );
    if (!evt) throw new LocalApiError('Event Gift Table not found.', 404);
    const payload = body as Partial<GiftTableEntry>;
    const giverName = String(payload.giverName || '').trim();
    if (!giverName) throw new LocalApiError('Your name is required on the Gift Table entry.', 400);
    const giftType: GiftTableEntry['giftType'] =
      payload.giftType === 'cash-momo' || payload.giftType === 'registry-item' || payload.giftType === 'blessing-only'
        ? payload.giftType
        : 'cash-momo';
    const gift: GiftTableEntry = {
      id: `gift-${Date.now()}-${randomHex(2)}`,
      eventId: evt.id,
      giverName,
      giverPhone: payload.giverPhone?.trim() ? normalizePhoneE164(payload.giverPhone.trim()) : undefined,
      giftType,
      currency: payload.currency === 'USD' ? 'USD' : 'GHS',
      amount: giftType === 'cash-momo' ? Math.max(1, Number(payload.amount) || 0) : undefined,
      registryItem:
        giftType === 'registry-item'
          ? payload.registryItem?.trim() || evt.extraDataConfig?.giftRegistryItems?.[0] || 'Registry Gift'
          : undefined,
      side: payload.side?.trim() || undefined,
      message: payload.message?.trim() || undefined,
      recordedVia: 'public-table',
      createdAt: new Date().toISOString(),
    };
    const existingExtra = evt.extraDataConfig ?? { enableGiftTable: true, customFields: [] };
    evt.extraDataConfig = {
      ...existingExtra,
      enableGiftTable: true,
      giftLedger: [gift, ...(existingExtra.giftLedger ?? [])],
    };
    saveDb(db);
    return { gift, event: sanitizePublicEventItem(evt) } as T;
  }

  const publicDeskMatch = path.match(/^\/public\/events\/([^/]+)\/gift-desk\/([^/]+)$/);
  if (publicDeskMatch) {
    const target = decodeURIComponent(publicDeskMatch[1]).trim().toLowerCase();
    const token = decodeURIComponent(publicDeskMatch[2]).trim();
    const evt = db.events.find(
      (e) =>
        (e.status === 'live' || e.status === 'upcoming') &&
        (e.id.toLowerCase() === target || e.slug.toLowerCase() === target)
    );
    if (!evt) throw new LocalApiError('Event Gift Table not found.', 404);
    const links = Array.isArray(evt.extraDataConfig?.attendantLinks)
      ? evt.extraDataConfig!.attendantLinks!
      : [];
    const link = links.find((l) => l.token === token);
    if (!link) throw new LocalApiError('Gift Table attendant link not found.', 404);
    if (!link.active) {
      throw new LocalApiError('This Gift Table attendant link has been paused by the organiser.', 403);
    }
    if (method === 'GET') {
      const { token: _secret, ...safeAttendant } = link;
      return { event: sanitizePublicEventItem(evt), attendant: safeAttendant } as T;
    }
    if (method === 'POST') {
      const payload = body as Partial<GiftTableEntry>;
      const giverName = String(payload.giverName || '').trim();
      if (!giverName) throw new LocalApiError('Giver or donor name is required.', 400);
      const giftType: GiftTableEntry['giftType'] =
        payload.giftType === 'cash-momo' || payload.giftType === 'registry-item' || payload.giftType === 'blessing-only'
          ? payload.giftType
          : 'cash-momo';
      const nowIso = new Date().toISOString();
      const gift: GiftTableEntry = {
        id: `gift-${Date.now()}-${randomHex(2)}`,
        eventId: evt.id,
        giverName,
        giverPhone: payload.giverPhone?.trim() ? normalizePhoneE164(payload.giverPhone.trim()) : undefined,
        giftType,
        currency: payload.currency === 'USD' ? 'USD' : 'GHS',
        amount: giftType === 'cash-momo' ? Math.max(1, Number(payload.amount) || 0) : undefined,
        registryItem:
          giftType === 'registry-item'
            ? payload.registryItem?.trim() || evt.extraDataConfig?.giftRegistryItems?.[0] || 'Registry Gift'
            : undefined,
        side: payload.side?.trim() || undefined,
        message: payload.message?.trim() || undefined,
        recordedVia: 'gift-desk',
        recordedBy: link.attendantName,
        attendantLinkId: link.id,
        createdAt: nowIso,
      };
      const existingExtra = evt.extraDataConfig ?? { enableGiftTable: true, customFields: [] };
      const updatedLinks = links.map((l) =>
        l.id === link.id ? { ...l, recordedCount: (l.recordedCount ?? 0) + 1, lastUsedAt: nowIso } : l
      );
      const updatedLink = updatedLinks.find((l) => l.id === link.id)!;
      evt.extraDataConfig = {
        ...existingExtra,
        enableGiftTable: true,
        giftLedger: [gift, ...(existingExtra.giftLedger ?? [])],
        attendantLinks: updatedLinks,
      };
      saveDb(db);
      const { token: _secret, ...safeAttendant } = updatedLink;
      return { gift, event: sanitizePublicEventItem(evt), attendant: safeAttendant } as T;
    }
  }

  // Public Corporate Event Polls routes
  const publicPollsMatch = path.match(/^\/public\/events\/([^/]+)\/polls$/);
  if (method === 'GET' && publicPollsMatch) {
    const target = decodeURIComponent(publicPollsMatch[1]).trim().toLowerCase();
    const evt = db.events.find(
      (e) =>
        (e.status === 'live' || e.status === 'upcoming') &&
        (e.id.toLowerCase() === target || e.slug.toLowerCase() === target)
    );
    if (!evt) throw new LocalApiError('Event polls not found.', 404);
    const cleanEvent = sanitizePublicEventItem(evt);
    return {
      event: cleanEvent,
      polls: cleanEvent.extraDataConfig?.polls ?? [],
    } as T;
  }

  const publicPollVoteMatch = path.match(/^\/public\/events\/([^/]+)\/polls\/([^/]+)\/vote$/);
  if (method === 'POST' && publicPollVoteMatch) {
    const target = decodeURIComponent(publicPollVoteMatch[1]).trim().toLowerCase();
    const pollId = decodeURIComponent(publicPollVoteMatch[2]).trim();
    const evt = db.events.find(
      (e) =>
        (e.status === 'live' || e.status === 'upcoming') &&
        (e.id.toLowerCase() === target || e.slug.toLowerCase() === target)
    );
    if (!evt) throw new LocalApiError('Event not found.', 404);
    const polls = Array.isArray(evt.extraDataConfig?.polls) ? evt.extraDataConfig!.polls! : [];
    const pollIdx = polls.findIndex((p) => p.id === pollId);
    if (pollIdx === -1) throw new LocalApiError('Poll not found.', 404);
    const poll = polls[pollIdx];
    if (poll.status !== 'active') {
      throw new LocalApiError('This poll is currently closed for voting.', 403);
    }

    const rawIds = Array.isArray(body.optionIds)
      ? body.optionIds.map((id) => String(id).trim()).filter(Boolean)
      : [];
    const uniqueIds = Array.from(new Set(rawIds));
    const validOptionSet = new Set(poll.options.map((o) => o.id));
    const chosenIds = uniqueIds.filter((id) => validOptionSet.has(id));
    if (chosenIds.length === 0) {
      throw new LocalApiError('Select at least one valid option to cast your vote.', 400);
    }
    if (!poll.allowMultiple && chosenIds.length > 1) {
      throw new LocalApiError('This poll allows only one choice.', 400);
    }

    let dedupeKey = '';
    if (poll.requireVerifiedPass) {
      const rawPass = String(body.passCode || '').trim();
      if (!rawPass) {
        throw new LocalApiError(
          'This accredited poll requires your Event Pass Code, registered email, or phone number.',
          403
        );
      }
      const cleanLower = rawPass.toLowerCase();
      const cleanCode = rawPass.toUpperCase().replace(/^#/, '');
      const normalizedPassPhone = normalizePhoneE164(rawPass);
      const digitsOnly = rawPass.replace(/\D/g, '');
      const matchedAtt = db.attendees.find((att) => {
        if (att.eventId !== evt.id) return false;
        const attCode = att.ticketCode.toUpperCase().replace(/^#/, '');
        const attPhone = normalizePhoneE164(att.phone);
        const attDigits = att.phone.replace(/\D/g, '');
        return (
          attCode === cleanCode ||
          att.email.toLowerCase() === cleanLower ||
          (normalizedPassPhone && attPhone === normalizedPassPhone) ||
          (digitsOnly.length >= 9 && attDigits.endsWith(digitsOnly.slice(-9)))
        );
      });
      if (!matchedAtt) {
        throw new LocalApiError(
          'No registered delegate pass matched that code, email, or phone number.',
          403
        );
      }
      dedupeKey = `att:${matchedAtt.id}`;
    } else {
      const rawKey = String(body.voterKey || '').trim().slice(0, 80);
      dedupeKey = rawKey ? `anon:${rawKey}` : `anon:${randomHex(8)}`;
    }

    const existingVoters = Array.isArray(poll.voterKeys) ? poll.voterKeys : [];
    if (existingVoters.includes(dedupeKey)) {
      throw new LocalApiError('Your vote has already been recorded for this poll.', 409);
    }

    const chosenSet = new Set(chosenIds);
    const updatedPoll: EventPoll = {
      ...poll,
      options: poll.options.map((opt) =>
        chosenSet.has(opt.id) ? { ...opt, votes: (opt.votes || 0) + 1 } : opt
      ),
      totalVotes: (poll.totalVotes || 0) + 1,
      voterKeys: [...existingVoters, dedupeKey],
    };

    const existingExtra = evt.extraDataConfig ?? { enableGiftTable: false, customFields: [] };
    evt.extraDataConfig = {
      ...existingExtra,
      enablePolls: true,
      polls: polls.map((p, idx) => (idx === pollIdx ? updatedPoll : p)),
    };
    saveDb(db);
    return {
      poll: sanitizePollForPublic(updatedPoll),
      event: sanitizePublicEventItem(evt),
    } as T;
  }

  // Public Disposable Camera routes
  const publicCamMatch = path.match(/^\/public\/camera\/([^/]+)$/);
  if (method === 'GET' && publicCamMatch) {
    const target = decodeURIComponent(publicCamMatch[1]).trim().toLowerCase();
    const matched = db.events.find(
      (e) => e.id.toLowerCase() === target || e.slug.toLowerCase() === target
    );
    if (!matched) {
      throw new LocalApiError('Event disposable camera not found.', 404);
    }
    const cleanEvent = sanitizePublicEventItem(matched);
    const shots = db.disposableShots
      .filter((s) => s.eventId === matched.id)
      .sort((a, b) => b.frameNumber - a.frameNumber);
    const rollSettings = db.rollSettings[matched.id] ?? {
      exposuresLimit: 24,
      darkroomMode: false,
    };
    const rawQuery = url.includes('?') ? url.split('?')[1] : '';
    const passParam = new URLSearchParams(rawQuery).get('pass')?.trim().toLowerCase() || '';
    const matchedPassAtt = passParam
      ? db.attendees.find(
          (a) => a.eventId === matched.id && a.ticketCode.trim().toLowerCase() === passParam
        )
      : undefined;
    const verifiedPass = matchedPassAtt
      ? {
          attendeeName: matchedPassAtt.name,
          ticketCode: matchedPassAtt.ticketCode,
          checkedIn: matchedPassAtt.checkedIn,
          tier: matchedPassAtt.tier,
        }
      : null;
    return { event: cleanEvent, shots, rollSettings, verifiedPass } as T;
  }

  const publicCamShotMatch = path.match(/^\/public\/camera\/([^/]+)\/shots$/);
  if (method === 'POST' && publicCamShotMatch) {
    const target = decodeURIComponent(publicCamShotMatch[1]).trim().toLowerCase();
    const matched = db.events.find(
      (e) => e.id.toLowerCase() === target || e.slug.toLowerCase() === target
    );
    if (!matched) {
      throw new LocalApiError('Event disposable camera not found.', 404);
    }
    const shot = body as unknown as DisposableShot;
    const existingEventShots = db.disposableShots.filter((s) => s.eventId === matched.id);
    const rollCfg = db.rollSettings[matched.id] ?? { exposuresLimit: 24, darkroomMode: false };
    if (existingEventShots.length >= rollCfg.exposuresLimit) {
      throw new LocalApiError(
        `Film roll full (${rollCfg.exposuresLimit}/${rollCfg.exposuresLimit} exposures).`,
        403
      );
    }
    const effectiveKey = (shot.shooterKey || '').trim();
    const normalizedAuthor = (shot.capturedBy || 'Guest').trim().toLowerCase();
    const userShotCount = existingEventShots.filter((s) =>
      effectiveKey && s.shooterKey
        ? s.shooterKey === effectiveKey
        : s.capturedBy.trim().toLowerCase() === normalizedAuthor
    ).length;
    if (userShotCount >= 5) {
      throw new LocalApiError(
        'Camera limit reached: each user is allowed up to 5 pictures per event.',
        403
      );
    }
    const nextFrame = existingEventShots.reduce((max, s) => Math.max(max, s.frameNumber), 0) + 1;
    const saved: DisposableShot = {
      ...shot,
      id: shot.id || `shot-${Date.now()}-${randomHex(2)}`,
      eventId: matched.id,
      frameNumber: nextFrame,
      developed: !rollCfg.darkroomMode,
    };
    db.disposableShots.unshift(saved);
    saveDb(db);
    return { shot: saved } as T;
  }

  const publicCamLikeMatch = path.match(/^\/public\/camera\/shots\/([^/]+)\/like$/);
  if (method === 'PATCH' && publicCamLikeMatch) {
    const shotId = decodeURIComponent(publicCamLikeMatch[1]);
    const shot = db.disposableShots.find((s) => s.id === shotId);
    if (!shot) throw new LocalApiError('Shot not found.', 404);
    shot.liked = !shot.liked;
    shot.likes = shot.liked ? shot.likes + 1 : Math.max(0, shot.likes - 1);
    saveDb(db);
    return { shot } as T;
  }

  const publicCamDelMatch = path.match(/^\/public\/camera\/shots\/([^/]+)$/);
  if (method === 'DELETE' && publicCamDelMatch) {
    const shotId = decodeURIComponent(publicCamDelMatch[1]);
    const rawQuery = url.includes('?') ? url.split('?')[1] : '';
    const queryKey = new URLSearchParams(rawQuery).get('shooterKey')?.trim() || '';
    const bodyKey = typeof body?.shooterKey === 'string' ? body.shooterKey.trim() : '';
    const shooterKey = queryKey || bodyKey;
    if (!shooterKey) {
      throw new LocalApiError('Missing shooterKey to verify photo ownership.', 400);
    }
    const shot = db.disposableShots.find((s) => s.id === shotId);
    if (!shot) throw new LocalApiError('Photo not found.', 404);
    if (!shot.shooterKey || shot.shooterKey !== shooterKey) {
      throw new LocalApiError('You can only delete photos you captured.', 403);
    }
    db.disposableShots = db.disposableShots.filter((s) => s.id !== shotId);
    saveDb(db);
    return { ok: true } as T;
  }

  // Authenticated Studio & Builder routes
  const user = getAuthenticatedUser(db, accessToken, exemptCheckInTimeout);

  if (method === 'GET' && path === '/studio/bootstrap') {
    requireRoles(user, ['creator', 'organizer']);
    return loadUserWorkspace(db, user.id) as T;
  }

  if (method === 'POST' && path === '/studio/seed-starter') {
    requireRoles(user, ['creator', 'organizer']);
    throw new LocalApiError('Demo and starter data seeding has been removed.', 403);
  }

  if (method === 'PATCH' && path === '/studio/profile') {
    requireRoles(user, ['creator', 'organizer']);
    const incoming = body as Partial<OrganizerProfile>;
    if (incoming.plan !== undefined && incoming.plan !== user.profile.plan) {
      throw new LocalApiError(
        incoming.plan === 'Starter'
          ? 'Use the Plan & Credits downgrade action to switch back to Starter.'
          : `Subscription upgrades to ${incoming.plan} require verified checkout payment in Plan & Credits.`,
        403
      );
    }
    const ent = getPlanEntitlements(user.profile);
    if (incoming.senderId !== undefined && !ent.allowCustomSenderId && hasCustomSenderIdValue(incoming.senderId)) {
      throw new LocalApiError(
        'Custom Alphanumeric Sender ID requires Pro Organizer or Enterprise plan. Starter accounts use EVENTSAPP.',
        403
      );
    }
    const {
      appRole: _ignoreRole,
      phoneVerified: _ignoreVerified,
      smsCredits: _ignoreSmsCredits,
      plan: _ignorePlan,
      planBillingCycle: _ignoreCycle,
      planExpiresAt: _ignoreExp,
      ...safePatch
    } = incoming;
    if (safePatch.senderId !== undefined && !ent.allowCustomSenderId) {
      safePatch.senderId = DEFAULT_SHARED_SENDER_ID;
    }
    user.profile = { ...user.profile, ...safePatch };
    saveDb(db);
    return { profile: user.profile } as T;
  }

  if (method === 'GET' && path === '/studio/arkesel/status') {
    requireRoles(user, ['creator', 'organizer']);
    const senderId = (user.profile.senderId || 'Arkesel').trim();
    return {
      configured: false,
      paystackConfigured: false,
      mode: db.flags.smsMode,
      live: false,
      smsBalance: null,
      mainBalance: null,
      error: 'Local offline fallback mode — Arkesel server API key is checked on the backend server.',
      senderId,
      isDefaultUnverifiedSender: senderId.toLowerCase() === 'arkesel' || senderId.toLowerCase() === 'eventsapp',
      organizerCredits: user.profile.smsCredits,
      apiInfoUrl: 'https://sms.arkesel.com/user/sms-api/info',
      rechargeUrl: 'https://sms.arkesel.com',
      checkedAt: new Date().toISOString(),
    } as T;
  }

  if (method === 'GET' && path === '/studio/sms/purchases') {
    requireRoles(user, ['creator', 'organizer']);
    const purchases = db.smsPurchases
      .filter((p) => p.organizerId === user.id)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return {
      purchases,
      paystackConfigured: false,
      mode: db.flags.smsMode,
    } as T;
  }

  if (method === 'POST' && path === '/studio/sms/paystack/initialize') {
    requireRoles(user, ['creator', 'organizer']);
    throw new LocalApiError(
      'Online Paystack checkout requires the backend server with PAYSTACK_SECRET_KEY configured.',
      503
    );
  }

  if (method === 'GET' && path.startsWith('/studio/sms/paystack/verify/')) {
    requireRoles(user, ['creator', 'organizer']);
    throw new LocalApiError(
      'Paystack verification requires the backend server with PAYSTACK_SECRET_KEY configured.',
      503
    );
  }

  if (method === 'POST' && path === '/studio/sms/purchase-bundle') {
    requireRoles(user, ['creator', 'organizer']);
    let quote;
    try {
      quote = resolveAuthoritativeSmsBundle({
        bundleId: typeof body.bundleId === 'string' ? body.bundleId : undefined,
        credits: Number(body.credits ?? 0),
        expectedAmountGhs: Number(body.amountGhs ?? 0),
      });
    } catch (err) {
      throw new LocalApiError(err instanceof Error ? err.message : 'Invalid SMS bundle.', 400);
    }

    const refCheck = validateReceiptReference(
      typeof body.arkeselReference === 'string' ? body.arkeselReference : ''
    );
    if (!refCheck.ok) {
      throw new LocalApiError(refCheck.error, 400);
    }
    const cleanRef = refCheck.normalized;

    const duplicate = db.smsPurchases.find(
      (p) => p.reference.toLowerCase() === cleanRef.toLowerCase()
    );
    if (duplicate) {
      throw new LocalApiError(
        `Transaction reference "${cleanRef}" has already been submitted (${duplicate.status}).`,
        409
      );
    }

    const isSandbox = db.flags.smsMode === 'sandbox';
    const nowIso = new Date().toISOString();
    const channel =
      typeof body.paymentChannel === 'string' && body.paymentChannel.trim()
        ? body.paymentChannel.trim()
        : 'Arkesel Portal Wallet';

    const purchase: SmsBundlePurchase = {
      id: `smsp-${Date.now()}-${randomHex(3)}`,
      organizerId: user.id,
      organizerName: user.profile.name,
      organizerEmail: user.email || user.profile.email,
      bundleId: quote.bundleId,
      bundleName: quote.bundleName,
      credits: quote.credits,
      amountGhs: quote.amountGhs,
      paymentChannel: channel,
      provider: isSandbox ? 'sandbox' : 'arkesel_manual',
      reference: cleanRef,
      status: isSandbox ? 'credited' : 'pending_verification',
      createdAt: nowIso,
      verifiedAt: isSandbox ? nowIso : undefined,
    };
    db.smsPurchases.unshift(purchase);

    if (isSandbox) {
      user.profile = { ...user.profile, smsCredits: user.profile.smsCredits + quote.credits };
    }
    saveDb(db);

    const senderId = (user.profile.senderId || 'Arkesel').trim();
    return {
      ok: true,
      pendingVerification: !isSandbox,
      profile: user.profile,
      purchase,
      bundleId: quote.bundleId,
      bundleName: quote.bundleName,
      addedCredits: isSandbox ? quote.credits : 0,
      amountGhs: quote.amountGhs,
      paymentChannel: channel,
      arkeselReference: cleanRef,
      portalPurchaseRequired: true,
      arkeselStatus: {
        configured: false,
        paystackConfigured: false,
        mode: db.flags.smsMode,
        live: false,
        smsBalance: null,
        mainBalance: null,
        error: null,
        senderId,
        isDefaultUnverifiedSender: senderId.toLowerCase() === 'arkesel' || senderId.toLowerCase() === 'eventsapp',
        organizerCredits: user.profile.smsCredits,
        apiInfoUrl: 'https://sms.arkesel.com/user/sms-api/info',
        rechargeUrl: 'https://sms.arkesel.com',
        checkedAt: nowIso,
      },
      message: isSandbox
        ? `[Sandbox] +${quote.credits.toLocaleString()} SMS credits allocated (Ref: ${cleanRef}).`
        : `Receipt "${cleanRef}" submitted for +${quote.credits.toLocaleString()} SMS (GH₵ ${quote.amountGhs}). Credits are added once verified in Apps Creator Console.`,
    } as T;
  }

  if (method === 'GET' && path === '/studio/subscription/payments') {
    requireRoles(user, ['creator', 'organizer']);
    const payments = db.subscriptionPayments
      .filter((p) => p.organizerId === user.id)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return {
      payments,
      paystackConfigured: false,
      mode: db.flags.smsMode,
    } as T;
  }

  if (method === 'POST' && path === '/studio/subscription/paystack/initialize') {
    requireRoles(user, ['creator', 'organizer']);
    throw new LocalApiError(
      'Online Paystack checkout requires the backend server with PAYSTACK_SECRET_KEY configured.',
      503
    );
  }

  if (method === 'GET' && path.startsWith('/studio/subscription/paystack/verify/')) {
    requireRoles(user, ['creator', 'organizer']);
    throw new LocalApiError(
      'Paystack verification requires the backend server with PAYSTACK_SECRET_KEY configured.',
      503
    );
  }

  if (method === 'POST' && path === '/studio/subscription/purchase') {
    requireRoles(user, ['creator', 'organizer']);
    let quote;
    try {
      quote = resolveAuthoritativeSubscriptionQuote({
        planId: typeof body.planId === 'string' ? body.planId : undefined,
        planName: typeof body.planName === 'string' ? body.planName : undefined,
        billingCycle: typeof body.billingCycle === 'string' ? body.billingCycle : undefined,
        expectedAmountGhs: Number(body.amountGhs ?? 0),
      });
    } catch (err) {
      throw new LocalApiError(err instanceof Error ? err.message : 'Invalid subscription plan.', 400);
    }

    const refCheck = validateReceiptReference(
      typeof body.receiptReference === 'string' ? body.receiptReference : ''
    );
    if (!refCheck.ok) {
      throw new LocalApiError(refCheck.error, 400);
    }
    const cleanRef = refCheck.normalized;

    const duplicate = db.subscriptionPayments.find(
      (p) => p.reference.toLowerCase() === cleanRef.toLowerCase()
    );
    if (duplicate) {
      throw new LocalApiError(
        `Transaction reference "${cleanRef}" has already been submitted (${duplicate.status}).`,
        409
      );
    }

    const isSandbox = db.flags.smsMode === 'sandbox';
    const now = new Date();
    const nowIso = now.toISOString();
    const expiresIso = isSandbox ? computePlanExpiresAtIso(quote.billingCycle, now) : undefined;
    const channel =
      typeof body.paymentChannel === 'string' && body.paymentChannel.trim()
        ? body.paymentChannel.trim()
        : 'Mobile Money / Bank Transfer';

    const payment: SubscriptionPayment = {
      id: `subp-${Date.now()}-${randomHex(3)}`,
      organizerId: user.id,
      organizerName: user.profile.name,
      organizerEmail: user.email || user.profile.email,
      planId: quote.planId,
      planName: quote.planName,
      billingCycle: quote.billingCycle,
      amountUsd: quote.amountUsd,
      amountGhs: quote.amountGhs,
      paymentChannel: channel,
      provider: isSandbox ? 'sandbox' : 'manual',
      reference: cleanRef,
      status: isSandbox ? 'active' : 'pending_verification',
      periodStart: isSandbox ? nowIso : undefined,
      periodEnd: expiresIso,
      createdAt: nowIso,
      verifiedAt: isSandbox ? nowIso : undefined,
    };
    db.subscriptionPayments.unshift(payment);

    if (isSandbox) {
      user.profile = {
        ...user.profile,
        plan: quote.planName,
        planBillingCycle: quote.billingCycle,
        planExpiresAt: expiresIso,
      };
    }
    saveDb(db);

    return {
      ok: true,
      activated: isSandbox,
      pendingVerification: !isSandbox,
      profile: user.profile,
      payment,
      message: isSandbox
        ? `Sandbox Mode: ${quote.planName} (${quote.billingCycle}) activated immediately (Ref: ${cleanRef}).`
        : `Payment reference "${cleanRef}" for ${quote.planName} is queued for administrator verification before activation.`,
    } as T;
  }

  if (method === 'POST' && path === '/studio/subscription/downgrade') {
    requireRoles(user, ['creator', 'organizer']);
    user.profile = {
      ...user.profile,
      plan: 'Starter',
      planBillingCycle: 'monthly',
      planExpiresAt: undefined,
      senderId: DEFAULT_SHARED_SENDER_ID,
    };
    saveDb(db);
    return {
      ok: true,
      profile: user.profile,
      message: 'Workspace downgraded to Starter (Free). Existing events remain intact; Starter quotas now apply.',
    } as T;
  }

  if (method === 'DELETE' && path === '/studio/account') {
    requireRoles(user, ['creator', 'organizer', 'gate_staff']);
    const confirmation = typeof body.confirmation === 'string' ? body.confirmation : undefined;
    if (confirmation !== undefined && confirmation.trim().toUpperCase() !== 'DELETE') {
      throw new LocalApiError('Type DELETE to confirm permanent account deletion.', 400);
    }
    const ownedEventIds = new Set(
      db.events.filter((e) => e.organizerId === user.id).map((e) => e.id)
    );
    db.events = db.events.filter((e) => e.organizerId !== user.id);
    db.attendees = db.attendees.filter((a) => !ownedEventIds.has(a.eventId));
    db.scheduleBlocks = db.scheduleBlocks.filter((b) => !ownedEventIds.has(b.eventId));
    db.disposableShots = db.disposableShots.filter((s) => !ownedEventIds.has(s.eventId));
    for (const evtId of ownedEventIds) {
      delete db.rollSettings[evtId];
      delete db.duplicateBlocksByEvent[evtId];
    }
    db.alerts = db.alerts.filter((a) => a.organizerId !== user.id);
    const ownedAppIds = new Set(
      db.creatorApps.filter((a) => a.organizerId === user.id).map((a) => a.id)
    );
    db.creatorApps = db.creatorApps.filter((a) => a.organizerId !== user.id);
    db.creatorAppLogs = db.creatorAppLogs.filter((l) => !ownedAppIds.has(l.appId));
    db.smsPurchases = db.smsPurchases.filter((p) => p.organizerId !== user.id);
    db.subscriptionPayments = db.subscriptionPayments.filter((p) => p.organizerId !== user.id);

    for (const [tok, sess] of Object.entries(db.sessions)) {
      if (sess.userId === user.id) delete db.sessions[tok];
    }
    for (const [key, pending] of Object.entries(db.pendingSignups)) {
      if (
        (user.email && pending.email.toLowerCase() === user.email.toLowerCase()) ||
        (user.profile.phone && pending.phone === user.profile.phone)
      ) {
        delete db.pendingSignups[key];
      }
    }
    delete db.users[user.id];
    saveDb(db);
    return { ok: true, deletedUserId: user.id } as T;
  }

  if (method === 'POST' && path === '/studio/sms/test') {
    requireRoles(user, ['creator', 'organizer']);
    const ent = getPlanEntitlements(user.profile);
    if (!ent.allowCustomSenderId && hasCustomSenderIdValue(typeof body.senderId === 'string' ? body.senderId : undefined)) {
      throw new LocalApiError('Custom Alphanumeric Sender ID requires Pro Organizer or Enterprise plan.', 403);
    }
    const phoneCheck = validateStrictPhoneE164(String(body.phone || ''));
    if (!phoneCheck.ok) {
      throw new LocalApiError(phoneCheck.error, 400);
    }
    if (user.profile.smsCredits < 1) {
      throw new LocalApiError(
        'No SMS credits remaining in your organizer balance. Purchase an SMS bundle first.',
        402
      );
    }
    const rawSender = ent.allowCustomSenderId
      ? String(body.senderId || user.profile.senderId || db.flags.arkeselSenderId || DEFAULT_SHARED_SENDER_ID)
          .toUpperCase()
          .replace(/[^A-Z0-9]/g, '')
          .slice(0, 11) || DEFAULT_SHARED_SENDER_ID
      : DEFAULT_SHARED_SENDER_ID;
    const nextCredits = Math.max(0, user.profile.smsCredits - 1);
    user.profile.smsCredits = nextCredits;
    saveDb(db);
    return {
      ok: true,
      phone: phoneCheck.normalized,
      senderId: rawSender,
      messageId: `loc-sms-${randomHex(4)}`,
      sandbox: true,
      warning:
        'Browser local fallback mode is active (sandbox simulation). 1 SMS credit deducted from your bundle.',
      smsCredits: nextCredits,
    } as T;
  }

  if (method === 'POST' && path === '/studio/events') {
    requireRoles(user, ['creator', 'organizer']);
    const event = body.event as EventItem | undefined;
    const blocks = Array.isArray(body.blocks) ? (body.blocks as ScheduleBlock[]) : [];
    if (!event?.title) throw new LocalApiError('Invalid event payload.', 400);
    const ent = getPlanEntitlements(user.profile);
    if (ent.maxActiveEvents != null && isActiveEventStatus(event.status)) {
      const activeCount = db.events.filter(
        (e) => e.organizerId === user.id && isActiveEventStatus(e.status)
      ).length;
      if (activeCount >= ent.maxActiveEvents) {
        throw new LocalApiError(
          `Starter plan allows up to ${ent.maxActiveEvents} active (Live or Upcoming) event. Archive an existing event, save as Draft, or upgrade to Pro Organizer.`,
          403
        );
      }
    }
    if (ent.maxAttendeesPerEvent != null && Number(event.capacity) > ent.maxAttendeesPerEvent) {
      throw new LocalApiError(
        `Starter plan caps event capacity at ${ent.maxAttendeesPerEvent} attendees per event. Upgrade to Pro Organizer for unlimited capacity.`,
        403
      );
    }
    if (!ent.allowCustomSenderId && hasCustomSenderIdValue(event.senderId)) {
      throw new LocalApiError('Custom Alphanumeric Sender ID requires Pro Organizer or Enterprise plan.', 403);
    }
    if (!ent.allowCustomMessages && hasCustomMessageOverrides(event.messageConfig)) {
      throw new LocalApiError(
        'Custom confirmation & check-in SMS/Email templates require Pro Organizer or Enterprise plan.',
        403
      );
    }
    const baseSlug =
      (event.slug || event.title)
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, '-')
        .replace(/(^-|-$)+/g, '') || `event-${Date.now().toString(36)}`;
    const slugTaken = db.events.some((e) => e.slug === baseSlug);
    const uniqueSlug = slugTaken ? `${baseSlug}-${randomHex(2)}` : baseSlug;
    const uniqueEventId = `evt-${Date.now().toString(36)}-${randomHex(4)}`;
    const initialExtraDataConfig = event.extraDataConfig
      ? {
          ...event.extraDataConfig,
          planningConfig:
            event.extraDataConfig.planningConfig ??
            createStarterPlanningConfig(
              event.category || 'Events',
              event.organizer || user.profile.name || 'Organiser',
              event.venue || 'Main Venue'
            ),
        }
      : {
          enableGiftTable: false,
          customFields: [],
          planningConfig: createStarterPlanningConfig(
            event.category || 'Events',
            event.organizer || user.profile.name || 'Organiser',
            event.venue || 'Main Venue'
          ),
        };
    const created: EventItem = {
      ...event,
      id: uniqueEventId,
      slug: uniqueSlug,
      capacity: getEffectiveEventCapacity(event.capacity, user.profile),
      extraDataConfig: initialExtraDataConfig,
      senderId: ent.allowCustomSenderId ? event.senderId : DEFAULT_SHARED_SENDER_ID,
      messageConfig: ent.allowCustomMessages ? event.messageConfig : undefined,
      qrPassPublished: event.status === 'draft' ? false : Boolean(event.qrPassPublished),
    };
    db.events.unshift({ ...created, organizerId: user.id });
    const createdBlocks = blocks.map((b, idx) => {
      const blk: ScheduleBlock = {
        ...b,
        id: `sch-${Date.now().toString(36)}-${randomHex(2)}-${idx}`,
        eventId: uniqueEventId,
      };
      db.scheduleBlocks.push(blk);
      return blk;
    });
    saveDb(db);
    return { event: created, blocks: createdBlocks } as T;
  }

  const qrPassMatch = path.match(/^\/studio\/events\/([^/]+)\/qr-pass$/);
  if (method === 'PATCH' && qrPassMatch) {
    requireRoles(user, ['creator', 'organizer']);
    const eventId = decodeURIComponent(qrPassMatch[1]);
    const evt = db.events.find((e) => e.id === eventId && e.organizerId === user.id);
    if (!evt) throw new LocalApiError('Event not found.', 404);
    evt.qrPassPublished = Boolean(body.published);
    saveDb(db);
    const { organizerId: _org, ...clean } = evt;
    return { event: clean } as T;
  }

  const studioAttCreateMatch = path.match(/^\/studio\/events\/([^/]+)\/attendees$/);
  if (method === 'POST' && studioAttCreateMatch) {
    requireRoles(user, ['creator', 'organizer']);
    const eventId = decodeURIComponent(studioAttCreateMatch[1]);
    const evt = db.events.find((e) => e.id === eventId && e.organizerId === user.id);
    if (!evt) throw new LocalApiError('Event not found.', 404);
    const effectiveCap = getEffectiveEventCapacity(evt.capacity, user.profile);
    if (evt.registered >= effectiveCap) {
      throw new LocalApiError(
        `Event capacity reached (${effectiveCap}/${effectiveCap} attendees). Upgrade your plan or expand capacity before issuing more passes.`,
        403
      );
    }
    const payload = body as unknown as Attendee;
    const normalizedAttPhone = payload.phone ? normalizePhoneE164(payload.phone) : '';
    const resolved = resolveEventMessage({
      type: payload.checkedIn ? 'checkin' : 'confirmation',
      event: evt,
      attendeeName: payload.name,
      ticketCode: payload.ticketCode,
      originOverride:
        typeof window !== 'undefined' && window.location?.origin
          ? window.location.origin
          : 'https://eventsbyyou.xyz',
      includeGuestInCameraUrl: true,
    });

    const smsCost = normalizedAttPhone ? Math.max(1, calculateSmsCredits(resolved.text)) : 0;
    let smsStatus: Attendee['smsStatus'] = 'Pending';
    let smsCreditsUsed = 0;
    let smsSkippedReason: string | undefined;

    if (normalizedAttPhone && user.profile.smsCredits >= smsCost) {
      user.profile.smsCredits -= smsCost;
      smsCreditsUsed = smsCost;
      smsStatus = 'Arkesel Sent';
      evt.smsDispatched += 1;
    } else if (normalizedAttPhone) {
      smsSkippedReason = `Insufficient SMS credits (${user.profile.smsCredits} remaining, ${smsCost} needed). Purchase an SMS bundle to deliver pass SMS.`;
    }

    const att: Attendee = {
      ...payload,
      id: payload.id || `att-${Date.now()}-${randomHex(2)}`,
      eventId,
      phone: normalizedAttPhone,
      smsStatus,
    };
    db.attendees.unshift(att);
    evt.registered += 1;
    evt.revenue += evt.ticketPrice;
    saveDb(db);
    const { organizerId: _org, ...cleanEvent } = evt;
    return {
      attendee: att,
      event: cleanEvent,
      cameraUrl: resolved.cameraUrl,
      dispatchedMessage: resolved.text,
      smsCredits: user.profile.smsCredits,
      smsCreditsUsed,
      smsSkippedReason,
    } as T;
  }

  const studioGiftMatch = path.match(/^\/studio\/events\/([^/]+)\/gifts$/);
  if (method === 'POST' && studioGiftMatch) {
    requireRoles(user, ['creator', 'organizer']);
    const eventId = decodeURIComponent(studioGiftMatch[1]);
    const evt = db.events.find((e) => e.id === eventId && e.organizerId === user.id);
    if (!evt) throw new LocalApiError('Event not found.', 404);
    const payload = body as Partial<GiftTableEntry>;
    const giverName = String(payload.giverName || '').trim();
    if (!giverName) throw new LocalApiError('Donor name is required.', 400);
    const giftType: GiftTableEntry['giftType'] =
      payload.giftType === 'cash-momo' || payload.giftType === 'registry-item' || payload.giftType === 'blessing-only'
        ? payload.giftType
        : 'cash-momo';
    const gift: GiftTableEntry = {
      id: `gift-${Date.now()}-${randomHex(2)}`,
      eventId: evt.id,
      giverName,
      giverPhone: payload.giverPhone?.trim() ? normalizePhoneE164(payload.giverPhone.trim()) : undefined,
      giftType,
      currency: payload.currency === 'USD' ? 'USD' : 'GHS',
      amount: giftType === 'cash-momo' ? Math.max(1, Number(payload.amount) || 0) : undefined,
      registryItem:
        giftType === 'registry-item'
          ? payload.registryItem?.trim() || evt.extraDataConfig?.giftRegistryItems?.[0] || 'Registry Gift'
          : undefined,
      side: payload.side?.trim() || undefined,
      message: payload.message?.trim() || undefined,
      recordedVia: 'gift-desk',
      createdAt: new Date().toISOString(),
    };
    const existingExtra = evt.extraDataConfig ?? { enableGiftTable: true, customFields: [] };
    evt.extraDataConfig = {
      ...existingExtra,
      enableGiftTable: true,
      giftLedger: [gift, ...(existingExtra.giftLedger ?? [])],
    };
    saveDb(db);
    const { organizerId: _org, ...cleanEvent } = evt;
    return { gift, event: cleanEvent } as T;
  }

  const studioGiftLinksCreateMatch = path.match(/^\/studio\/events\/([^/]+)\/gift-links$/);
  if (method === 'POST' && studioGiftLinksCreateMatch) {
    requireRoles(user, ['creator', 'organizer']);
    const eventId = decodeURIComponent(studioGiftLinksCreateMatch[1]);
    const evt = db.events.find((e) => e.id === eventId && e.organizerId === user.id);
    if (!evt) throw new LocalApiError('Event not found.', 404);
    const attendantName = String(body.attendantName || '').trim();
    if (!attendantName) throw new LocalApiError('Attendant name is required.', 400);
    const link: GiftTableAttendantLink = {
      id: `glink-${Date.now()}-${randomHex(2)}`,
      eventId: evt.id,
      token: `gd_${randomHex(8)}`,
      attendantName,
      roleLabel: body.roleLabel ? String(body.roleLabel).trim() : 'Gift Table Attendant',
      phone: body.phone ? normalizePhoneE164(String(body.phone).trim()) : undefined,
      active: true,
      recordedCount: 0,
      createdAt: new Date().toISOString(),
    };
    const existingExtra = evt.extraDataConfig ?? { enableGiftTable: true, customFields: [] };
    evt.extraDataConfig = {
      ...existingExtra,
      enableGiftTable: true,
      attendantLinks: [link, ...(existingExtra.attendantLinks ?? [])],
    };
    saveDb(db);
    const { organizerId: _org, ...cleanEvent } = evt;
    return { link, event: cleanEvent } as T;
  }

  const studioGiftLinkItemMatch = path.match(/^\/studio\/events\/([^/]+)\/gift-links\/([^/]+)$/);
  if (studioGiftLinkItemMatch) {
    requireRoles(user, ['creator', 'organizer']);
    const eventId = decodeURIComponent(studioGiftLinkItemMatch[1]);
    const linkId = decodeURIComponent(studioGiftLinkItemMatch[2]);
    const evt = db.events.find((e) => e.id === eventId && e.organizerId === user.id);
    if (!evt) throw new LocalApiError('Event not found.', 404);
    const existingExtra = evt.extraDataConfig ?? { enableGiftTable: true, customFields: [] };
    const links = Array.isArray(existingExtra.attendantLinks) ? existingExtra.attendantLinks : [];
    if (method === 'PATCH') {
      const target = links.find((l) => l.id === linkId);
      if (!target) throw new LocalApiError('Gift Table attendant link not found.', 404);
      const nextLink: GiftTableAttendantLink = {
        ...target,
        active: body.active !== undefined ? Boolean(body.active) : !target.active,
      };
      evt.extraDataConfig = {
        ...existingExtra,
        attendantLinks: links.map((l) => (l.id === linkId ? nextLink : l)),
      };
      saveDb(db);
      const { organizerId: _org, ...cleanEvent } = evt;
      return { link: nextLink, event: cleanEvent } as T;
    }
    if (method === 'DELETE') {
      evt.extraDataConfig = {
        ...existingExtra,
        attendantLinks: links.filter((l) => l.id !== linkId),
      };
      saveDb(db);
      const { organizerId: _org, ...cleanEvent } = evt;
      return { ok: true, event: cleanEvent } as T;
    }
  }

  const studioPollsCreateMatch = path.match(/^\/studio\/events\/([^/]+)\/polls$/);
  if (method === 'POST' && studioPollsCreateMatch) {
    requireRoles(user, ['creator', 'organizer']);
    const eventId = decodeURIComponent(studioPollsCreateMatch[1]);
    const evt = db.events.find((e) => e.id === eventId && e.organizerId === user.id);
    if (!evt) throw new LocalApiError('Event not found.', 404);
    const question = String(body.question || '').trim();
    if (question.length < 3) {
      throw new LocalApiError('Enter a poll question (at least 3 characters).', 400);
    }
    const options = buildValidatedPollOptions(Array.isArray(body.options) ? body.options : []);
    if (options.length < 2) {
      throw new LocalApiError('Add at least 2 distinct answer options.', 400);
    }
    const poll: EventPoll = {
      id: `poll-${Date.now()}-${randomHex(2)}`,
      eventId: evt.id,
      question: question.slice(0, 240),
      description: body.description ? String(body.description).trim().slice(0, 320) : undefined,
      sessionLabel: body.sessionLabel ? String(body.sessionLabel).trim().slice(0, 80) : undefined,
      status: normalizePollStatus(body.status, 'active'),
      allowMultiple: Boolean(body.allowMultiple),
      showResultsToPublic: body.showResultsToPublic !== false,
      requireVerifiedPass: Boolean(body.requireVerifiedPass),
      options,
      totalVotes: 0,
      voterKeys: [],
      createdAt: new Date().toISOString(),
    };
    const existingExtra = evt.extraDataConfig ?? { enableGiftTable: false, customFields: [] };
    evt.extraDataConfig = {
      ...existingExtra,
      enablePolls: true,
      polls: [poll, ...(existingExtra.polls ?? [])],
    };
    saveDb(db);
    const { organizerId: _org, ...cleanEvent } = evt;
    return { poll, event: cleanEvent } as T;
  }

  const studioPollItemMatch = path.match(/^\/studio\/events\/([^/]+)\/polls\/([^/]+)$/);
  if (studioPollItemMatch) {
    requireRoles(user, ['creator', 'organizer']);
    const eventId = decodeURIComponent(studioPollItemMatch[1]);
    const pollId = decodeURIComponent(studioPollItemMatch[2]);
    const evt = db.events.find((e) => e.id === eventId && e.organizerId === user.id);
    if (!evt) throw new LocalApiError('Event not found.', 404);
    const existingExtra = evt.extraDataConfig ?? { enableGiftTable: false, customFields: [] };
    const prevPolls = Array.isArray(existingExtra.polls) ? existingExtra.polls : [];
    const target = prevPolls.find((p) => p.id === pollId);
    if (!target) throw new LocalApiError('Poll not found.', 404);
    if (method === 'PATCH') {
      const nextStatus =
        body.status !== undefined ? normalizePollStatus(body.status, target.status) : target.status;
      const updatedPoll: EventPoll = {
        ...target,
        question:
          typeof body.question === 'string' && body.question.trim().length >= 3
            ? body.question.trim().slice(0, 240)
            : target.question,
        description:
          body.description !== undefined
            ? String(body.description || '').trim().slice(0, 320) || undefined
            : target.description,
        sessionLabel:
          body.sessionLabel !== undefined
            ? String(body.sessionLabel || '').trim().slice(0, 80) || undefined
            : target.sessionLabel,
        status: nextStatus,
        allowMultiple:
          body.allowMultiple !== undefined ? Boolean(body.allowMultiple) : target.allowMultiple,
        showResultsToPublic:
          body.showResultsToPublic !== undefined
            ? Boolean(body.showResultsToPublic)
            : target.showResultsToPublic,
        requireVerifiedPass:
          body.requireVerifiedPass !== undefined
            ? Boolean(body.requireVerifiedPass)
            : target.requireVerifiedPass,
        closedAt:
          nextStatus === 'closed'
            ? target.closedAt || new Date().toISOString()
            : nextStatus === 'active'
              ? undefined
              : target.closedAt,
      };
      evt.extraDataConfig = {
        ...existingExtra,
        polls: prevPolls.map((p) => (p.id === pollId ? updatedPoll : p)),
      };
      saveDb(db);
      const { organizerId: _org, ...cleanEvent } = evt;
      return { poll: updatedPoll, event: cleanEvent } as T;
    }
    if (method === 'DELETE') {
      evt.extraDataConfig = {
        ...existingExtra,
        polls: prevPolls.filter((p) => p.id !== pollId),
      };
      saveDb(db);
      const { organizerId: _org, ...cleanEvent } = evt;
      return { ok: true, event: cleanEvent } as T;
    }
  }

  const evtMatch = path.match(/^\/studio\/events\/([^/]+)$/);
  if (evtMatch) {
    requireRoles(user, ['creator', 'organizer']);
    const eventId = decodeURIComponent(evtMatch[1]);
    const idx = db.events.findIndex((e) => e.id === eventId && e.organizerId === user.id);
    if (idx === -1) throw new LocalApiError('Event not found.', 404);
    if (method === 'PATCH') {
      const existing = db.events[idx];
      const patch = body as Partial<EventItem>;
      const ent = getPlanEntitlements(user.profile);
      const nextStatus = patch.status ?? existing.status;
      if (ent.maxActiveEvents != null && isActiveEventStatus(nextStatus)) {
        const otherActive = db.events.filter(
          (e) => e.organizerId === user.id && e.id !== eventId && isActiveEventStatus(e.status)
        ).length;
        if (otherActive >= ent.maxActiveEvents) {
          throw new LocalApiError(
            `Starter plan allows up to ${ent.maxActiveEvents} active (Live or Upcoming) event. Set your other event to Past/Draft or upgrade to Pro Organizer.`,
            403
          );
        }
      }
      const nextCapRaw = patch.capacity ?? existing.capacity;
      if (ent.maxAttendeesPerEvent != null && Number(nextCapRaw) > ent.maxAttendeesPerEvent) {
        throw new LocalApiError(
          `Starter plan caps event capacity at ${ent.maxAttendeesPerEvent} attendees per event. Upgrade to Pro Organizer for unlimited capacity.`,
          403
        );
      }
      if (!ent.allowCustomSenderId && patch.senderId !== existing.senderId && hasCustomSenderIdValue(patch.senderId)) {
        throw new LocalApiError('Custom Alphanumeric Sender ID requires Pro Organizer or Enterprise plan.', 403);
      }
      if (!ent.allowCustomMessages && hasCustomMessageOverrides(patch.messageConfig, existing.messageConfig)) {
        throw new LocalApiError(
          'Custom confirmation & check-in SMS/Email templates require Pro Organizer or Enterprise plan.',
          403
        );
      }
      const mergedExtra = patch.extraDataConfig
        ? {
            ...(existing.extraDataConfig ?? { enableGiftTable: false, customFields: [] }),
            ...patch.extraDataConfig,
            giftLedger: patch.extraDataConfig.giftLedger ?? existing.extraDataConfig?.giftLedger,
            attendantLinks:
              patch.extraDataConfig.attendantLinks ?? existing.extraDataConfig?.attendantLinks,
            polls: patch.extraDataConfig.polls ?? existing.extraDataConfig?.polls,
            planningConfig:
              patch.extraDataConfig.planningConfig ?? existing.extraDataConfig?.planningConfig,
          }
        : existing.extraDataConfig;
      const updated = {
        ...existing,
        ...patch,
        id: eventId,
        extraDataConfig: mergedExtra,
        capacity: getEffectiveEventCapacity(nextCapRaw, user.profile),
        senderId: ent.allowCustomSenderId ? (patch.senderId ?? existing.senderId) : (existing.senderId || DEFAULT_SHARED_SENDER_ID),
        messageConfig: ent.allowCustomMessages ? (patch.messageConfig ?? existing.messageConfig) : existing.messageConfig,
      };
      db.events[idx] = updated;
      saveDb(db);
      const { organizerId: _org, ...clean } = updated;
      return { event: clean } as T;
    }
    if (method === 'DELETE') {
      db.events.splice(idx, 1);
      db.scheduleBlocks = db.scheduleBlocks.filter((b) => b.eventId !== eventId);
      saveDb(db);
      return { ok: true } as T;
    }
  }

  const studioPlanningMatch = path.match(/^\/studio\/events\/([^/]+)\/planning$/);
  if (studioPlanningMatch && (method === 'GET' || method === 'PUT')) {
    requireRoles(user, ['creator', 'organizer']);
    const eventId = decodeURIComponent(studioPlanningMatch[1]);
    const idx = db.events.findIndex((e) => e.id === eventId && e.organizerId === user.id);
    if (idx === -1) throw new LocalApiError('Event not found in studio.', 404);
    const existing = db.events[idx];
    if (method === 'GET') {
      const { organizerId: _org, ...clean } = existing;
      return {
        planningConfig: clean.extraDataConfig?.planningConfig ?? null,
        event: clean,
      } as T;
    }
    const sanitizedPlanning = sanitizeEventPlanningConfig(body, existing.category || 'Events');
    const updated = {
      ...existing,
      extraDataConfig: {
        ...(existing.extraDataConfig ?? { enableGiftTable: false, customFields: [] }),
        planningConfig: sanitizedPlanning,
      },
    };
    db.events[idx] = updated;
    saveDb(db);
    const { organizerId: _org, ...clean } = updated;
    return { planningConfig: sanitizedPlanning, event: clean } as T;
  }

  const checkinMatch = path.match(/^\/studio\/attendees\/([^/]+)\/checkin$/);
  if (method === 'PATCH' && checkinMatch) {
    requireRoles(user, ['creator', 'organizer']);
    const attId = decodeURIComponent(checkinMatch[1]);
    const att = db.attendees.find((a) => a.id === attId);
    if (!att) throw new LocalApiError('Attendee not found.', 404);
    const nowTime = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    att.checkedIn = !att.checkedIn;
    att.checkedInAt = att.checkedIn ? nowTime : undefined;
    const evt = db.events.find((e) => e.id === att.eventId);
    if (evt) {
      evt.checkedIn = Math.max(0, evt.checkedIn + (att.checkedIn ? 1 : -1));
    }
    const owner = (evt && Object.values(db.users).find((u) => u.id === evt.organizerId)) || user;
    const origin =
      typeof window !== 'undefined' && window.location?.origin
        ? window.location.origin
        : 'https://eventsbyyou.xyz';
    let cameraUrl: string | undefined;
    let dispatchedMessage: string | undefined;
    let checkInSmsSent = false;
    let smsCreditsUsed = 0;
    let smsSkippedReason: string | undefined;

    if (att.checkedIn && evt) {
      const resolved = resolveEventMessage({
        type: 'checkin',
        event: evt,
        attendeeName: att.name,
        ticketCode: att.ticketCode,
        originOverride: origin,
        includeGuestInCameraUrl: true,
      });
      cameraUrl = resolved.cameraUrl;
      dispatchedMessage = resolved.text;
      const smsCost = att.phone ? Math.max(1, calculateSmsCredits(resolved.text)) : 0;
      if (att.phone && owner.profile.smsCredits >= smsCost) {
        owner.profile.smsCredits -= smsCost;
        smsCreditsUsed = smsCost;
        checkInSmsSent = true;
        evt.smsDispatched += 1;
      } else if (att.phone) {
        smsSkippedReason = `No SMS credits remaining (${owner.profile.smsCredits} left, ${smsCost} needed). Purchase an SMS bundle for check-in SMS.`;
      }
    }
    saveDb(db);
    return {
      attendee: att,
      checkInMessageSent: checkInSmsSent,
      checkInSmsSent,
      cameraUrl,
      dispatchedMessage,
      smsCredits: owner.profile.smsCredits,
      smsCreditsUsed,
      smsSkippedReason,
    } as T;
  }

  const deleteAttendeeMatch = path.match(/^\/studio\/attendees\/([^/]+)$/);
  if (method === 'DELETE' && deleteAttendeeMatch) {
    requireRoles(user, ['creator', 'organizer']);
    const attId = decodeURIComponent(deleteAttendeeMatch[1]);
    const idx = db.attendees.findIndex((a) => a.id === attId);
    if (idx === -1) throw new LocalApiError('Attendee not found.', 404);
    const att = db.attendees[idx];
    const evt = db.events.find((e) => e.id === att.eventId);
    if (!evt || evt.organizerId !== user.id) {
      throw new LocalApiError('Only the event creator can delete attendees from this event.', 403);
    }
    db.attendees.splice(idx, 1);
    evt.registered = Math.max(0, evt.registered - 1);
    if (att.checkedIn) {
      evt.checkedIn = Math.max(0, evt.checkedIn - 1);
    }
    if (att.paymentStatus === 'paid') {
      evt.revenue = Math.max(0, evt.revenue - evt.ticketPrice);
    }
    saveDb(db);
    const { organizerId: _org, ...cleanEvent } = evt;
    return { ok: true, deletedAttendeeId: attId, event: cleanEvent } as T;
  }

  const retryPayMatch = path.match(/^\/studio\/attendees\/([^/]+)\/retry-payment$/);
  if (method === 'PATCH' && retryPayMatch) {
    requireRoles(user, ['creator', 'organizer']);
    const attId = decodeURIComponent(retryPayMatch[1]);
    const att = db.attendees.find((a) => a.id === attId);
    if (!att) throw new LocalApiError('Attendee not found.', 404);
    att.paymentStatus = 'paid';
    for (const al of db.alerts) {
      if (al.organizerId === user.id && al.category === 'payment') al.resolved = true;
    }
    saveDb(db);
    return { attendee: att } as T;
  }

  if (method === 'POST' && path === '/studio/broadcast') {
    requireRoles(user, ['creator', 'organizer']);
    const message = String(body.message || '').trim();
    const attendeeIds = Array.isArray(body.attendeeIds) ? body.attendeeIds.map(String) : [];
    const rawChannel = body.channel;
    const requestedChannel = rawChannel === 'email' || rawChannel === 'sms' || rawChannel === 'dual' ? rawChannel : undefined;
    if (!message) throw new LocalApiError('Broadcast message text is required.', 400);
    if (attendeeIds.length === 0) {
      throw new LocalApiError('Select at least one recipient for the broadcast.', 400);
    }
    const ent = getPlanEntitlements(user.profile);
    if (!ent.allowSmsBroadcast && requestedChannel !== 'email') {
      throw new LocalApiError(
        'Bulk SMS & Dual SMS/Email broadcasts require Pro Organizer or Enterprise plan. Starter accounts can send Resend Email broadcasts only.',
        403
      );
    }
    const sendSms = ent.allowSmsBroadcast && requestedChannel !== 'email';
    const ownedEventIds = new Set(
      db.events.filter((e) => e.organizerId === user.id).map((e) => e.id)
    );
    const idSet = new Set(attendeeIds);
    const recipients = db.attendees.filter((a) => idSet.has(a.id) && ownedEventIds.has(a.eventId));
    if (recipients.length === 0) {
      throw new LocalApiError('No matching attendees found in your studio.', 404);
    }
    const prepared = recipients.map((att) => {
      const evt = db.events.find((e) => e.id === att.eventId)!;
      const personalizedRaw = message
        .replace(/\{name\}/gi, att.name)
        .replace(/\{event\}/gi, evt.title)
        .replace(/\{ticket_code\}|\{code\}/gi, att.ticketCode);
      const personalized = appendPoweredByLine(personalizedRaw);
      const smsCost = sendSms && att.phone?.trim() ? calculateSmsCredits(personalized) : 0;
      return { att, evt, smsCost };
    });
    const requiredSmsCredits = prepared.reduce((acc, item) => acc + item.smsCost, 0);
    if (requiredSmsCredits > 0 && user.profile.smsCredits < requiredSmsCredits) {
      throw new LocalApiError(
        `Insufficient SMS bundle credits: you have ${user.profile.smsCredits.toLocaleString()} SMS remaining, but this broadcast requires ${requiredSmsCredits.toLocaleString()} SMS.`,
        402
      );
    }
    user.profile.smsCredits = Math.max(0, user.profile.smsCredits - requiredSmsCredits);
    const touchedIds = new Set<string>();
    for (const { evt, smsCost } of prepared) {
      if (smsCost > 0) {
        evt.smsDispatched += 1;
        touchedIds.add(evt.id);
      }
    }
    saveDb(db);
    const updatedEvents = db.events
      .filter((e) => touchedIds.has(e.id))
      .map(({ organizerId: _org, ...clean }) => clean);
    return {
      ok: true,
      recipientCount: recipients.length,
      sentCount: recipients.length,
      creditsUsed: requiredSmsCredits,
      smsCredits: user.profile.smsCredits,
      events: updatedEvents,
    } as T;
  }

  if (method === 'POST' && path === '/studio/schedule') {
    requireRoles(user, ['creator', 'organizer']);
    const blk: ScheduleBlock = {
      ...(body as unknown as ScheduleBlock),
      id: (body.id as string) || `sch-${Date.now()}-${randomHex(2)}`,
    };
    db.scheduleBlocks.push(blk);
    saveDb(db);
    return { block: blk } as T;
  }

  const schToggleMatch = path.match(/^\/studio\/schedule\/([^/]+)\/toggle$/);
  if (method === 'PATCH' && schToggleMatch) {
    requireRoles(user, ['creator', 'organizer']);
    const blockId = decodeURIComponent(schToggleMatch[1]);
    const blk = db.scheduleBlocks.find((b) => b.id === blockId);
    if (!blk) throw new LocalApiError('Schedule block not found.', 404);
    blk.completed = !blk.completed;
    saveDb(db);
    return { block: blk } as T;
  }

  const schDelMatch = path.match(/^\/studio\/schedule\/([^/]+)$/);
  if (method === 'DELETE' && schDelMatch) {
    requireRoles(user, ['creator', 'organizer']);
    const blockId = decodeURIComponent(schDelMatch[1]);
    db.scheduleBlocks = db.scheduleBlocks.filter((b) => b.id !== blockId);
    saveDb(db);
    return { ok: true } as T;
  }

  const alertMatch = path.match(/^\/studio\/alerts\/([^/]+)\/resolve$/);
  if (method === 'PATCH' && alertMatch) {
    requireRoles(user, ['creator', 'organizer']);
    const alertId = decodeURIComponent(alertMatch[1]);
    const al = db.alerts.find((a) => a.id === alertId && a.organizerId === user.id);
    if (!al) throw new LocalApiError('Alert not found.', 404);
    al.resolved = true;
    saveDb(db);
    const { organizerId: _org, ...clean } = al;
    return { alert: clean } as T;
  }

  // Camera
  if (method === 'POST' && path === '/studio/camera/shots') {
    requireRoles(user, ['creator', 'organizer']);
    const shot = body as unknown as DisposableShot;
    const existingEventShots = db.disposableShots.filter((s) => s.eventId === shot.eventId);
    const rollCfg = db.rollSettings[shot.eventId] ?? { exposuresLimit: 24, darkroomMode: false };
    if (existingEventShots.length >= rollCfg.exposuresLimit) {
      throw new LocalApiError(
        `Film roll full (${rollCfg.exposuresLimit}/${rollCfg.exposuresLimit} exposures).`,
        403
      );
    }
    const effectiveKey = (shot.shooterKey || '').trim();
    const normalizedAuthor = (shot.capturedBy || 'Guest').trim().toLowerCase();
    const userShotCount = existingEventShots.filter((s) =>
      effectiveKey && s.shooterKey
        ? s.shooterKey === effectiveKey
        : s.capturedBy.trim().toLowerCase() === normalizedAuthor
    ).length;
    if (userShotCount >= 5) {
      throw new LocalApiError(
        'Camera limit reached: each user is allowed up to 5 pictures per event.',
        403
      );
    }
    db.disposableShots.unshift(shot);
    saveDb(db);
    return { shot } as T;
  }

  const shotLikeMatch = path.match(/^\/studio\/camera\/shots\/([^/]+)\/like$/);
  if (method === 'PATCH' && shotLikeMatch) {
    requireRoles(user, ['creator', 'organizer']);
    const shotId = decodeURIComponent(shotLikeMatch[1]);
    const shot = db.disposableShots.find((s) => s.id === shotId);
    if (!shot) throw new LocalApiError('Shot not found.', 404);
    shot.liked = !shot.liked;
    shot.likes = shot.liked ? shot.likes + 1 : Math.max(0, shot.likes - 1);
    saveDb(db);
    return { shot } as T;
  }

  const shotDelMatch = path.match(/^\/studio\/camera\/shots\/([^/]+)$/);
  if (method === 'DELETE' && shotDelMatch) {
    requireRoles(user, ['creator', 'organizer']);
    const shotId = decodeURIComponent(shotDelMatch[1]);
    db.disposableShots = db.disposableShots.filter((s) => s.id !== shotId);
    saveDb(db);
    return { ok: true } as T;
  }

  const devMatch = path.match(/^\/studio\/camera\/([^/]+)\/develop$/);
  if (method === 'POST' && devMatch) {
    requireRoles(user, ['creator', 'organizer']);
    const eventId = decodeURIComponent(devMatch[1]);
    for (const shot of db.disposableShots) {
      if (shot.eventId === eventId) shot.developed = true;
    }
    saveDb(db);
    return { ok: true } as T;
  }

  const camSettingsMatch = path.match(/^\/studio\/camera\/([^/]+)\/settings$/);
  if (method === 'PUT' && camSettingsMatch) {
    requireRoles(user, ['creator', 'organizer']);
    const eventId = decodeURIComponent(camSettingsMatch[1]);
    const settings = body as unknown as DisposableRollSettings;
    db.rollSettings[eventId] = settings;
    saveDb(db);
    return { settings } as T;
  }

  if (method === 'POST' && path === '/studio/creator-unlock') {
    requireRoles(user, ['creator']);
    return { unlocked: true, creatorToken: `loc_creator_${user.id}` } as T;
  }

  // Creator Apps
  if (method === 'POST' && path === '/studio/apps') {
    requireRoles(user, ['creator']);
    const name = String(body.name || '').trim();
    if (!name) throw new LocalApiError('App name is required.', 400);
    const env = (body.environment as CreatorAppEnvironment) || 'sandbox';
    const rawSecret = `${env === 'production' ? 'ev_live_sec_' : 'ev_test_sec_'}${randomHex(16)}`;
    const secretPrefix = `${rawSecret.slice(0, 16)}••••••••${rawSecret.slice(-4)}`;
    const webhookSecret = `whsec_${randomHex(16)}`;
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'app';
    const record: StoredCreatorAppRecord = {
      id: `app-${Date.now().toString(36)}-${randomHex(3)}`,
      organizerId: user.id,
      name,
      slug,
      description: String(body.description || '').trim(),
      appType: (body.appType as CreatorAppType) || 'kiosk',
      environment: env,
      status: 'active',
      eventId: body.eventId ? String(body.eventId) : undefined,
      clientId: `ev_${env === 'production' ? 'live' : 'test'}_${randomHex(8)}`,
      secretPrefix,
      webhookSecret,
      scopes: Array.isArray(body.scopes) ? (body.scopes as CreatorAppScope[]) : ['events:read'],
      webhookUrl: body.webhookUrl ? String(body.webhookUrl) : undefined,
      webhookEvents: Array.isArray(body.webhookEvents)
        ? (body.webhookEvents as WebhookTriggerEvent[])
        : [],
      allowedOrigins: Array.isArray(body.allowedOrigins)
        ? body.allowedOrigins.map(String)
        : [],
      requestsCount: 0,
      createdAt: new Date().toISOString(),
    };
    db.creatorApps.unshift(record);
    const log: CreatorAppLog = {
      id: `log-${Date.now()}-${randomHex(2)}`,
      appId: record.id,
      eventType: 'app.created',
      method: 'POST',
      endpoint: '/api/studio/apps',
      statusCode: 201,
      latencyMs: 12,
      requestSummary: `Provisioned ${record.name} (${env}) with ${record.scopes.length} scopes`,
      responseSummary: `client_id=${record.clientId}`,
      createdAt: new Date().toISOString(),
    };
    db.creatorAppLogs.unshift(log);
    saveDb(db);
    const { organizerId: _org, webhookSecret: _ws, ...app } = record;
    return { app, rawSecret, webhookSecret, log } as T;
  }

  const appRotateMatch = path.match(/^\/studio\/apps\/([^/]+)\/rotate-secret$/);
  if (method === 'POST' && appRotateMatch) {
    requireRoles(user, ['creator']);
    const appId = decodeURIComponent(appRotateMatch[1]);
    const rec = db.creatorApps.find((a) => a.id === appId && a.organizerId === user.id);
    if (!rec) throw new LocalApiError('Creator app not found.', 404);
    const rawSecret = `${rec.environment === 'production' ? 'ev_live_sec_' : 'ev_test_sec_'}${randomHex(16)}`;
    rec.secretPrefix = `${rawSecret.slice(0, 16)}••••••••${rawSecret.slice(-4)}`;
    rec.webhookSecret = `whsec_${randomHex(16)}`;
    const log: CreatorAppLog = {
      id: `log-${Date.now()}-${randomHex(2)}`,
      appId,
      eventType: 'credentials.rotated',
      method: 'POST',
      endpoint: `/api/studio/apps/${appId}/rotate-secret`,
      statusCode: 200,
      latencyMs: 15,
      requestSummary: 'Rotated client secret & signing key',
      responseSummary: `new_prefix=${rec.secretPrefix}`,
      createdAt: new Date().toISOString(),
    };
    db.creatorAppLogs.unshift(log);
    saveDb(db);
    const { organizerId: _org, webhookSecret: _ws, ...app } = rec;
    return { app, rawSecret, webhookSecret: rec.webhookSecret, log } as T;
  }

  const appWebhookMatch = path.match(/^\/studio\/apps\/([^/]+)\/test-webhook$/);
  if (method === 'POST' && appWebhookMatch) {
    requireRoles(user, ['creator']);
    const appId = decodeURIComponent(appWebhookMatch[1]);
    const rec = db.creatorApps.find((a) => a.id === appId && a.organizerId === user.id);
    if (!rec) throw new LocalApiError('Creator app not found.', 404);
    const trigger = String(body.eventType || 'attendee.registered');
    rec.requestsCount += 1;
    rec.lastUsedAt = `Today ${new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
    const log: CreatorAppLog = {
      id: `log-${Date.now()}-${randomHex(2)}`,
      appId,
      eventType: trigger,
      method: 'POST',
      endpoint: rec.webhookUrl || '/sandbox/webhook-loopback',
      statusCode: 200,
      latencyMs: 18,
      requestSummary: `Signed webhook ${trigger} (browser sandbox)`,
      responseSummary: 'Sandbox loopback acknowledged (HTTP 200)',
      createdAt: new Date().toISOString(),
    };
    db.creatorAppLogs.unshift(log);
    saveDb(db);
    const { organizerId: _org, webhookSecret: _ws, ...app } = rec;
    return { app, log } as T;
  }

  const appSimMatch = path.match(/^\/studio\/apps\/([^/]+)\/simulate-call$/);
  if (method === 'POST' && appSimMatch) {
    requireRoles(user, ['creator']);
    const appId = decodeURIComponent(appSimMatch[1]);
    const rec = db.creatorApps.find((a) => a.id === appId && a.organizerId === user.id);
    if (!rec) throw new LocalApiError('Creator app not found.', 404);
    const cleanEndpoint = String(body.endpoint || '/v1/events');
    const httpMethod = body.method === 'POST' ? 'POST' : 'GET';
    let statusCode = 200;
    let result: Record<string, unknown> = { ok: true };
    let responseSummary = '200 OK';
    const userEvents = db.events.filter((e) => e.organizerId === user.id);
    const scopedEvents = rec.eventId ? userEvents.filter((e) => e.id === rec.eventId) : userEvents;
    const scopedIds = new Set(scopedEvents.map((e) => e.id));

    if (rec.status !== 'active') {
      statusCode = 403;
      result = { error: 'App client is paused. Resume app to accept API calls.' };
      responseSummary = '403 Forbidden — App is currently paused';
    } else if (cleanEndpoint === '/v1/events') {
      const list = scopedEvents.map((e) => ({
        id: e.id,
        title: e.title,
        status: e.status,
        registered: e.registered,
        capacity: e.capacity,
      }));
      result = { count: list.length, events: list };
      responseSummary = `Returned ${list.length} event(s)`;
    } else if (cleanEndpoint === '/v1/attendees') {
      const list = db.attendees
        .filter((a) => scopedIds.has(a.eventId))
        .slice(0, 20)
        .map((a) => ({
          id: a.id,
          name: a.name,
          tier: a.tier,
          checked_in: a.checkedIn,
          ticket_code: a.ticketCode,
        }));
      result = { count: list.length, attendees: list };
      responseSummary = `Returned ${list.length} attendee pass(es)`;
    } else if (cleanEndpoint === '/v1/checkin') {
      result = {
        verified: true,
        mode: rec.environment,
        checkedInAt: new Date().toISOString(),
        clientId: rec.clientId,
      };
      responseSummary = `Gate check-in verified (${rec.environment})`;
    } else if (cleanEndpoint === '/v1/camera/shots') {
      const frames = db.disposableShots
        .filter((s) => scopedIds.has(s.eventId))
        .slice(0, 20)
        .map((s) => ({
          id: s.id,
          frame_number: s.frameNumber,
          film_stock: s.filmStock,
          captured_by: s.capturedBy,
          developed: s.developed,
        }));
      result = { count: frames.length, frames };
      responseSummary = `Returned ${frames.length} 35mm film frame(s)`;
    }
    rec.requestsCount += 1;
    rec.lastUsedAt = `Today ${new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
    const log: CreatorAppLog = {
      id: `log-${Date.now()}-${randomHex(2)}`,
      appId,
      eventType: 'api.invocation',
      method: httpMethod,
      endpoint: cleanEndpoint,
      statusCode,
      latencyMs: 9,
      requestSummary: `${httpMethod} ${cleanEndpoint} (${rec.clientId})`,
      responseSummary,
      createdAt: new Date().toISOString(),
    };
    db.creatorAppLogs.unshift(log);
    saveDb(db);
    const { organizerId: _org, webhookSecret: _ws, ...app } = rec;
    return { app, log, result } as T;
  }

  const appItemMatch = path.match(/^\/studio\/apps\/([^/]+)$/);
  if (appItemMatch) {
    requireRoles(user, ['creator']);
    const appId = decodeURIComponent(appItemMatch[1]);
    const idx = db.creatorApps.findIndex((a) => a.id === appId && a.organizerId === user.id);
    if (idx === -1) throw new LocalApiError('Creator app not found.', 404);
    if (method === 'PATCH') {
      const existing = db.creatorApps[idx];
      db.creatorApps[idx] = {
        ...existing,
        name:
          typeof body.name === 'string' && body.name.trim() ? body.name.trim() : existing.name,
        description:
          typeof body.description === 'string' ? body.description.trim() : existing.description,
        appType: (body.appType as CreatorAppType) ?? existing.appType,
        environment: (body.environment as CreatorAppEnvironment) ?? existing.environment,
        status: (body.status as CreatorAppStatus) ?? existing.status,
        eventId:
          body.eventId !== undefined
            ? body.eventId
              ? String(body.eventId)
              : undefined
            : existing.eventId,
        scopes: Array.isArray(body.scopes) ? (body.scopes as CreatorAppScope[]) : existing.scopes,
        webhookUrl:
          body.webhookUrl !== undefined
            ? body.webhookUrl
              ? String(body.webhookUrl)
              : undefined
            : existing.webhookUrl,
        webhookEvents: Array.isArray(body.webhookEvents)
          ? (body.webhookEvents as WebhookTriggerEvent[])
          : existing.webhookEvents,
        allowedOrigins: Array.isArray(body.allowedOrigins)
          ? body.allowedOrigins.map(String)
          : existing.allowedOrigins,
      };
      saveDb(db);
      const { organizerId: _org, webhookSecret: _ws, ...app } = db.creatorApps[idx];
      return { app } as T;
    }
    if (method === 'DELETE') {
      db.creatorApps.splice(idx, 1);
      db.creatorAppLogs = db.creatorAppLogs.filter((l) => l.appId !== appId);
      saveDb(db);
      return { ok: true } as T;
    }
  }

  // Builder Console routes
  if (path.startsWith('/builder/')) {
    requireRoles(user, ['creator']);

    if (method === 'GET' && path === '/builder/overview') {
      const allUsers = Object.values(db.users);
      const eventMap = new Map(db.events.map((e) => [e.id, e]));
      const totalDispatched = db.events.reduce((acc, e) => acc + e.smsDispatched, 0);
      const pendingAtts = db.attendees.filter((a) => a.smsStatus === 'Pending');
      const deliveredCount = Math.max(0, totalDispatched - pendingAtts.length);
      const successRatePct =
        totalDispatched > 0 ? Number(((deliveredCount / totalDispatched) * 100).toFixed(1)) : 100;

      const failedQueue: BuilderSmsQueueItem[] = pendingAtts.map((a) => ({
        attendeeId: a.id,
        attendeeName: a.name,
        phone: a.phone,
        eventId: a.eventId,
        eventTitle: eventMap.get(a.eventId)?.title ?? a.eventId,
        smsStatus: a.smsStatus,
      }));

      const tenants = allUsers.map((u) => buildTenantSummary(db, u));
      const eventTraffic: BuilderEventTrafficRow[] = db.events.map((e) => {
        const evtShots = db.disposableShots.filter((s) => s.eventId === e.id);
        const bytes = evtShots.reduce((acc, s) => acc + estimateShotBytes(s.dataUrl), 0);
        return {
          eventId: e.id,
          title: e.title,
          slug: e.slug,
          status: e.status,
          registered: e.registered,
          capacity: e.capacity,
          checkedIn: e.checkedIn,
          duplicateBlocks: db.duplicateBlocksByEvent[e.id] ?? 0,
          cameraShots: evtShots.length,
          cameraStorageMb: Number((bytes / (1024 * 1024)).toFixed(2)),
          registrationPaused: db.flags.pausedEventIds.includes(e.id),
        };
      });

      const perTenant: BuilderTenantUnitEconomics[] = allUsers.map((u) => {
        const uEvts = db.events.filter((e) => e.organizerId === u.id);
        const uEvtIds = new Set(uEvts.map((e) => e.id));
        const smsSentCount = uEvts.reduce((acc, e) => acc + e.smsDispatched, 0);
        const uShots = db.disposableShots.filter((s) => uEvtIds.has(s.eventId));
        const storageMb = Number(
          (uShots.reduce((acc, s) => acc + estimateShotBytes(s.dataUrl), 0) / (1024 * 1024)).toFixed(2)
        );
        const mrrUsd = PLAN_MRR_USD[u.profile.plan];
        const smsCostUsd = Number((smsSentCount * 0.012).toFixed(2));
        const storageCostUsd = Number((storageMb * 0.08).toFixed(2));
        const netMarginUsd = Number((mrrUsd - smsCostUsd - storageCostUsd).toFixed(2));
        return {
          userId: u.id,
          name: u.profile.name,
          email: u.email,
          plan: u.profile.plan,
          mrrUsd,
          smsSentCount,
          smsCostUsd,
          storageMb,
          storageCostUsd,
          netMarginUsd,
          unprofitableFlag: netMarginUsd < 0,
        };
      });

      const totalMrrUsd = Number(perTenant.reduce((a, t) => a + t.mrrUsd, 0).toFixed(2));
      const totalSmsCostUsd = Number(perTenant.reduce((a, t) => a + t.smsCostUsd, 0).toFixed(2));
      const totalStorageCostUsd = Number(perTenant.reduce((a, t) => a + t.storageCostUsd, 0).toFixed(2));
      const totalStorageMb = Number(perTenant.reduce((a, t) => a + t.storageMb, 0).toFixed(2));

      const overview: BuilderConsoleOverview = {
        storageMode: 'in-memory',
        dbLatencyMs: 3,
        rlsVerified: true,
        tableCounts: {
          profiles: allUsers.length,
          events: db.events.length,
          attendees: db.attendees.length,
          disposable_shots: db.disposableShots.length,
          creator_apps: db.creatorApps.length,
        },
        recentErrors: db.recentErrors,
        smsTelemetry: {
          mode: db.flags.smsMode,
          activeSenderId: db.flags.arkeselSenderId || 'EVENTSAPP',
          usingDefaultSenderIdWarning: !db.flags.arkeselSenderId,
          totalDispatched,
          deliveredCount,
          pendingOrFailedCount: pendingAtts.length,
          successRatePct,
          gatewayBalanceCredits: db.gatewayBalanceCredits,
          organizerCreditLiabilities: allUsers.reduce((acc, u) => acc + u.profile.smsCredits, 0),
          failedQueue,
          recentDispatches: [],
        },
        tenants,
        eventTraffic,
        totalDuplicateBlocks: Object.values(db.duplicateBlocksByEvent).reduce((a, b) => a + b, 0),
        diagnosticFailures: db.diagnosticFailures,
        flags: { ...db.flags, pausedEventIds: [...db.flags.pausedEventIds] },
        envStatus: {
          SUPABASE_URL: false,
          SUPABASE_ANON_KEY: false,
          SUPABASE_SERVICE_ROLE_KEY: false,
          ARKESEL_API_KEY: false,
          ARKESEL_SENDER_ID: false,
          arkeselSenderIdValue: 'EVENTSAPP',
          RESEND_API_KEY: false,
          RESEND_FROM_EMAIL: false,
          PAYSTACK_SECRET_KEY: false,
          CREATOR_PASSWORD: false,
          CREATOR_EMAIL,
        },
        pendingSmsPurchases: [...db.smsPurchases]
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
          .slice(0, 30),
        pendingSubscriptionPayments: [...db.subscriptionPayments]
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
          .slice(0, 30),
        unitEconomics: {
          totalMrrUsd,
          totalSmsCostUsd,
          totalStorageCostUsd,
          grossMarginUsd: Number((totalMrrUsd - totalSmsCostUsd - totalStorageCostUsd).toFixed(2)),
          totalStorageMb,
          proCount: allUsers.filter((u) => u.profile.plan === 'Pro Organizer').length,
          enterpriseCount: allUsers.filter((u) => u.profile.plan === 'Enterprise').length,
          starterCount: allUsers.filter((u) => u.profile.plan === 'Starter').length,
          perTenant,
        },
      };
      return overview as T;
    }

    if (method === 'POST' && path === '/builder/errors/clear') {
      db.recentErrors = [];
      saveDb(db);
      return { ok: true } as T;
    }

    if (method === 'POST' && path === '/builder/sms/retry') {
      const targetId = body.attendeeId ? String(body.attendeeId) : undefined;
      let retried = 0;
      for (const att of db.attendees) {
        if (targetId && att.id !== targetId) continue;
        if (att.smsStatus === 'Pending') {
          att.smsStatus = 'Arkesel Sent';
          retried += 1;
        }
      }
      saveDb(db);
      return { retried } as T;
    }

    if (method === 'POST' && path === '/builder/sms/sync-dlr') {
      return {
        ok: true,
        balance: {
          ok: true,
          balanceCredits: db.gatewayBalanceCredits,
        },
        dlr: {
          ok: true,
          checked: 0,
          updated: 0,
        },
        emailDiagnostics: {
          resendConfigured: false,
          activeFrom: 'onboarding@resend.dev',
          domainName: 'resend.dev',
          domainVerified: false,
          usingSharedSandboxSender: true,
          usingSupabaseFallback: false,
          verifiedDomains: [],
          dnsStatus: 'unconfigured',
          recommendation:
            'Browser local fallback mode is active. Configure RESEND_API_KEY & verified RESEND_FROM_EMAIL on the server for inbox delivery.',
        },
        recentDispatches: [],
      } as T;
    }

    if (method === 'PATCH' && path === '/builder/flags') {
      const patch = body as Partial<BuilderFeatureFlags>;
      if (typeof patch.publicRegistrationsPaused === 'boolean') {
        db.flags.publicRegistrationsPaused = patch.publicRegistrationsPaused;
      }
      if (Array.isArray(patch.pausedEventIds)) {
        db.flags.pausedEventIds = Array.from(new Set(patch.pausedEventIds.map(String)));
      }
      if (patch.smsMode === 'live' || patch.smsMode === 'sandbox') {
        db.flags.smsMode = patch.smsMode;
      }
      if (typeof patch.arkeselSenderId === 'string') {
        const cleaned = patch.arkeselSenderId
          .trim()
          .toUpperCase()
          .replace(/[^A-Z0-9]/g, '')
          .slice(0, 11);
        db.flags.arkeselSenderId = cleaned || undefined;
      }
      if (typeof patch.signupsEnabled === 'boolean') {
        db.flags.signupsEnabled = patch.signupsEnabled;
      }
      if (typeof patch.starterSeedingEnabled === 'boolean') {
        db.flags.starterSeedingEnabled = patch.starterSeedingEnabled;
      }
      saveDb(db);
      return { flags: db.flags } as T;
    }

    const tenantActionMatch = path.match(/^\/builder\/tenants\/([^/]+)\/([^/]+)$/);
    if (tenantActionMatch) {
      const targetUserId = decodeURIComponent(tenantActionMatch[1]);
      const action = tenantActionMatch[2];
      const targetUser = db.users[targetUserId];
      if (!targetUser) throw new LocalApiError('Organiser account not found.', 404);

      if (action === 'credits' && method === 'POST') {
        targetUser.profile.smsCredits = Math.max(
          0,
          targetUser.profile.smsCredits + Number(body.amount ?? 100)
        );
        saveDb(db);
        return { tenant: buildTenantSummary(db, targetUser) } as T;
      }
      if (action === 'plan' && method === 'POST') {
        const nextPlan = body.plan as OrganizerProfile['plan'];
        targetUser.profile.plan = nextPlan;
        if (nextPlan === 'Starter') {
          targetUser.profile.planBillingCycle = 'monthly';
          targetUser.profile.planExpiresAt = undefined;
          targetUser.profile.senderId = DEFAULT_SHARED_SENDER_ID;
        } else {
          targetUser.profile.planBillingCycle = 'monthly';
          targetUser.profile.planExpiresAt = computePlanExpiresAtIso('monthly');
        }
        saveDb(db);
        return { tenant: buildTenantSummary(db, targetUser) } as T;
      }
      if (action === 'role' && method === 'POST') {
        const nextRole = body.appRole as AppRole;
        if (nextRole === 'creator') {
          throw new LocalApiError(
            'The creator role is exclusive to the platform owner and cannot be assigned to any other user.',
            403
          );
        }
        if (nextRole !== 'organizer' && nextRole !== 'gate_staff') {
          throw new LocalApiError('Invalid RBAC role.', 400);
        }
        if (targetUser.email.trim().toLowerCase() === CREATOR_EMAIL) {
          throw new LocalApiError('The primary creator account role cannot be modified.', 403);
        }
        targetUser.profile.appRole = nextRole;
        targetUser.profile.role = nextRole === 'gate_staff' ? 'Gate Check-In Staff' : 'Lead Organiser';
        saveDb(db);
        return { tenant: buildTenantSummary(db, targetUser) } as T;
      }
      if (action === 'suspend' && method === 'POST') {
        targetUser.suspended = !targetUser.suspended;
        saveDb(db);
        return { tenant: buildTenantSummary(db, targetUser) } as T;
      }
      if (action === 'revoke-sessions' && method === 'POST') {
        let revoked = 0;
        for (const [tok, sess] of Object.entries(db.sessions)) {
          if (sess.userId === targetUserId) {
            delete db.sessions[tok];
            revoked += 1;
          }
        }
        saveDb(db);
        return { revoked } as T;
      }
      if (action === 'inspect' && method === 'GET') {
        const events = db.events
          .filter((e) => e.organizerId === targetUserId)
          .map(({ organizerId: _org, ...rest }) => rest);
        const evtIds = new Set(events.map((e) => e.id));
        const attendees = db.attendees.filter((a) => evtIds.has(a.eventId));
        return {
          tenant: buildTenantSummary(db, targetUser),
          events,
          attendees,
        } satisfies BuilderTenantInspection as T;
      }
    }

    const diagMatch = path.match(/^\/builder\/diagnostics\/([^/]+)\/replay$/);
    if (method === 'POST' && diagMatch) {
      const diagId = decodeURIComponent(diagMatch[1]);
      const item = db.diagnosticFailures.find((d) => d.id === diagId);
      if (!item) throw new LocalApiError('Diagnostic failure entry not found.', 404);
      item.replayed = true;
      saveDb(db);
      return { item } as T;
    }

    const resolvePurchaseMatch = path.match(/^\/builder\/sms-purchases\/([^/]+)\/resolve$/);
    if (method === 'POST' && resolvePurchaseMatch) {
      const purchaseId = decodeURIComponent(resolvePurchaseMatch[1]);
      const action = body.action === 'approve' ? 'approve' : body.action === 'reject' ? 'reject' : null;
      if (!action) throw new LocalApiError('Action must be "approve" or "reject".', 400);
      const idx = db.smsPurchases.findIndex((p) => p.id === purchaseId);
      if (idx === -1) throw new LocalApiError('SMS bundle purchase record not found.', 404);
      const existing = db.smsPurchases[idx];
      const targetUser = db.users[existing.organizerId];
      if (!targetUser) throw new LocalApiError('Organizer profile not found.', 404);
      if (existing.status === 'credited') {
        return {
          ok: true,
          alreadyCredited: true,
          purchase: existing,
          smsCredits: targetUser.profile.smsCredits,
        } as T;
      }
      if (action === 'reject') {
        const rejected: SmsBundlePurchase = {
          ...existing,
          status: 'rejected',
          rejectionReason:
            typeof body.reason === 'string' && body.reason.trim()
              ? body.reason.trim()
              : 'Rejected by creator administrator.',
          verifiedAt: new Date().toISOString(),
        };
        db.smsPurchases[idx] = rejected;
        saveDb(db);
        return {
          ok: true,
          alreadyCredited: false,
          purchase: rejected,
          smsCredits: targetUser.profile.smsCredits,
        } as T;
      }
      const approved: SmsBundlePurchase = {
        ...existing,
        status: 'credited',
        rejectionReason: undefined,
        verifiedAt: new Date().toISOString(),
      };
      db.smsPurchases[idx] = approved;
      targetUser.profile.smsCredits += approved.credits;
      saveDb(db);
      return {
        ok: true,
        alreadyCredited: false,
        purchase: approved,
        smsCredits: targetUser.profile.smsCredits,
      } as T;
    }

    const resolveSubMatch = path.match(/^\/builder\/subscription-purchases\/([^/]+)\/resolve$/);
    if (method === 'POST' && resolveSubMatch) {
      const paymentId = decodeURIComponent(resolveSubMatch[1]);
      const action = body.action === 'approve' ? 'approve' : body.action === 'reject' ? 'reject' : null;
      if (!action) throw new LocalApiError('Action must be "approve" or "reject".', 400);
      const idx = db.subscriptionPayments.findIndex((p) => p.id === paymentId);
      if (idx === -1) throw new LocalApiError('Subscription payment record not found.', 404);
      const existing = db.subscriptionPayments[idx];
      const targetUser = db.users[existing.organizerId];
      if (!targetUser) throw new LocalApiError('Organizer profile not found.', 404);
      if (existing.status === 'active') {
        return {
          ok: true,
          alreadyActivated: true,
          payment: existing,
          plan: targetUser.profile.plan,
        } as T;
      }
      if (action === 'reject') {
        const rejected: SubscriptionPayment = {
          ...existing,
          status: 'rejected',
          rejectionReason:
            typeof body.reason === 'string' && body.reason.trim()
              ? body.reason.trim()
              : 'Rejected by creator administrator.',
          verifiedAt: new Date().toISOString(),
        };
        db.subscriptionPayments[idx] = rejected;
        saveDb(db);
        return {
          ok: true,
          alreadyActivated: false,
          payment: rejected,
          plan: targetUser.profile.plan,
        } as T;
      }
      const now = new Date();
      const nowIso = now.toISOString();
      const expiresIso = computePlanExpiresAtIso(existing.billingCycle, now);
      const approved: SubscriptionPayment = {
        ...existing,
        status: 'active',
        rejectionReason: undefined,
        periodStart: nowIso,
        periodEnd: expiresIso,
        verifiedAt: nowIso,
      };
      db.subscriptionPayments[idx] = approved;
      targetUser.profile.plan = approved.planName;
      targetUser.profile.planBillingCycle = approved.billingCycle;
      targetUser.profile.planExpiresAt = expiresIso;
      saveDb(db);
      return {
        ok: true,
        alreadyActivated: false,
        payment: approved,
        plan: targetUser.profile.plan,
      } as T;
    }
  }

  throw new LocalApiError(`Unsupported local fallback route: ${method} ${path}`, 404);
}
