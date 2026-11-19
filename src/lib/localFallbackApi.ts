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
  OrganizerProfile,
  ScheduleBlock,
  SystemAlert,
  WebhookTriggerEvent,
} from '../types/events';

const STORAGE_KEY = 'eventsapp_local_backend_v1';
const SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const CREATOR_EMAIL = 'amoakoimml@gmail.com';

const PLAN_MRR_USD: Record<OrganizerProfile['plan'], number> = {
  Starter: 0,
  'Pro Organizer': 29,
  Enterprise: 99,
};

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
  const partnerId = 'usr-grace-chapel';
  const enterpriseId = 'usr-meridian-corp';

  const creatorProfile: OrganizerProfile = {
    ...INITIAL_PROFILE,
    name: 'Apps Creator',
    firstName: 'Creator',
    role: 'Apps Creator',
    appRole: 'creator',
    email: CREATOR_EMAIL,
    studio: 'Apps Creator Console',
    plan: 'Pro Organizer',
    smsCredits: 1840,
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
      lastLoginAt: new Date(Date.now() - 18 * 60 * 1000).toISOString(),
      createdAt: '2026-09-14T08:30:00.000Z',
    },
    [partnerId]: {
      id: partnerId,
      email: 'events@gracechapel.org',
      passwordHash: hashPassword('grace2026'),
      profile: {
        name: 'Pastor Daniel Adjei',
        firstName: 'Daniel',
        role: 'Lead Organiser',
        appRole: 'organizer',
        email: 'events@gracechapel.org',
        studio: 'Grace Chapel Ministry',
        plan: 'Starter',
        smsCredits: 14,
        capacityAlertThreshold: 90,
        timezone: 'Africa/Accra',
        twoFactorEnabled: true,
        senderId: 'GRACECH',
      },
      suspended: false,
      lastLoginAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
      createdAt: '2026-10-02T11:15:00.000Z',
    },
    [enterpriseId]: {
      id: enterpriseId,
      email: 'ops@meridianbank.ng',
      passwordHash: hashPassword('meridian2026'),
      profile: {
        name: 'Chidi Okonkwo',
        firstName: 'Chidi',
        role: 'VP Corporate Events',
        appRole: 'organizer',
        email: 'ops@meridianbank.ng',
        studio: 'Meridian Financial Group',
        plan: 'Enterprise',
        smsCredits: 4200,
        capacityAlertThreshold: 95,
        timezone: 'Africa/Lagos',
        twoFactorEnabled: true,
        senderId: 'MERIDIAN',
      },
      suspended: false,
      lastLoginAt: new Date(Date.now() - 25 * 60 * 1000).toISOString(),
      createdAt: '2026-09-20T09:00:00.000Z',
    },
  };

  const events = INITIAL_EVENTS.map((evt) => ({
    ...evt,
    organizer: creatorProfile.name || evt.organizer,
    organizerId: creatorId,
  }));

  const alerts = INITIAL_ALERTS.map((al) => ({
    ...al,
    organizerId: creatorId,
  }));

  return {
    users,
    sessions: {},
    pendingSignups: {},
    events,
    attendees: INITIAL_ATTENDEES.map((a) => ({ ...a })),
    scheduleBlocks: INITIAL_SCHEDULE.map((b) => ({ ...b })),
    alerts,
    disposableShots: INITIAL_DISPOSABLE_SHOTS.map((s) => ({ ...s })),
    rollSettings: { ...INITIAL_ROLL_SETTINGS },
    creatorApps: [],
    creatorAppLogs: [],
    flags: {
      publicRegistrationsPaused: false,
      pausedEventIds: [],
      smsMode: 'sandbox',
      signupsEnabled: true,
      starterSeedingEnabled: true,
    },
    recentErrors: [],
    duplicateBlocksByEvent: {},
    diagnosticFailures: [],
    gatewayBalanceCredits: 25000,
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

function getAuthenticatedUser(db: LocalDatabase, accessToken?: string | null): LocalUser {
  if (!accessToken) {
    throw new LocalApiError('Authentication required. Please sign in.', 401);
  }
  const sess = db.sessions[accessToken];
  if (!sess) {
    throw new LocalApiError('Session expired. Please sign in again.', 401);
  }
  const now = Date.now();
  if (sess.expiresAt * 1000 < now || now - sess.lastActivityAt > SESSION_IDLE_TIMEOUT_MS) {
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
  return user.profile.appRole ?? (user.email.toLowerCase() === CREATOR_EMAIL ? 'creator' : 'organizer');
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
          smsCredits: 20,
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
    const redirectTo =
      parsedUrl.searchParams.get('redirectTo')?.replace(/\/$/, '') || window.location.origin;
    const creator = findUserByEmail(db, CREATOR_EMAIL) || Object.values(db.users)[0];
    const session = createSession(db, creator.id);
    const urlOut = `${redirectTo}/#access_token=${encodeURIComponent(
      session.accessToken
    )}&refresh_token=${encodeURIComponent(session.refreshToken)}&expires_in=604800`;
    return { url: urlOut } as T;
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
    const user = getAuthenticatedUser(db, accessToken);
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
  if (method === 'GET' && path === '/public/events') {
    const events = db.events
      .filter((e) => e.status === 'live' || e.status === 'upcoming')
      .map(({ organizerId: _org, ...rest }) => rest);
    return { events } as T;
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
    const { organizerId: _org, ...clean } = matched;
    return { event: clean } as T;
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
    if (!name || !email || !phone) {
      throw new LocalApiError('Name, email, and phone number are required.', 400);
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
      smsStatus: 'Pending',
      paymentStatus: 'paid',
      validationGroup: body.validationGroup ? String(body.validationGroup).trim() : undefined,
      inviteCodeUsed: body.inviteCodeUsed ? String(body.inviteCodeUsed).trim() : undefined,
      giftEntry: body.giftEntry as Attendee['giftEntry'],
      customResponses: body.customResponses as Record<string, string> | undefined,
    };
    db.attendees.unshift(attendee);
    evt.registered += 1;
    evt.smsDispatched += 1;
    evt.revenue += evt.ticketPrice;
    saveDb(db);
    const { organizerId: _org, ...cleanEvent } = evt;
    return { attendee, event: cleanEvent } as T;
  }

  // Authenticated Studio & Builder routes
  const user = getAuthenticatedUser(db, accessToken);

  if (method === 'GET' && path === '/studio/bootstrap') {
    return loadUserWorkspace(db, user.id) as T;
  }

  if (method === 'POST' && path === '/studio/seed-starter') {
    requireRoles(user, ['creator', 'organizer']);
    if (!db.flags.starterSeedingEnabled) {
      throw new LocalApiError(
        'Starter data seeding is currently disabled by platform administrator.',
        403
      );
    }
    seedStarterForUser(db, user.id, user.profile.name);
    saveDb(db);
    return loadUserWorkspace(db, user.id) as T;
  }

  if (method === 'PATCH' && path === '/studio/profile') {
    requireRoles(user, ['creator', 'organizer']);
    const { appRole: _ignoreRole, phoneVerified: _ignoreVerified, ...safePatch } =
      body as Partial<OrganizerProfile>;
    user.profile = { ...user.profile, ...safePatch };
    saveDb(db);
    return { profile: user.profile } as T;
  }

  if (method === 'POST' && path === '/studio/events') {
    requireRoles(user, ['creator', 'organizer']);
    const event = body.event as EventItem | undefined;
    const blocks = Array.isArray(body.blocks) ? (body.blocks as ScheduleBlock[]) : [];
    if (!event?.title) throw new LocalApiError('Invalid event payload.', 400);
    const baseSlug =
      (event.slug || event.title)
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, '-')
        .replace(/(^-|-$)+/g, '') || `event-${Date.now().toString(36)}`;
    const slugTaken = db.events.some((e) => e.slug === baseSlug);
    const uniqueSlug = slugTaken ? `${baseSlug}-${randomHex(2)}` : baseSlug;
    const uniqueEventId = `evt-${Date.now().toString(36)}-${randomHex(4)}`;
    const created: EventItem = {
      ...event,
      id: uniqueEventId,
      slug: uniqueSlug,
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
    const payload = body as unknown as Attendee;
    const att: Attendee = {
      ...payload,
      id: payload.id || `att-${Date.now()}-${randomHex(2)}`,
      eventId,
      phone: normalizePhoneE164(payload.phone || ''),
    };
    db.attendees.unshift(att);
    evt.registered += 1;
    evt.smsDispatched += 1;
    evt.revenue += evt.ticketPrice;
    saveDb(db);
    const { organizerId: _org, ...cleanEvent } = evt;
    return { attendee: att, event: cleanEvent } as T;
  }

  const evtMatch = path.match(/^\/studio\/events\/([^/]+)$/);
  if (evtMatch) {
    requireRoles(user, ['creator', 'organizer']);
    const eventId = decodeURIComponent(evtMatch[1]);
    const idx = db.events.findIndex((e) => e.id === eventId && e.organizerId === user.id);
    if (idx === -1) throw new LocalApiError('Event not found.', 404);
    if (method === 'PATCH') {
      const updated = { ...db.events[idx], ...(body as Partial<EventItem>), id: eventId };
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

  const checkinMatch = path.match(/^\/studio\/attendees\/([^/]+)\/checkin$/);
  if (method === 'PATCH' && checkinMatch) {
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
    saveDb(db);
    return { attendee: att } as T;
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
    const shot = body as unknown as DisposableShot;
    db.disposableShots.unshift(shot);
    saveDb(db);
    return { shot } as T;
  }

  const shotLikeMatch = path.match(/^\/studio\/camera\/shots\/([^/]+)\/like$/);
  if (method === 'PATCH' && shotLikeMatch) {
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
          totalDispatched,
          deliveredCount,
          pendingOrFailedCount: pendingAtts.length,
          successRatePct,
          gatewayBalanceCredits: db.gatewayBalanceCredits,
          organizerCreditLiabilities: allUsers.reduce((acc, u) => acc + u.profile.smsCredits, 0),
          failedQueue,
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
          RESEND_API_KEY: false,
          RESEND_FROM_EMAIL: false,
          CREATOR_PASSWORD: false,
          CREATOR_EMAIL,
        },
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
        targetUser.profile.plan = body.plan as OrganizerProfile['plan'];
        saveDb(db);
        return { tenant: buildTenantSummary(db, targetUser) } as T;
      }
      if (action === 'role' && method === 'POST') {
        targetUser.profile.appRole = body.appRole as AppRole;
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
  }

  throw new LocalApiError(`Unsupported local fallback route: ${method} ${path}`, 404);
}
