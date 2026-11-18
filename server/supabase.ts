import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import type {
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

export function getSupabaseConfig() {
  const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim();
  const anonKey = (
    process.env.SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    ''
  ).trim();
  const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
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
  return createClient(url, anonKey, {
    auth: {
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
  return createClient(url, anonKey, {
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
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
  return createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}

export function mapProfileRow(row: Record<string, unknown>, fallbackEmail = ''): OrganizerProfile {
  const name = String(row.name ?? 'Organiser');
  return {
    name,
    firstName: String(row.first_name ?? (name.split(' ')[0] || 'Organiser')),
    role: String(row.role ?? 'Lead Organiser'),
    email: String(row.email ?? fallbackEmail),
    studio: String(row.studio ?? 'Events Studio'),
    plan: (row.plan as OrganizerProfile['plan']) || 'Starter',
    smsCredits: Number(row.sms_credits ?? 20),
    capacityAlertThreshold: Number(row.capacity_alert_threshold ?? 90),
    avatarUrl: row.avatar_url != null ? String(row.avatar_url) : undefined,
    replyToEmail: row.reply_to_email != null ? String(row.reply_to_email) : undefined,
    timezone: row.timezone != null ? String(row.timezone) : 'Africa/Accra',
    twoFactorEnabled: Boolean(row.two_factor_enabled ?? false),
    senderId: row.sender_id != null ? String(row.sender_id) : 'EVENTSAPP',
  };
}

export function mapEventRow(row: Record<string, unknown>): EventItem {
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
    broadcastError: row.broadcast_error != null ? String(row.broadcast_error) : undefined,
    flyerUrl: row.flyer_url != null ? String(row.flyer_url) : undefined,
    venueFormat:
      (row.venue_format as EventItem['venueFormat']) || 'in-person',
    senderId: row.sender_id != null ? String(row.sender_id) : undefined,
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
  const { data: existing, error: selectErr } = await client
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .maybeSingle();

  if (selectErr) {
    throw new Error(selectErr.message);
  }
  if (existing) {
    return mapProfileRow(existing as Record<string, unknown>, user.email ?? '');
  }

  const metaName =
    (typeof user.user_metadata?.name === 'string' && user.user_metadata.name.trim()) ||
    (typeof user.user_metadata?.full_name === 'string' && user.user_metadata.full_name.trim()) ||
    (user.email ? user.email.split('@')[0] : 'Organiser');

  const creatorEmail = (process.env.CREATOR_EMAIL || 'amoakoimml@gmail.com').trim().toLowerCase();
  const isPrimaryCreator = (user.email ?? '').trim().toLowerCase() === creatorEmail;

  const metaStudio =
    (typeof user.user_metadata?.studio === 'string' && user.user_metadata.studio.trim()) ||
    (isPrimaryCreator ? 'Apps Creator Console' : 'Events Studio');

  const insertPayload = {
    id: user.id,
    email: user.email ?? '',
    name: metaName,
    first_name: metaName.split(' ')[0] || 'Creator',
    role: isPrimaryCreator ? 'Apps Creator' : 'Lead Organiser',
    studio: metaStudio,
    plan: isPrimaryCreator ? 'Pro Organizer' : 'Starter',
    sms_credits: isPrimaryCreator ? 1840 : 20,
    capacity_alert_threshold: 90,
  };

  const { data: created, error: insertErr } = await client
    .from('profiles')
    .upsert(insertPayload, { onConflict: 'id' })
    .select('*')
    .single();

  if (insertErr) {
    throw new Error(insertErr.message);
  }

  return mapProfileRow(created as Record<string, unknown>, user.email ?? '');
}
