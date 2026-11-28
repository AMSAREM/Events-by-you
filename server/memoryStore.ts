import crypto from 'node:crypto';
import {
  INITIAL_ALERTS,
  INITIAL_ATTENDEES,
  INITIAL_DISPOSABLE_SHOTS,
  INITIAL_EVENTS,
  INITIAL_PROFILE,
  INITIAL_ROLL_SETTINGS,
  INITIAL_SCHEDULE,
  normalizePhoneE164,
} from '../src/data/initialData.ts';
import { normalizeHexColor } from '../src/lib/themeColors.ts';
import {
  compareScheduleBlocksChronological,
  formatEventDateSpan,
  getEventCheckInPolicy,
  getScheduleBlockDayFromIso,
  getTodayIsoDate,
  normalizeScheduleDay,
  resolveScheduleBlockDate,
  sanitizeCheckedInDates,
  sanitizeCheckInPolicy,
  sanitizeIsoDate,
} from '../src/lib/eventDates.ts';
import {
  buildValidatedPollOptions,
  normalizePollStatus,
  sanitizePollForPublic,
  sanitizePublicExtraDataConfig,
} from '../src/lib/polls.ts';
import {
  createStarterPlanningConfig,
  sanitizeEventPlanningConfig,
} from '../src/lib/planningTemplates.ts';
import { sanitizeEventLogoUrl, sanitizeProgramOutline } from '../src/lib/programOutline.ts';
import {
  PLAN_MRR_USD,
  DEFAULT_SHARED_SENDER_ID,
  MAX_CUSTOM_ATTENDEE_CAPACITY,
  STARTER_MAX_ACTIVE_EVENTS,
  STARTER_MAX_ATTENDEES_PER_EVENT,
  computeNextPlanAttendeeCapacity,
  computePlanExpiresAtIso,
  getEffectiveEventCapacity,
  getPlanEntitlements,
  hasCustomMessageOverrides,
  hasCustomSenderIdValue,
  isActiveEventStatus,
  resolvePlanAttendeeCapacityValue,
} from '../src/lib/subscriptionPlans.ts';
import type {
  AppRole,
  Attendee,
  BuilderConsoleOverview,
  BuilderDiagnosticFailure,
  BuilderEnvStatus,
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
  EventPlanningConfig,
  EventPoll,
  EventPollStatus,
  GiftTableAttendantLink,
  GiftTableEntry,
  OrganizerProfile,
  ScheduleBlock,
  SmsBundlePurchase,
  SmsDispatchLogEntry,
  SubscriptionPayment,
  SystemAlert,
  WebhookTriggerEvent,
} from '../src/types/events.ts';
import { isPaystackConfigured } from './paystack.ts';

export interface MemoryUser {
  id: string;
  email: string;
  passwordHash: string | null;
  profile: OrganizerProfile;
  suspended: boolean;
  lastLoginAt: string;
  createdAt: string;
}

export const SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000;

export interface MemorySession {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  lastActivityAt: number;
  userId: string;
}

interface StoredCreatorAppRecord extends CreatorApp {
  organizerId: string;
  secretHash: string;
  webhookSecret: string;
}

interface MemoryDatabase {
  users: Map<string, MemoryUser>;
  userIdByEmail: Map<string, string>;
  userIdByPhone: Map<string, string>;
  sessionsByAccessToken: Map<string, MemorySession>;
  sessionsByRefreshToken: Map<string, MemorySession>;
  events: Map<string, EventItem & { organizerId: string }>;
  attendees: Map<string, Attendee>;
  scheduleBlocks: Map<string, ScheduleBlock>;
  alerts: Map<string, SystemAlert & { organizerId: string }>;
  disposableShots: Map<string, DisposableShot>;
  rollSettings: Map<string, DisposableRollSettings>;
  creatorApps: Map<string, StoredCreatorAppRecord>;
  creatorAppLogs: Map<string, CreatorAppLog>;
  smsPurchases: Map<string, SmsBundlePurchase>;
  subscriptionPayments: Map<string, SubscriptionPayment>;
}

const SMS_UNIT_COST_USD = 0.012;
const STORAGE_COST_PER_MB_USD = 0.08;

export const platformRuntime = {
  flags: {
    publicRegistrationsPaused: false,
    pausedEventIds: [],
    smsMode: (process.env.ARKESEL_API_KEY || '').trim() ? 'live' : 'sandbox',
    arkeselSenderId: (process.env.ARKESEL_SENDER_ID || '').trim() || undefined,
    signupsEnabled: true,
    starterSeedingEnabled: false,
  } as BuilderFeatureFlags,
  gatewayBalanceCredits: 0,
  gatewayBalanceLive: false,
  gatewayBalanceError: undefined as string | undefined,
  recentErrors: [] as BuilderErrorEntry[],
  duplicateBlocksByEvent: new Map<string, number>(),
  diagnosticFailures: [] as BuilderDiagnosticFailure[],
  smsDispatches: [] as SmsDispatchLogEntry[],
  fallbackSmsPurchases: new Map<string, SmsBundlePurchase>(),
  fallbackSubscriptionPayments: new Map<string, SubscriptionPayment>(),
  planAttendeeCapacityOverrides: new Map<string, number | 'unlimited' | null>(),

  getEffectiveArkeselSenderId(explicit?: string): {
    senderId: string;
    isDefaultUnverifiedWarning: boolean;
  } {
    const cleanExplicit = (explicit || '').trim().slice(0, 11);
    const runtimeOverride = (this.flags.arkeselSenderId || '').trim().slice(0, 11);
    const envSender = (process.env.ARKESEL_SENDER_ID || '').trim().slice(0, 11);
    const isGenericDefault = (val: string) =>
      val.toUpperCase() === DEFAULT_SHARED_SENDER_ID.toUpperCase();

    if (cleanExplicit && !isGenericDefault(cleanExplicit)) {
      return { senderId: cleanExplicit, isDefaultUnverifiedWarning: false };
    }
    if (runtimeOverride) {
      return {
        senderId: runtimeOverride,
        isDefaultUnverifiedWarning: isGenericDefault(runtimeOverride),
      };
    }
    if (envSender) {
      return {
        senderId: envSender,
        isDefaultUnverifiedWarning: isGenericDefault(envSender),
      };
    }
    return { senderId: DEFAULT_SHARED_SENDER_ID, isDefaultUnverifiedWarning: true };
  },

  recordSmsDispatch(entry: Omit<SmsDispatchLogEntry, 'id' | 'timestamp'>): SmsDispatchLogEntry {
    const item: SmsDispatchLogEntry = {
      ...entry,
      id: `sms-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`,
      timestamp: new Date().toISOString(),
    };
    this.smsDispatches.unshift(item);
    if (this.smsDispatches.length > 50) {
      this.smsDispatches.length = 50;
    }
    return item;
  },

  updateSmsDispatchByMessageId(
    messageId: string,
    dlrStatus: string,
    errorReason?: string
  ): SmsDispatchLogEntry | null {
    const cleanId = (messageId || '').trim();
    if (!cleanId) return null;
    const match = this.smsDispatches.find((d) => d.messageId === cleanId);
    if (!match) return null;
    match.dlrStatus = dlrStatus;
    if (errorReason) match.errorReason = errorReason;
    match.updatedAt = new Date().toISOString();
    return match;
  },

  recordError(source: string, err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    this.recentErrors.unshift({
      id: `err-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`,
      source,
      message,
      stack,
      timestamp: new Date().toISOString(),
    });
    if (this.recentErrors.length > 25) {
      this.recentErrors.length = 25;
    }
  },

  clearErrors() {
    this.recentErrors = [];
  },

  recordDuplicateBlock(eventId: string) {
    this.duplicateBlocksByEvent.set(eventId, (this.duplicateBlocksByEvent.get(eventId) ?? 0) + 1);
  },

  recordDiagnosticFailure(entry: Omit<BuilderDiagnosticFailure, 'id' | 'timestamp' | 'replayed'>) {
    this.diagnosticFailures.unshift({
      ...entry,
      id: `diag-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`,
      timestamp: new Date().toISOString(),
      replayed: false,
    });
    if (this.diagnosticFailures.length > 40) {
      this.diagnosticFailures.length = 40;
    }
  },

  getEnvStatus(): BuilderEnvStatus {
    const sender = this.getEffectiveArkeselSenderId();
    return {
      SUPABASE_URL: Boolean((process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim()),
      SUPABASE_ANON_KEY: Boolean(
        (process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '').trim()
      ),
      SUPABASE_SERVICE_ROLE_KEY: Boolean((process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()),
      ARKESEL_API_KEY: Boolean((process.env.ARKESEL_API_KEY || '').trim()),
      ARKESEL_SENDER_ID: Boolean(
        (process.env.ARKESEL_SENDER_ID || '').trim() || (this.flags.arkeselSenderId || '').trim()
      ),
      arkeselSenderIdValue: sender.senderId,
      RESEND_API_KEY: Boolean((process.env.RESEND_API_KEY || '').trim()),
      RESEND_FROM_EMAIL: Boolean((process.env.RESEND_FROM_EMAIL || '').trim()),
      PAYSTACK_SECRET_KEY: isPaystackConfigured(),
      CREATOR_PASSWORD: Boolean((process.env.CREATOR_PASSWORD || '').trim()),
      CREATOR_EMAIL: (process.env.CREATOR_EMAIL || 'amoakoimml@gmail.com').trim().toLowerCase(),
    };
  },

  updateFlags(patch: Partial<BuilderFeatureFlags>): BuilderFeatureFlags {
    if (typeof patch.publicRegistrationsPaused === 'boolean') {
      this.flags.publicRegistrationsPaused = patch.publicRegistrationsPaused;
    }
    if (Array.isArray(patch.pausedEventIds)) {
      this.flags.pausedEventIds = Array.from(new Set(patch.pausedEventIds.map(String)));
    }
    if (patch.smsMode === 'live' || patch.smsMode === 'sandbox') {
      this.flags.smsMode = patch.smsMode;
    }
    if (typeof patch.arkeselSenderId === 'string') {
      const cleaned = patch.arkeselSenderId.trim().replace(/[^a-zA-Z0-9 .-]/g, '').slice(0, 11);
      this.flags.arkeselSenderId = cleaned || undefined;
    }
    if (typeof patch.signupsEnabled === 'boolean') {
      this.flags.signupsEnabled = patch.signupsEnabled;
    }
    if (typeof patch.starterSeedingEnabled === 'boolean') {
      this.flags.starterSeedingEnabled = patch.starterSeedingEnabled;
    }
    return { ...this.flags, pausedEventIds: [...this.flags.pausedEventIds] };
  },
};

function hashPassword(password: string): string {
  return crypto.createHash('sha256').update(`eventsapp-pw:${password}`).digest('hex');
}

function sha256Hex(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function createMemorySession(userId: string): MemorySession {
  const accessToken = `mem_acc_${crypto.randomBytes(24).toString('hex')}`;
  const refreshToken = `mem_ref_${crypto.randomBytes(24).toString('hex')}`;
  const expiresAt = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60;
  const session: MemorySession = {
    accessToken,
    refreshToken,
    expiresAt,
    lastActivityAt: Date.now(),
    userId,
  };
  db.sessionsByAccessToken.set(accessToken, session);
  db.sessionsByRefreshToken.set(refreshToken, session);
  return session;
}

const db: MemoryDatabase = {
  users: new Map(),
  userIdByEmail: new Map(),
  userIdByPhone: new Map(),
  sessionsByAccessToken: new Map(),
  sessionsByRefreshToken: new Map(),
  events: new Map(),
  attendees: new Map(),
  scheduleBlocks: new Map(),
  alerts: new Map(),
  disposableShots: new Map(),
  rollSettings: new Map(),
  creatorApps: new Map(),
  creatorAppLogs: new Map(),
  smsPurchases: new Map(),
  subscriptionPayments: new Map(),
};

function estimateShotBytes(dataUrl: string): number {
  if (!dataUrl) return 0;
  if (dataUrl.startsWith('data:')) {
    return Math.round((dataUrl.length * 3) / 4);
  }
  return 420 * 1024;
}

function seedStarterForUser(userId: string, organizerName: string, useRawIds = false): void {
  const existingForUser = Array.from(db.events.values()).some((e) => e.organizerId === userId);
  const uniqueSuffix = useRawIds
    ? ''
    : existingForUser
      ? `-${userId.slice(0, 6)}-${crypto.randomBytes(2).toString('hex')}`
      : `-${userId.slice(0, 6)}`;
  const makeId = (baseId: string) => (useRawIds ? baseId : `${baseId}${uniqueSuffix}`);

  for (const evt of INITIAL_EVENTS) {
    const id = makeId(evt.id);
    const slug = useRawIds ? evt.slug : `${evt.slug}${uniqueSuffix}`;
    db.events.set(id, {
      ...evt,
      id,
      slug,
      organizer: organizerName || evt.organizer,
      organizerId: userId,
    });
  }

  for (const att of INITIAL_ATTENDEES) {
    const id = makeId(att.id);
    db.attendees.set(id, {
      ...att,
      id,
      eventId: makeId(att.eventId),
    });
  }

  for (const blk of INITIAL_SCHEDULE) {
    const id = makeId(blk.id);
    db.scheduleBlocks.set(id, {
      ...blk,
      id,
      eventId: makeId(blk.eventId),
    });
  }

  for (const al of INITIAL_ALERTS) {
    const id = makeId(al.id);
    db.alerts.set(id, {
      ...al,
      id,
      eventId: al.eventId ? makeId(al.eventId) : undefined,
      organizerId: userId,
    });
  }

  for (const [evtId, cfg] of Object.entries(INITIAL_ROLL_SETTINGS)) {
    db.rollSettings.set(makeId(evtId), { ...cfg });
  }

  for (const shot of INITIAL_DISPOSABLE_SHOTS) {
    const id = makeId(shot.id);
    db.disposableShots.set(id, {
      ...shot,
      id,
      eventId: makeId(shot.eventId),
    });
  }
}

function initDefaultAccounts(): void {
  const creatorEmail = (process.env.CREATOR_EMAIL || 'amoakoimml@gmail.com').trim().toLowerCase();
  const creatorPassword = (process.env.CREATOR_PASSWORD || '').trim();
  const creatorId = 'usr-primary-creator';

  const creatorProfile: OrganizerProfile = {
    ...INITIAL_PROFILE,
    name: 'Apps Creator',
    firstName: 'Creator',
    role: 'Apps Creator',
    appRole: 'creator',
    email: creatorEmail,
    studio: 'Apps Creator Console',
    plan: 'Pro Organizer',
    smsCredits: 0,
    capacityAlertThreshold: 90,
    timezone: 'Africa/Accra',
    twoFactorEnabled: false,
    senderId: 'EVENTSAPP',
  };

  db.users.set(creatorId, {
    id: creatorId,
    email: creatorEmail,
    passwordHash: creatorPassword ? hashPassword(creatorPassword) : null,
    profile: creatorProfile,
    suspended: false,
    lastLoginAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  });
  db.userIdByEmail.set(creatorEmail, creatorId);
}

initDefaultAccounts();

export function getOrCreateMemoryUser(
  emailInput: string,
  options?: {
    name?: string;
    studio?: string;
    password?: string;
    setPasswordIfMissing?: boolean;
    appRole?: AppRole;
    phone?: string;
    phoneVerified?: boolean;
    avatarUrl?: string;
  }
): MemoryUser {
  const email = emailInput.trim().toLowerCase();
  const normalizedPhone = options?.phone ? normalizePhoneE164(options.phone) : undefined;
  const existingId =
    (email ? db.userIdByEmail.get(email) : undefined) ||
    (normalizedPhone ? db.userIdByPhone.get(normalizedPhone) : undefined);
  if (existingId) {
    const user = db.users.get(existingId)!;
    if (options?.password && options.setPasswordIfMissing && !user.passwordHash) {
      user.passwordHash = hashPassword(options.password);
    }
    if (normalizedPhone && !user.profile.phone) {
      user.profile.phone = normalizedPhone;
      db.userIdByPhone.set(normalizedPhone, user.id);
    }
    if (options?.phoneVerified) {
      user.profile.phoneVerified = true;
    }
    if (options?.avatarUrl && !user.profile.avatarUrl) {
      user.profile.avatarUrl = options.avatarUrl;
    }
    return user;
  }

  const userId = `usr-${crypto.randomBytes(6).toString('hex')}`;
  const creatorEmail = (process.env.CREATOR_EMAIL || 'amoakoimml@gmail.com').trim().toLowerCase();
  const creatorPhone = (process.env.CREATOR_PHONE || '').trim()
    ? normalizePhoneE164((process.env.CREATOR_PHONE || '').trim())
    : '';
  const isCreator =
    (Boolean(email) && email === creatorEmail) ||
    Boolean(creatorPhone && normalizedPhone && normalizedPhone === creatorPhone);
  const resolvedAppRole: AppRole = isCreator
    ? 'creator'
    : options?.appRole === 'gate_staff'
      ? 'gate_staff'
      : 'organizer';
  const name = options?.name?.trim() || (email ? email.split('@')[0] : normalizedPhone) || 'Organiser';
  const profile: OrganizerProfile = {
    name,
    firstName: name.split(' ')[0] || 'Organiser',
    role:
      resolvedAppRole === 'creator'
        ? 'Apps Creator'
        : resolvedAppRole === 'gate_staff'
          ? 'Gate Check-In Staff'
          : 'Lead Organiser',
    appRole: resolvedAppRole,
    email,
    phone: normalizedPhone,
    phoneVerified: Boolean(options?.phoneVerified),
    studio: options?.studio?.trim() || (isCreator ? 'Apps Creator Console' : 'Events Studio'),
    plan: isCreator ? 'Pro Organizer' : 'Starter',
    smsCredits: 0,
    capacityAlertThreshold: 90,
    avatarUrl: options?.avatarUrl,
    timezone: 'Africa/Accra',
    twoFactorEnabled: false,
    senderId: 'EVENTSAPP',
  };

  const now = new Date().toISOString();
  const user: MemoryUser = {
    id: userId,
    email,
    passwordHash: options?.password ? hashPassword(options.password) : null,
    profile,
    suspended: false,
    lastLoginAt: now,
    createdAt: now,
  };
  db.users.set(userId, user);
  if (email) db.userIdByEmail.set(email, userId);
  if (normalizedPhone) db.userIdByPhone.set(normalizedPhone, userId);
  return user;
}

function buildTenantSummary(user: MemoryUser): BuilderTenantSummary {
  const userEvents = Array.from(db.events.values()).filter((e) => e.organizerId === user.id);
  const evtIds = new Set(userEvents.map((e) => e.id));
  const attendeesCount = Array.from(db.attendees.values()).filter((a) => evtIds.has(a.eventId)).length;
  const shots = Array.from(db.disposableShots.values()).filter((s) => evtIds.has(s.eventId));
  const storageBytes = shots.reduce((acc, s) => acc + estimateShotBytes(s.dataUrl), 0);

  const creatorEmail = (process.env.CREATOR_EMAIL || 'amoakoimml@gmail.com').trim().toLowerCase();
  const creatorPhone = (process.env.CREATOR_PHONE || '').trim()
    ? normalizePhoneE164((process.env.CREATOR_PHONE || '').trim())
    : '';
  const isPrimaryCreator =
    user.email.trim().toLowerCase() === creatorEmail ||
    Boolean(creatorPhone && user.profile.phone && normalizePhoneE164(user.profile.phone) === creatorPhone);

  return {
    id: user.id,
    name: user.profile.name,
    email: user.email,
    studio: user.profile.studio,
    appRole: isPrimaryCreator
      ? 'creator'
      : user.profile.appRole === 'gate_staff'
        ? 'gate_staff'
        : 'organizer',
    plan: user.profile.plan,
    ...(user.profile.planAttendeeCapacity !== undefined
      ? { planAttendeeCapacity: user.profile.planAttendeeCapacity }
      : {}),
    smsCredits: user.profile.smsCredits,
    eventsCount: userEvents.length,
    attendeesCount,
    shotsCount: shots.length,
    storageMb: Number((storageBytes / (1024 * 1024)).toFixed(2)),
    suspended: user.suspended,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
  };
}

export const memoryStore = {
  getUserByPhone(phoneInput: string): MemoryUser | null {
    const normalized = normalizePhoneE164(phoneInput);
    const id = normalized ? db.userIdByPhone.get(normalized) : undefined;
    return id ? db.users.get(id) ?? null : null;
  },

  getUserByEmail(emailInput: string): MemoryUser | null {
    const clean = emailInput.trim().toLowerCase();
    const id = clean ? db.userIdByEmail.get(clean) : undefined;
    return id ? db.users.get(id) ?? null : null;
  },

  signUp(payload: {
    email?: string;
    phone: string;
    phoneVerified?: boolean;
    password: string;
    name: string;
    studio?: string;
    appRole?: AppRole;
  }) {
    if (!platformRuntime.flags.signupsEnabled) {
      throw new Error('New organiser signups are temporarily paused by platform administrator.');
    }
    const normalizedPhone = normalizePhoneE164(payload.phone);
    const email = (payload.email || '').trim().toLowerCase();
    if (normalizedPhone && db.userIdByPhone.has(normalizedPhone)) {
      throw new Error('An account with this mobile phone number already exists. Please sign in.');
    }
    if (email && db.userIdByEmail.has(email)) {
      throw new Error('An account with this email already exists. Please sign in.');
    }
    const user = getOrCreateMemoryUser(email, {
      name: payload.name,
      studio: payload.studio || 'Events Studio',
      password: payload.password,
      appRole: payload.appRole === 'gate_staff' ? 'gate_staff' : 'organizer',
      phone: normalizedPhone,
      phoneVerified: Boolean(payload.phoneVerified),
    });
    user.lastLoginAt = new Date().toISOString();
    const session = createMemorySession(user.id);
    return { session, profile: user.profile };
  },

  signIn(identifierInput: string, password: string, countryGateway = 'GH') {
    const raw = identifierInput.trim();
    const isEmail = raw.includes('@');
    const existingId = isEmail
      ? db.userIdByEmail.get(raw.toLowerCase())
      : db.userIdByPhone.get(normalizePhoneE164(raw, countryGateway));
    if (!existingId) {
      throw new Error(
        isEmail
          ? 'Invalid email or password. Create a free account or use a 6-digit code.'
          : 'Invalid mobile number or password. Create a free account or use a 6-digit SMS code.'
      );
    }
    const user = db.users.get(existingId)!;
    if (user.suspended) {
      throw new Error('This organiser account has been suspended. Contact support.');
    }
    if (user.passwordHash && user.passwordHash !== hashPassword(password)) {
      throw new Error('Invalid login credentials.');
    }
    if (!user.passwordHash) {
      user.passwordHash = hashPassword(password);
    }
    user.lastLoginAt = new Date().toISOString();
    const session = createMemorySession(user.id);
    return { session, profile: user.profile };
  },

  creatorLogin(emailInput: string, password: string) {
    const email = emailInput.trim().toLowerCase();
    const user = getOrCreateMemoryUser(email, {
      name: 'Apps Creator',
      studio: 'Apps Creator Console',
      password,
      setPasswordIfMissing: true,
    });
    if (user.suspended) {
      throw new Error('Creator account is suspended.');
    }
    user.lastLoginAt = new Date().toISOString();
    const session = createMemorySession(user.id);
    return { session, profile: user.profile };
  },

  verifyOtp(target: { email?: string; phone?: string }, token: string) {
    if (!/^\d{6}$/.test(token.trim())) {
      throw new Error('Enter a valid 6-digit verification code.');
    }
    const user = target.phone
      ? this.getUserByPhone(target.phone)
      : target.email
        ? getOrCreateMemoryUser(target.email)
        : null;
    if (!user) {
      throw new Error('Account not found for verification.');
    }
    if (user.suspended) {
      throw new Error('This organiser account has been suspended.');
    }
    if (target.phone) {
      user.profile.phone = normalizePhoneE164(target.phone);
      user.profile.phoneVerified = true;
      db.userIdByPhone.set(user.profile.phone, user.id);
    }
    user.lastLoginAt = new Date().toISOString();
    const session = createMemorySession(user.id);
    return { session, profile: user.profile };
  },

  signInWithGoogle(payload: {
    email: string;
    name?: string;
    givenName?: string;
    avatarUrl?: string;
    studio?: string;
    appRole?: AppRole;
  }) {
    const email = payload.email.trim().toLowerCase();
    const existing = this.getUserByEmail(email);
    const isNewUser = !existing;
    if (isNewUser && !platformRuntime.flags.signupsEnabled) {
      throw new Error('New organiser signups are temporarily paused by platform administrator.');
    }
    const displayName =
      payload.name?.trim() ||
      payload.givenName?.trim() ||
      (email.includes('@') ? email.split('@')[0] : 'Organiser');
    const firstWord = (payload.givenName?.trim() || displayName.split(/\s+/)[0] || 'My').trim();
    const defaultStudio = payload.studio?.trim() || `${firstWord}'s Events`;
    const user = getOrCreateMemoryUser(email, {
      name: displayName,
      studio: defaultStudio,
      avatarUrl: payload.avatarUrl,
      appRole: payload.appRole === 'gate_staff' ? 'gate_staff' : 'organizer',
    });
    if (user.suspended) {
      throw new Error('This organiser account has been suspended. Contact support.');
    }
    if (payload.avatarUrl && !user.profile.avatarUrl) {
      user.profile.avatarUrl = payload.avatarUrl;
    }
    if (payload.name?.trim() && (!user.profile.name || user.profile.name === 'Organiser')) {
      user.profile.name = payload.name.trim();
      user.profile.firstName = payload.name.trim().split(/\s+/)[0] || user.profile.firstName;
    }
    user.lastLoginAt = new Date().toISOString();
    const session = createMemorySession(user.id);
    return { session, profile: user.profile, isNewUser };
  },

  refreshSession(refreshToken: string) {
    const existing = db.sessionsByRefreshToken.get(refreshToken);
    if (!existing) return null;
    const user = db.users.get(existing.userId);
    if (!user || user.suspended) return null;
    db.sessionsByAccessToken.delete(existing.accessToken);
    db.sessionsByRefreshToken.delete(existing.refreshToken);
    const next = createMemorySession(user.id);
    return { session: next, profile: user.profile };
  },

  signOut(accessToken: string) {
    const existing = db.sessionsByAccessToken.get(accessToken);
    if (existing) {
      db.sessionsByAccessToken.delete(existing.accessToken);
      db.sessionsByRefreshToken.delete(existing.refreshToken);
    }
  },

  getUserByAccessToken(
    accessToken: string,
    options?: { exemptIdleTimeout?: boolean }
  ): MemoryUser | null {
    const session = db.sessionsByAccessToken.get(accessToken);
    if (!session) return null;
    const nowMs = Date.now();
    const idleTimedOut =
      !options?.exemptIdleTimeout && nowMs - session.lastActivityAt > SESSION_IDLE_TIMEOUT_MS;
    if (session.expiresAt * 1000 < nowMs || idleTimedOut) {
      db.sessionsByAccessToken.delete(accessToken);
      db.sessionsByRefreshToken.delete(session.refreshToken);
      return null;
    }
    session.lastActivityAt = nowMs;
    const user = db.users.get(session.userId) ?? null;
    if (!user || user.suspended) return null;
    return user;
  },

  updatePassword(userId: string, password: string) {
    const user = db.users.get(userId);
    if (!user) throw new Error('User not found.');
    user.passwordHash = hashPassword(password);
  },

  getPublicEvents(): EventItem[] {
    return Array.from(db.events.values())
      .filter((e) => e.status === 'live' || e.status === 'upcoming')
      .map(({ organizerId, ...rest }) => {
        const ownerEnt = getPlanEntitlements(db.users.get(organizerId)?.profile);
        return {
          ...rest,
          checkedIn: 0,
          whiteLabel: ownerEnt.whiteLabelPublicEvent,
          extraDataConfig: sanitizePublicExtraDataConfig(rest.extraDataConfig),
        };
      })
      .sort((a, b) => {
        const aCustom = a.flyerUrl?.startsWith('data:') ? 1 : 0;
        const bCustom = b.flyerUrl?.startsWith('data:') ? 1 : 0;
        return bCustom - aCustom;
      });
  },

  getPublicEventBySlugOrId(slugOrId: string): EventItem | null {
    const target = slugOrId.trim().toLowerCase();
    for (const evt of db.events.values()) {
      if (
        (evt.status === 'live' || evt.status === 'upcoming') &&
        (evt.id.toLowerCase() === target || evt.slug.toLowerCase() === target)
      ) {
        const { organizerId, ...rest } = evt;
        const ownerEnt = getPlanEntitlements(db.users.get(organizerId)?.profile);
        return {
          ...rest,
          checkedIn: 0,
          whiteLabel: ownerEnt.whiteLabelPublicEvent,
          extraDataConfig: sanitizePublicExtraDataConfig(rest.extraDataConfig),
        };
      }
    }
    return null;
  },

  getAnyEventBySlugOrId(slugOrId: string): EventItem | null {
    const target = slugOrId.trim().toLowerCase();
    for (const evt of db.events.values()) {
      if (evt.id.toLowerCase() === target || evt.slug.toLowerCase() === target) {
        const { organizerId, ...rest } = evt;
        const ownerEnt = getPlanEntitlements(db.users.get(organizerId)?.profile);
        return { ...rest, whiteLabel: ownerEnt.whiteLabelPublicEvent };
      }
    }
    return null;
  },

  getEventScheduleBlocks(eventId: string): ScheduleBlock[] {
    const evt = db.events.get(eventId);
    const blocks = Array.from(db.scheduleBlocks.values())
      .filter((b) => b.eventId === eventId)
      .map((b) => {
        const date = evt ? resolveScheduleBlockDate(b, evt) : sanitizeIsoDate(b.date);
        return date && !b.date ? { ...b, date } : b;
      });
    return blocks.sort((a, b) => compareScheduleBlocksChronological(a, b, evt));
  },

  getPublicScheduleBlocks(eventIds?: string[]): ScheduleBlock[] {
    const allowedIds = eventIds
      ? new Set(eventIds)
      : new Set(this.getPublicEvents().map((e) => e.id));
    const blocks: ScheduleBlock[] = [];
    for (const blk of db.scheduleBlocks.values()) {
      if (!allowedIds.has(blk.eventId)) continue;
      const evt = db.events.get(blk.eventId);
      const date = evt ? resolveScheduleBlockDate(blk, evt) : sanitizeIsoDate(blk.date);
      blocks.push(date && !blk.date ? { ...blk, date } : blk);
    }
    return blocks.sort((a, b) =>
      compareScheduleBlocksChronological(a, b, db.events.get(a.eventId) ?? null)
    );
  },

  getEventOrganizerDefaults(slugOrId: string): {
    organizerId?: string;
    replyToEmail?: string;
    senderId?: string;
    smsCredits: number;
    plan: OrganizerProfile['plan'];
    allowCustomSenderId: boolean;
  } {
    const target = slugOrId.trim().toLowerCase();
    for (const evt of db.events.values()) {
      if (evt.id.toLowerCase() === target || evt.slug.toLowerCase() === target) {
        const owner = db.users.get(evt.organizerId);
        const ownerEnt = getPlanEntitlements(owner?.profile);
        return {
          organizerId: evt.organizerId,
          replyToEmail: owner?.profile.replyToEmail,
          senderId: ownerEnt.allowCustomSenderId ? owner?.profile.senderId : DEFAULT_SHARED_SENDER_ID,
          smsCredits: owner?.profile.smsCredits ?? 0,
          plan: ownerEnt.plan,
          allowCustomSenderId: ownerEnt.allowCustomSenderId,
        };
      }
    }
    return { smsCredits: 0, plan: 'Starter', allowCustomSenderId: false };
  },

  getSmsCredits(userId: string): number {
    return db.users.get(userId)?.profile.smsCredits ?? 0;
  },

  addSmsCredits(userId: string, credits: number): OrganizerProfile {
    const user = db.users.get(userId);
    if (!user) throw new Error('User not found.');
    const delta = Math.max(0, Math.round(credits));
    user.profile = { ...user.profile, smsCredits: user.profile.smsCredits + delta };
    return user.profile;
  },

  listSmsPurchases(userId: string): SmsBundlePurchase[] {
    return Array.from(db.smsPurchases.values())
      .filter((p) => p.organizerId === userId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  },

  findSmsPurchaseByReference(reference: string): SmsBundlePurchase | null {
    const target = reference.trim().toLowerCase();
    for (const item of db.smsPurchases.values()) {
      if (item.reference.trim().toLowerCase() === target) {
        return item;
      }
    }
    return null;
  },

  createPaystackPendingPurchase(
    userId: string,
    payload: {
      bundleId: string;
      bundleName: string;
      credits: number;
      amountGhs: number;
      reference: string;
    }
  ): SmsBundlePurchase {
    const user = db.users.get(userId);
    if (!user) throw Object.assign(new Error('Organizer profile not found.'), { status: 404 });
    if (this.findSmsPurchaseByReference(payload.reference)) {
      throw Object.assign(new Error('Duplicate payment reference.'), { status: 409 });
    }
    const item: SmsBundlePurchase = {
      id: `smsp-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
      organizerId: userId,
      organizerName: user.profile.name,
      organizerEmail: user.email || user.profile.email,
      bundleId: payload.bundleId,
      bundleName: payload.bundleName,
      credits: payload.credits,
      amountGhs: Number(payload.amountGhs.toFixed(2)),
      paymentChannel: 'Paystack Checkout',
      provider: 'paystack',
      reference: payload.reference,
      status: 'pending_payment',
      createdAt: new Date().toISOString(),
    };
    db.smsPurchases.set(item.id, item);
    return item;
  },

  completePaystackPurchase(
    userId: string,
    reference: string,
    channel?: string
  ): { alreadyCredited: boolean; purchase: SmsBundlePurchase; profile: OrganizerProfile } {
    const existing = this.findSmsPurchaseByReference(reference);
    if (!existing) {
      throw Object.assign(new Error(`Payment reference "${reference}" not found.`), { status: 404 });
    }
    if (existing.organizerId !== userId) {
      throw Object.assign(new Error('Payment reference belongs to a different organizer account.'), { status: 403 });
    }
    const user = db.users.get(userId);
    if (!user) throw Object.assign(new Error('Organizer profile not found.'), { status: 404 });

    if (existing.status === 'credited') {
      return { alreadyCredited: true, purchase: existing, profile: user.profile };
    }
    if (existing.status === 'rejected') {
      throw Object.assign(new Error('This purchase has been rejected and cannot be credited.'), { status: 400 });
    }

    const updated: SmsBundlePurchase = {
      ...existing,
      paymentChannel: channel ? `Paystack (${channel})` : existing.paymentChannel,
      status: 'credited',
      verifiedAt: new Date().toISOString(),
    };
    db.smsPurchases.set(updated.id, updated);
    const profile = this.addSmsCredits(userId, updated.credits);
    return { alreadyCredited: false, purchase: updated, profile };
  },

  markPaystackPurchaseFailed(reference: string, reason?: string): SmsBundlePurchase | null {
    const existing = this.findSmsPurchaseByReference(reference);
    if (!existing || existing.status === 'credited') return existing;
    const updated: SmsBundlePurchase = {
      ...existing,
      status: 'failed',
      rejectionReason: reason,
    };
    db.smsPurchases.set(updated.id, updated);
    return updated;
  },

  submitManualSmsBundlePurchase(
    userId: string,
    payload: {
      bundleId: string;
      bundleName: string;
      credits: number;
      amountGhs: number;
      paymentChannel: string;
      reference: string;
      smsMode: 'live' | 'sandbox';
    }
  ): {
    purchase: SmsBundlePurchase;
    profile: OrganizerProfile;
    addedCredits: number;
    pendingVerification: boolean;
  } {
    const user = db.users.get(userId);
    if (!user) throw Object.assign(new Error('Organizer profile not found.'), { status: 404 });
    if (this.findSmsPurchaseByReference(payload.reference)) {
      throw Object.assign(
        new Error(
          `Transaction reference "${payload.reference}" has already been submitted. Duplicate redemptions are blocked.`
        ),
        { status: 409 }
      );
    }

    const isSandbox = payload.smsMode === 'sandbox';
    const nowIso = new Date().toISOString();
    const item: SmsBundlePurchase = {
      id: `smsp-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
      organizerId: userId,
      organizerName: user.profile.name,
      organizerEmail: user.email || user.profile.email,
      bundleId: payload.bundleId,
      bundleName: payload.bundleName,
      credits: payload.credits,
      amountGhs: Number(payload.amountGhs.toFixed(2)),
      paymentChannel: payload.paymentChannel,
      provider: isSandbox ? 'sandbox' : 'arkesel_manual',
      reference: payload.reference,
      status: isSandbox ? 'credited' : 'pending_verification',
      createdAt: nowIso,
      verifiedAt: isSandbox ? nowIso : undefined,
    };
    db.smsPurchases.set(item.id, item);

    const profile = isSandbox ? this.addSmsCredits(userId, payload.credits) : user.profile;
    return {
      purchase: item,
      profile,
      addedCredits: isSandbox ? payload.credits : 0,
      pendingVerification: !isSandbox,
    };
  },

  resolveSmsBundlePurchase(
    purchaseId: string,
    action: 'approve' | 'reject',
    reason?: string
  ): { purchase: SmsBundlePurchase; smsCredits: number; alreadyCredited: boolean } {
    const existing = db.smsPurchases.get(purchaseId);
    if (!existing) {
      throw Object.assign(new Error('SMS bundle purchase record not found.'), { status: 404 });
    }
    const user = db.users.get(existing.organizerId);
    if (!user) {
      throw Object.assign(new Error('Organizer profile not found.'), { status: 404 });
    }
    if (existing.status === 'credited') {
      return { purchase: existing, smsCredits: user.profile.smsCredits, alreadyCredited: true };
    }
    if (action === 'reject') {
      const rejected: SmsBundlePurchase = {
        ...existing,
        status: 'rejected',
        rejectionReason: reason?.trim() || 'Rejected by creator administrator.',
        verifiedAt: new Date().toISOString(),
      };
      db.smsPurchases.set(rejected.id, rejected);
      return { purchase: rejected, smsCredits: user.profile.smsCredits, alreadyCredited: false };
    }
    const approved: SmsBundlePurchase = {
      ...existing,
      status: 'credited',
      rejectionReason: undefined,
      verifiedAt: new Date().toISOString(),
    };
    db.smsPurchases.set(approved.id, approved);
    const updatedProf = this.addSmsCredits(existing.organizerId, approved.credits);
    return { purchase: approved, smsCredits: updatedProf.smsCredits, alreadyCredited: false };
  },

  listSubscriptionPayments(userId: string): SubscriptionPayment[] {
    return Array.from(db.subscriptionPayments.values())
      .filter((p) => p.organizerId === userId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  },

  findSubscriptionPaymentByReference(reference: string): SubscriptionPayment | null {
    const target = reference.trim().toLowerCase();
    for (const item of db.subscriptionPayments.values()) {
      if (item.reference.trim().toLowerCase() === target) return item;
    }
    return null;
  },

  createPaystackPendingSubscription(
    userId: string,
    payload: {
      planId: 'pro' | 'enterprise';
      planName: 'Pro Organizer' | 'Enterprise';
      billingCycle: 'monthly' | 'annual';
      amountUsd: number;
      amountGhs: number;
      reference: string;
    }
  ): SubscriptionPayment {
    const user = db.users.get(userId);
    if (!user) throw Object.assign(new Error('Organizer profile not found.'), { status: 404 });
    if (this.findSubscriptionPaymentByReference(payload.reference)) {
      throw Object.assign(new Error('Duplicate payment reference.'), { status: 409 });
    }
    const item: SubscriptionPayment = {
      id: `subp-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
      organizerId: userId,
      organizerName: user.profile.name,
      organizerEmail: user.email || user.profile.email,
      planId: payload.planId,
      planName: payload.planName,
      billingCycle: payload.billingCycle,
      amountUsd: payload.amountUsd,
      amountGhs: Number(payload.amountGhs.toFixed(2)),
      paymentChannel: 'Paystack Checkout',
      provider: 'paystack',
      reference: payload.reference,
      status: 'pending_payment',
      createdAt: new Date().toISOString(),
    };
    db.subscriptionPayments.set(item.id, item);
    return item;
  },

  completePaystackSubscription(
    userId: string,
    reference: string,
    channel?: string
  ): { alreadyActivated: boolean; payment: SubscriptionPayment; profile: OrganizerProfile } {
    const existing = this.findSubscriptionPaymentByReference(reference);
    if (!existing) {
      throw Object.assign(new Error(`Payment reference "${reference}" not found.`), { status: 404 });
    }
    if (existing.organizerId !== userId) {
      throw Object.assign(new Error('Payment reference belongs to a different organizer account.'), { status: 403 });
    }
    const user = db.users.get(userId);
    if (!user) throw Object.assign(new Error('Organizer profile not found.'), { status: 404 });

    if (existing.status === 'active') {
      return { alreadyActivated: true, payment: existing, profile: user.profile };
    }
    if (existing.status === 'rejected') {
      throw Object.assign(new Error('This subscription payment has been rejected and cannot be activated.'), { status: 400 });
    }

    const now = new Date();
    const nowIso = now.toISOString();
    const expiresIso = computePlanExpiresAtIso(existing.billingCycle, now);
    const updated: SubscriptionPayment = {
      ...existing,
      paymentChannel: channel ? `Paystack (${channel})` : existing.paymentChannel,
      status: 'active',
      periodStart: nowIso,
      periodEnd: expiresIso,
      verifiedAt: nowIso,
    };
    db.subscriptionPayments.set(updated.id, updated);
    user.profile = {
      ...user.profile,
      plan: updated.planName,
      planBillingCycle: updated.billingCycle,
      planExpiresAt: expiresIso,
      planAttendeeCapacity: undefined,
    };
    return { alreadyActivated: false, payment: updated, profile: user.profile };
  },

  markPaystackSubscriptionFailed(reference: string, reason?: string): SubscriptionPayment | null {
    const existing = this.findSubscriptionPaymentByReference(reference);
    if (!existing || existing.status === 'active') return existing;
    const updated: SubscriptionPayment = {
      ...existing,
      status: 'failed',
      rejectionReason: reason,
    };
    db.subscriptionPayments.set(updated.id, updated);
    return updated;
  },

  submitManualSubscriptionPayment(
    userId: string,
    payload: {
      planId: 'pro' | 'enterprise';
      planName: 'Pro Organizer' | 'Enterprise';
      billingCycle: 'monthly' | 'annual';
      amountUsd: number;
      amountGhs: number;
      paymentChannel: string;
      reference: string;
      smsMode: 'live' | 'sandbox';
    }
  ): {
    payment: SubscriptionPayment;
    profile: OrganizerProfile;
    activated: boolean;
    pendingVerification: boolean;
  } {
    const user = db.users.get(userId);
    if (!user) throw Object.assign(new Error('Organizer profile not found.'), { status: 404 });
    if (this.findSubscriptionPaymentByReference(payload.reference)) {
      throw Object.assign(
        new Error(
          `Transaction reference "${payload.reference}" has already been submitted. Duplicate redemptions are blocked.`
        ),
        { status: 409 }
      );
    }

    const isSandbox = payload.smsMode === 'sandbox';
    const now = new Date();
    const nowIso = now.toISOString();
    const expiresIso = isSandbox ? computePlanExpiresAtIso(payload.billingCycle, now) : undefined;
    const item: SubscriptionPayment = {
      id: `subp-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
      organizerId: userId,
      organizerName: user.profile.name,
      organizerEmail: user.email || user.profile.email,
      planId: payload.planId,
      planName: payload.planName,
      billingCycle: payload.billingCycle,
      amountUsd: payload.amountUsd,
      amountGhs: Number(payload.amountGhs.toFixed(2)),
      paymentChannel: payload.paymentChannel,
      provider: isSandbox ? 'sandbox' : 'manual',
      reference: payload.reference,
      status: isSandbox ? 'active' : 'pending_verification',
      periodStart: isSandbox ? nowIso : undefined,
      periodEnd: expiresIso,
      createdAt: nowIso,
      verifiedAt: isSandbox ? nowIso : undefined,
    };
    db.subscriptionPayments.set(item.id, item);

    if (isSandbox) {
      user.profile = {
        ...user.profile,
        plan: payload.planName,
        planBillingCycle: payload.billingCycle,
        planExpiresAt: expiresIso,
        planAttendeeCapacity: undefined,
      };
    }

    return {
      payment: item,
      profile: user.profile,
      activated: isSandbox,
      pendingVerification: !isSandbox,
    };
  },

  resolveSubscriptionPayment(
    paymentId: string,
    action: 'approve' | 'reject',
    reason?: string
  ): { payment: SubscriptionPayment; profile: OrganizerProfile; alreadyActivated: boolean } {
    const existing = db.subscriptionPayments.get(paymentId);
    if (!existing) {
      throw Object.assign(new Error('Subscription payment record not found.'), { status: 404 });
    }
    const user = db.users.get(existing.organizerId);
    if (!user) {
      throw Object.assign(new Error('Organizer profile not found.'), { status: 404 });
    }
    if (existing.status === 'active') {
      return { payment: existing, profile: user.profile, alreadyActivated: true };
    }
    if (action === 'reject') {
      const rejected: SubscriptionPayment = {
        ...existing,
        status: 'rejected',
        rejectionReason: reason?.trim() || 'Rejected by creator administrator.',
        verifiedAt: new Date().toISOString(),
      };
      db.subscriptionPayments.set(rejected.id, rejected);
      return { payment: rejected, profile: user.profile, alreadyActivated: false };
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
    db.subscriptionPayments.set(approved.id, approved);
    user.profile = {
      ...user.profile,
      plan: approved.planName,
      planBillingCycle: approved.billingCycle,
      planExpiresAt: expiresIso,
      planAttendeeCapacity: undefined,
    };
    return { payment: approved, profile: user.profile, alreadyActivated: false };
  },

  downgradeToStarter(userId: string): OrganizerProfile {
    const user = db.users.get(userId);
    if (!user) throw Object.assign(new Error('User not found.'), { status: 404 });
    user.profile = {
      ...user.profile,
      plan: 'Starter',
      planBillingCycle: 'monthly',
      planExpiresAt: undefined,
      planAttendeeCapacity: undefined,
      senderId: DEFAULT_SHARED_SENDER_ID,
    };
    return user.profile;
  },

  consumeSmsCredits(userId: string, cost: number): { ok: boolean; remaining: number } {
    const user = db.users.get(userId);
    if (!user) return { ok: false, remaining: 0 };
    const needed = Math.max(0, Math.round(cost));
    if (user.profile.smsCredits < needed) {
      return { ok: false, remaining: user.profile.smsCredits };
    }
    const next = user.profile.smsCredits - needed;
    user.profile = { ...user.profile, smsCredits: next };
    return { ok: true, remaining: next };
  },

  setAttendeeSmsStatus(attendeeId: string, smsStatus: Attendee['smsStatus']): Attendee | null {
    const existing = db.attendees.get(attendeeId);
    if (!existing) return null;
    const updated = { ...existing, smsStatus };
    db.attendees.set(attendeeId, updated);
    return updated;
  },

  incrementEventSmsDispatched(eventId: string, count: number): EventItem | null {
    const evt = db.events.get(eventId);
    if (!evt) return null;
    if (count > 0) {
      evt.smsDispatched += count;
    }
    const { organizerId: _org, ...clean } = evt;
    return clean;
  },

  broadcastOwnedAttendees(userId: string, attendeeIds: string[]): { attendees: Attendee[]; eventById: Map<string, EventItem & { organizerId: string }> } {
    const eventById = new Map<string, EventItem & { organizerId: string }>();
    for (const evt of db.events.values()) {
      if (evt.organizerId === userId) {
        eventById.set(evt.id, evt);
      }
    }
    const idSet = new Set(attendeeIds);
    const attendees = Array.from(db.attendees.values()).filter(
      (att) => idSet.has(att.id) && eventById.has(att.eventId)
    );
    return { attendees, eventById };
  },

  getPublicCameraRoll(slugOrId: string, passCode?: string): {
    event: EventItem;
    shots: DisposableShot[];
    rollSettings: DisposableRollSettings;
    verifiedPass: {
      attendeeName: string;
      ticketCode: string;
      checkedIn: boolean;
      tier: string;
    } | null;
  } | null {
    const evt =
      this.getPublicEventBySlugOrId(slugOrId) || this.getAnyEventBySlugOrId(slugOrId);
    if (!evt) return null;
    const shots = Array.from(db.disposableShots.values())
      .filter((s) => s.eventId === evt.id)
      .sort((a, b) => b.frameNumber - a.frameNumber);
    const rollSettings = db.rollSettings.get(evt.id) ?? {
      exposuresLimit: 24,
      darkroomMode: false,
    };
    let verifiedPass: {
      attendeeName: string;
      ticketCode: string;
      checkedIn: boolean;
      tier: string;
    } | null = null;
    const cleanPass = (passCode || '').trim().toLowerCase();
    if (cleanPass) {
      const matched = Array.from(db.attendees.values()).find(
        (a) => a.eventId === evt.id && a.ticketCode.trim().toLowerCase() === cleanPass
      );
      if (matched) {
        verifiedPass = {
          attendeeName: matched.name,
          ticketCode: matched.ticketCode,
          checkedIn: matched.checkedIn,
          tier: matched.tier,
        };
      }
    }
    return { event: evt, shots, rollSettings, verifiedPass };
  },

  recordGiftTableEntry(
    slugOrId: string,
    payload: Partial<GiftTableEntry>,
    recordedVia: 'public-table' | 'gift-desk' = 'public-table'
  ): { gift: GiftTableEntry; event: EventItem } {
    const evt =
      this.getPublicEventBySlugOrId(slugOrId) || this.getAnyEventBySlugOrId(slugOrId);
    if (!evt) {
      throw Object.assign(new Error('Event Gift Table not found.'), { status: 404 });
    }
    const giverName = (payload.giverName || '').trim();
    if (!giverName) {
      throw Object.assign(new Error('Giver name is required.'), { status: 400 });
    }
    const giftType: GiftTableEntry['giftType'] =
      payload.giftType === 'cash-momo' || payload.giftType === 'registry-item' || payload.giftType === 'blessing-only'
        ? payload.giftType
        : 'cash-momo';
    const gift: GiftTableEntry = {
      id: `gift-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`,
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
      recordedVia,
      createdAt: new Date().toISOString(),
    };
    const existingExtra = evt.extraDataConfig ?? { enableGiftTable: true, customFields: [] };
    const prevLedger = Array.isArray(existingExtra.giftLedger) ? existingExtra.giftLedger : [];
    const updatedEvt: EventItem = {
      ...evt,
      extraDataConfig: {
        ...existingExtra,
        enableGiftTable: true,
        giftLedger: [gift, ...prevLedger],
      },
    };
    const stored = db.events.get(evt.id);
    if (stored) {
      db.events.set(evt.id, { ...stored, extraDataConfig: updatedEvt.extraDataConfig });
    }
    const pubExtra = sanitizePublicExtraDataConfig(updatedEvt.extraDataConfig);
    return {
      gift,
      event: recordedVia === 'public-table' ? { ...updatedEvt, extraDataConfig: pubExtra } : updatedEvt,
    };
  },

  getGiftDeskSession(
    slugOrId: string,
    token: string
  ): { event: EventItem; attendant: Omit<GiftTableAttendantLink, 'token'> } {
    const target = slugOrId.trim().toLowerCase();
    let matchedEvt: EventItem | null = null;
    for (const evt of db.events.values()) {
      if (
        (evt.status === 'live' || evt.status === 'upcoming') &&
        (evt.id.toLowerCase() === target || evt.slug.toLowerCase() === target)
      ) {
        const { organizerId: _org, ...rest } = evt;
        matchedEvt = rest;
        break;
      }
    }
    if (!matchedEvt) {
      throw Object.assign(new Error('Event Gift Table not found.'), { status: 404 });
    }
    const links = Array.isArray(matchedEvt.extraDataConfig?.attendantLinks)
      ? matchedEvt.extraDataConfig!.attendantLinks!
      : [];
    const link = links.find((l) => l.token === token.trim());
    if (!link) {
      throw Object.assign(new Error('Gift Table attendant link not found.'), { status: 404 });
    }
    if (!link.active) {
      throw Object.assign(new Error('This Gift Table attendant link has been paused by the organiser.'), {
        status: 403,
      });
    }
    const { token: _secret, ...safeAttendant } = link;
    const pubExtra = sanitizePublicExtraDataConfig(
      matchedEvt.extraDataConfig ?? {
        enableGiftTable: true,
        customFields: [],
      }
    );
    return {
      event: { ...matchedEvt, extraDataConfig: pubExtra },
      attendant: safeAttendant,
    };
  },

  recordGiftDeskEntry(
    slugOrId: string,
    token: string,
    payload: Partial<GiftTableEntry>
  ): { gift: GiftTableEntry; event: EventItem; attendant: Omit<GiftTableAttendantLink, 'token'> } {
    const { event: matchedEvt, attendant } = this.getGiftDeskSession(slugOrId, token);
    const stored = db.events.get(matchedEvt.id);
    if (!stored) {
      throw Object.assign(new Error('Event Gift Table not found.'), { status: 404 });
    }
    const giverName = (payload.giverName || '').trim();
    if (!giverName) {
      throw Object.assign(new Error('Giver or donor name is required.'), { status: 400 });
    }
    const giftType: GiftTableEntry['giftType'] =
      payload.giftType === 'cash-momo' || payload.giftType === 'registry-item' || payload.giftType === 'blessing-only'
        ? payload.giftType
        : 'cash-momo';
    const nowIso = new Date().toISOString();
    const gift: GiftTableEntry = {
      id: `gift-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`,
      eventId: stored.id,
      giverName,
      giverPhone: payload.giverPhone?.trim() ? normalizePhoneE164(payload.giverPhone.trim()) : undefined,
      giftType,
      currency: payload.currency === 'USD' ? 'USD' : 'GHS',
      amount: giftType === 'cash-momo' ? Math.max(1, Number(payload.amount) || 0) : undefined,
      registryItem:
        giftType === 'registry-item'
          ? payload.registryItem?.trim() || stored.extraDataConfig?.giftRegistryItems?.[0] || 'Registry Gift'
          : undefined,
      side: payload.side?.trim() || undefined,
      message: payload.message?.trim() || undefined,
      recordedVia: 'gift-desk',
      recordedBy: attendant.attendantName,
      attendantLinkId: attendant.id,
      createdAt: nowIso,
    };
    const existingExtra = stored.extraDataConfig ?? { enableGiftTable: true, customFields: [] };
    const prevLedger = Array.isArray(existingExtra.giftLedger) ? existingExtra.giftLedger : [];
    const prevLinks = Array.isArray(existingExtra.attendantLinks) ? existingExtra.attendantLinks : [];
    const nextLinks = prevLinks.map((l) =>
      l.id === attendant.id ? { ...l, recordedCount: (l.recordedCount ?? 0) + 1, lastUsedAt: nowIso } : l
    );
    const updatedLink = nextLinks.find((l) => l.id === attendant.id)!;
    stored.extraDataConfig = {
      ...existingExtra,
      enableGiftTable: true,
      giftLedger: [gift, ...prevLedger],
      attendantLinks: nextLinks,
    };
    db.events.set(stored.id, stored);
    const { organizerId: _org, ...clean } = stored;
    const pubExtra = sanitizePublicExtraDataConfig(clean.extraDataConfig);
    const { token: _secret, ...safeAttendant } = updatedLink;
    return {
      gift,
      event: { ...clean, extraDataConfig: pubExtra },
      attendant: safeAttendant,
    };
  },

  registerPublicAttendee(payload: {
    id: string;
    eventId: string;
    name: string;
    email: string;
    phone: string;
    organization?: string;
    tier?: Attendee['tier'];
    ticketCode: string;
    smsStatus: Attendee['smsStatus'];
    smsCreditsUsed?: number;
    validationGroup?: string;
    inviteCodeUsed?: string;
    giftEntry?: Attendee['giftEntry'];
    customResponses?: Record<string, string>;
  }): { attendee: Attendee; event: EventItem } {
    const evt = db.events.get(payload.eventId);
    if (!evt || (evt.status !== 'live' && evt.status !== 'upcoming')) {
      throw new Error('Event not found or not open for registration.');
    }
    if (evt.qrPassPublished === false) {
      throw new Error(`QR_PASS_NOT_PUBLISHED:${evt.title}`);
    }
    if (evt.validationConfig?.requireInviteCode && evt.validationConfig.inviteCode?.trim()) {
      const expected = evt.validationConfig.inviteCode.trim().toLowerCase();
      const given = (payload.inviteCodeUsed || '').trim().toLowerCase();
      if (given !== expected) {
        throw new Error('INVALID_INVITE_CODE:Invalid invitation passcode for this event.');
      }
    }

    const owner = db.users.get(evt.organizerId);
    const effectiveCap = getEffectiveEventCapacity(evt.capacity, owner?.profile);
    if (evt.registered >= effectiveCap) {
      throw new Error(
        `CAPACITY_REACHED:${evt.title} has reached its attendee capacity (${effectiveCap} seats).`
      );
    }

    const normalizedPhone = normalizePhoneE164(payload.phone);
    const duplicate = Array.from(db.attendees.values()).find(
      (a) =>
        a.eventId === payload.eventId &&
        a.phone.replace(/\s+/g, '') === normalizedPhone.replace(/\s+/g, '')
    );
    if (duplicate) {
      platformRuntime.recordDuplicateBlock(payload.eventId);
      throw new Error(`DUPLICATE_PHONE:${normalizedPhone} already holds a pass for ${evt.title}`);
    }

    const attendee: Attendee = {
      id: payload.id,
      eventId: payload.eventId,
      name: payload.name,
      email: payload.email,
      phone: normalizedPhone,
      organization: payload.organization?.trim() || 'Fast Pass Attendee',
      tier: payload.tier || 'General',
      checkedIn: false,
      ticketCode: payload.ticketCode,
      smsStatus: payload.smsStatus,
      paymentStatus: 'paid',
      validationGroup: payload.validationGroup?.trim() || undefined,
      inviteCodeUsed: payload.inviteCodeUsed?.trim() || undefined,
      giftEntry: payload.giftEntry,
      customResponses: payload.customResponses,
    };
    db.attendees.set(attendee.id, attendee);

    const smsUsed = Math.max(0, payload.smsCreditsUsed ?? 0);
    evt.registered += 1;
    evt.smsDispatched += smsUsed > 0 ? 1 : 0;
    evt.revenue += evt.ticketPrice;
    if (smsUsed > 0 && platformRuntime.gatewayBalanceCredits > 0) {
      platformRuntime.gatewayBalanceCredits = Math.max(0, platformRuntime.gatewayBalanceCredits - smsUsed);
    }

    const { organizerId: _org, ...cleanEvent } = evt;
    return { attendee, event: cleanEvent };
  },

  loadWorkspace(userId: string) {
    const user = db.users.get(userId);
    if (!user) throw new Error('User not found.');

    const events = Array.from(db.events.values())
      .filter((e) => e.organizerId === userId)
      .map(({ organizerId: _org, ...rest }) => rest);
    const eventIdSet = new Set(events.map((e) => e.id));

    const attendees = Array.from(db.attendees.values()).filter((a) => eventIdSet.has(a.eventId));
    const scheduleBlocks = Array.from(db.scheduleBlocks.values()).filter((b) =>
      eventIdSet.has(b.eventId)
    );
    const alerts = Array.from(db.alerts.values())
      .filter((al) => al.organizerId === userId)
      .map(({ organizerId: _org, ...rest }) => rest);
    const disposableShots = Array.from(db.disposableShots.values()).filter((s) =>
      eventIdSet.has(s.eventId)
    );
    const rollSettings: Record<string, DisposableRollSettings> = {};
    for (const evtId of eventIdSet) {
      const cfg = db.rollSettings.get(evtId);
      if (cfg) rollSettings[evtId] = cfg;
    }

    const creatorApps = Array.from(db.creatorApps.values())
      .filter((app) => app.organizerId === userId)
      .map(({ organizerId: _org, secretHash: _sh, webhookSecret: _ws, ...rest }) => rest);
    const appIdSet = new Set(creatorApps.map((a) => a.id));
    const creatorAppLogs = Array.from(db.creatorAppLogs.values()).filter((l) =>
      appIdSet.has(l.appId)
    );

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
  },

  seedStarter(_userId: string) {
    throw new Error('Demo and starter data seeding has been removed.');
  },

  updateProfile(userId: string, patch: Partial<OrganizerProfile>): OrganizerProfile {
    const user = db.users.get(userId);
    if (!user) throw new Error('User not found.');
    const {
      appRole: _ignoreAppRole,
      phoneVerified: _ignorePhoneVerified,
      smsCredits: _ignoreSmsCredits,
      plan: _ignorePlan,
      planBillingCycle: _ignoreCycle,
      planExpiresAt: _ignoreExpiry,
      ...safePatch
    } = patch;
    const ent = getPlanEntitlements(user.profile);
    if (safePatch.senderId !== undefined && !ent.allowCustomSenderId) {
      if (hasCustomSenderIdValue(safePatch.senderId)) {
        throw Object.assign(
          new Error(
            'Custom Alphanumeric Sender ID requires Pro Organizer or Enterprise plan. Upgrade in Plan & Credits.'
          ),
          { status: 403 }
        );
      }
      safePatch.senderId = DEFAULT_SHARED_SENDER_ID;
    }
    if (typeof safePatch.phone === 'string') {
      const normalized = safePatch.phone.trim() ? normalizePhoneE164(safePatch.phone.trim()) : undefined;
      if (normalized && normalized !== user.profile.phone) {
        if (user.profile.phone) db.userIdByPhone.delete(user.profile.phone);
        db.userIdByPhone.set(normalized, user.id);
        safePatch.phone = normalized;
      } else if (!normalized) {
        safePatch.phone = undefined;
      }
    }
    user.profile = { ...user.profile, ...safePatch };
    return user.profile;
  },

  deleteAccount(userId: string): { email?: string; phone?: string } {
    const user = db.users.get(userId);
    if (!user) {
      const err = new Error('Account not found.');
      (err as Error & { status?: number }).status = 404;
      throw err;
    }

    const ownedEventIds = new Set<string>();
    for (const [evtId, evt] of db.events) {
      if (evt.organizerId === userId) {
        ownedEventIds.add(evtId);
        db.events.delete(evtId);
        db.rollSettings.delete(evtId);
        platformRuntime.duplicateBlocksByEvent.delete(evtId);
      }
    }

    if (ownedEventIds.size > 0) {
      for (const [id, att] of db.attendees) {
        if (ownedEventIds.has(att.eventId)) db.attendees.delete(id);
      }
      for (const [id, blk] of db.scheduleBlocks) {
        if (ownedEventIds.has(blk.eventId)) db.scheduleBlocks.delete(id);
      }
      for (const [id, shot] of db.disposableShots) {
        if (ownedEventIds.has(shot.eventId)) db.disposableShots.delete(id);
      }
      platformRuntime.flags.pausedEventIds = platformRuntime.flags.pausedEventIds.filter(
        (id) => !ownedEventIds.has(id)
      );
    }

    for (const [id, al] of db.alerts) {
      if (al.organizerId === userId) db.alerts.delete(id);
    }

    for (const [id, purchase] of db.smsPurchases) {
      if (purchase.organizerId === userId) db.smsPurchases.delete(id);
    }
    for (const [id, subPay] of db.subscriptionPayments) {
      if (subPay.organizerId === userId) db.subscriptionPayments.delete(id);
    }

    const ownedAppIds = new Set<string>();
    for (const [id, app] of db.creatorApps) {
      if (app.organizerId === userId) {
        ownedAppIds.add(id);
        db.creatorApps.delete(id);
      }
    }
    if (ownedAppIds.size > 0) {
      for (const [id, log] of db.creatorAppLogs) {
        if (ownedAppIds.has(log.appId)) db.creatorAppLogs.delete(id);
      }
    }

    for (const [token, session] of db.sessionsByAccessToken) {
      if (session.userId === userId) db.sessionsByAccessToken.delete(token);
    }
    for (const [token, session] of db.sessionsByRefreshToken) {
      if (session.userId === userId) db.sessionsByRefreshToken.delete(token);
    }

    for (const [emailKey, mappedId] of db.userIdByEmail) {
      if (mappedId === userId) db.userIdByEmail.delete(emailKey);
    }
    for (const [phoneKey, mappedId] of db.userIdByPhone) {
      if (mappedId === userId) db.userIdByPhone.delete(phoneKey);
    }

    db.users.delete(userId);
    return {
      email: user.email || user.profile.email || undefined,
      phone: user.profile.phone || undefined,
    };
  },

  createEvent(userId: string, event: EventItem, blocks: ScheduleBlock[] = []) {
    const owner = db.users.get(userId);
    const ent = getPlanEntitlements(owner?.profile);

    if (ent.maxActiveEvents != null && isActiveEventStatus(event.status)) {
      const activeCount = Array.from(db.events.values()).filter(
        (e) => e.organizerId === userId && isActiveEventStatus(e.status)
      ).length;
      if (activeCount >= ent.maxActiveEvents) {
        throw Object.assign(
          new Error(
            `Starter plan allows at most ${STARTER_MAX_ACTIVE_EVENTS} active (live or upcoming) event. Save as draft or upgrade to Pro Organizer for unlimited concurrent events.`
          ),
          { status: 403 }
        );
      }
    }

    if (ent.maxAttendeesPerEvent != null && Number(event.capacity || 0) > ent.maxAttendeesPerEvent) {
      throw Object.assign(
        new Error(
          `${ent.plan} plan limits event capacity to ${ent.maxAttendeesPerEvent.toLocaleString()} attendees per event. Upgrade or request a creator capacity boost for higher venue capacities.`
        ),
        { status: 403 }
      );
    }

    if (!ent.allowCustomSenderId && hasCustomSenderIdValue(event.senderId)) {
      throw Object.assign(
        new Error('Custom Alphanumeric Sender ID requires Pro Organizer or Enterprise plan.'),
        { status: 403 }
      );
    }

    if (!ent.allowCustomMessages && hasCustomMessageOverrides(event.messageConfig)) {
      throw Object.assign(
        new Error('Custom SMS & Email message templates require Pro Organizer or Enterprise plan.'),
        { status: 403 }
      );
    }

    const baseSlug =
      (event.slug || event.title)
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, '-')
        .replace(/(^-|-$)+/g, '') || `event-${Date.now().toString(36)}`;
    const slugTaken = Array.from(db.events.values()).some((e) => e.slug === baseSlug);
    const uniqueSlug = slugTaken ? `${baseSlug}-${crypto.randomBytes(2).toString('hex')}` : baseSlug;
    const uniqueEventId = `evt-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;

    const createdBrandColor = normalizeHexColor(
      event.brandColor ?? event.extraDataConfig?.brandColor
    );
    const enforcedCapacity =
      ent.maxAttendeesPerEvent != null
        ? Math.min(Math.max(1, Number(event.capacity) || 50), ent.maxAttendeesPerEvent)
        : Math.max(1, Number(event.capacity) || 100);
    const cleanStartIso = sanitizeIsoDate(event.isoDate) || getTodayIsoDate();
    const rawEndIso = sanitizeIsoDate(event.endIsoDate ?? event.extraDataConfig?.endIsoDate);
    const cleanEndIso = rawEndIso && rawEndIso > cleanStartIso ? rawEndIso : undefined;
    const cleanPolicy = sanitizeCheckInPolicy(
      event.checkInPolicy ?? event.extraDataConfig?.checkInPolicy
    );
    const dateContext = { isoDate: cleanStartIso, endIsoDate: cleanEndIso };

    const sanitizedPlanning = sanitizeEventPlanningConfig(
      event.extraDataConfig?.planningConfig ??
        createStarterPlanningConfig(
          event.category || 'Events',
          event.organizer || owner?.profile.name || 'Organiser',
          event.venue || 'Main Venue',
          dateContext
        ),
      event.category || 'Events',
      dateContext
    );

    const rawIncomingOutline = (
      event.extraDataConfig as unknown as Record<string, unknown> | undefined
    )?.programOutline;
    const cleanProgramOutline =
      rawIncomingOutline !== undefined && rawIncomingOutline !== null
        ? sanitizeProgramOutline(rawIncomingOutline)
        : undefined;
    if (rawIncomingOutline !== undefined && rawIncomingOutline !== null && !cleanProgramOutline) {
      throw Object.assign(
        new Error(
          'Unsupported or oversized program outline file. Allowed formats: PDF, JPG/PNG/WebP, TXT, CSV, or Markdown (.md) up to 2.5 MB.'
        ),
        { status: 400 }
      );
    }

    const rawIncomingLogo = (
      event.extraDataConfig as unknown as Record<string, unknown> | undefined
    )?.logoUrl;
    const cleanIncomingLogo =
      rawIncomingLogo !== undefined && rawIncomingLogo !== null && rawIncomingLogo !== ''
        ? sanitizeEventLogoUrl(rawIncomingLogo)
        : undefined;
    if (
      rawIncomingLogo !== undefined &&
      rawIncomingLogo !== null &&
      rawIncomingLogo !== '' &&
      !cleanIncomingLogo
    ) {
      throw Object.assign(
        new Error('Event logo must be a valid JPG, PNG, or WebP image (under 1 MB) or HTTPS URL.'),
        { status: 400 }
      );
    }

    const initialExtraDataConfig = event.extraDataConfig
      ? {
          ...event.extraDataConfig,
          planningConfig: sanitizedPlanning,
          ...(cleanProgramOutline ? { programOutline: cleanProgramOutline } : {}),
          ...(cleanIncomingLogo ? { logoUrl: cleanIncomingLogo } : {}),
        }
      : {
          enableGiftTable: false,
          customFields: [],
          planningConfig: sanitizedPlanning,
        };
    if (rawIncomingOutline === null && 'programOutline' in initialExtraDataConfig) {
      delete (initialExtraDataConfig as unknown as Record<string, unknown>).programOutline;
    }
    if ((rawIncomingLogo === null || rawIncomingLogo === '') && 'logoUrl' in initialExtraDataConfig) {
      delete (initialExtraDataConfig as unknown as Record<string, unknown>).logoUrl;
    }

    const created: EventItem = {
      ...event,
      id: uniqueEventId,
      slug: uniqueSlug,
      isoDate: cleanStartIso,
      ...(cleanEndIso ? { endIsoDate: cleanEndIso } : {}),
      ...(cleanPolicy ? { checkInPolicy: cleanPolicy } : {}),
      date: cleanEndIso
        ? formatEventDateSpan(cleanStartIso, cleanEndIso, event.date)
        : event.date,
      capacity: enforcedCapacity,
      extraDataConfig: {
        ...initialExtraDataConfig,
        ...(cleanEndIso ? { endIsoDate: cleanEndIso } : {}),
        ...(cleanPolicy ? { checkInPolicy: cleanPolicy } : {}),
      },
      senderId: ent.allowCustomSenderId ? event.senderId : undefined,
      messageConfig: ent.allowCustomMessages
        ? event.messageConfig
        : event.messageConfig
          ? { includeCameraLink: event.messageConfig.includeCameraLink !== false }
          : undefined,
      brandColor: createdBrandColor,
      qrPassPublished: event.status === 'draft' ? false : Boolean(event.qrPassPublished),
    };
    db.events.set(uniqueEventId, { ...created, organizerId: userId });

    const createdBlocks: ScheduleBlock[] = blocks.map((b, idx) => {
      const id = `sch-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}-${idx}`;
      const resolvedDate =
        sanitizeIsoDate(b.date) ?? resolveScheduleBlockDate({ day: b.day, date: b.date }, dateContext);
      const resolvedDay = resolvedDate
        ? getScheduleBlockDayFromIso(resolvedDate, dateContext, normalizeScheduleDay(b.day, 'Sat'))
        : normalizeScheduleDay(b.day, 'Sat');
      const block: ScheduleBlock = {
        ...b,
        id,
        eventId: uniqueEventId,
        day: resolvedDay,
        ...(resolvedDate ? { date: resolvedDate } : {}),
      };
      db.scheduleBlocks.set(id, block);
      return block;
    });

    return { event: created, blocks: createdBlocks };
  },

  updateEvent(userId: string, eventId: string, updated: EventItem): EventItem {
    const existing = db.events.get(eventId);
    if (!existing) {
      const err = new Error('Event not found.');
      (err as Error & { status?: number }).status = 404;
      throw err;
    }
    if (existing.organizerId !== userId) {
      const err = new Error('Only the event creator can update this event.');
      (err as Error & { status?: number }).status = 403;
      throw err;
    }
    const owner = db.users.get(userId);
    const ent = getPlanEntitlements(owner?.profile);
    const nextStatus = updated.status ?? existing.status;

    if (ent.maxActiveEvents != null && isActiveEventStatus(nextStatus) && !isActiveEventStatus(existing.status)) {
      const otherActiveCount = Array.from(db.events.values()).filter(
        (e) => e.id !== eventId && e.organizerId === userId && isActiveEventStatus(e.status)
      ).length;
      if (otherActiveCount >= ent.maxActiveEvents) {
        throw Object.assign(
          new Error(
            `Starter plan allows at most ${STARTER_MAX_ACTIVE_EVENTS} active (live or upcoming) event. Upgrade to Pro Organizer for unlimited concurrent events.`
          ),
          { status: 403 }
        );
      }
    }

    if (
      ent.maxAttendeesPerEvent != null &&
      updated.capacity !== undefined &&
      Number(updated.capacity) > ent.maxAttendeesPerEvent
    ) {
      throw Object.assign(
        new Error(
          `${ent.plan} plan limits event capacity to ${ent.maxAttendeesPerEvent.toLocaleString()} attendees per event. Upgrade or request a creator capacity boost to raise venue capacity.`
        ),
        { status: 403 }
      );
    }

    if (!ent.allowCustomSenderId && updated.senderId !== undefined && hasCustomSenderIdValue(updated.senderId)) {
      throw Object.assign(
        new Error('Custom Alphanumeric Sender ID requires Pro Organizer or Enterprise plan.'),
        { status: 403 }
      );
    }

    if (
      !ent.allowCustomMessages &&
      hasCustomMessageOverrides(updated.messageConfig, existing.messageConfig)
    ) {
      throw Object.assign(
        new Error('Custom SMS & Email message templates require Pro Organizer or Enterprise plan.'),
        { status: 403 }
      );
    }

    const nextBrandColor =
      updated.brandColor === undefined
        ? existing.brandColor
        : normalizeHexColor(updated.brandColor);
    const nextCapacity =
      ent.maxAttendeesPerEvent != null
        ? Math.min(Math.max(1, Number(updated.capacity ?? existing.capacity) || 50), ent.maxAttendeesPerEvent)
        : Math.max(1, Number(updated.capacity ?? existing.capacity) || 100);
    const existingExtra = existing.extraDataConfig;
    const incomingExtra = updated.extraDataConfig;
    const incomingExtraRec = incomingExtra as unknown as Record<string, unknown> | undefined;
    const hasExplicitOutline = Boolean(incomingExtraRec && 'programOutline' in incomingExtraRec);
    const rawUpdatedOutline = incomingExtraRec?.programOutline;
    const cleanUpdatedOutline =
      hasExplicitOutline && rawUpdatedOutline !== undefined && rawUpdatedOutline !== null
        ? sanitizeProgramOutline(rawUpdatedOutline)
        : undefined;
    if (hasExplicitOutline && rawUpdatedOutline !== undefined && rawUpdatedOutline !== null && !cleanUpdatedOutline) {
      throw Object.assign(
        new Error(
          'Unsupported or oversized program outline file. Allowed formats: PDF, JPG/PNG/WebP, TXT, CSV, or Markdown (.md) up to 2.5 MB.'
        ),
        { status: 400 }
      );
    }

    const hasExplicitLogo = Boolean(incomingExtraRec && 'logoUrl' in incomingExtraRec);
    const rawUpdatedLogo = incomingExtraRec?.logoUrl;
    const cleanUpdatedLogo =
      hasExplicitLogo && rawUpdatedLogo !== undefined && rawUpdatedLogo !== null && rawUpdatedLogo !== ''
        ? sanitizeEventLogoUrl(rawUpdatedLogo)
        : undefined;
    if (
      hasExplicitLogo &&
      rawUpdatedLogo !== undefined &&
      rawUpdatedLogo !== null &&
      rawUpdatedLogo !== '' &&
      !cleanUpdatedLogo
    ) {
      throw Object.assign(
        new Error('Event logo must be a valid JPG, PNG, or WebP image (under 1 MB) or HTTPS URL.'),
        { status: 400 }
      );
    }

    const mergedExtra =
      incomingExtra === undefined
        ? existingExtra
        : {
            ...incomingExtra,
            ...(incomingExtra.giftLedger === undefined && existingExtra?.giftLedger !== undefined
              ? { giftLedger: existingExtra.giftLedger }
              : {}),
            ...(incomingExtra.attendantLinks === undefined && existingExtra?.attendantLinks !== undefined
              ? { attendantLinks: existingExtra.attendantLinks }
              : {}),
            ...(incomingExtra.polls === undefined && existingExtra?.polls !== undefined
              ? { polls: existingExtra.polls }
              : {}),
            ...(incomingExtra.planningConfig === undefined && existingExtra?.planningConfig !== undefined
              ? { planningConfig: existingExtra.planningConfig }
              : {}),
          };

    const nextStartIso = sanitizeIsoDate(updated.isoDate) ?? existing.isoDate;
    const rawNextEnd =
      'endIsoDate' in updated || (incomingExtra && 'endIsoDate' in incomingExtra)
        ? sanitizeIsoDate(updated.endIsoDate ?? incomingExtra?.endIsoDate)
        : existing.endIsoDate;
    const nextEndIso = rawNextEnd && nextStartIso && rawNextEnd > nextStartIso ? rawNextEnd : undefined;
    const nextPolicy =
      'checkInPolicy' in updated || (incomingExtra && 'checkInPolicy' in incomingExtra)
        ? sanitizeCheckInPolicy(updated.checkInPolicy ?? incomingExtra?.checkInPolicy)
        : existing.checkInPolicy;

    const finalExtra = mergedExtra ? { ...mergedExtra } : undefined;
    const dateContext = { isoDate: nextStartIso, endIsoDate: nextEndIso };
    if (finalExtra) {
      if (nextEndIso) finalExtra.endIsoDate = nextEndIso;
      else delete finalExtra.endIsoDate;
      if (nextPolicy) finalExtra.checkInPolicy = nextPolicy;
      else delete finalExtra.checkInPolicy;
      if (hasExplicitOutline) {
        if (cleanUpdatedOutline) finalExtra.programOutline = cleanUpdatedOutline;
        else delete finalExtra.programOutline;
      } else if (existingExtra?.programOutline) {
        const preservedOutline = sanitizeProgramOutline(existingExtra.programOutline);
        if (preservedOutline) finalExtra.programOutline = preservedOutline;
      }
      if (hasExplicitLogo) {
        if (cleanUpdatedLogo) finalExtra.logoUrl = cleanUpdatedLogo;
        else delete finalExtra.logoUrl;
      } else if (existingExtra?.logoUrl) {
        const preservedLogo = sanitizeEventLogoUrl(existingExtra.logoUrl);
        if (preservedLogo) finalExtra.logoUrl = preservedLogo;
      }
      if (finalExtra.planningConfig) {
        finalExtra.planningConfig = sanitizeEventPlanningConfig(
          finalExtra.planningConfig,
          updated.category || existing.category || 'Events',
          dateContext
        );
      }
    }

    const next = {
      ...existing,
      ...updated,
      id: eventId,
      organizerId: userId,
      isoDate: nextStartIso,
      endIsoDate: nextEndIso,
      checkInPolicy: nextPolicy,
      capacity: nextCapacity,
      extraDataConfig: finalExtra,
      senderId: ent.allowCustomSenderId
        ? updated.senderId !== undefined
          ? updated.senderId
          : existing.senderId
        : undefined,
      messageConfig: ent.allowCustomMessages
        ? updated.messageConfig !== undefined
          ? updated.messageConfig
          : existing.messageConfig
        : existing.messageConfig,
      brandColor: nextBrandColor,
      qrPassPublished:
        nextStatus === 'draft'
          ? false
          : updated.qrPassPublished !== undefined
            ? Boolean(updated.qrPassPublished)
            : Boolean(existing.qrPassPublished),
    };
    db.events.set(eventId, next);
    const { organizerId: _org, ...clean } = next;
    return clean;
  },

  getEventPlanning(
    userId: string,
    eventId: string
  ): { planningConfig: EventPlanningConfig | null; event: EventItem } {
    const existing = db.events.get(eventId);
    if (!existing || existing.organizerId !== userId) {
      throw Object.assign(new Error('Event not found in studio.'), { status: 404 });
    }
    const { organizerId: _org, ...clean } = existing;
    return {
      planningConfig: clean.extraDataConfig?.planningConfig ?? null,
      event: clean,
    };
  },

  updateEventPlanning(
    userId: string,
    eventId: string,
    rawPlanning: unknown
  ): { planningConfig: EventPlanningConfig; event: EventItem } {
    const existing = db.events.get(eventId);
    if (!existing || existing.organizerId !== userId) {
      throw Object.assign(new Error('Event not found in studio.'), { status: 404 });
    }
    const sanitizedPlanning = sanitizeEventPlanningConfig(
      rawPlanning,
      existing.category || 'Events',
      { isoDate: existing.isoDate, endIsoDate: existing.endIsoDate }
    );
    const prevExtra = existing.extraDataConfig ?? {
      enableGiftTable: false,
      customFields: [],
    };
    const next = {
      ...existing,
      extraDataConfig: {
        ...prevExtra,
        planningConfig: sanitizedPlanning,
      },
    };
    db.events.set(eventId, next);
    const { organizerId: _org, ...clean } = next;
    return {
      planningConfig: sanitizedPlanning,
      event: clean,
    };
  },

  publishQrPass(userId: string, eventId: string, published: boolean): EventItem {
    const existing = db.events.get(eventId);
    if (!existing) {
      const err = new Error('Event not found.');
      (err as Error & { status?: number }).status = 404;
      throw err;
    }
    if (existing.organizerId !== userId) {
      const err = new Error('Only the event creator can publish or unpublish check-in QR passes.');
      (err as Error & { status?: number }).status = 403;
      throw err;
    }
    if (published && existing.status === 'draft') {
      const err = new Error('Publish the event before publishing check-in QR passes.');
      (err as Error & { status?: number }).status = 400;
      throw err;
    }
    existing.qrPassPublished = Boolean(published);
    db.events.set(eventId, existing);
    const { organizerId: _org, ...clean } = existing;
    return clean;
  },

  createGiftAttendantLink(
    userId: string,
    eventId: string,
    payload: { attendantName: string; roleLabel?: string; phone?: string }
  ): { link: GiftTableAttendantLink; event: EventItem } {
    const existing = db.events.get(eventId);
    if (!existing) throw Object.assign(new Error('Event not found.'), { status: 404 });
    if (existing.organizerId !== userId) {
      throw Object.assign(new Error('Only the event creator can manage Gift Table links.'), { status: 403 });
    }
    const attendantName = (payload.attendantName || '').trim();
    if (!attendantName) {
      throw Object.assign(new Error('Attendant or desk representative name is required.'), { status: 400 });
    }
    const link: GiftTableAttendantLink = {
      id: `glink-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`,
      eventId,
      token: `gd_${crypto.randomBytes(8).toString('hex')}`,
      attendantName,
      roleLabel: payload.roleLabel?.trim() || 'Gift Table Attendant',
      phone: payload.phone?.trim() ? normalizePhoneE164(payload.phone.trim()) : undefined,
      active: true,
      recordedCount: 0,
      createdAt: new Date().toISOString(),
    };
    const prevExtra = existing.extraDataConfig ?? { enableGiftTable: true, customFields: [] };
    existing.extraDataConfig = {
      ...prevExtra,
      enableGiftTable: true,
      attendantLinks: [link, ...(prevExtra.attendantLinks ?? [])],
    };
    db.events.set(eventId, existing);
    const { organizerId: _org, ...clean } = existing;
    return { link, event: clean };
  },

  toggleGiftAttendantLink(
    userId: string,
    eventId: string,
    linkId: string,
    active?: boolean
  ): { link: GiftTableAttendantLink; event: EventItem } {
    const existing = db.events.get(eventId);
    if (!existing) throw Object.assign(new Error('Event not found.'), { status: 404 });
    if (existing.organizerId !== userId) {
      throw Object.assign(new Error('Only the event creator can manage Gift Table links.'), { status: 403 });
    }
    const prevExtra = existing.extraDataConfig ?? { enableGiftTable: true, customFields: [] };
    const prevLinks = Array.isArray(prevExtra.attendantLinks) ? prevExtra.attendantLinks : [];
    const target = prevLinks.find((l) => l.id === linkId);
    if (!target) {
      throw Object.assign(new Error('Gift Table attendant link not found.'), { status: 404 });
    }
    const nextLink: GiftTableAttendantLink = {
      ...target,
      active: active !== undefined ? Boolean(active) : !target.active,
    };
    existing.extraDataConfig = {
      ...prevExtra,
      attendantLinks: prevLinks.map((l) => (l.id === linkId ? nextLink : l)),
    };
    db.events.set(eventId, existing);
    const { organizerId: _org, ...clean } = existing;
    return { link: nextLink, event: clean };
  },

  deleteGiftAttendantLink(userId: string, eventId: string, linkId: string): EventItem {
    const existing = db.events.get(eventId);
    if (!existing) throw Object.assign(new Error('Event not found.'), { status: 404 });
    if (existing.organizerId !== userId) {
      throw Object.assign(new Error('Only the event creator can manage Gift Table links.'), { status: 403 });
    }
    const prevExtra = existing.extraDataConfig ?? { enableGiftTable: true, customFields: [] };
    const prevLinks = Array.isArray(prevExtra.attendantLinks) ? prevExtra.attendantLinks : [];
    existing.extraDataConfig = {
      ...prevExtra,
      attendantLinks: prevLinks.filter((l) => l.id !== linkId),
    };
    db.events.set(eventId, existing);
    const { organizerId: _org, ...clean } = existing;
    return clean;
  },

  getPublicEventPolls(slugOrId: string): { event: EventItem; polls: EventPoll[] } {
    const cleanEvt = this.getPublicEventBySlugOrId(slugOrId);
    if (!cleanEvt) {
      throw Object.assign(new Error('Event polls not found.'), { status: 404 });
    }
    return {
      event: cleanEvt,
      polls: cleanEvt.extraDataConfig?.polls ?? [],
    };
  },

  votePublicEventPoll(
    slugOrId: string,
    pollId: string,
    payload: { optionIds?: string[]; voterKey?: string; passCode?: string }
  ): { poll: EventPoll; event: EventItem } {
    const target = slugOrId.trim().toLowerCase();
    let stored: (EventItem & { organizerId: string }) | undefined;
    for (const evt of db.events.values()) {
      if (
        (evt.status === 'live' || evt.status === 'upcoming') &&
        (evt.id.toLowerCase() === target || evt.slug.toLowerCase() === target)
      ) {
        stored = evt;
        break;
      }
    }
    if (!stored) {
      throw Object.assign(new Error('Event not found.'), { status: 404 });
    }
    const polls = Array.isArray(stored.extraDataConfig?.polls)
      ? stored.extraDataConfig!.polls!
      : [];
    const pollIdx = polls.findIndex((p) => p.id === pollId);
    if (pollIdx === -1) {
      throw Object.assign(new Error('Poll not found.'), { status: 404 });
    }
    const poll = polls[pollIdx];
    if (poll.status !== 'active') {
      throw Object.assign(new Error('This poll is currently closed for voting.'), { status: 403 });
    }

    const rawIds = Array.isArray(payload.optionIds)
      ? payload.optionIds.map((id) => String(id).trim()).filter(Boolean)
      : [];
    const uniqueIds = Array.from(new Set(rawIds));
    const validOptionSet = new Set(poll.options.map((o) => o.id));
    const chosenIds = uniqueIds.filter((id) => validOptionSet.has(id));
    if (chosenIds.length === 0) {
      throw Object.assign(new Error('Select at least one valid option to cast your vote.'), {
        status: 400,
      });
    }
    if (!poll.allowMultiple && chosenIds.length > 1) {
      throw Object.assign(new Error('This poll allows only one choice.'), { status: 400 });
    }

    let dedupeKey = '';
    if (poll.requireVerifiedPass) {
      const rawPass = (payload.passCode || '').trim();
      if (!rawPass) {
        throw Object.assign(
          new Error(
            'This accredited poll requires your Event Pass Code, registered email, or phone number.'
          ),
          { status: 403 }
        );
      }
      const cleanLower = rawPass.toLowerCase();
      const cleanCode = rawPass.toUpperCase().replace(/^#/, '');
      const digitsOnly = rawPass.replace(/\D/g, '');
      const normalizedPassPhone = digitsOnly.length >= 9 ? normalizePhoneE164(rawPass) : '';
      const matchedAtt = Array.from(db.attendees.values()).find((att) => {
        if (att.eventId !== stored!.id) return false;
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
        throw Object.assign(
          new Error('No registered delegate pass matched that code, email, or phone number.'),
          { status: 403 }
        );
      }
      dedupeKey = `att:${matchedAtt.id}`;
    } else {
      const rawKey = (payload.voterKey || '').trim().slice(0, 80);
      dedupeKey = rawKey
        ? `anon:${rawKey}`
        : `anon:${crypto.randomBytes(8).toString('hex')}`;
    }

    const existingVoters = Array.isArray(poll.voterKeys) ? poll.voterKeys : [];
    if (existingVoters.includes(dedupeKey)) {
      throw Object.assign(new Error('Your vote has already been recorded for this poll.'), {
        status: 409,
      });
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

    const existingExtra = stored.extraDataConfig ?? { enableGiftTable: false, customFields: [] };
    stored.extraDataConfig = {
      ...existingExtra,
      enablePolls: true,
      polls: polls.map((p, idx) => (idx === pollIdx ? updatedPoll : p)),
    };
    db.events.set(stored.id, stored);

    const { organizerId, ...rest } = stored;
    const ownerEnt = getPlanEntitlements(db.users.get(organizerId)?.profile);
    return {
      poll: sanitizePollForPublic(updatedPoll),
      event: {
        ...rest,
        checkedIn: 0,
        whiteLabel: ownerEnt.whiteLabelPublicEvent,
        extraDataConfig: sanitizePublicExtraDataConfig(rest.extraDataConfig),
      },
    };
  },

  createStudioPoll(
    userId: string,
    eventId: string,
    payload: {
      question?: string;
      description?: string;
      sessionLabel?: string;
      options?: unknown[];
      status?: EventPollStatus;
      allowMultiple?: boolean;
      showResultsToPublic?: boolean;
      requireVerifiedPass?: boolean;
    }
  ): { poll: EventPoll; event: EventItem } {
    const existing = db.events.get(eventId);
    if (!existing) throw Object.assign(new Error('Event not found.'), { status: 404 });
    if (existing.organizerId !== userId) {
      throw Object.assign(new Error('Only the event creator can manage event polls.'), {
        status: 403,
      });
    }
    const question = (payload.question || '').trim();
    if (!question) {
      throw Object.assign(new Error('Poll question is required.'), { status: 400 });
    }
    const options = buildValidatedPollOptions(Array.isArray(payload.options) ? payload.options : []);
    if (options.length < 2) {
      throw Object.assign(new Error('Provide at least two distinct answer choices.'), {
        status: 400,
      });
    }
    const status = normalizePollStatus(payload.status, 'active');
    const newPoll: EventPoll = {
      id: `poll-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`,
      eventId,
      question: question.slice(0, 220),
      description: payload.description?.trim().slice(0, 320) || undefined,
      sessionLabel: payload.sessionLabel?.trim().slice(0, 80) || undefined,
      options,
      status,
      allowMultiple: Boolean(payload.allowMultiple),
      showResultsToPublic: payload.showResultsToPublic !== false,
      requireVerifiedPass: Boolean(payload.requireVerifiedPass),
      totalVotes: 0,
      voterKeys: [],
      createdAt: new Date().toISOString(),
      closedAt: status === 'closed' ? new Date().toISOString() : undefined,
    };
    const prevExtra = existing.extraDataConfig ?? { enableGiftTable: false, customFields: [] };
    existing.extraDataConfig = {
      ...prevExtra,
      enablePolls: true,
      polls: [newPoll, ...(prevExtra.polls ?? [])],
    };
    db.events.set(eventId, existing);
    const { organizerId: _org, ...clean } = existing;
    return { poll: newPoll, event: clean };
  },

  updateStudioPoll(
    userId: string,
    eventId: string,
    pollId: string,
    patch: {
      question?: string;
      description?: string;
      sessionLabel?: string;
      status?: EventPollStatus;
      allowMultiple?: boolean;
      showResultsToPublic?: boolean;
      requireVerifiedPass?: boolean;
    }
  ): { poll: EventPoll; event: EventItem } {
    const existing = db.events.get(eventId);
    if (!existing) throw Object.assign(new Error('Event not found.'), { status: 404 });
    if (existing.organizerId !== userId) {
      throw Object.assign(new Error('Only the event creator can manage event polls.'), {
        status: 403,
      });
    }
    const prevExtra = existing.extraDataConfig ?? { enableGiftTable: false, customFields: [] };
    const polls = Array.isArray(prevExtra.polls) ? prevExtra.polls : [];
    const target = polls.find((p) => p.id === pollId);
    if (!target) {
      throw Object.assign(new Error('Poll not found.'), { status: 404 });
    }
    const nextStatus = patch.status !== undefined ? normalizePollStatus(patch.status, target.status) : target.status;
    const updatedPoll: EventPoll = {
      ...target,
      question: patch.question?.trim() ? patch.question.trim().slice(0, 220) : target.question,
      description:
        patch.description !== undefined
          ? patch.description.trim().slice(0, 320) || undefined
          : target.description,
      sessionLabel:
        patch.sessionLabel !== undefined
          ? patch.sessionLabel.trim().slice(0, 80) || undefined
          : target.sessionLabel,
      status: nextStatus,
      allowMultiple:
        patch.allowMultiple !== undefined ? Boolean(patch.allowMultiple) : target.allowMultiple,
      showResultsToPublic:
        patch.showResultsToPublic !== undefined
          ? Boolean(patch.showResultsToPublic)
          : target.showResultsToPublic,
      requireVerifiedPass:
        patch.requireVerifiedPass !== undefined
          ? Boolean(patch.requireVerifiedPass)
          : target.requireVerifiedPass,
      closedAt:
        nextStatus === 'closed'
          ? target.closedAt || new Date().toISOString()
          : nextStatus === 'active'
            ? undefined
            : target.closedAt,
    };
    existing.extraDataConfig = {
      ...prevExtra,
      enablePolls: true,
      polls: polls.map((p) => (p.id === pollId ? updatedPoll : p)),
    };
    db.events.set(eventId, existing);
    const { organizerId: _org, ...clean } = existing;
    return { poll: updatedPoll, event: clean };
  },

  deleteStudioPoll(userId: string, eventId: string, pollId: string): EventItem {
    const existing = db.events.get(eventId);
    if (!existing) throw Object.assign(new Error('Event not found.'), { status: 404 });
    if (existing.organizerId !== userId) {
      throw Object.assign(new Error('Only the event creator can manage event polls.'), {
        status: 403,
      });
    }
    const prevExtra = existing.extraDataConfig ?? { enableGiftTable: false, customFields: [] };
    const polls = Array.isArray(prevExtra.polls) ? prevExtra.polls : [];
    existing.extraDataConfig = {
      ...prevExtra,
      polls: polls.filter((p) => p.id !== pollId),
    };
    db.events.set(eventId, existing);
    const { organizerId: _org, ...clean } = existing;
    return clean;
  },

  deleteEvent(userId: string, eventId: string) {
    const existing = db.events.get(eventId);
    if (!existing || existing.organizerId !== userId) {
      throw new Error('Event not found.');
    }
    db.events.delete(eventId);
    for (const [id, att] of db.attendees) {
      if (att.eventId === eventId) db.attendees.delete(id);
    }
    for (const [id, blk] of db.scheduleBlocks) {
      if (blk.eventId === eventId) db.scheduleBlocks.delete(id);
    }
    for (const [id, shot] of db.disposableShots) {
      if (shot.eventId === eventId) db.disposableShots.delete(id);
    }
    db.rollSettings.delete(eventId);
  },

  registerStudioAttendee(userId: string, eventId: string, attendee: Attendee) {
    const evt = db.events.get(eventId);
    if (!evt) {
      const err = new Error('Event not found in your organizer studio.');
      (err as Error & { status?: number }).status = 404;
      throw err;
    }
    if (evt.organizerId !== userId) {
      const err = new Error('Only the event creator can issue check-in QR passes for this event.');
      (err as Error & { status?: number }).status = 403;
      throw err;
    }
    if (evt.qrPassPublished === false) {
      const err = new Error(
        'Check-in QR passes have not been published yet. Publish the Check-In QR Pass as the event creator first.'
      );
      (err as Error & { status?: number }).status = 403;
      throw err;
    }
    const owner = db.users.get(evt.organizerId);
    const effectiveCap = getEffectiveEventCapacity(evt.capacity, owner?.profile);
    if (evt.registered >= effectiveCap) {
      throw Object.assign(
        new Error(
          `${evt.title} has reached its attendee capacity (${effectiveCap} seats). Upgrade plan or increase venue capacity to add more attendees.`
        ),
        { status: 403 }
      );
    }
    const normalizedPhone = normalizePhoneE164(attendee.phone);
    const duplicate = Array.from(db.attendees.values()).find(
      (a) =>
        a.eventId === eventId &&
        a.phone.replace(/\s+/g, '') === normalizedPhone.replace(/\s+/g, '')
    );
    if (duplicate) {
      platformRuntime.recordDuplicateBlock(eventId);
      const err = new Error(
        `Duplicate shield: ${normalizedPhone} is already registered for this event.`
      );
      (err as Error & { status?: number }).status = 409;
      throw err;
    }

    const todayIso = getTodayIsoDate();
    const initialDates = attendee.checkedIn
      ? sanitizeCheckedInDates(attendee.checkedInDates) ?? [todayIso]
      : [];
    const created: Attendee = {
      ...attendee,
      eventId,
      email: (attendee.email || '').trim(),
      phone: normalizedPhone,
      organization: attendee.organization || 'General Guest',
      tier: attendee.tier || 'General',
      ...(initialDates.length > 0 ? { checkedInDates: initialDates } : {}),
      smsStatus: attendee.smsStatus || 'Pending',
      paymentStatus: attendee.paymentStatus || 'paid',
    };
    db.attendees.set(created.id, created);

    evt.registered += 1;
    evt.revenue += evt.ticketPrice;
    if (created.checkedIn) evt.checkedIn += 1;

    const { organizerId: _org, ...cleanEvent } = evt;
    return { attendee: created, event: cleanEvent };
  },

  toggleCheckIn(
    userId: string,
    attendeeId: string,
    options?: { mode?: 'toggle' | 'checkin' | 'undo'; dateIso?: string }
  ): Attendee {
    const att = db.attendees.get(attendeeId);
    if (!att) throw new Error('Attendee not found.');
    const evt = db.events.get(att.eventId);
    if (!evt || evt.organizerId !== userId) throw new Error('Unauthorized.');

    const targetDateIso = sanitizeIsoDate(options?.dateIso) ?? getTodayIsoDate();
    const mode = options?.mode ?? 'toggle';
    const policy = getEventCheckInPolicy(evt);
    const nowTime = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    const wasCheckedIn = Boolean(att.checkedIn);

    if (policy === 'daily-reentry') {
      const existingDates = sanitizeCheckedInDates(att.checkedInDates) ?? [];
      let nextDates = [...existingDates];
      if (mode === 'checkin') {
        if (!nextDates.includes(targetDateIso)) nextDates.push(targetDateIso);
      } else if (mode === 'undo') {
        nextDates = nextDates.filter((d) => d !== targetDateIso);
      } else {
        nextDates = existingDates.includes(targetDateIso)
          ? existingDates.filter((d) => d !== targetDateIso)
          : [...existingDates, targetDateIso];
      }
      nextDates.sort();
      const nextCheckedIn = nextDates.length > 0;
      const addedDay = nextDates.includes(targetDateIso) && !existingDates.includes(targetDateIso);
      const checkedInAt = nextCheckedIn
        ? addedDay
          ? nowTime
          : att.checkedInAt || nowTime
        : undefined;
      const updated: Attendee = {
        ...att,
        checkedIn: nextCheckedIn,
        checkedInAt,
        checkedInDates: nextDates,
      };
      db.attendees.set(attendeeId, updated);
      if (!wasCheckedIn && nextCheckedIn) {
        evt.checkedIn += 1;
      } else if (wasCheckedIn && !nextCheckedIn) {
        evt.checkedIn = Math.max(0, evt.checkedIn - 1);
      }
      return updated;
    }

    const nextCheckedIn =
      mode === 'checkin' ? true : mode === 'undo' ? false : !wasCheckedIn;
    const checkedInAt = nextCheckedIn ? nowTime : undefined;
    const nextDates = nextCheckedIn ? [targetDateIso] : [];
    const updated: Attendee = {
      ...att,
      checkedIn: nextCheckedIn,
      checkedInAt,
      checkedInDates: nextDates,
    };
    db.attendees.set(attendeeId, updated);
    if (!wasCheckedIn && nextCheckedIn) {
      evt.checkedIn += 1;
    } else if (wasCheckedIn && !nextCheckedIn) {
      evt.checkedIn = Math.max(0, evt.checkedIn - 1);
    }
    return updated;
  },

  deleteAttendee(
    userId: string,
    attendeeId: string
  ): { ok: boolean; deletedAttendeeId: string; event: EventItem } {
    const att = db.attendees.get(attendeeId);
    if (!att) {
      throw Object.assign(new Error('Attendee not found.'), { status: 404 });
    }
    const evt = db.events.get(att.eventId);
    if (!evt || evt.organizerId !== userId) {
      throw Object.assign(
        new Error('Only the event creator can delete attendees from this event.'),
        { status: 403 }
      );
    }

    db.attendees.delete(attendeeId);
    evt.registered = Math.max(0, evt.registered - 1);
    if (att.checkedIn) {
      evt.checkedIn = Math.max(0, evt.checkedIn - 1);
    }
    if (att.paymentStatus === 'paid') {
      evt.revenue = Math.max(0, evt.revenue - evt.ticketPrice);
    }
    db.events.set(evt.id, evt);
    const { organizerId: _org, ...cleanEvent } = evt;
    return {
      ok: true,
      deletedAttendeeId: attendeeId,
      event: cleanEvent,
    };
  },

  retryPayment(userId: string, attendeeId: string): Attendee {
    const att = db.attendees.get(attendeeId);
    if (!att) throw new Error('Attendee not found.');
    const evt = db.events.get(att.eventId);
    if (!evt || evt.organizerId !== userId) throw new Error('Unauthorized.');
    const updated: Attendee = { ...att, paymentStatus: 'paid' };
    db.attendees.set(attendeeId, updated);
    for (const al of db.alerts.values()) {
      if (al.organizerId === userId && al.category === 'payment') {
        al.resolved = true;
      }
    }
    return updated;
  },

  addScheduleBlock(userId: string, block: ScheduleBlock): ScheduleBlock {
    const evt = db.events.get(block.eventId);
    if (!evt || evt.organizerId !== userId) throw new Error('Event not found.');
    const resolvedDate =
      sanitizeIsoDate(block.date) ?? resolveScheduleBlockDate({ day: block.day, date: block.date }, evt);
    const resolvedDay = resolvedDate
      ? getScheduleBlockDayFromIso(resolvedDate, evt, normalizeScheduleDay(block.day, 'Sat'))
      : normalizeScheduleDay(block.day, 'Sat');
    const normalized: ScheduleBlock = {
      ...block,
      day: resolvedDay,
      ...(resolvedDate ? { date: resolvedDate } : {}),
    };
    db.scheduleBlocks.set(normalized.id, normalized);
    return normalized;
  },

  updateScheduleBlock(
    userId: string,
    blockId: string,
    patch: Partial<ScheduleBlock>
  ): ScheduleBlock {
    const blk = db.scheduleBlocks.get(blockId);
    if (!blk) throw new Error('Schedule block not found.');
    const evt = db.events.get(blk.eventId);
    if (!evt || evt.organizerId !== userId) throw new Error('Unauthorized.');

    const explicitDateProvided = 'date' in patch;
    const cleanedExplicitDate = explicitDateProvided ? sanitizeIsoDate(patch.date) : blk.date;
    let nextDay = patch.day !== undefined ? normalizeScheduleDay(patch.day, blk.day) : blk.day;
    let nextDate = cleanedExplicitDate;

    if (explicitDateProvided && cleanedExplicitDate) {
      nextDay =
        patch.day !== undefined
          ? normalizeScheduleDay(patch.day, getScheduleBlockDayFromIso(cleanedExplicitDate, evt, blk.day))
          : getScheduleBlockDayFromIso(cleanedExplicitDate, evt, blk.day);
    } else if (patch.day !== undefined && !explicitDateProvided) {
      nextDate = resolveScheduleBlockDate({ day: nextDay, date: undefined }, evt) ?? blk.date;
    }

    const updated: ScheduleBlock = {
      ...blk,
      ...(typeof patch.time === 'string' && patch.time.trim() ? { time: patch.time.trim() } : {}),
      ...(typeof patch.duration === 'string' && patch.duration.trim()
        ? { duration: patch.duration.trim() }
        : {}),
      ...(typeof patch.title === 'string' && patch.title.trim() ? { title: patch.title.trim() } : {}),
      ...(typeof patch.stage === 'string' && patch.stage.trim() ? { stage: patch.stage.trim() } : {}),
      ...(typeof patch.lead === 'string' && patch.lead.trim() ? { lead: patch.lead.trim() } : {}),
      ...(typeof patch.completed === 'boolean' ? { completed: patch.completed } : {}),
      day: nextDay,
    };
    if (nextDate) {
      updated.date = nextDate;
    } else {
      delete updated.date;
    }

    db.scheduleBlocks.set(blockId, updated);
    return updated;
  },

  toggleScheduleBlock(userId: string, blockId: string): ScheduleBlock {
    const blk = db.scheduleBlocks.get(blockId);
    if (!blk) throw new Error('Schedule block not found.');
    const evt = db.events.get(blk.eventId);
    if (!evt || evt.organizerId !== userId) throw new Error('Unauthorized.');
    const updated = { ...blk, completed: !blk.completed };
    db.scheduleBlocks.set(blockId, updated);
    return updated;
  },

  deleteScheduleBlock(userId: string, blockId: string) {
    const blk = db.scheduleBlocks.get(blockId);
    if (!blk) return;
    const evt = db.events.get(blk.eventId);
    if (!evt || evt.organizerId !== userId) throw new Error('Unauthorized.');
    db.scheduleBlocks.delete(blockId);
  },

  resolveAlert(userId: string, alertId: string): SystemAlert {
    const al = db.alerts.get(alertId);
    if (!al || al.organizerId !== userId) throw new Error('Alert not found.');
    al.resolved = true;
    const { organizerId: _org, ...clean } = al;
    return clean;
  },

  addShot(userId: string, shot: DisposableShot): DisposableShot {
    const evt = db.events.get(shot.eventId);
    if (!evt || evt.organizerId !== userId) throw new Error('Event not found.');
    const existingEventShots = Array.from(db.disposableShots.values()).filter(
      (s) => s.eventId === evt.id
    );
    const rollCfg = db.rollSettings.get(evt.id) ?? { exposuresLimit: 24, darkroomMode: false };
    if (existingEventShots.length >= rollCfg.exposuresLimit) {
      const err = new Error(`Film roll full (${rollCfg.exposuresLimit}/${rollCfg.exposuresLimit} exposures).`);
      (err as Error & { status?: number }).status = 403;
      throw err;
    }
    const effectiveKey = (shot.shooterKey || '').trim();
    const normalizedAuthor = (shot.capturedBy || 'Guest').trim().toLowerCase();
    const userShotCount = existingEventShots.filter((s) =>
      effectiveKey && s.shooterKey
        ? s.shooterKey === effectiveKey
        : s.capturedBy.trim().toLowerCase() === normalizedAuthor
    ).length;
    if (userShotCount >= 5) {
      const err = new Error('Camera limit reached: each user is allowed up to 5 pictures per event.');
      (err as Error & { status?: number }).status = 403;
      throw err;
    }
    db.disposableShots.set(shot.id, shot);
    return shot;
  },

  addPublicShot(slugOrId: string, shot: DisposableShot): DisposableShot {
    const evtMeta =
      this.getPublicEventBySlugOrId(slugOrId) || this.getAnyEventBySlugOrId(slugOrId);
    if (!evtMeta) {
      const err = new Error('Event camera roll not found.');
      (err as Error & { status?: number }).status = 404;
      throw err;
    }
    const existingEventShots = Array.from(db.disposableShots.values()).filter(
      (s) => s.eventId === evtMeta.id
    );
    const rollCfg = db.rollSettings.get(evtMeta.id) ?? { exposuresLimit: 24, darkroomMode: false };
    if (existingEventShots.length >= rollCfg.exposuresLimit) {
      const err = new Error(`Film roll full (${rollCfg.exposuresLimit}/${rollCfg.exposuresLimit} exposures).`);
      (err as Error & { status?: number }).status = 403;
      throw err;
    }
    const effectiveKey = (shot.shooterKey || '').trim();
    const normalizedAuthor = (shot.capturedBy || 'Guest').trim().toLowerCase();
    const userShotCount = existingEventShots.filter((s) =>
      effectiveKey && s.shooterKey
        ? s.shooterKey === effectiveKey
        : s.capturedBy.trim().toLowerCase() === normalizedAuthor
    ).length;
    if (userShotCount >= 5) {
      const err = new Error('Camera limit reached: each user is allowed up to 5 pictures per event.');
      (err as Error & { status?: number }).status = 403;
      throw err;
    }
    const nextFrame =
      existingEventShots.reduce((max, s) => Math.max(max, s.frameNumber), 0) + 1;
    const saved: DisposableShot = {
      ...shot,
      id: shot.id || `shot-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      eventId: evtMeta.id,
      frameNumber: nextFrame,
      developed: !rollCfg.darkroomMode,
    };
    db.disposableShots.set(saved.id, saved);
    return saved;
  },

  togglePublicLikeShot(shotId: string): DisposableShot {
    const shot = db.disposableShots.get(shotId);
    if (!shot) {
      const err = new Error('Shot not found.');
      (err as Error & { status?: number }).status = 404;
      throw err;
    }
    const liked = !Boolean(shot.liked);
    const likes = liked ? shot.likes + 1 : Math.max(0, shot.likes - 1);
    const updated = { ...shot, liked, likes };
    db.disposableShots.set(shotId, updated);
    return updated;
  },

  toggleLikeShot(userId: string, shotId: string): DisposableShot {
    const shot = db.disposableShots.get(shotId);
    if (!shot) throw new Error('Shot not found.');
    const evt = db.events.get(shot.eventId);
    if (!evt || evt.organizerId !== userId) throw new Error('Unauthorized.');
    const liked = !Boolean(shot.liked);
    const likes = liked ? shot.likes + 1 : Math.max(0, shot.likes - 1);
    const updated = { ...shot, liked, likes };
    db.disposableShots.set(shotId, updated);
    return updated;
  },

  deleteShot(userId: string, shotId: string) {
    const shot = db.disposableShots.get(shotId);
    if (!shot) return;
    const evt = db.events.get(shot.eventId);
    if (!evt || evt.organizerId !== userId) throw new Error('Unauthorized.');
    db.disposableShots.delete(shotId);
  },

  deletePublicShot(shotId: string, shooterKey: string) {
    const key = shooterKey.trim();
    if (!key) {
      const err = new Error('Missing shooterKey to verify photo ownership.');
      (err as Error & { status?: number }).status = 400;
      throw err;
    }
    const shot = db.disposableShots.get(shotId);
    if (!shot) {
      const err = new Error('Photo not found.');
      (err as Error & { status?: number }).status = 404;
      throw err;
    }
    if (!shot.shooterKey || shot.shooterKey !== key) {
      const err = new Error('You can only delete photos you captured.');
      (err as Error & { status?: number }).status = 403;
      throw err;
    }
    db.disposableShots.delete(shotId);
  },

  developRoll(userId: string, eventId: string) {
    const evt = db.events.get(eventId);
    if (!evt || evt.organizerId !== userId) throw new Error('Unauthorized.');
    for (const [id, shot] of db.disposableShots) {
      if (shot.eventId === eventId) {
        db.disposableShots.set(id, { ...shot, developed: true });
      }
    }
  },

  updateRollSettings(
    userId: string,
    eventId: string,
    settings: DisposableRollSettings
  ): DisposableRollSettings {
    const evt = db.events.get(eventId);
    if (!evt || evt.organizerId !== userId) throw new Error('Unauthorized.');
    const limit =
      settings.exposuresLimit === 12 || settings.exposuresLimit === 36 ? settings.exposuresLimit : 24;
    const next: DisposableRollSettings = {
      exposuresLimit: limit,
      darkroomMode: Boolean(settings.darkroomMode),
    };
    db.rollSettings.set(eventId, next);
    return next;
  },

  createCreatorApp(
    userId: string,
    payload: {
      name: string;
      description?: string;
      appType?: CreatorAppType;
      environment?: CreatorAppEnvironment;
      eventId?: string;
      scopes?: CreatorAppScope[];
      webhookUrl?: string;
      webhookEvents?: WebhookTriggerEvent[];
      allowedOrigins?: string[];
    }
  ) {
    const env: CreatorAppEnvironment = payload.environment === 'production' ? 'production' : 'sandbox';
    const appId = `app-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
    const slug =
      payload.name
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') || appId;
    const clientId = `${env === 'production' ? 'ev_live_' : 'ev_test_'}${crypto.randomBytes(10).toString('hex')}`;
    const token = crypto.randomBytes(20).toString('hex');
    const rawSecret = `${env === 'production' ? 'ev_live_sec_' : 'ev_test_sec_'}${token}`;
    const secretHash = sha256Hex(rawSecret);
    const secretPrefix = `${rawSecret.slice(0, 16)}••••••••${rawSecret.slice(-4)}`;
    const webhookSecret = `whsec_${crypto.randomBytes(18).toString('hex')}`;
    const scopes: CreatorAppScope[] =
      Array.isArray(payload.scopes) && payload.scopes.length > 0
        ? payload.scopes
        : ['events:read', 'attendees:read'];

    const record: StoredCreatorAppRecord = {
      id: appId,
      organizerId: userId,
      name: payload.name.trim(),
      slug,
      description: (payload.description || '').trim(),
      appType: payload.appType || 'widget',
      environment: env,
      status: 'active',
      eventId: payload.eventId || undefined,
      clientId,
      secretHash,
      secretPrefix,
      webhookSecret,
      scopes,
      webhookUrl: payload.webhookUrl?.trim() || undefined,
      webhookEvents: Array.isArray(payload.webhookEvents) ? payload.webhookEvents : [],
      allowedOrigins: Array.isArray(payload.allowedOrigins) ? payload.allowedOrigins : [],
      requestsCount: 1,
      lastUsedAt: 'Just now',
      createdAt: new Date().toISOString(),
    };
    db.creatorApps.set(appId, record);

    const log: CreatorAppLog = {
      id: `log-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`,
      appId,
      eventType: 'app.provisioned',
      method: 'POST',
      endpoint: '/api/studio/apps',
      statusCode: 201,
      latencyMs: 14,
      requestSummary: `Provisioned ${record.name} (${env}) with ${scopes.length} scopes`,
      responseSummary: `client_id=${clientId}`,
      createdAt: new Date().toISOString(),
    };
    db.creatorAppLogs.set(log.id, log);

    const { organizerId: _org, secretHash: _sh, webhookSecret: _ws, ...app } = record;
    return { app, rawSecret, webhookSecret, log };
  },

  updateCreatorApp(
    userId: string,
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
  ): CreatorApp {
    const existing = db.creatorApps.get(appId);
    if (!existing || existing.organizerId !== userId) {
      throw new Error('Creator app not found.');
    }
    const updated: StoredCreatorAppRecord = {
      ...existing,
      name: typeof patch.name === 'string' && patch.name.trim() ? patch.name.trim() : existing.name,
      description:
        typeof patch.description === 'string' ? patch.description.trim() : existing.description,
      appType: patch.appType ?? existing.appType,
      environment: patch.environment ?? existing.environment,
      status: patch.status ?? existing.status,
      eventId: patch.eventId !== undefined ? patch.eventId || undefined : existing.eventId,
      scopes: Array.isArray(patch.scopes) ? patch.scopes : existing.scopes,
      webhookUrl:
        patch.webhookUrl !== undefined ? patch.webhookUrl || undefined : existing.webhookUrl,
      webhookEvents: Array.isArray(patch.webhookEvents)
        ? patch.webhookEvents
        : existing.webhookEvents,
      allowedOrigins: Array.isArray(patch.allowedOrigins)
        ? patch.allowedOrigins
        : existing.allowedOrigins,
    };
    db.creatorApps.set(appId, updated);
    const { organizerId: _org, secretHash: _sh, webhookSecret: _ws, ...app } = updated;
    return app;
  },

  rotateCreatorAppSecret(userId: string, appId: string) {
    const existing = db.creatorApps.get(appId);
    if (!existing || existing.organizerId !== userId) {
      throw new Error('Creator app not found.');
    }
    const token = crypto.randomBytes(20).toString('hex');
    const rawSecret = `${existing.environment === 'production' ? 'ev_live_sec_' : 'ev_test_sec_'}${token}`;
    const secretHash = sha256Hex(rawSecret);
    const secretPrefix = `${rawSecret.slice(0, 16)}••••••••${rawSecret.slice(-4)}`;
    const webhookSecret = `whsec_${crypto.randomBytes(18).toString('hex')}`;

    const updated: StoredCreatorAppRecord = {
      ...existing,
      secretHash,
      secretPrefix,
      webhookSecret,
    };
    db.creatorApps.set(appId, updated);

    const log: CreatorAppLog = {
      id: `log-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`,
      appId,
      eventType: 'credentials.rotated',
      method: 'POST',
      endpoint: `/api/studio/apps/${appId}/rotate-secret`,
      statusCode: 200,
      latencyMs: 19,
      requestSummary: 'Rotated client secret & HMAC signing key',
      responseSummary: `new_prefix=${secretPrefix}`,
      createdAt: new Date().toISOString(),
    };
    db.creatorAppLogs.set(log.id, log);

    const { organizerId: _org, secretHash: _sh, webhookSecret: _ws, ...app } = updated;
    return { app, rawSecret, webhookSecret, log };
  },

  async testCreatorWebhook(userId: string, appId: string, eventType?: string) {
    const existing = db.creatorApps.get(appId);
    if (!existing || existing.organizerId !== userId) {
      throw new Error('Creator app not found.');
    }
    const trigger = eventType || 'attendee.registered';
    const payload = {
      id: `evt_wh_${crypto.randomBytes(6).toString('hex')}`,
      type: trigger,
      createdAt: new Date().toISOString(),
      appId: existing.id,
      clientId: existing.clientId,
      environment: existing.environment,
      data: {
        eventId: existing.eventId || 'evt-test-webhook',
        attendeeName: 'Test Webhook Attendee',
        ticketCode: '#EVT-TEST-2026',
        smsStatus: 'Arkesel Sent',
      },
    };
    const bodyString = JSON.stringify(payload);
    const signature = crypto
      .createHmac('sha256', existing.webhookSecret)
      .update(bodyString)
      .digest('hex');

    const started = Date.now();
    let statusCode = 200;
    let responseSummary = 'Sandbox loop verified locally (no external webhook URL configured)';
    let targetEndpoint = '/sandbox/webhook-loopback';

    if (existing.webhookUrl && /^https?:\/\//i.test(existing.webhookUrl)) {
      targetEndpoint = existing.webhookUrl;
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 5000);
        const remoteResp = await fetch(existing.webhookUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-EventsApp-Event': trigger,
            'X-EventsApp-Signature': `sha256=${signature}`,
          },
          body: bodyString,
          signal: controller.signal,
        });
        clearTimeout(timer);
        statusCode = remoteResp.status;
        const text = await remoteResp.text();
        responseSummary = `HTTP ${remoteResp.status}${text ? ` — ${text.slice(0, 140)}` : ''}`;
      } catch (err) {
        statusCode = 502;
        responseSummary = err instanceof Error ? err.message : 'Outbound webhook unreachable';
      }
    }

    if (statusCode >= 400) {
      platformRuntime.recordDiagnosticFailure({
        kind: 'webhook',
        target: targetEndpoint,
        statusCode,
        reason: responseSummary,
        payloadPreview: bodyString.slice(0, 260),
        expectedDiff: `Expected HTTP 200-299 ACK; received ${statusCode}`,
        appId: existing.id,
      });
    }

    const latencyMs = Math.max(4, Date.now() - started);
    const nowLabel = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    existing.requestsCount += 1;
    existing.lastUsedAt = `Today ${nowLabel}`;

    const log: CreatorAppLog = {
      id: `log-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`,
      appId,
      eventType: trigger,
      method: 'POST',
      endpoint: targetEndpoint,
      statusCode,
      latencyMs,
      requestSummary: `Signed webhook ${trigger} (sig ${signature.slice(0, 12)}…)`,
      responseSummary,
      createdAt: new Date().toISOString(),
    };
    db.creatorAppLogs.set(log.id, log);

    const { organizerId: _org, secretHash: _sh, webhookSecret: _ws, ...app } = existing;
    return { app, log };
  },

  simulateCreatorEndpointCall(
    userId: string,
    appId: string,
    endpoint?: string,
    method?: 'GET' | 'POST'
  ) {
    const existing = db.creatorApps.get(appId);
    if (!existing || existing.organizerId !== userId) {
      throw new Error('Creator app not found.');
    }
    const cleanEndpoint = endpoint || '/v1/events';
    const httpMethod = method === 'POST' ? 'POST' : 'GET';
    const started = Date.now();
    let statusCode = 200;
    let result: Record<string, unknown> = {};
    let responseSummary = '';

    const userEvents = Array.from(db.events.values()).filter((e) => e.organizerId === userId);
    const scopedEvents = existing.eventId
      ? userEvents.filter((e) => e.id === existing.eventId)
      : userEvents;
    const scopedIds = new Set(scopedEvents.map((e) => e.id));

    if (existing.status !== 'active') {
      statusCode = 403;
      result = { error: 'App client is paused. Resume app to accept API calls.' };
      responseSummary = '403 Forbidden — App is currently paused';
      platformRuntime.recordDiagnosticFailure({
        kind: 'client-auth',
        target: `${httpMethod} ${cleanEndpoint}`,
        statusCode,
        reason: responseSummary,
        payloadPreview: JSON.stringify({ clientId: existing.clientId, status: existing.status }),
        expectedDiff: 'App status=active required; client is paused',
        appId: existing.id,
      });
    } else if (cleanEndpoint === '/v1/events') {
      if (!existing.scopes.includes('events:read')) {
        statusCode = 403;
        result = { error: 'Missing required scope: events:read' };
        responseSummary = '403 Missing scope events:read';
      } else {
        const list = scopedEvents.map((e) => ({
          id: e.id,
          title: e.title,
          status: e.status,
          registered: e.registered,
          capacity: e.capacity,
        }));
        result = { count: list.length, events: list };
        responseSummary = `Returned ${list.length} event(s) for client ${existing.clientId}`;
      }
    } else if (cleanEndpoint === '/v1/attendees') {
      if (!existing.scopes.includes('attendees:read')) {
        statusCode = 403;
        result = { error: 'Missing required scope: attendees:read' };
        responseSummary = '403 Missing scope attendees:read';
      } else {
        const list = Array.from(db.attendees.values())
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
      }
    } else if (cleanEndpoint === '/v1/checkin') {
      if (!existing.scopes.includes('checkin:write')) {
        statusCode = 403;
        result = { error: 'Missing required scope: checkin:write' };
        responseSummary = '403 Missing scope checkin:write';
      } else {
        result = {
          verified: true,
          mode: existing.environment,
          checkedInAt: new Date().toISOString(),
          clientId: existing.clientId,
        };
        responseSummary = `Gate check-in authorization verified (${existing.environment})`;
      }
    } else if (cleanEndpoint === '/v1/camera/shots') {
      if (!existing.scopes.includes('camera:read')) {
        statusCode = 403;
        result = { error: 'Missing required scope: camera:read' };
        responseSummary = '403 Missing scope camera:read';
      } else {
        const frames = Array.from(db.disposableShots.values())
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
    }

    const latencyMs = Math.max(8, Date.now() - started);
    const nowLabel = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    existing.requestsCount += 1;
    existing.lastUsedAt = `Today ${nowLabel}`;

    const log: CreatorAppLog = {
      id: `log-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`,
      appId,
      eventType: 'api.invocation',
      method: httpMethod,
      endpoint: cleanEndpoint,
      statusCode,
      latencyMs,
      requestSummary: `${httpMethod} ${cleanEndpoint} (${existing.clientId})`,
      responseSummary,
      createdAt: new Date().toISOString(),
    };
    db.creatorAppLogs.set(log.id, log);

    const { organizerId: _org, secretHash: _sh, webhookSecret: _ws, ...app } = existing;
    return { app, log, result };
  },

  deleteCreatorApp(userId: string, appId: string) {
    const existing = db.creatorApps.get(appId);
    if (!existing || existing.organizerId !== userId) {
      throw new Error('Creator app not found.');
    }
    db.creatorApps.delete(appId);
    for (const [id, log] of db.creatorAppLogs) {
      if (log.appId === appId) db.creatorAppLogs.delete(id);
    }
  },

  // =========================================================================
  // APPS BUILDER CONSOLE TELEMETRY & ADMIN OPERATIONS (In-Memory Mode)
  // =========================================================================

  getBuilderOverview(): BuilderConsoleOverview {
    const started = Date.now();
    const allEvents = Array.from(db.events.values());
    const allAttendees = Array.from(db.attendees.values());
    const allShots = Array.from(db.disposableShots.values());
    const allUsers = Array.from(db.users.values());

    const eventMap = new Map(allEvents.map((e) => [e.id, e]));
    const totalDispatched = allEvents.reduce((acc, e) => acc + e.smsDispatched, 0);
    const pendingAttendees = allAttendees.filter((a) => a.smsStatus === 'Pending');
    const pendingOrFailedCount = pendingAttendees.length;
    const deliveredCount = Math.max(0, totalDispatched - pendingOrFailedCount);
    const successRatePct =
      totalDispatched > 0
        ? Number(((deliveredCount / totalDispatched) * 100).toFixed(1))
        : 100;

    const failedQueue: BuilderSmsQueueItem[] = pendingAttendees.map((a) => ({
      attendeeId: a.id,
      attendeeName: a.name,
      phone: a.phone,
      eventId: a.eventId,
      eventTitle: eventMap.get(a.eventId)?.title ?? a.eventId,
      smsStatus: a.smsStatus,
    }));

    const organizerCreditLiabilities = allUsers.reduce((acc, u) => acc + u.profile.smsCredits, 0);
    const tenants = allUsers.map((u) => buildTenantSummary(u));

    const eventTraffic: BuilderEventTrafficRow[] = allEvents.map((e) => {
      const evtShots = allShots.filter((s) => s.eventId === e.id);
      const bytes = evtShots.reduce((acc, s) => acc + estimateShotBytes(s.dataUrl), 0);
      return {
        eventId: e.id,
        title: e.title,
        slug: e.slug,
        status: e.status,
        registered: e.registered,
        capacity: e.capacity,
        checkedIn: e.checkedIn,
        duplicateBlocks: platformRuntime.duplicateBlocksByEvent.get(e.id) ?? 0,
        cameraShots: evtShots.length,
        cameraStorageMb: Number((bytes / (1024 * 1024)).toFixed(2)),
        registrationPaused: platformRuntime.flags.pausedEventIds.includes(e.id),
      };
    });

    const totalDuplicateBlocks = Array.from(platformRuntime.duplicateBlocksByEvent.values()).reduce(
      (a, b) => a + b,
      0
    );

    const perTenant: BuilderTenantUnitEconomics[] = allUsers.map((u) => {
      const uEvents = allEvents.filter((e) => e.organizerId === u.id);
      const uEvtIds = new Set(uEvents.map((e) => e.id));
      const smsSentCount = uEvents.reduce((acc, e) => acc + e.smsDispatched, 0);
      const uShots = allShots.filter((s) => uEvtIds.has(s.eventId));
      const storageMb = Number(
        (uShots.reduce((acc, s) => acc + estimateShotBytes(s.dataUrl), 0) / (1024 * 1024)).toFixed(
          2
        )
      );
      const mrrUsd = PLAN_MRR_USD[u.profile.plan];
      const smsCostUsd = Number((smsSentCount * SMS_UNIT_COST_USD).toFixed(2));
      const storageCostUsd = Number((storageMb * STORAGE_COST_PER_MB_USD).toFixed(2));
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
    const totalStorageCostUsd = Number(
      perTenant.reduce((a, t) => a + t.storageCostUsd, 0).toFixed(2)
    );
    const totalStorageMb = Number(perTenant.reduce((a, t) => a + t.storageMb, 0).toFixed(2));
    const grossMarginUsd = Number(
      (totalMrrUsd - totalSmsCostUsd - totalStorageCostUsd).toFixed(2)
    );

    return {
      storageMode: 'in-memory',
      dbLatencyMs: Math.max(2, Date.now() - started + 2),
      rlsVerified: true,
      tableCounts: {
        profiles: allUsers.length,
        events: allEvents.length,
        attendees: allAttendees.length,
        disposable_shots: allShots.length,
        creator_apps: db.creatorApps.size,
      },
      recentErrors: [...platformRuntime.recentErrors],
      smsTelemetry: {
        mode: platformRuntime.flags.smsMode,
        activeSenderId: platformRuntime.getEffectiveArkeselSenderId().senderId,
        usingDefaultSenderIdWarning: platformRuntime.getEffectiveArkeselSenderId().isDefaultUnverifiedWarning,
        dlrWebhookUrl: process.env.APP_URL
          ? `${process.env.APP_URL.replace(/\/+$/, '')}/api/webhooks/arkesel-dlr`
          : undefined,
        totalDispatched,
        deliveredCount,
        pendingOrFailedCount,
        successRatePct,
        gatewayBalanceCredits: platformRuntime.gatewayBalanceCredits,
        gatewayBalanceLive: platformRuntime.gatewayBalanceLive,
        gatewayBalanceError: platformRuntime.gatewayBalanceError,
        organizerCreditLiabilities,
        failedQueue,
        recentDispatches: [...platformRuntime.smsDispatches],
      },
      pendingSmsPurchases: Array.from(db.smsPurchases.values())
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, 30),
      pendingSubscriptionPayments: Array.from(db.subscriptionPayments.values())
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, 30),
      tenants,
      eventTraffic,
      totalDuplicateBlocks,
      diagnosticFailures: [...platformRuntime.diagnosticFailures],
      flags: {
        ...platformRuntime.flags,
        pausedEventIds: [...platformRuntime.flags.pausedEventIds],
      },
      envStatus: platformRuntime.getEnvStatus(),
      unitEconomics: {
        totalMrrUsd,
        totalSmsCostUsd,
        totalStorageCostUsd,
        grossMarginUsd,
        totalStorageMb,
        proCount: allUsers.filter((u) => u.profile.plan === 'Pro Organizer').length,
        enterpriseCount: allUsers.filter((u) => u.profile.plan === 'Enterprise').length,
        starterCount: allUsers.filter((u) => u.profile.plan === 'Starter').length,
        perTenant,
      },
    };
  },

  retryFailedSms(attendeeId?: string) {
    let retried = 0;
    for (const [id, att] of db.attendees) {
      if (attendeeId && id !== attendeeId) continue;
      if (att.smsStatus === 'Pending') {
        db.attendees.set(id, { ...att, smsStatus: 'Arkesel Sent' });
        retried += 1;
      }
    }
    if (retried > 0) {
      for (const al of db.alerts.values()) {
        if (al.category === 'broadcast') al.resolved = true;
      }
    }
    return { retried };
  },

  topUpTenantCredits(userId: string, amount: number): BuilderTenantSummary {
    const user = db.users.get(userId);
    if (!user) throw new Error('Organiser account not found.');
    user.profile.smsCredits = Math.max(0, user.profile.smsCredits + amount);
    return buildTenantSummary(user);
  },

  updateTenantPlan(userId: string, plan: OrganizerProfile['plan']): BuilderTenantSummary {
    const user = db.users.get(userId);
    if (!user) throw new Error('Organiser account not found.');
    const previousPlan = user.profile.plan;
    user.profile.plan = plan;
    if (previousPlan !== plan) {
      user.profile.planAttendeeCapacity = undefined;
    }
    if (plan === 'Starter') {
      user.profile.planBillingCycle = 'monthly';
      user.profile.planExpiresAt = undefined;
      user.profile.senderId = DEFAULT_SHARED_SENDER_ID;
    } else if (!user.profile.planExpiresAt) {
      user.profile.planBillingCycle = user.profile.planBillingCycle || 'monthly';
      user.profile.planExpiresAt = computePlanExpiresAtIso(user.profile.planBillingCycle);
    }
    return buildTenantSummary(user);
  },

  updateTenantAttendeeCapacity(
    userId: string,
    payload: { delta?: number; capacity?: number | 'unlimited' | 'default' | null }
  ): {
    tenant: BuilderTenantSummary;
    planAttendeeCapacity?: number | 'unlimited';
    effectiveMaxAttendeesPerEvent: number | null;
  } {
    const user = db.users.get(userId);
    if (!user) throw Object.assign(new Error('Organiser account not found.'), { status: 404 });

    let nextValue: number | 'unlimited' | undefined;
    if (payload.capacity === 'default' || payload.capacity === null) {
      nextValue = undefined;
    } else if (payload.capacity === 'unlimited') {
      nextValue = 'unlimited';
    } else if (payload.capacity !== undefined) {
      const parsed = resolvePlanAttendeeCapacityValue(payload.capacity);
      if (parsed === undefined) {
        throw Object.assign(
          new Error(`Attendee capacity must be between 1 and ${MAX_CUSTOM_ATTENDEE_CAPACITY.toLocaleString()}, "unlimited", or "default".`),
          { status: 400 }
        );
      }
      nextValue = parsed;
    } else if (payload.delta !== undefined) {
      try {
        nextValue = computeNextPlanAttendeeCapacity(user.profile, payload.delta);
      } catch (err) {
        throw Object.assign(
          new Error(err instanceof Error ? err.message : 'Invalid attendee capacity delta.'),
          { status: 400 }
        );
      }
    } else {
      throw Object.assign(new Error('Provide a capacity value or delta.'), { status: 400 });
    }

    user.profile.planAttendeeCapacity = nextValue;
    const ent = getPlanEntitlements(user.profile);
    return {
      tenant: buildTenantSummary(user),
      planAttendeeCapacity: user.profile.planAttendeeCapacity,
      effectiveMaxAttendeesPerEvent: ent.maxAttendeesPerEvent,
    };
  },

  updateTenantRole(userId: string, appRole: AppRole): BuilderTenantSummary {
    if (appRole === 'creator') {
      throw new Error('The creator role is exclusive to the platform owner and cannot be assigned to any other user.');
    }
    if (appRole !== 'organizer' && appRole !== 'gate_staff') {
      throw new Error('Invalid RBAC role.');
    }
    const user = db.users.get(userId);
    if (!user) throw new Error('Organiser account not found.');
    const creatorEmail = (process.env.CREATOR_EMAIL || 'amoakoimml@gmail.com').trim().toLowerCase();
    const creatorPhone = (process.env.CREATOR_PHONE || '').trim()
      ? normalizePhoneE164((process.env.CREATOR_PHONE || '').trim())
      : '';
    const isPrimaryCreator =
      user.email.trim().toLowerCase() === creatorEmail ||
      Boolean(creatorPhone && user.profile.phone && normalizePhoneE164(user.profile.phone) === creatorPhone);
    if (isPrimaryCreator) {
      throw new Error('The primary creator account role cannot be modified.');
    }
    user.profile.appRole = appRole;
    user.profile.role = appRole === 'gate_staff' ? 'Gate Check-In Staff' : 'Lead Organiser';
    return buildTenantSummary(user);
  },

  toggleTenantSuspend(userId: string): BuilderTenantSummary {
    const user = db.users.get(userId);
    if (!user) throw new Error('Organiser account not found.');
    user.suspended = !user.suspended;
    if (user.suspended) {
      this.revokeTenantSessions(userId);
    }
    return buildTenantSummary(user);
  },

  revokeTenantSessions(userId: string): { revoked: number } {
    let revoked = 0;
    for (const [token, sess] of db.sessionsByAccessToken) {
      if (sess.userId === userId) {
        db.sessionsByAccessToken.delete(token);
        db.sessionsByRefreshToken.delete(sess.refreshToken);
        revoked += 1;
      }
    }
    return { revoked };
  },

  inspectTenant(userId: string): BuilderTenantInspection {
    const user = db.users.get(userId);
    if (!user) throw new Error('Organiser account not found.');
    const events = Array.from(db.events.values())
      .filter((e) => e.organizerId === userId)
      .map(({ organizerId: _org, ...rest }) => rest);
    const evtIds = new Set(events.map((e) => e.id));
    const attendees = Array.from(db.attendees.values()).filter((a) => evtIds.has(a.eventId));
    return {
      tenant: buildTenantSummary(user),
      events,
      attendees,
    };
  },

  async replayDiagnosticFailure(diagId: string) {
    const item = platformRuntime.diagnosticFailures.find((d) => d.id === diagId);
    if (!item) throw new Error('Diagnostic failure entry not found.');
    item.replayed = true;
    if (item.appId && db.creatorApps.has(item.appId)) {
      const app = db.creatorApps.get(item.appId)!;
      await this.testCreatorWebhook(app.organizerId, app.id, 'attendee.registered');
    }
    return item;
  },
};
