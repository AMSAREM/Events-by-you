import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import { normalizePhoneE164 } from '../src/data/initialData.ts';
import type {
  AppRole,
  Attendee,
  CreatorApp,
  CreatorAppLog,
  DisposableRollSettings,
  DisposableShot,
  EventItem,
  OrganizerProfile,
  ScheduleBlock,
  SystemAlert,
} from '../src/types/events.ts';
import { isSyntheticPhoneEmail } from './phoneAuth.ts';
import { normalizeHexColor } from '../src/lib/themeColors.ts';

function cleanEnvValue(raw: string | undefined): string {
  if (!raw) return '';
  return raw.trim().replace(/^['"]|['"]$/g, '').trim();
}

function isNewFormatSupabaseKey(key: string): boolean {
  return key.startsWith('sb_publishable_') || key.startsWith('sb_secret_');
}

function createSupabaseSafeFetch(apiKey: string): typeof fetch | undefined {
  if (!isNewFormatSupabaseKey(apiKey)) return undefined;
  return async (input, init) => {
    const headers = new Headers(init?.headers);
    const authHeader = headers.get('Authorization') || headers.get('authorization');
    if (authHeader && authHeader.trim() === `Bearer ${apiKey}`) {
      headers.delete('Authorization');
      headers.delete('authorization');
    }
    if (!headers.has('apikey')) {
      headers.set('apikey', apiKey);
    }
    return fetch(input, { ...init, headers });
  };
}

export function getSupabaseConfig() {
  const url = cleanEnvValue(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL);
  const anonKey = cleanEnvValue(
    process.env.SUPABASE_ANON_KEY ||
      process.env.VITE_SUPABASE_ANON_KEY ||
      process.env.SUPABASE_PUBLISHABLE_KEY ||
      process.env.VITE_SUPABASE_PUBLISHABLE_KEY
  );
  const serviceRoleKey = cleanEnvValue(
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY
  );
  return { url, anonKey, serviceRoleKey };
}

export function isSupabaseConfigured(): boolean {
  const { url, anonKey } = getSupabaseConfig();
  return Boolean(url && anonKey);
}

export function createPublicSupabaseClient(): SupabaseClient {
  const { url, anonKey } = getSupabaseConfig();
  if (!url || !anonKey) {
    throw new Error(
      'Supabase is not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY in your environment.'
    );
  }
  const safeFetch = createSupabaseSafeFetch(anonKey);
  return createClient(url, anonKey, {
    ...(safeFetch ? { global: { fetch: safeFetch } } : {}),
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}

export function createImplicitSupabaseClient(): SupabaseClient {
  const { url, anonKey } = getSupabaseConfig();
  if (!url || !anonKey) {
    throw new Error(
      'Supabase is not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY in your environment.'
    );
  }
  const safeFetch = createSupabaseSafeFetch(anonKey);
  return createClient(url, anonKey, {
    ...(safeFetch ? { global: { fetch: safeFetch } } : {}),
    auth: {
      flowType: 'implicit',
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}

export function createUserSupabaseClient(accessToken: string): SupabaseClient {
  const { url, anonKey } = getSupabaseConfig();
  if (!url || !anonKey) {
    throw new Error(
      'Supabase is not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY in your environment.'
    );
  }
  const cleanToken = accessToken
    .trim()
    .replace(/^['"]|['"]$/g, '')
    .replace(/^Bearer\s+/i, '')
    .trim();
  const safeFetch = createSupabaseSafeFetch(anonKey);
  return createClient(url, anonKey, {
    global: {
      ...(safeFetch ? { fetch: safeFetch } : {}),
      headers: {
        Authorization: `Bearer ${cleanToken}`,
      },
    },
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}

export function createServiceSupabaseClient(): SupabaseClient | null {
  const { url, serviceRoleKey } = getSupabaseConfig();
  if (!url || !serviceRoleKey) return null;
  const safeFetch = createSupabaseSafeFetch(serviceRoleKey);
  return createClient(url, serviceRoleKey, {
    ...(safeFetch ? { global: { fetch: safeFetch } } : {}),
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}

export function mapProfileRow(row: Record<string, unknown>, fallbackEmail = ''): OrganizerProfile {
  const name = String(row.name ?? 'Organiser');
  const rawEmail = String(row.email ?? fallbackEmail ?? '');
  const email = isSyntheticPhoneEmail(rawEmail) ? '' : rawEmail;
  const phone = row.phone != null && String(row.phone).trim() ? String(row.phone).trim() : undefined;
  const phoneVerified = Boolean(row.phone_verified ?? false);
  const creatorEmail = (process.env.CREATOR_EMAIL || 'amoakoimml@gmail.com').trim().toLowerCase();
  const creatorPhone = (process.env.CREATOR_PHONE || '').trim()
    ? normalizePhoneE164((process.env.CREATOR_PHONE || '').trim())
    : '';
  const isCreatorEmail = Boolean(email) && email.trim().toLowerCase() === creatorEmail;
  const isCreatorPhone = Boolean(creatorPhone && phone && normalizePhoneE164(phone) === creatorPhone);
  const isPrimaryCreator = isCreatorEmail || isCreatorPhone;
  const rawAppRole = row.app_role != null ? String(row.app_role) : undefined;
  const appRole: AppRole = isPrimaryCreator
    ? 'creator'
    : rawAppRole === 'gate_staff'
      ? 'gate_staff'
      : 'organizer';
  return {
    name,
    firstName: String(row.first_name ?? (name.split(' ')[0] || 'Organiser')),
    role: String(row.role ?? (appRole === 'creator' ? 'Apps Creator' : appRole === 'gate_staff' ? 'Gate Check-In Staff' : 'Lead Organiser')),
    appRole,
    email,
    phone,
    phoneVerified,
    studio: String(row.studio ?? 'Events Studio'),
    plan: (row.plan as OrganizerProfile['plan']) || 'Starter',
    planBillingCycle:
      row.plan_billing_cycle === 'annual' || row.plan_billing_cycle === 'monthly'
        ? row.plan_billing_cycle
        : undefined,
    planExpiresAt: row.plan_expires_at != null ? String(row.plan_expires_at) : undefined,
    smsCredits: Number(row.sms_credits ?? 0),
    capacityAlertThreshold: Number(row.capacity_alert_threshold ?? 90),
    avatarUrl: row.avatar_url != null ? String(row.avatar_url) : undefined,
    replyToEmail: row.reply_to_email != null ? String(row.reply_to_email) : undefined,
    timezone: row.timezone != null ? String(row.timezone) : 'Africa/Accra',
    twoFactorEnabled: Boolean(row.two_factor_enabled ?? false),
    senderId: row.sender_id != null ? String(row.sender_id) : 'EVENTSAPP',
  };
}

export function extractEventAttendeeMetaMap(
  rawExtraConfig: unknown
): Record<string, { validationGroup?: string; inviteCodeUsed?: string; giftEntry?: Attendee['giftEntry']; customResponses?: Record<string, string> }> {
  if (!rawExtraConfig || typeof rawExtraConfig !== 'object') return {};
  const map = (rawExtraConfig as Record<string, unknown>).__attendeeMeta;
  if (!map || typeof map !== 'object') return {};
  return map as Record<
    string,
    {
      validationGroup?: string;
      inviteCodeUsed?: string;
      giftEntry?: Attendee['giftEntry'];
      customResponses?: Record<string, string>;
    }
  >;
}

export function extractEventShotShootersMap(rawExtraConfig: unknown): Record<string, string> {
  if (!rawExtraConfig || typeof rawExtraConfig !== 'object') return {};
  const map = (rawExtraConfig as Record<string, unknown>).__shotShooters;
  if (!map || typeof map !== 'object') return {};
  return map as Record<string, string>;
}

export function mapEventRow(row: Record<string, unknown>): EventItem {
  const rawExtraObj =
    row.extra_data_config && typeof row.extra_data_config === 'object'
      ? ({ ...(row.extra_data_config as Record<string, unknown>) })
      : undefined;
  const embeddedMessageConfig =
    rawExtraObj?.__messageConfig && typeof rawExtraObj.__messageConfig === 'object'
      ? (rawExtraObj.__messageConfig as EventItem['messageConfig'])
      : undefined;

  if (rawExtraObj) {
    delete rawExtraObj.__messageConfig;
    delete rawExtraObj.__attendeeMeta;
    delete rawExtraObj.__shotShooters;
  }

  const rawExtra = rawExtraObj as EventItem['extraDataConfig'] | undefined;
  const resolvedBrandColor = normalizeHexColor(
    row.brand_color != null ? String(row.brand_color) : rawExtra?.brandColor
  );

  return {
    id: String(row.id),
    slug: String(row.slug),
    title: String(row.title),
    subtitle: String(row.subtitle ?? ''),
    category: String(row.category ?? 'Events'),
    status: (row.status as EventItem['status']) || 'upcoming',
    date: String(row.date),
    isoDate: String(row.iso_date),
    time: String(row.time),
    venue: String(row.venue),
    city: String(row.city),
    capacity: Number(row.capacity ?? 100),
    registered: Number(row.registered ?? 0),
    checkedIn: Number(row.checked_in ?? 0),
    smsDispatched: Number(row.sms_dispatched ?? 0),
    ticketPrice: Number(row.ticket_price ?? 0),
    revenue: Number(row.revenue ?? 0),
    organizer: String(row.organizer ?? 'Organiser'),
    artwork: (row.artwork as EventItem['artwork']) || 'architecture',
    designTheme: (row.design_theme as EventItem['designTheme']) || undefined,
    brandColor: resolvedBrandColor,
    broadcastError: row.broadcast_error != null ? String(row.broadcast_error) : undefined,
    flyerUrl: row.flyer_url != null ? String(row.flyer_url) : undefined,
    venueFormat:
      (row.venue_format as EventItem['venueFormat']) || 'in-person',
    senderId: row.sender_id != null ? String(row.sender_id) : undefined,
    qrPassPublished:
      row.qr_pass_published !== undefined
        ? Boolean(row.qr_pass_published)
        : (row.status as EventItem['status']) !== 'draft',
    validationConfig:
      row.validation_config && typeof row.validation_config === 'object'
        ? (row.validation_config as EventItem['validationConfig'])
        : undefined,
    extraDataConfig: rawExtra,
    messageConfig:
      row.message_config && typeof row.message_config === 'object'
        ? (row.message_config as EventItem['messageConfig'])
        : embeddedMessageConfig,
  };
}

export function mapAttendeeRow(row: Record<string, unknown>): Attendee {
  return {
    id: String(row.id),
    name: String(row.name),
    email: String(row.email),
    phone: String(row.phone),
    organization: String(row.organization ?? 'General Guest'),
    eventId: String(row.event_id),
    tier: (row.tier as Attendee['tier']) || 'General',
    checkedIn: Boolean(row.checked_in),
    checkedInAt: row.checked_in_at != null ? String(row.checked_in_at) : undefined,
    ticketCode: String(row.ticket_code),
    smsStatus: (row.sms_status as Attendee['smsStatus']) || 'Arkesel Sent',
    paymentStatus: (row.payment_status as Attendee['paymentStatus']) || 'paid',
    validationGroup: row.validation_group != null ? String(row.validation_group) : undefined,
    inviteCodeUsed: row.invite_code_used != null ? String(row.invite_code_used) : undefined,
    giftEntry:
      row.gift_entry && typeof row.gift_entry === 'object'
        ? (row.gift_entry as Attendee['giftEntry'])
        : undefined,
    customResponses:
      row.custom_responses && typeof row.custom_responses === 'object'
        ? (row.custom_responses as Record<string, string>)
        : undefined,
  };
}

export function mapScheduleRow(row: Record<string, unknown>): ScheduleBlock {
  return {
    id: String(row.id),
    eventId: String(row.event_id),
    time: String(row.time),
    duration: String(row.duration),
    title: String(row.title),
    stage: String(row.stage),
    lead: String(row.lead),
    completed: Boolean(row.completed),
    day: (row.day as ScheduleBlock['day']) || 'Sat',
  };
}

export function mapAlertRow(row: Record<string, unknown>): SystemAlert {
  return {
    id: String(row.id),
    title: String(row.title),
    detail: String(row.detail),
    category: (row.category as SystemAlert['category']) || 'capacity',
    eventId: row.event_id != null ? String(row.event_id) : undefined,
    timestamp: String(row.timestamp ?? 'Just now'),
    resolved: Boolean(row.resolved),
  };
}

export function mapShotRow(row: Record<string, unknown>): DisposableShot {
  return {
    id: String(row.id),
    eventId: String(row.event_id),
    frameNumber: Number(row.frame_number ?? 1),
    dataUrl: String(row.data_url),
    capturedBy: String(row.captured_by ?? 'Guest'),
    shooterKey: row.shooter_key != null ? String(row.shooter_key) : undefined,
    caption: row.caption != null ? String(row.caption) : undefined,
    filmStock: (row.film_stock as DisposableShot['filmStock']) || 'ilford-bw',
    dateStamp: String(row.date_stamp ?? ''),
    capturedAt: String(row.captured_at ?? ''),
    developed: Boolean(row.developed ?? true),
    likes: Number(row.likes ?? 0),
    liked: Boolean(row.liked ?? false),
  };
}

export function mapRollSettingsRow(row: Record<string, unknown>): DisposableRollSettings {
  const limit = Number(row.exposures_limit ?? 24);
  return {
    exposuresLimit: limit === 12 || limit === 36 ? limit : 24,
    darkroomMode: Boolean(row.darkroom_mode ?? false),
  };
}

export function mapCreatorAppRow(row: Record<string, unknown>): CreatorApp {
  return {
    id: String(row.id),
    name: String(row.name),
    slug: String(row.slug ?? ''),
    description: String(row.description ?? ''),
    appType: (row.app_type as CreatorApp['appType']) || 'widget',
    environment: (row.environment as CreatorApp['environment']) || 'sandbox',
    status: (row.status as CreatorApp['status']) || 'active',
    eventId: row.event_id != null ? String(row.event_id) : undefined,
    clientId: String(row.client_id),
    secretPrefix: String(row.secret_prefix ?? 'ev_sec_••••'),
    scopes: Array.isArray(row.scopes)
      ? (row.scopes as CreatorApp['scopes'])
      : ['events:read', 'attendees:read'],
    webhookUrl: row.webhook_url != null ? String(row.webhook_url) : undefined,
    webhookEvents: Array.isArray(row.webhook_events)
      ? (row.webhook_events as CreatorApp['webhookEvents'])
      : [],
    allowedOrigins: Array.isArray(row.allowed_origins)
      ? (row.allowed_origins as string[])
      : [],
    requestsCount: Number(row.requests_count ?? 0),
    lastUsedAt: row.last_used_at != null ? String(row.last_used_at) : undefined,
    createdAt: String(row.created_at ?? new Date().toISOString()),
  };
}

export function mapCreatorAppLogRow(row: Record<string, unknown>): CreatorAppLog {
  return {
    id: String(row.id),
    appId: String(row.app_id),
    eventType: String(row.event_type),
    method: String(row.method ?? 'POST'),
    endpoint: String(row.endpoint ?? '/'),
    statusCode: Number(row.status_code ?? 200),
    latencyMs: Number(row.latency_ms ?? 0),
    requestSummary: String(row.request_summary ?? ''),
    responseSummary: String(row.response_summary ?? ''),
    createdAt: String(row.created_at ?? new Date().toISOString()),
  };
}

export async function ensureProfileRow(
  client: SupabaseClient,
  user: User
): Promise<OrganizerProfile> {
  const phoneExplicitlyCleared = user.user_metadata?.phone === null;
  const rawUserPhone = phoneExplicitlyCleared
    ? ''
    : (typeof user.user_metadata?.phone === 'string' && user.user_metadata.phone.trim()) ||
      (typeof user.phone === 'string' && user.phone.trim()) ||
      '';
  const resolvedPhone = rawUserPhone ? normalizePhoneE164(rawUserPhone) : '';
  const resolvedPhoneVerified = phoneExplicitlyCleared
    ? false
    : Boolean(user.phone_confirmed_at || user.user_metadata?.phone_verified);

  const { data: existing, error: selectErr } = await client
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .maybeSingle();

  if (selectErr) {
    throw new Error(selectErr.message);
  }
  if (existing) {
    const existingRec = existing as Record<string, unknown>;
    const mapped = mapProfileRow(existingRec, user.email ?? '');
    if (resolvedPhone && !mapped.phone) {
      mapped.phone = resolvedPhone;
    }
    if (resolvedPhoneVerified && !mapped.phoneVerified) {
      mapped.phoneVerified = true;
    }
    return mapped;
  }

  const metaName =
    (typeof user.user_metadata?.name === 'string' && user.user_metadata.name.trim()) ||
    (typeof user.user_metadata?.full_name === 'string' && user.user_metadata.full_name.trim()) ||
    (user.email && !isSyntheticPhoneEmail(user.email) ? user.email.split('@')[0] : 'Organiser');

  const creatorEmail = (process.env.CREATOR_EMAIL || 'amoakoimml@gmail.com').trim().toLowerCase();
  const creatorPhone = (process.env.CREATOR_PHONE || '').trim()
    ? normalizePhoneE164((process.env.CREATOR_PHONE || '').trim())
    : '';
  const isPrimaryCreator =
    (user.email ?? '').trim().toLowerCase() === creatorEmail ||
    Boolean(creatorPhone && resolvedPhone && resolvedPhone === creatorPhone);

  const metaStudio =
    (typeof user.user_metadata?.studio === 'string' && user.user_metadata.studio.trim()) ||
    (isPrimaryCreator ? 'Apps Creator Console' : 'Events Studio');

  const requestedAppRole =
    !isPrimaryCreator && user.user_metadata?.app_role === 'gate_staff'
      ? 'gate_staff'
      : isPrimaryCreator
        ? 'creator'
        : 'organizer';

  const metaAvatar =
    (typeof user.user_metadata?.avatar_url === 'string' && user.user_metadata.avatar_url.trim()) ||
    (typeof user.user_metadata?.picture === 'string' && user.user_metadata.picture.trim()) ||
    undefined;

  const insertPayload: Record<string, unknown> = {
    id: user.id,
    email: user.email ?? '',
    phone: resolvedPhone || null,
    phone_verified: resolvedPhoneVerified,
    name: metaName,
    first_name: metaName.split(' ')[0] || 'Creator',
    role:
      requestedAppRole === 'creator'
        ? 'Apps Creator'
        : requestedAppRole === 'gate_staff'
          ? 'Gate Check-In Staff'
          : 'Lead Organiser',
    app_role: requestedAppRole,
    studio: metaStudio,
    plan: isPrimaryCreator ? 'Pro Organizer' : 'Starter',
    sms_credits: 0,
    capacity_alert_threshold: 90,
    ...(metaAvatar ? { avatar_url: metaAvatar } : {}),
  };

  let { data: created, error: insertErr } = await client
    .from('profiles')
    .upsert(insertPayload, { onConflict: 'id' })
    .select('*')
    .single();

  if (
    insertErr &&
    (insertErr.message?.toLowerCase().includes('app_role') ||
      insertErr.message?.toLowerCase().includes('phone'))
  ) {
    const fallbackPayload = { ...insertPayload };
    if (insertErr.message?.toLowerCase().includes('app_role')) {
      delete fallbackPayload.app_role;
    }
    if (insertErr.message?.toLowerCase().includes('phone')) {
      delete fallbackPayload.phone;
      delete fallbackPayload.phone_verified;
    }
    const retry = await client
      .from('profiles')
      .upsert(fallbackPayload, { onConflict: 'id' })
      .select('*')
      .single();
    created = retry.data;
    insertErr = retry.error;
  }

  if (insertErr) {
    throw new Error(insertErr.message);
  }

  const mapped = mapProfileRow(created as Record<string, unknown>, user.email ?? '');
  if (resolvedPhone && !mapped.phone) mapped.phone = resolvedPhone;
  if (resolvedPhoneVerified && !mapped.phoneVerified) mapped.phoneVerified = true;
  return mapped;
}

export async function findSupabaseUserByPhone(
  svc: SupabaseClient,
  normalizedPhone: string
): Promise<User | null> {
  try {
    const { data: prof } = await svc
      .from('profiles')
      .select('id')
      .eq('phone', normalizedPhone)
      .maybeSingle();
    const profId = (prof as Record<string, unknown> | null)?.id;
    if (typeof profId === 'string' && profId) {
      const { data: userRes } = await svc.auth.admin.getUserById(profId);
      if (userRes?.user) return userRes.user;
    }
  } catch {
    // Ignore if phone column is not yet present on remote profiles table
  }

  for (let page = 1; page <= 5; page += 1) {
    const { data: listData, error } = await svc.auth.admin.listUsers({
      page,
      perPage: 200,
    });
    if (error || !listData?.users?.length) break;
    const match = listData.users.find((u) => {
      const authPhone = u.phone ? normalizePhoneE164(u.phone) : '';
      const metaPhone =
        typeof u.user_metadata?.phone === 'string' && u.user_metadata.phone.trim()
          ? normalizePhoneE164(u.user_metadata.phone)
          : '';
      return authPhone === normalizedPhone || metaPhone === normalizedPhone;
    });
    if (match) return match;
    if (listData.users.length < 200) break;
  }

  return null;
}

export async function findSupabaseUserByEmail(
  svc: SupabaseClient,
  emailInput: string
): Promise<User | null> {
  const target = emailInput.trim().toLowerCase();
  if (!target) return null;

  try {
    const { data: prof } = await svc
      .from('profiles')
      .select('id')
      .ilike('email', target)
      .maybeSingle();
    const profId = (prof as Record<string, unknown> | null)?.id;
    if (typeof profId === 'string' && profId) {
      const { data: userRes } = await svc.auth.admin.getUserById(profId);
      if (userRes?.user) return userRes.user;
    }
  } catch {
    // Fallback to admin user scan below
  }

  for (let page = 1; page <= 5; page += 1) {
    const { data: listData, error } = await svc.auth.admin.listUsers({
      page,
      perPage: 200,
    });
    if (error || !listData?.users?.length) break;
    const match = listData.users.find((u) => (u.email || '').trim().toLowerCase() === target);
    if (match) return match;
    if (listData.users.length < 200) break;
  }

  return null;
}

export async function resolveSupabaseUserContacts(
  svc: SupabaseClient,
  user: User
): Promise<{ phone?: string; email?: string; name?: string }> {
  let phone =
    (typeof user.phone === 'string' && user.phone.trim() ? normalizePhoneE164(user.phone) : '') ||
    (typeof user.user_metadata?.phone === 'string' && user.user_metadata.phone.trim()
      ? normalizePhoneE164(user.user_metadata.phone)
      : '');
  let email =
    user.email && !isSyntheticPhoneEmail(user.email) ? user.email.trim().toLowerCase() : '';
  let name =
    typeof user.user_metadata?.name === 'string' && user.user_metadata.name.trim()
      ? user.user_metadata.name.trim()
      : undefined;

  if (!phone || !email || !name) {
    try {
      const { data: prof } = await svc
        .from('profiles')
        .select('phone, email, name')
        .eq('id', user.id)
        .maybeSingle();
      if (prof) {
        const rec = prof as Record<string, unknown>;
        if (!phone && typeof rec.phone === 'string' && rec.phone.trim()) {
          phone = normalizePhoneE164(rec.phone);
        }
        if (!email && typeof rec.email === 'string' && rec.email.trim() && !isSyntheticPhoneEmail(rec.email)) {
          email = rec.email.trim().toLowerCase();
        }
        if (!name && typeof rec.name === 'string' && rec.name.trim()) {
          name = rec.name.trim();
        }
      }
    } catch {
      // Ignore schema differences
    }
  }

  return {
    phone: phone || undefined,
    email: email || undefined,
    name,
  };
}

