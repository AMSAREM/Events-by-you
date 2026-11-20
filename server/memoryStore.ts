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
  GiftTableEntry,
  OrganizerProfile,
  ScheduleBlock,
  SmsDispatchLogEntry,
  SystemAlert,
  WebhookTriggerEvent,
} from '../src/types/events.ts';

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
}

const PLAN_MRR_USD: Record<OrganizerProfile['plan'], number> = {
  Starter: 0,
  'Pro Organizer': 29,
  Enterprise: 99,
};

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

  getEffectiveArkeselSenderId(explicit?: string): {
    senderId: string;
    isDefaultUnverifiedWarning: boolean;
  } {
    const cleanExplicit = (explicit || '').trim().slice(0, 11);
    const runtimeOverride = (this.flags.arkeselSenderId || '').trim().slice(0, 11);
    const envSender = (process.env.ARKESEL_SENDER_ID || '').trim().slice(0, 11);
    if (cleanExplicit) {
      return { senderId: cleanExplicit, isDefaultUnverifiedWarning: false };
    }
    if (runtimeOverride) {
      return { senderId: runtimeOverride, isDefaultUnverifiedWarning: false };
    }
    if (envSender) {
      return { senderId: envSender, isDefaultUnverifiedWarning: false };
    }
    return { senderId: 'EVENTSAPP', isDefaultUnverifiedWarning: true };
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
    smsCredits: isCreator ? 1840 : 20,
    capacityAlertThreshold: 90,
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

  return {
    id: user.id,
    name: user.profile.name,
    email: user.email,
    studio: user.profile.studio,
    appRole: user.profile.appRole ?? 'organizer',
    plan: user.profile.plan,
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

  issueOAuthSession(emailInput = 'amoakoimml@gmail.com') {
    const user = getOrCreateMemoryUser(emailInput);
    if (user.suspended) {
      throw new Error('This organiser account has been suspended.');
    }
    user.lastLoginAt = new Date().toISOString();
    return createMemorySession(user.id);
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

  getUserByAccessToken(accessToken: string): MemoryUser | null {
    const session = db.sessionsByAccessToken.get(accessToken);
    if (!session) return null;
    const nowMs = Date.now();
    if (session.expiresAt * 1000 < nowMs || nowMs - session.lastActivityAt > SESSION_IDLE_TIMEOUT_MS) {
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
      .map(({ organizerId: _org, ...rest }) => rest)
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
        const { organizerId: _org, ...rest } = evt;
        return rest;
      }
    }
    return null;
  },

  getAnyEventBySlugOrId(slugOrId: string): EventItem | null {
    const target = slugOrId.trim().toLowerCase();
    for (const evt of db.events.values()) {
      if (evt.id.toLowerCase() === target || evt.slug.toLowerCase() === target) {
        const { organizerId: _org, ...rest } = evt;
        return rest;
      }
    }
    return null;
  },

  getEventOrganizerDefaults(slugOrId: string): { replyToEmail?: string; senderId?: string } {
    const target = slugOrId.trim().toLowerCase();
    for (const evt of db.events.values()) {
      if (evt.id.toLowerCase() === target || evt.slug.toLowerCase() === target) {
        const owner = db.users.get(evt.organizerId);
        return {
          replyToEmail: owner?.profile.replyToEmail,
          senderId: owner?.profile.senderId,
        };
      }
    }
    return {};
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
    return { gift, event: updatedEvt };
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

    evt.registered += 1;
    evt.smsDispatched += 1;
    evt.revenue += evt.ticketPrice;
    if (platformRuntime.gatewayBalanceCredits > 0) {
      platformRuntime.gatewayBalanceCredits -= 1;
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
      ...safePatch
    } = patch;
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
    const baseSlug =
      (event.slug || event.title)
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, '-')
        .replace(/(^-|-$)+/g, '') || `event-${Date.now().toString(36)}`;
    const slugTaken = Array.from(db.events.values()).some((e) => e.slug === baseSlug);
    const uniqueSlug = slugTaken ? `${baseSlug}-${crypto.randomBytes(2).toString('hex')}` : baseSlug;
    const uniqueEventId = `evt-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;

    const created: EventItem = {
      ...event,
      id: uniqueEventId,
      slug: uniqueSlug,
      qrPassPublished: event.status === 'draft' ? false : Boolean(event.qrPassPublished),
    };
    db.events.set(uniqueEventId, { ...created, organizerId: userId });

    const createdBlocks: ScheduleBlock[] = blocks.map((b, idx) => {
      const id = `sch-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}-${idx}`;
      const block: ScheduleBlock = { ...b, id, eventId: uniqueEventId };
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
    const nextStatus = updated.status ?? existing.status;
    const next = {
      ...existing,
      ...updated,
      id: eventId,
      organizerId: userId,
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

    const created: Attendee = {
      ...attendee,
      eventId,
      phone: normalizedPhone,
      organization: attendee.organization || 'General Guest',
      tier: attendee.tier || 'General',
      smsStatus: attendee.smsStatus || 'Arkesel Sent',
      paymentStatus: attendee.paymentStatus || 'paid',
    };
    db.attendees.set(created.id, created);

    evt.registered += 1;
    evt.smsDispatched += 1;
    evt.revenue += evt.ticketPrice;
    if (created.checkedIn) evt.checkedIn += 1;

    const { organizerId: _org, ...cleanEvent } = evt;
    return { attendee: created, event: cleanEvent };
  },

  toggleCheckIn(userId: string, attendeeId: string): Attendee {
    const att = db.attendees.get(attendeeId);
    if (!att) throw new Error('Attendee not found.');
    const evt = db.events.get(att.eventId);
    if (!evt || evt.organizerId !== userId) throw new Error('Unauthorized.');

    const nextCheckedIn = !att.checkedIn;
    const checkedInAt = nextCheckedIn
      ? new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
      : undefined;
    const updated: Attendee = { ...att, checkedIn: nextCheckedIn, checkedInAt };
    db.attendees.set(attendeeId, updated);
    evt.checkedIn = Math.max(0, evt.checkedIn + (nextCheckedIn ? 1 : -1));
    return updated;
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
    db.scheduleBlocks.set(block.id, block);
    return block;
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
    user.profile.plan = plan;
    return buildTenantSummary(user);
  },

  updateTenantRole(userId: string, appRole: AppRole): BuilderTenantSummary {
    const user = db.users.get(userId);
    if (!user) throw new Error('Organiser account not found.');
    user.profile.appRole = appRole;
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
