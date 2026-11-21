import 'dotenv/config';
import crypto from 'node:crypto';
import http from 'node:http';
import express, { type NextFunction, type Request, type Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import {
  createPublicSupabaseClient,
  createServiceSupabaseClient,
  createUserSupabaseClient,
  ensureProfileRow,
  extractEventAttendeeMetaMap,
  extractEventShotShootersMap,
  findSupabaseUserByEmail,
  findSupabaseUserByPhone,
  isSupabaseConfigured,
  mapAlertRow,
  mapAttendeeRow,
  mapCreatorAppLogRow,
  mapCreatorAppRow,
  mapEventRow,
  mapProfileRow,
  mapRollSettingsRow,
  mapScheduleRow,
  mapShotRow,
  resolveSupabaseUserContacts,
} from './server/supabase.ts';
import { normalizeHexColor } from './src/lib/themeColors.ts';
import {
  INITIAL_ALERTS,
  INITIAL_ATTENDEES,
  INITIAL_DISPOSABLE_SHOTS,
  INITIAL_EVENTS,
  INITIAL_ROLL_SETTINGS,
  INITIAL_SCHEDULE,
  normalizePhoneE164,
  validateStrictEmail,
  validateStrictPassword,
  validateStrictPhoneE164,
} from './src/data/initialData.ts';
import type {
  AppRole,
  Attendee,
  CreatorApp,
  CreatorAppLog,
  DisposableRollSettings,
  DisposableShot,
  EventItem,
  GiftTableAttendantLink,
  GiftTableEntry,
  OrganizerProfile,
  ScheduleBlock,
} from './src/types/events.ts';
import {
  dispatchOptionalArkeselSms,
  getBearerToken,
  getCreatorCredentials,
  requireCreatorVerification,
  requireRole,
  requireVerifiedPhoneIfSet,
  safeTimingEqual,
  signCreatorSessionToken,
  type AuthedRequest,
} from './server/helpers.ts';
import { buildEventOgSvg, injectEventMetaTags } from './server/ogImage.ts';
import {
  isResendConfigured,
  sendAuthOtpEmail,
  sendCheckInWelcomeEmail,
  sendEventPassEmail,
} from './server/resend.ts';
import { MAX_SHOTS_PER_USER, resolveEventMessage } from './src/lib/eventMessages.ts';
import {
  buildSyntheticPhoneEmail,
  clearPendingSignup,
  consumePendingSignup,
  dispatchDualAuthChallenge,
  fetchArkeselGatewayBalance,
  getPendingSignup,
  handleArkeselDlrPayload,
  hasActiveAuthChallenge,
  isArkeselConfigured,
  isSyntheticPhoneEmail,
  sendArkeselSmsOtp,
  stagePendingSignup,
  verifyAuthOtp,
} from './server/phoneAuth.ts';
import { createMemoryRouter } from './server/memoryRoutes.ts';
import { createBuilderRouter } from './server/builderRoutes.ts';
import { memoryStore, platformRuntime } from './server/memoryStore.ts';

function formatSupabaseEmailError(message: string, hasServiceRole: boolean): { status: number; error: string } {
  const lower = message.toLowerCase();
  if (lower.includes('rate limit') || lower.includes('over_email_send_rate_limit')) {
    if (!isResendConfigured()) {
      return {
        status: 429,
        error:
          'Supabase email rate limit exceeded (~2 emails/hr on default SMTP). Add RESEND_API_KEY and SUPABASE_SERVICE_ROLE_KEY in environment Secrets (or configure Resend SMTP in Supabase Auth Settings) to send emails via Resend.',
      };
    }
    if (!hasServiceRole) {
      return {
        status: 429,
        error:
          'Supabase email rate limit exceeded on client-side SMTP. Add SUPABASE_SERVICE_ROLE_KEY to environment Secrets so the server can route auth emails directly through Resend without Supabase limits.',
      };
    }
    return {
      status: 429,
      error: 'Email rate limit exceeded. Please wait a moment and try again.',
    };
  }
  return { status: 400, error: message };
}

function sha256Hex(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function generateAppSecret(env: 'sandbox' | 'production'): {
  rawSecret: string;
  secretHash: string;
  secretPrefix: string;
} {
  const token = crypto.randomBytes(20).toString('hex');
  const rawSecret = `${env === 'production' ? 'ev_live_sec_' : 'ev_test_sec_'}${token}`;
  return {
    rawSecret,
    secretHash: sha256Hex(rawSecret),
    secretPrefix: `${rawSecret.slice(0, 16)}••••••••${rawSecret.slice(-4)}`,
  };
}

function generateClientId(env: 'sandbox' | 'production'): string {
  return `${env === 'production' ? 'ev_live_' : 'ev_test_'}${crypto.randomBytes(10).toString('hex')}`;
}

function generateWebhookSecret(): string {
  return `whsec_${crypto.randomBytes(18).toString('hex')}`;
}

function isMissingTableError(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false;
  return (
    err.code === '42P01' ||
    err.code === 'PGRST205' ||
    Boolean(err.message && err.message.toLowerCase().includes('creator_app'))
  );
}

function isMissingColumnError(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false;
  const msg = (err.message || '').toLowerCase();
  return (
    err.code === 'PGRST204' ||
    err.code === '42703' ||
    msg.includes('column') ||
    msg.includes('schema cache')
  );
}

function stripOptionalEventColumns<T extends Record<string, unknown>>(
  row: T
): Omit<T, 'qr_pass_published' | 'design_theme' | 'validation_config' | 'extra_data_config' | 'message_config'> {
  const {
    qr_pass_published: _q,
    design_theme: _d,
    validation_config: _v,
    extra_data_config: _e,
    message_config: _m,
    ...legacy
  } = row;
  return legacy;
}

function withEmbeddedMessageConfig(
  extraDataConfig: EventItem['extraDataConfig'] | undefined,
  messageConfig: EventItem['messageConfig'] | undefined,
  brandColor?: string,
  existingRawExtra?: unknown
): Record<string, unknown> | null {
  const normalizedColor = normalizeHexColor(brandColor);
  const existingObj =
    existingRawExtra && typeof existingRawExtra === 'object'
      ? (existingRawExtra as Record<string, unknown>)
      : {};
  const hasIncomingExtra = Boolean(extraDataConfig && typeof extraDataConfig === 'object');
  if (!hasIncomingExtra && !messageConfig && !normalizedColor && Object.keys(existingObj).length === 0) {
    return null;
  }
  const base: Record<string, unknown> = hasIncomingExtra
    ? { ...(extraDataConfig as unknown as Record<string, unknown>) }
    : { ...existingObj };

  // Preserve server-managed or omitted collection fields so partial updates never wipe them
  if (existingObj.__attendeeMeta !== undefined) {
    base.__attendeeMeta = existingObj.__attendeeMeta;
  }
  if (existingObj.__shotShooters !== undefined) {
    base.__shotShooters = existingObj.__shotShooters;
  }
  if (hasIncomingExtra) {
    if ((extraDataConfig as EventItem['extraDataConfig'])?.giftLedger === undefined && existingObj.giftLedger !== undefined) {
      base.giftLedger = existingObj.giftLedger;
    }
    if ((extraDataConfig as EventItem['extraDataConfig'])?.attendantLinks === undefined && existingObj.attendantLinks !== undefined) {
      base.attendantLinks = existingObj.attendantLinks;
    }
  }
  if (messageConfig && typeof messageConfig === 'object') {
    base.__messageConfig = messageConfig;
  } else if (existingObj.__messageConfig !== undefined) {
    base.__messageConfig = existingObj.__messageConfig;
  }
  if (normalizedColor) {
    base.brandColor = normalizedColor;
  } else if (hasIncomingExtra && !(extraDataConfig as EventItem['extraDataConfig'])?.brandColor) {
    delete base.brandColor;
  }
  return base;
}

function hydrateAttendeeWithEventMeta(
  attendee: Attendee,
  metaMap?: Record<
    string,
    {
      validationGroup?: string;
      inviteCodeUsed?: string;
      giftEntry?: Attendee['giftEntry'];
      customResponses?: Record<string, string>;
    }
  >
): Attendee {
  const meta = metaMap?.[attendee.id];
  if (!meta) return attendee;
  return {
    ...attendee,
    validationGroup: attendee.validationGroup ?? meta.validationGroup,
    inviteCodeUsed: attendee.inviteCodeUsed ?? meta.inviteCodeUsed,
    giftEntry: attendee.giftEntry ?? meta.giftEntry,
    customResponses: attendee.customResponses ?? meta.customResponses,
  };
}

function hydrateShotWithEventMeta(
  shot: DisposableShot,
  shootersMap?: Record<string, string>
): DisposableShot {
  const fallbackKey = shootersMap?.[shot.id];
  if (shot.shooterKey || !fallbackKey) return shot;
  return { ...shot, shooterKey: fallbackKey };
}

async function mergeEventAttendeeMeta(
  client: SupabaseClient,
  eventId: string,
  attendeeId: string,
  meta: {
    validationGroup?: string;
    inviteCodeUsed?: string;
    giftEntry?: Attendee['giftEntry'];
    customResponses?: Record<string, string>;
  }
) {
  const hasAny =
    Boolean(meta.validationGroup) ||
    Boolean(meta.inviteCodeUsed) ||
    Boolean(meta.giftEntry) ||
    Boolean(meta.customResponses && Object.keys(meta.customResponses).length > 0);
  if (!hasAny) return;
  try {
    const { data: rawRow } = await client
      .from('events')
      .select('extra_data_config')
      .eq('id', eventId)
      .maybeSingle();
    const currentExtra =
      rawRow && (rawRow as Record<string, unknown>).extra_data_config &&
      typeof (rawRow as Record<string, unknown>).extra_data_config === 'object'
        ? ({ ...((rawRow as Record<string, unknown>).extra_data_config as Record<string, unknown>) })
        : {};
    const currentMap = extractEventAttendeeMetaMap(currentExtra);
    currentExtra.__attendeeMeta = {
      ...currentMap,
      [attendeeId]: {
        ...(meta.validationGroup ? { validationGroup: meta.validationGroup } : {}),
        ...(meta.inviteCodeUsed ? { inviteCodeUsed: meta.inviteCodeUsed } : {}),
        ...(meta.giftEntry ? { giftEntry: meta.giftEntry } : {}),
        ...(meta.customResponses && Object.keys(meta.customResponses).length > 0
          ? { customResponses: meta.customResponses }
          : {}),
      },
    };
    await client.from('events').update({ extra_data_config: currentExtra }).eq('id', eventId);
  } catch {
    // Non-fatal fallback
  }
}

async function mergeEventShotShooter(
  client: SupabaseClient,
  eventId: string,
  shotId: string,
  shooterKey: string
) {
  if (!shooterKey.trim()) return;
  try {
    const { data: rawRow } = await client
      .from('events')
      .select('extra_data_config')
      .eq('id', eventId)
      .maybeSingle();
    const currentExtra =
      rawRow && (rawRow as Record<string, unknown>).extra_data_config &&
      typeof (rawRow as Record<string, unknown>).extra_data_config === 'object'
        ? ({ ...((rawRow as Record<string, unknown>).extra_data_config as Record<string, unknown>) })
        : {};
    const currentMap = extractEventShotShootersMap(currentExtra);
    currentExtra.__shotShooters = {
      ...currentMap,
      [shotId]: shooterKey.trim(),
    };
    await client.from('events').update({ extra_data_config: currentExtra }).eq('id', eventId);
  } catch {
    // Non-fatal fallback
  }
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function requireSupabaseConfiguredMiddleware(_req: Request, res: Response, next: NextFunction) {
  if (!isSupabaseConfigured()) {
    return res.status(503).json({
      error:
        'Supabase is not configured on this server. Set SUPABASE_URL and SUPABASE_ANON_KEY in your environment.',
      code: 'SUPABASE_NOT_CONFIGURED',
    });
  }
  return next();
}

async function requireSupabaseAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  if (!isSupabaseConfigured()) {
    return res.status(503).json({
      error:
        'Supabase is not configured on this server. Set SUPABASE_URL and SUPABASE_ANON_KEY in your environment.',
      code: 'SUPABASE_NOT_CONFIGURED',
    });
  }

  const token = getBearerToken(req);
  if (!token) {
    return res.status(401).json({ error: 'Authentication required. Please sign in.' });
  }

  try {
    const publicClient = createPublicSupabaseClient();
    const { data, error } = await publicClient.auth.getUser(token);
    if (error || !data.user) {
      return res.status(401).json({ error: error?.message || 'Session expired. Please sign in again.' });
    }
    req.accessToken = token;
    req.user = data.user;
    req.supabase = createUserSupabaseClient(token);
    let prof: Record<string, unknown> | null = null;
    const profRes = await req.supabase
      .from('profiles')
      .select('app_role, phone, phone_verified')
      .eq('id', data.user.id)
      .maybeSingle();
    if (!profRes.error) {
      prof = profRes.data as Record<string, unknown> | null;
    } else {
      const legacyRes = await req.supabase
        .from('profiles')
        .select('app_role')
        .eq('id', data.user.id)
        .maybeSingle();
      prof = legacyRes.data as Record<string, unknown> | null;
    }
    const dbRole = prof?.app_role;
    if (dbRole === 'creator' || dbRole === 'organizer' || dbRole === 'gate_staff') {
      req.appRole = dbRole;
    }
    const rawPhone =
      (typeof prof?.phone === 'string' && prof.phone.trim()) ||
      (typeof data.user.phone === 'string' && data.user.phone.trim()) ||
      (typeof data.user.user_metadata?.phone === 'string' && data.user.user_metadata.phone.trim()) ||
      '';
    if (rawPhone) {
      req.userPhone = normalizePhoneE164(rawPhone);
      req.phoneVerified = Boolean(
        prof?.phone_verified ||
          data.user.phone_confirmed_at ||
          data.user.user_metadata?.phone_verified
      );
    }
    return next();
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unable to verify session';
    return res.status(401).json({ error: message });
  }
}

async function loadOrganizerWorkspace(client: SupabaseClient, user: User) {
  const profile = await ensureProfileRow(client, user);

  const { data: eventRows, error: eventsErr } = await client
    .from('events')
    .select('*')
    .eq('organizer_id', user.id)
    .order('created_at', { ascending: false });

  if (eventsErr) throw new Error(eventsErr.message);

  const attendeeMetaByEvent = new Map<string, ReturnType<typeof extractEventAttendeeMetaMap>>();
  const shotShootersByEvent = new Map<string, Record<string, string>>();
  for (const row of eventRows ?? []) {
    const rec = row as Record<string, unknown>;
    const evtId = String(rec.id);
    attendeeMetaByEvent.set(evtId, extractEventAttendeeMetaMap(rec.extra_data_config));
    shotShootersByEvent.set(evtId, extractEventShotShootersMap(rec.extra_data_config));
  }

  const events = (eventRows ?? []).map((r) => mapEventRow(r as Record<string, unknown>));
  const eventIds = events.map((e) => e.id);

  const { data: alertRows, error: alertsErr } = await client
    .from('system_alerts')
    .select('*')
    .eq('organizer_id', user.id)
    .order('created_at', { ascending: false });

  if (alertsErr) throw new Error(alertsErr.message);
  const alerts = (alertRows ?? []).map((r) => mapAlertRow(r as Record<string, unknown>));

  const { data: appsData, error: appsErr } = await client
    .from('creator_apps')
    .select('*')
    .eq('organizer_id', user.id)
    .order('created_at', { ascending: false });

  let creatorApps: CreatorApp[] = [];
  let creatorAppLogs: CreatorAppLog[] = [];

  if (!appsErr && appsData) {
    creatorApps = appsData.map((r) => mapCreatorAppRow(r as Record<string, unknown>));
    const appIds = creatorApps.map((a) => a.id);
    if (appIds.length > 0) {
      const { data: logsData, error: logsErr } = await client
        .from('creator_app_logs')
        .select('*')
        .in('app_id', appIds)
        .order('created_at', { ascending: false })
        .limit(100);
      if (!logsErr && logsData) {
        creatorAppLogs = logsData.map((r) => mapCreatorAppLogRow(r as Record<string, unknown>));
      }
    }
  } else if (appsErr && !isMissingTableError(appsErr)) {
    throw new Error(appsErr.message);
  }

  if (eventIds.length === 0) {
    return {
      profile,
      events,
      attendees: [] as Attendee[],
      scheduleBlocks: [] as ScheduleBlock[],
      alerts,
      disposableShots: [] as DisposableShot[],
      rollSettings: {} as Record<string, DisposableRollSettings>,
      creatorApps,
      creatorAppLogs,
    };
  }

  const [attRes, schRes, shotRes, rollRes] = await Promise.all([
    client.from('attendees').select('*').in('event_id', eventIds).order('created_at', { ascending: false }),
    client.from('schedule_blocks').select('*').in('event_id', eventIds).order('created_at', { ascending: true }),
    client.from('disposable_shots').select('*').in('event_id', eventIds).order('created_at', { ascending: false }),
    client.from('disposable_roll_settings').select('*').in('event_id', eventIds),
  ]);

  if (attRes.error) throw new Error(attRes.error.message);
  if (schRes.error) throw new Error(schRes.error.message);
  if (shotRes.error) throw new Error(shotRes.error.message);
  if (rollRes.error) throw new Error(rollRes.error.message);

  const attendees = (attRes.data ?? []).map((r) => {
    const mapped = mapAttendeeRow(r as Record<string, unknown>);
    return hydrateAttendeeWithEventMeta(mapped, attendeeMetaByEvent.get(mapped.eventId));
  });
  const scheduleBlocks = (schRes.data ?? []).map((r) => mapScheduleRow(r as Record<string, unknown>));
  const disposableShots = (shotRes.data ?? []).map((r) => {
    const mapped = mapShotRow(r as Record<string, unknown>);
    return hydrateShotWithEventMeta(mapped, shotShootersByEvent.get(mapped.eventId));
  });

  const rollSettings: Record<string, DisposableRollSettings> = {};
  for (const row of rollRes.data ?? []) {
    const rec = row as Record<string, unknown>;
    rollSettings[String(rec.event_id)] = mapRollSettingsRow(rec);
  }

  return {
    profile,
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

export async function createExpressApp(options?: { serverless?: boolean; httpServer?: http.Server }) {
  const app = express();
  app.set('trust proxy', 1);
  const jsonParser = express.json({ limit: '15mb' });
  app.use((req, res, next) => {
    if (req.body !== undefined && typeof req.body === 'object' && req.readableEnded) {
      return next();
    }
    return jsonParser(req, res, next);
  });

  const configuredCorsOrigins = (process.env.CORS_ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter(Boolean);

  app.use('/api', (req, res, next) => {
    const origin = req.headers.origin;
    const appOrigin = (process.env.APP_URL || '').trim().replace(/\/+$/, '');
    const allowed =
      !origin ||
      configuredCorsOrigins.length === 0 ||
      configuredCorsOrigins.includes(origin) ||
      (appOrigin && origin === appOrigin);

    if (origin && allowed) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Creator-Token');
      res.setHeader('Access-Control-Max-Age', '86400');
    }
    if (req.method === 'OPTIONS') {
      return res.status(204).end();
    }
    if (!req.path.startsWith('/og/')) {
      res.setHeader('Cache-Control', 'no-store');
    }
    return next();
  });

  const resolveBaseUrl = (req: Request) => {
    if (process.env.APP_URL) return process.env.APP_URL.replace(/\/+$/, '');
    const proto = (req.headers['x-forwarded-proto'] as string) || req.protocol || 'https';
    const host = (req.headers['x-forwarded-host'] as string) || req.get('host') || 'www.eventsbyyou.xyz';
    if (host.includes('localhost') || host.includes('127.0.0.1')) {
      return 'https://www.eventsbyyou.xyz';
    }
    return `${proto}://${host}`.replace(/\/+$/, '');
  };

  app.get(['/robots.txt', '/robot.txt'], (req, res) => {
    const baseUrl = resolveBaseUrl(req);
    res.type('text/plain; charset=utf-8').send(
      [
        'User-agent: *',
        'Allow: /',
        'Allow: /terms',
        'Allow: /privacy',
        'Disallow: /api/',
        'Disallow: /studio',
        'Disallow: /camera',
        '',
        `Sitemap: ${baseUrl}/sitemap.xml`,
        '',
      ].join('\n')
    );
  });

  app.get('/sitemap.xml', async (req, res) => {
    const baseUrl = resolveBaseUrl(req);
    const today = new Date().toISOString().split('T')[0];

    let publicEvents: EventItem[] = [];
    try {
      if (isSupabaseConfigured()) {
        const svc = createServiceSupabaseClient() ?? createPublicSupabaseClient();
        const { data } = await svc
          .from('events')
          .select('*')
          .in('status', ['live', 'upcoming'])
          .order('iso_date', { ascending: true });
        publicEvents = (data ?? []).map((r) => mapEventRow(r as Record<string, unknown>));
      } else {
        publicEvents = memoryStore.getPublicEvents();
      }
    } catch {
      publicEvents = [];
    }

    const escapeXml = (str: string) =>
      str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');

    const staticPaths = [
      { path: '/', changefreq: 'daily', priority: '1.0' },
      { path: '/signin', changefreq: 'monthly', priority: '0.6' },
      { path: '/signup', changefreq: 'monthly', priority: '0.7' },
      { path: '/terms', changefreq: 'monthly', priority: '0.5' },
      { path: '/privacy', changefreq: 'monthly', priority: '0.5' },
    ];

    const urlEntries = [
      ...staticPaths.map(
        (u) => `  <url>\n    <loc>${escapeXml(baseUrl + u.path)}</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>${u.changefreq}</changefreq>\n    <priority>${u.priority}</priority>\n  </url>`
      ),
      ...publicEvents.map(
        (evt) =>
          `  <url>\n    <loc>${escapeXml(`${baseUrl}/?event=${encodeURIComponent(evt.slug || evt.id)}`)}</loc>\n    <lastmod>${escapeXml(evt.isoDate || today)}</lastmod>\n    <changefreq>daily</changefreq>\n    <priority>0.8</priority>\n  </url>`
      ),
    ];

    res
      .type('application/xml; charset=utf-8')
      .send(
        `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.w3.org/2000/svg" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">\n${urlEntries.join('\n')}\n</urlset>\n`.replace('xmlns="http://www.w3.org/2000/svg" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"', 'xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"')
      );
  });

  const resolveEventForPublicOrOg = async (slugOrId: string): Promise<EventItem | null> => {
    const target = slugOrId.trim();
    if (!target) return null;
    if (!isSupabaseConfigured()) {
      return memoryStore.getAnyEventBySlugOrId(target) ?? null;
    }
    try {
      const supabase = createServiceSupabaseClient() ?? createPublicSupabaseClient();
      const { data: bySlug } = await supabase
        .from('events')
        .select('*')
        .eq('slug', target)
        .maybeSingle();
      if (bySlug) return mapEventRow(bySlug as Record<string, unknown>);
      const { data: byId } = await supabase
        .from('events')
        .select('*')
        .eq('id', target)
        .maybeSingle();
      if (byId) return mapEventRow(byId as Record<string, unknown>);
    } catch {
      // Return null when lookup fails
    }
    return null;
  };

  app.get('/api/og/event/:slugOrId', async (req, res) => {
    const baseUrl = resolveBaseUrl(req);
    const evt = (await resolveEventForPublicOrOg(req.params.slugOrId)) ?? {
      id: 'events-app',
      slug: 'events-app',
      title: 'Events App',
      subtitle: 'Event Invitations, SMS Passes & Gate Check-In',
      category: 'Events',
      status: 'live' as const,
      date: 'Upcoming',
      isoDate: new Date().toISOString().slice(0, 10),
      time: '',
      venue: 'Event Venue',
      city: 'Accra',
      capacity: 100,
      registered: 0,
      checkedIn: 0,
      smsDispatched: 0,
      ticketPrice: 0,
      revenue: 0,
      organizer: 'Events App',
      artwork: 'architecture' as const,
    };
    const svg = buildEventOgSvg(evt, baseUrl);
    res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=300');
    return res.send(svg);
  });

  app.get('/api/health', (_req, res) => {
    const creator = getCreatorCredentials();
    const configured = isSupabaseConfigured();
    const serviceRoleConfigured = Boolean((process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim());
    const senderInfo = platformRuntime.getEffectiveArkeselSenderId();
    res.json({
      ok: true,
      architecture: 'hybrid',
      runtime: process.env.VERCEL || options?.serverless ? 'vercel-serverless' : 'node-server',
      database: configured ? 'supabase' : 'in-memory',
      otpStorage: configured && serviceRoleConfigured ? 'supabase' : 'in-memory',
      supabaseConfigured: configured,
      serviceRoleConfigured,
      resendConfigured: isResendConfigured(),
      arkeselConfigured: isArkeselConfigured(),
      arkeselSenderIdConfigured: !senderInfo.isDefaultUnverifiedWarning,
      arkeselActiveSenderId: senderInfo.senderId,
      smsMode: platformRuntime.flags.smsMode,
      inMemoryFallback: !configured,
      creatorEmail: creator.email,
      creatorPasswordConfigured: creator.configured,
      sessionTimeoutMinutes: 30,
      timestamp: new Date().toISOString(),
    });
  });

  // Public Arkesel Delivery Report (DLR) Webhook (receives async carrier delivery status callbacks)
  app.all('/api/webhooks/arkesel-dlr', (req, res) => {
    const payload = {
      ...(typeof req.query === 'object' && req.query ? req.query : {}),
      ...(typeof req.body === 'object' && req.body ? req.body : {}),
    } as Record<string, unknown>;
    const result = handleArkeselDlrPayload(payload);
    return res.status(200).json({ ok: true, ...result });
  });

  // Builder Console Admin & Telemetry Routes (Creator RBAC enforced)
  app.use('/api/builder', createBuilderRouter());

  // Seamless In-Memory Persistence Router when Supabase credentials are not configured
  if (!isSupabaseConfigured()) {
    app.use('/api', createMemoryRouter());
  }

  // =========================================================================
  // AUTH ROUTES (Backed by Supabase Auth)
  // =========================================================================

  app.post('/api/auth/creator-login', requireSupabaseConfiguredMiddleware, async (req, res) => {
    const { email, password } = req.body as { email?: string; password?: string };
    const creator = getCreatorCredentials();
    if (!creator.configured) {
      return res.status(503).json({
        error:
          'CREATOR_PASSWORD is not set in the server environment yet. Add CREATOR_PASSWORD to your environment variables/Secrets.',
        code: 'CREATOR_PASSWORD_NOT_CONFIGURED',
      });
    }
    if (!email?.trim() || !password) {
      return res.status(400).json({ error: 'Creator email and CREATOR_PASSWORD are required.' });
    }
    const normalizedEmail = email.trim().toLowerCase();
    if (!safeTimingEqual(normalizedEmail, creator.email) || !safeTimingEqual(password, creator.password)) {
      return res.status(401).json({ error: 'Invalid App Creator email or CREATOR_PASSWORD.' });
    }

    const creatorToken = signCreatorSessionToken(creator.email, creator.password);

    try {
      const publicClient = createPublicSupabaseClient();
      let signInRes = await publicClient.auth.signInWithPassword({
        email: creator.email,
        password: creator.password,
      });

      if ((signInRes.error || !signInRes.data.session) && !signInRes.error?.message?.toLowerCase().includes('email not confirmed')) {
        const svc = createServiceSupabaseClient();
        if (svc) {
          const existingUser = await findSupabaseUserByEmail(svc, creator.email);
          if (existingUser) {
            const { error: updateErr } = await svc.auth.admin.updateUserById(existingUser.id, {
              password: creator.password,
              email_confirm: true,
            });
            if (updateErr) {
              throw new Error(updateErr.message);
            }
          } else {
            const { error: createErr } = await svc.auth.admin.createUser({
              email: creator.email,
              password: creator.password,
              email_confirm: true,
              user_metadata: {
                name: 'Apps Creator',
                studio: 'Apps Creator Console',
                app_role: 'creator',
              },
            });
            if (createErr) {
              throw new Error(createErr.message);
            }
          }
          signInRes = await publicClient.auth.signInWithPassword({
            email: creator.email,
            password: creator.password,
          });
        } else {
          const signUpRes = await publicClient.auth.signUp({
            email: creator.email,
            password: creator.password,
            options: {
              data: {
                name: 'Apps Creator',
                studio: 'Apps Creator Console',
              },
            },
          });
          if (signUpRes.data.session && signUpRes.data.user) {
            const userClient = createUserSupabaseClient(signUpRes.data.session.access_token);
            const profile = await ensureProfileRow(userClient, signUpRes.data.user);
            return res.json({
              requiresOtp: false,
              creatorToken,
              session: {
                accessToken: signUpRes.data.session.access_token,
                refreshToken: signUpRes.data.session.refresh_token,
                expiresAt: signUpRes.data.session.expires_at,
              },
              profile,
            });
          }
          if (!signUpRes.error) {
            return res.json({
              requiresOtp: true,
              creatorToken,
              email: creator.email,
              otpType: 'signup',
            });
          }
        }
      }

      if (signInRes.error?.message?.toLowerCase().includes('email not confirmed')) {
        return res.json({
          requiresOtp: true,
          creatorToken,
          email: creator.email,
          otpType: 'signup',
        });
      }

      if (signInRes.error || !signInRes.data.session || !signInRes.data.user) {
        return res.status(401).json({
          error:
            signInRes.error?.message ||
            'CREATOR_PASSWORD verified, but Supabase account requires password alignment or verification.',
        });
      }

      const userClient = createUserSupabaseClient(signInRes.data.session.access_token);
      const svcFallback = createServiceSupabaseClient();
      const profile = await ensureProfileRow(userClient, signInRes.data.user).catch((err) => {
        if (svcFallback) return ensureProfileRow(svcFallback, signInRes.data.user!);
        throw err;
      });
      return res.json({
        requiresOtp: false,
        creatorToken,
        session: {
          accessToken: signInRes.data.session.access_token,
          refreshToken: signInRes.data.session.refresh_token,
          expiresAt: signInRes.data.session.expires_at,
        },
        profile,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'App Creator sign-in failed.';
      return res.status(500).json({ error: message });
    }
  });

  app.post('/api/studio/creator-unlock', requireSupabaseAuth, (req: AuthedRequest, res) => {
    const creator = getCreatorCredentials();
    if (!creator.configured) {
      return res.json({ unlocked: true, creatorToken: null });
    }
    const userEmail = (req.user?.email || '').trim().toLowerCase();
    if (userEmail !== creator.email) {
      return res.status(403).json({
        error: `Signed in as ${userEmail}. Apps Creator Console belongs to ${creator.email}.`,
      });
    }
    const { password } = req.body as { password?: string };
    if (!password || !safeTimingEqual(password, creator.password)) {
      return res.status(401).json({ error: 'Invalid CREATOR_PASSWORD.' });
    }
    const creatorToken = signCreatorSessionToken(creator.email, creator.password);
    return res.json({ unlocked: true, creatorToken });
  });

  app.post('/api/auth/signin', requireSupabaseConfiguredMiddleware, async (req, res) => {
    const { identifier, email, phone, password, countryGateway } = req.body as {
      identifier?: string;
      email?: string;
      phone?: string;
      password?: string;
      countryGateway?: string;
    };
    const rawIdentifier = (identifier || phone || email || '').trim();
    if (!rawIdentifier || !password) {
      return res.status(400).json({ error: 'Mobile phone number (or email) and password are required.' });
    }
    try {
      const svc = createServiceSupabaseClient();
      let loginEmail = rawIdentifier;
      let resolvedPhone = '';

      if (!rawIdentifier.includes('@')) {
        const phoneCheck = validateStrictPhoneE164(rawIdentifier, countryGateway || 'GH');
        if (!phoneCheck.ok) {
          return res.status(400).json({ error: phoneCheck.error });
        }
        resolvedPhone = phoneCheck.normalized;
        if (!svc) {
          return res.status(503).json({
            error: 'Server-side phone lookup requires SUPABASE_SERVICE_ROLE_KEY.',
          });
        }
        const matchedUser = await findSupabaseUserByPhone(svc, resolvedPhone);
        if (!matchedUser?.email) {
          return res.status(401).json({
            error: `No account found for ${resolvedPhone}. Create a free account or sign in with your email.`,
          });
        }
        loginEmail = matchedUser.email;
      }

      const supabase = createPublicSupabaseClient();
      const { data, error } = await supabase.auth.signInWithPassword({
        email: loginEmail,
        password,
      });
      if (error || !data.session || !data.user) {
        if (error?.message?.toLowerCase().includes('email not confirmed') && svc) {
          const existing = resolvedPhone
            ? await findSupabaseUserByPhone(svc, resolvedPhone)
            : await findSupabaseUserByEmail(svc, loginEmail);
          if (existing) {
            const contacts = await resolveSupabaseUserContacts(svc, existing);
            const delivery = await dispatchDualAuthChallenge({
              phone: contacts.phone || resolvedPhone || undefined,
              email: contacts.email,
              purpose: 'login',
              name: contacts.name,
              requireBoth: Boolean((contacts.phone || resolvedPhone) && contacts.email),
            });
            if (!delivery.ok) {
              return res.status(400).json({ error: delivery.error || 'Could not dispatch verification code.' });
            }
            return res.json({
              requiresOtp: true,
              phone: contacts.phone || resolvedPhone || undefined,
              email: contacts.email,
              otpType: 'sms',
              channels: delivery.channels,
              provider: delivery.provider,
            });
          }
          return res.json({
            requiresOtp: true,
            email: isSyntheticPhoneEmail(loginEmail) ? undefined : loginEmail,
            phone: resolvedPhone || undefined,
            otpType: 'signup',
          });
        }
        return res.status(401).json({ error: error?.message || 'Invalid credentials.' });
      }

      const userClient = createUserSupabaseClient(data.session.access_token);
      const profile = await ensureProfileRow(userClient, data.user);
      const contacts = svc
        ? await resolveSupabaseUserContacts(svc, data.user)
        : {
            phone: profile.phone || resolvedPhone || undefined,
            email:
              profile.email ||
              (!isSyntheticPhoneEmail(data.user.email) ? data.user.email : undefined),
            name: profile.name,
          };
      const userPhone = contacts.phone || profile.phone || resolvedPhone;
      const phoneVerified = Boolean(
        profile.phoneVerified ||
          data.user.phone_confirmed_at ||
          data.user.user_metadata?.phone_verified
      );

      if (userPhone && !phoneVerified) {
        const challenge = await dispatchDualAuthChallenge({
          phone: userPhone,
          email: contacts.email,
          purpose: 'login',
          name: profile.name,
          requireBoth: Boolean(userPhone && contacts.email),
        });
        if (!challenge.ok) {
          return res.status(400).json({ error: challenge.error || 'Could not dispatch verification code.' });
        }
        return res.json({
          requiresOtp: true,
          phone: userPhone,
          email: contacts.email,
          otpType: 'sms',
          channels: challenge.channels,
          provider: challenge.provider,
        });
      }

      return res.json({
        requiresOtp: false,
        session: {
          accessToken: data.session.access_token,
          refreshToken: data.session.refresh_token,
          expiresAt: data.session.expires_at,
        },
        profile,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Sign-in failed.';
      return res.status(500).json({ error: message });
    }
  });

  app.post('/api/auth/signup', requireSupabaseConfiguredMiddleware, async (req, res) => {
    if (!platformRuntime.flags.signupsEnabled) {
      return res.status(403).json({
        error: 'New organiser signups are temporarily paused by platform administrator.',
      });
    }
    const { email, phone, password, name, studio, countryGateway, appRole, agreed } = req.body as {
      email?: string;
      phone?: string;
      password?: string;
      name?: string;
      studio?: string;
      countryGateway?: string;
      appRole?: AppRole;
      agreed?: boolean;
    };

    const trimmedName = (name || '').trim();
    if (trimmedName.length < 2) {
      return res.status(400).json({ error: 'Full name must be at least 2 characters.' });
    }

    const gateway = countryGateway || 'GH';
    const phoneCheck = validateStrictPhoneE164(phone || '', gateway);
    if (!phoneCheck.ok) {
      return res.status(400).json({ error: phoneCheck.error });
    }

    const emailCheck = validateStrictEmail(email || '');
    if (!emailCheck.ok) {
      return res.status(400).json({ error: emailCheck.error });
    }
    const cleanEmail = emailCheck.normalized;

    const pwCheck = validateStrictPassword(password || '');
    if (!pwCheck.ok) {
      return res.status(400).json({ error: pwCheck.error });
    }

    if (agreed === false) {
      return res.status(400).json({
        error: 'You must agree to the Terms & Conditions and NCA SMS regulations to create an account.',
      });
    }

    const trimmedStudio = (studio || `${trimmedName.split(' ')[0]}'s Events`).trim();
    const resolvedAppRole = appRole === 'gate_staff' ? 'gate_staff' : 'organizer';

    try {
      const svc = createServiceSupabaseClient();
      if (!svc) {
        return res.status(503).json({
          error:
            'Transactional verification requires SUPABASE_SERVICE_ROLE_KEY so accounts are only created after OTP verification succeeds.',
        });
      }

      // Check duplicates strictly BEFORE staging or writing anything to database
      const existingByPhone = await findSupabaseUserByPhone(svc, phoneCheck.normalized);
      if (existingByPhone) {
        return res.status(409).json({
          error: `An account with phone number ${phoneCheck.normalized} already exists. Please sign in instead.`,
        });
      }

      const existingByEmail = await findSupabaseUserByEmail(svc, cleanEmail);
      if (existingByEmail) {
        return res.status(409).json({
          error: `An account with email ${cleanEmail} already exists. Please sign in instead.`,
        });
      }

      // Stage registration in Supabase pending_signups (zero writes to Supabase auth.users or public.profiles yet)
      await stagePendingSignup({
        phone: phoneCheck.normalized,
        email: cleanEmail,
        password: password!,
        name: trimmedName,
        studio: trimmedStudio,
        countryGateway: gateway,
        appRole: resolvedAppRole,
      });

      const delivery = await dispatchDualAuthChallenge({
        phone: phoneCheck.normalized,
        email: cleanEmail,
        purpose: 'signup',
        name: trimmedName,
        requireBoth: true,
      });

      if (!delivery.ok) {
        // Roll back staged state cleanly; nothing was ever written to the database
        await clearPendingSignup({ phone: phoneCheck.normalized, email: cleanEmail });
        return res.status(400).json({
          error: delivery.error || 'Could not dispatch verification code to both SMS and email. Account was not created.',
        });
      }

      return res.json({
        requiresOtp: true,
        phone: phoneCheck.normalized,
        email: cleanEmail,
        otpType: 'sms',
        channels: delivery.channels,
        provider: delivery.provider,
        smsSenderId: delivery.smsSenderId,
        smsMessageId: delivery.smsMessageId,
        smsWarning: delivery.smsWarning,
      });
    } catch (err) {
      await clearPendingSignup({ phone: phoneCheck.normalized, email: cleanEmail });
      const message = err instanceof Error ? err.message : 'Sign-up failed. Account was not created.';
      return res.status(500).json({ error: message });
    }
  });

  app.post('/api/auth/verify-otp', requireSupabaseConfiguredMiddleware, async (req, res) => {
    const { email, phone, token, otpType, countryGateway } = req.body as {
      email?: string;
      phone?: string;
      token?: string;
      otpType?: 'signup' | 'email' | 'recovery' | 'sms';
      countryGateway?: string;
    };
    const cleanToken = (token || '').trim();
    if ((!email && !phone) || !cleanToken) {
      return res.status(400).json({ error: 'Phone number (or email) and 6-digit verification code are required.' });
    }

    try {
      const svc = createServiceSupabaseClient();

      let normalizedPhone = '';
      if (phone?.trim()) {
        const phoneCheck = validateStrictPhoneE164(phone.trim(), countryGateway || 'GH');
        if (!phoneCheck.ok) {
          return res.status(400).json({ error: phoneCheck.error });
        }
        normalizedPhone = phoneCheck.normalized;
      }
      const normalizedEmail = email?.trim() ? email.trim().toLowerCase() : '';

      const useDualChallenge =
        Boolean(normalizedPhone) ||
        otpType === 'sms' ||
        (await hasActiveAuthChallenge({ phone: normalizedPhone, email: normalizedEmail }));

      if (useDualChallenge) {
        const otpCheck = await verifyAuthOtp({
          phone: normalizedPhone || undefined,
          email: normalizedEmail || undefined,
          token: cleanToken,
        });
        if (!otpCheck.ok) {
          return res.status(401).json({ error: otpCheck.error });
        }
        if (!svc) {
          return res.status(503).json({
            error: 'OTP session verification requires SUPABASE_SERVICE_ROLE_KEY.',
          });
        }

        const resolvedPhone = otpCheck.phone || normalizedPhone;
        const resolvedEmail = otpCheck.email || normalizedEmail;
        const pending = await getPendingSignup({ phone: resolvedPhone, email: resolvedEmail });
        const publicClient = createPublicSupabaseClient();

        if (pending) {
          // Re-verify uniqueness right before atomic commit
          const dupPhone = await findSupabaseUserByPhone(svc, pending.phone);
          if (dupPhone) {
            await consumePendingSignup({ phone: pending.phone, email: pending.email });
            return res.status(409).json({
              error: `An account with phone number ${pending.phone} already exists. Please sign in instead.`,
            });
          }
          if (pending.email) {
            const dupEmail = await findSupabaseUserByEmail(svc, pending.email);
            if (dupEmail) {
              await consumePendingSignup({ phone: pending.phone, email: pending.email });
              return res.status(409).json({
                error: `An account with email ${pending.email} already exists. Please sign in instead.`,
              });
            }
          }

          const internalEmail = pending.email || buildSyntheticPhoneEmail(pending.phone);
          const creator = getCreatorCredentials();
          const finalRole: AppRole =
            (pending.email && pending.email.toLowerCase() === creator.email) ||
            (creator.phone && pending.phone === creator.phone)
              ? 'creator'
              : pending.appRole;

          const { data: createdRes, error: createErr } = await svc.auth.admin.createUser({
            email: internalEmail,
            phone: pending.phone,
            password: pending.password,
            email_confirm: true,
            phone_confirm: true,
            user_metadata: {
              name: pending.name,
              first_name: pending.name.split(' ')[0] || 'Organiser',
              studio: pending.studio,
              country_gateway: pending.countryGateway,
              app_role: finalRole,
              phone: pending.phone,
              phone_verified: true,
            },
          });

          if (createErr || !createdRes?.user) {
            return res.status(400).json({
              error: createErr?.message || 'Could not create account after verification.',
            });
          }

          const createdUser = createdRes.user;
          try {
            const profile = await ensureProfileRow(svc, createdUser);

            const linkRes = await svc.auth.admin.generateLink({
              type: 'magiclink',
              email: internalEmail,
            });
            const magicOtp = linkRes.data?.properties?.email_otp;
            if (linkRes.error || !magicOtp) {
              throw new Error(linkRes.error?.message || 'Could not mint authenticated session.');
            }

            const sessionRes = await publicClient.auth.verifyOtp({
              email: internalEmail,
              token: magicOtp,
              type: 'magiclink',
            });
            if (sessionRes.error || !sessionRes.data.session) {
              throw new Error(sessionRes.error?.message || 'Could not start authenticated session.');
            }

            await consumePendingSignup({ phone: pending.phone, email: pending.email });
            return res.json({
              session: {
                accessToken: sessionRes.data.session.access_token,
                refreshToken: sessionRes.data.session.refresh_token,
                expiresAt: sessionRes.data.session.expires_at,
              },
              profile: {
                ...profile,
                phone: pending.phone,
                phoneVerified: true,
              },
            });
          } catch (commitErr) {
            try {
              await svc.from('profiles').delete().eq('id', createdUser.id);
            } catch {
              // Best effort cleanup
            }
            try {
              await svc.auth.admin.deleteUser(createdUser.id);
            } catch {
              // Best effort cleanup
            }
            const errMsg =
              commitErr instanceof Error
                ? commitErr.message
                : 'Account provisioning failed and was cleanly rolled back.';
            return res.status(400).json({ error: errMsg });
          }
        }

        // Existing user verifying OTP for sign-in, password recovery, or phone authorisation
        const existingUser = resolvedPhone
          ? await findSupabaseUserByPhone(svc, resolvedPhone)
          : await findSupabaseUserByEmail(svc, resolvedEmail);
        if (!existingUser || !existingUser.email) {
          return res.status(404).json({
            error: `No account registered for ${resolvedPhone || resolvedEmail}.`,
          });
        }

        const contacts = await resolveSupabaseUserContacts(svc, existingUser);
        const verifiedPhone = resolvedPhone || contacts.phone || '';
        if (verifiedPhone) {
          await svc.auth.admin.updateUserById(existingUser.id, {
            phone: verifiedPhone,
            phone_confirm: true,
            email_confirm: true,
            user_metadata: {
              ...(existingUser.user_metadata || {}),
              phone: verifiedPhone,
              phone_verified: true,
            },
          });
          try {
            await svc
              .from('profiles')
              .update({ phone: verifiedPhone, phone_verified: true })
              .eq('id', existingUser.id);
          } catch {
            // Ignore if remote profiles schema doesn't have phone columns yet
          }
        } else {
          await svc.auth.admin.updateUserById(existingUser.id, {
            email_confirm: true,
          });
        }

        const linkRes = await svc.auth.admin.generateLink({
          type: 'magiclink',
          email: existingUser.email,
        });
        const magicOtp = linkRes.data?.properties?.email_otp;
        if (linkRes.error || !magicOtp) {
          return res.status(400).json({
            error: linkRes.error?.message || 'Could not start verified session.',
          });
        }
        const sessionRes = await publicClient.auth.verifyOtp({
          email: existingUser.email,
          token: magicOtp,
          type: 'magiclink',
        });
        if (sessionRes.error || !sessionRes.data.session || !sessionRes.data.user) {
          return res.status(401).json({
            error: sessionRes.error?.message || 'Unable to verify session.',
          });
        }

        const userClient = createUserSupabaseClient(sessionRes.data.session.access_token);
        const profile = await ensureProfileRow(userClient, sessionRes.data.user);
        return res.json({
          session: {
            accessToken: sessionRes.data.session.access_token,
            refreshToken: sessionRes.data.session.refresh_token,
            expiresAt: sessionRes.data.session.expires_at,
          },
          profile: {
            ...profile,
            phone: verifiedPhone || profile.phone,
            phoneVerified: Boolean(verifiedPhone || profile.phoneVerified),
          },
        });
      }

      // Native Supabase Email OTP verification fallback
      const supabase = createPublicSupabaseClient();
      const emailTarget = (email || '').trim();
      const candidateTypes: Array<'signup' | 'email' | 'magiclink' | 'recovery'> = Array.from(
        new Set([
          otpType === 'recovery' ? 'recovery' : otpType === 'email' ? 'email' : 'signup',
          'email',
          'magiclink',
          'signup',
          'recovery',
        ])
      );

      let result = await supabase.auth.verifyOtp({
        email: emailTarget,
        token: cleanToken,
        type: candidateTypes[0],
      });

      for (const nextType of candidateTypes.slice(1)) {
        if (!result.error && result.data.session && result.data.user) break;
        result = await supabase.auth.verifyOtp({
          email: emailTarget,
          token: cleanToken,
          type: nextType,
        });
      }

      if (result.error || !result.data.session || !result.data.user) {
        return res.status(401).json({
          error: result.error?.message || 'Invalid or expired verification code.',
        });
      }

      const userClient = createUserSupabaseClient(result.data.session.access_token);
      const profile = await ensureProfileRow(userClient, result.data.user);
      return res.json({
        session: {
          accessToken: result.data.session.access_token,
          refreshToken: result.data.session.refresh_token,
          expiresAt: result.data.session.expires_at,
        },
        profile,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'OTP verification failed.';
      return res.status(500).json({ error: message });
    }
  });

  app.post('/api/auth/send-otp', requireSupabaseConfiguredMiddleware, async (req, res) => {
    const { email, phone, identifier, countryGateway } = req.body as {
      email?: string;
      phone?: string;
      identifier?: string;
      countryGateway?: string;
    };
    const target = (phone || identifier || email || '').trim();
    if (!target) {
      return res.status(400).json({ error: 'Mobile phone number or email address is required.' });
    }

    try {
      const svc = createServiceSupabaseClient();

      if (!target.includes('@')) {
        const phoneCheck = validateStrictPhoneE164(target, countryGateway || 'GH');
        if (!phoneCheck.ok) {
          return res.status(400).json({ error: phoneCheck.error });
        }
        if (!svc) {
          return res.status(503).json({ error: 'Phone login requires SUPABASE_SERVICE_ROLE_KEY.' });
        }
        const existingUser = await findSupabaseUserByPhone(svc, phoneCheck.normalized);
        if (!existingUser) {
          return res.status(404).json({
            error: `No registered account found for ${phoneCheck.normalized}. Create a free account first.`,
          });
        }
        const contacts = await resolveSupabaseUserContacts(svc, existingUser);
        const resolvedPhone = contacts.phone || phoneCheck.normalized;
        const delivery = await dispatchDualAuthChallenge({
          phone: resolvedPhone,
          email: contacts.email,
          purpose: 'login',
          name: contacts.name,
          requireBoth: Boolean(resolvedPhone && contacts.email),
        });
        if (!delivery.ok) {
          return res.status(400).json({ error: delivery.error });
        }
        return res.json({
          ok: true,
          phone: resolvedPhone,
          email: contacts.email,
          channels: delivery.channels,
          provider: delivery.provider,
          smsSenderId: delivery.smsSenderId,
          smsMessageId: delivery.smsMessageId,
          smsWarning: delivery.smsWarning,
        });
      }

      const emailCheck = validateStrictEmail(target);
      if (!emailCheck.ok) {
        return res.status(400).json({ error: emailCheck.error });
      }
      const cleanEmail = emailCheck.normalized;

      if (svc) {
        const existingUser = await findSupabaseUserByEmail(svc, cleanEmail);
        if (!existingUser) {
          return res.status(404).json({
            error: `No registered account found for ${cleanEmail}. Create a free account first.`,
          });
        }
        const contacts = await resolveSupabaseUserContacts(svc, existingUser);
        const delivery = await dispatchDualAuthChallenge({
          phone: contacts.phone,
          email: cleanEmail,
          purpose: 'login',
          name: contacts.name,
          requireBoth: Boolean(contacts.phone && cleanEmail),
        });
        if (!delivery.ok) {
          return res.status(400).json({ error: delivery.error });
        }
        return res.json({
          ok: true,
          phone: contacts.phone,
          email: cleanEmail,
          channels: delivery.channels,
          provider: delivery.provider,
          smsSenderId: delivery.smsSenderId,
          smsMessageId: delivery.smsMessageId,
          smsWarning: delivery.smsWarning,
        });
      }

      const supabase = createPublicSupabaseClient();
      const { error } = await supabase.auth.signInWithOtp({
        email: cleanEmail,
        options: {
          shouldCreateUser: false,
        },
      });
      if (error) {
        const formatted = formatSupabaseEmailError(error.message, Boolean(svc));
        return res.status(formatted.status).json({ error: formatted.error });
      }
      return res.json({ ok: true, email: cleanEmail, channels: ['email'] });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not dispatch 6-digit code.';
      return res.status(500).json({ error: message });
    }
  });

  app.post('/api/auth/resend-otp', requireSupabaseConfiguredMiddleware, async (req, res) => {
    const { email, phone, otpType, countryGateway } = req.body as {
      email?: string;
      phone?: string;
      otpType?: 'signup' | 'email' | 'recovery' | 'sms';
      countryGateway?: string;
    };

    try {
      const svc = createServiceSupabaseClient();

      let normalizedPhone = '';
      if (phone?.trim()) {
        const phoneCheck = validateStrictPhoneE164(phone.trim(), countryGateway || 'GH');
        if (!phoneCheck.ok) {
          return res.status(400).json({ error: phoneCheck.error });
        }
        normalizedPhone = phoneCheck.normalized;
      }
      const cleanEmail = email?.trim() ? email.trim().toLowerCase() : '';

      const pending = await getPendingSignup({ phone: normalizedPhone, email: cleanEmail });
      let targetPhone = pending?.phone || normalizedPhone || undefined;
      let targetEmail = pending?.email || cleanEmail || undefined;
      let targetName = pending?.name;

      if (!pending && svc) {
        const existingUser = targetPhone
          ? await findSupabaseUserByPhone(svc, targetPhone)
          : targetEmail
            ? await findSupabaseUserByEmail(svc, targetEmail)
            : null;
        if (!existingUser) {
          return res.status(404).json({
            error: 'No active verification session found. Submit sign-up or sign-in again.',
          });
        }
        const contacts = await resolveSupabaseUserContacts(svc, existingUser);
        targetPhone = contacts.phone || targetPhone;
        targetEmail = contacts.email || targetEmail;
        targetName = contacts.name || targetName;
      } else if (!pending && !targetPhone && !targetEmail) {
        return res.status(400).json({ error: 'Phone number or email is required.' });
      }

      if (targetPhone || (svc && targetEmail)) {
        const delivery = await dispatchDualAuthChallenge({
          phone: targetPhone,
          email: targetEmail,
          purpose: otpType === 'recovery' ? 'recovery' : pending ? 'signup' : 'login',
          name: targetName,
          requireBoth: Boolean(targetPhone && targetEmail),
        });
        if (!delivery.ok) {
          return res.status(400).json({ error: delivery.error });
        }
        return res.json({
          ok: true,
          phone: targetPhone,
          email: targetEmail,
          channels: delivery.channels,
          provider: delivery.provider,
          smsSenderId: delivery.smsSenderId,
          smsMessageId: delivery.smsMessageId,
          smsWarning: delivery.smsWarning,
        });
      }

      const supabase = createPublicSupabaseClient();
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email: targetEmail!,
      });
      if (error) {
        const otpFallback = await supabase.auth.signInWithOtp({ email: targetEmail! });
        if (otpFallback.error) {
          const formatted = formatSupabaseEmailError(otpFallback.error.message, Boolean(svc));
          return res.status(formatted.status).json({ error: formatted.error });
        }
      }
      return res.json({ ok: true, email: targetEmail, channels: ['email'] });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not resend code.';
      return res.status(500).json({ error: message });
    }
  });

  app.post('/api/auth/reset-password', requireSupabaseConfiguredMiddleware, async (req, res) => {
    const { email, phone, redirectTo, countryGateway } = req.body as {
      email?: string;
      phone?: string;
      redirectTo?: string;
      countryGateway?: string;
    };

    try {
      const svc = createServiceSupabaseClient();

      if (phone?.trim()) {
        const phoneCheck = validateStrictPhoneE164(phone.trim(), countryGateway || 'GH');
        if (!phoneCheck.ok) {
          return res.status(400).json({ error: phoneCheck.error });
        }
        if (!svc) {
          return res.status(503).json({ error: 'Phone recovery requires SUPABASE_SERVICE_ROLE_KEY.' });
        }
        const existingUser = await findSupabaseUserByPhone(svc, phoneCheck.normalized);
        if (!existingUser) {
          return res.status(404).json({
            error: `No account registered with ${phoneCheck.normalized}.`,
          });
        }
        const contacts = await resolveSupabaseUserContacts(svc, existingUser);
        const resolvedPhone = contacts.phone || phoneCheck.normalized;
        let actionLink: string | undefined;
        if (contacts.email) {
          const genRes = await svc.auth.admin.generateLink({
            type: 'recovery',
            email: contacts.email,
            options: {
              redirectTo: redirectTo || process.env.APP_URL || 'https://www.eventsbyyou.xyz',
            },
          });
          if (!genRes.error) {
            actionLink = genRes.data?.properties?.action_link;
          }
        }
        const delivery = await dispatchDualAuthChallenge({
          phone: resolvedPhone,
          email: contacts.email,
          purpose: 'recovery',
          name: contacts.name,
          actionLink,
          requireBoth: Boolean(resolvedPhone && contacts.email),
        });
        if (!delivery.ok) {
          return res.status(400).json({ error: delivery.error });
        }
        return res.json({
          ok: true,
          phone: resolvedPhone,
          email: contacts.email,
          channels: delivery.channels,
          provider: delivery.provider,
        });
      }

      if (!email?.trim()) {
        return res.status(400).json({ error: 'Email address or phone number is required.' });
      }
      const emailCheck = validateStrictEmail(email.trim());
      if (!emailCheck.ok) {
        return res.status(400).json({ error: emailCheck.error });
      }
      const cleanEmail = emailCheck.normalized;

      if (svc) {
        const existingUser = await findSupabaseUserByEmail(svc, cleanEmail);
        if (!existingUser) {
          return res.status(404).json({
            error: `No account registered with ${cleanEmail}.`,
          });
        }
        const contacts = await resolveSupabaseUserContacts(svc, existingUser);
        let actionLink: string | undefined;
        const genRes = await svc.auth.admin.generateLink({
          type: 'recovery',
          email: cleanEmail,
          options: {
            redirectTo: redirectTo || process.env.APP_URL || 'https://www.eventsbyyou.xyz',
          },
        });
        if (!genRes.error) {
          actionLink = genRes.data?.properties?.action_link;
        }
        const delivery = await dispatchDualAuthChallenge({
          phone: contacts.phone,
          email: cleanEmail,
          purpose: 'recovery',
          name: contacts.name,
          actionLink,
          requireBoth: Boolean(contacts.phone && cleanEmail),
        });
        if (!delivery.ok) {
          return res.status(400).json({ error: delivery.error });
        }
        return res.json({
          ok: true,
          phone: contacts.phone,
          email: cleanEmail,
          channels: delivery.channels,
          provider: delivery.provider,
        });
      }

      const supabase = createPublicSupabaseClient();
      const { error } = await supabase.auth.resetPasswordForEmail(cleanEmail, {
        redirectTo: redirectTo || process.env.APP_URL || 'https://www.eventsbyyou.xyz',
      });
      if (error) {
        const formatted = formatSupabaseEmailError(error.message, Boolean(svc));
        return res.status(formatted.status).json({ error: formatted.error });
      }
      return res.json({ ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Password recovery failed.';
      return res.status(500).json({ error: message });
    }
  });

  app.get('/api/auth/oauth/:provider', requireSupabaseConfiguredMiddleware, async (req, res) => {
    const provider = req.params.provider;
    if (provider !== 'google' && provider !== 'github') {
      return res.status(400).json({ error: 'Unsupported OAuth provider.' });
    }
    const redirectTo =
      typeof req.query.redirectTo === 'string' && req.query.redirectTo
        ? req.query.redirectTo
        : resolveBaseUrl(req);
    try {
      const supabase = createPublicSupabaseClient();
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo,
          skipBrowserRedirect: true,
        },
      });
      if (error || !data.url) {
        return res.status(400).json({ error: error?.message || 'OAuth initialization failed.' });
      }
      return res.json({ url: data.url });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'OAuth error.';
      return res.status(500).json({ error: message });
    }
  });

  app.post('/api/auth/refresh', requireSupabaseConfiguredMiddleware, async (req, res) => {
    const { refreshToken } = req.body as { refreshToken?: string };
    if (!refreshToken) {
      return res.status(400).json({ error: 'Refresh token required.' });
    }
    try {
      const supabase = createPublicSupabaseClient();
      const { data, error } = await supabase.auth.refreshSession({ refresh_token: refreshToken });
      if (error || !data.session || !data.user) {
        return res.status(401).json({ error: error?.message || 'Could not refresh session.' });
      }
      const userClient = createUserSupabaseClient(data.session.access_token);
      const profile = await ensureProfileRow(userClient, data.user);
      return res.json({
        session: {
          accessToken: data.session.access_token,
          refreshToken: data.session.refresh_token,
          expiresAt: data.session.expires_at,
        },
        profile,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Session refresh failed.';
      return res.status(500).json({ error: message });
    }
  });

  app.post('/api/auth/signout', async (req, res) => {
    const token = getBearerToken(req);
    if (token && isSupabaseConfigured()) {
      try {
        const client = createUserSupabaseClient(token);
        await client.auth.signOut();
      } catch {
        // Ignore signout errors
      }
    }
    return res.json({ ok: true });
  });

  app.get('/api/auth/session', requireSupabaseAuth, async (req: AuthedRequest, res) => {
    try {
      const profile = await ensureProfileRow(req.supabase!, req.user!);
      return res.json({ profile });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load profile.';
      return res.status(500).json({ error: message });
    }
  });

  app.post('/api/auth/update-password', requireSupabaseAuth, requireVerifiedPhoneIfSet, async (req: AuthedRequest, res) => {
    const { password } = req.body as { password?: string };
    const pwCheck = validateStrictPassword(password || '');
    if (!pwCheck.ok) {
      return res.status(400).json({ error: pwCheck.error });
    }
    try {
      const { error } = await req.supabase!.auth.updateUser({ password: password! });
      if (error) {
        return res.status(400).json({ error: error.message });
      }
      return res.json({ ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update password.';
      return res.status(500).json({ error: message });
    }
  });

  // =========================================================================
  // PUBLIC ROUTES (Single Source of Truth in Supabase)
  // =========================================================================

  const sanitizePublicEvent = (evt: EventItem): EventItem => {
    if (!evt.extraDataConfig?.attendantLinks) return evt;
    const { attendantLinks: _attLinks, ...restExtra } = evt.extraDataConfig;
    return {
      ...evt,
      extraDataConfig: restExtra,
    };
  };

  app.get('/api/public/events', async (_req, res) => {
    if (!isSupabaseConfigured()) {
      return res.status(503).json({
        error:
          'Supabase is not configured on this server. Set SUPABASE_URL and SUPABASE_ANON_KEY in your environment.',
        code: 'SUPABASE_NOT_CONFIGURED',
        events: [],
      });
    }
    try {
      const supabase = createServiceSupabaseClient() ?? createPublicSupabaseClient();
      const { data, error } = await supabase
        .from('events')
        .select('*')
        .in('status', ['live', 'upcoming'])
        .order('created_at', { ascending: false });

      if (error) {
        return res.status(500).json({ error: error.message, events: [] });
      }
      const events = (data ?? []).map((r) =>
        sanitizePublicEvent(mapEventRow(r as Record<string, unknown>))
      );
      return res.json({ events });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load events.';
      return res.status(500).json({ error: message, events: [] });
    }
  });

  app.get('/api/public/events/:slugOrId', async (req, res) => {
    if (!isSupabaseConfigured()) {
      return res.status(503).json({
        error:
          'Supabase is not configured on this server. Set SUPABASE_URL and SUPABASE_ANON_KEY in your environment.',
      });
    }
    const evt = await resolveEventForPublicOrOg(req.params.slugOrId);
    if (!evt || (evt.status !== 'live' && evt.status !== 'upcoming')) {
      return res.status(404).json({ error: 'Event invitation not found or no longer active.' });
    }
    return res.json({ event: sanitizePublicEvent(evt) });
  });

  app.get('/api/public/camera/:slugOrId', requireSupabaseConfiguredMiddleware, async (req, res) => {
    try {
      const evt = await resolveEventForPublicOrOg(req.params.slugOrId);
      if (!evt) {
        return res.status(404).json({ error: 'Event disposable camera not found.' });
      }
      const passQuery = typeof req.query.pass === 'string' ? req.query.pass.trim() : '';
      const supabase = createServiceSupabaseClient() ?? createPublicSupabaseClient();
      const [shotsRes, rollRes, passRes, rawEvtRes] = await Promise.all([
        supabase
          .from('disposable_shots')
          .select('*')
          .eq('event_id', evt.id)
          .order('frame_number', { ascending: false }),
        supabase
          .from('disposable_roll_settings')
          .select('*')
          .eq('event_id', evt.id)
          .maybeSingle(),
        passQuery
          ? supabase
              .from('attendees')
              .select('name, ticket_code, checked_in, tier')
              .eq('event_id', evt.id)
              .ilike('ticket_code', passQuery)
              .maybeSingle()
          : Promise.resolve({ data: null }),
        supabase
          .from('events')
          .select('extra_data_config')
          .eq('id', evt.id)
          .maybeSingle(),
      ]);
      const shotShooters = extractEventShotShootersMap(
        (rawEvtRes.data as Record<string, unknown> | null)?.extra_data_config
      );
      const shots = (shotsRes.data ?? []).map((r) =>
        hydrateShotWithEventMeta(mapShotRow(r as Record<string, unknown>), shotShooters)
      );
      const rollSettings = rollRes.data
        ? mapRollSettingsRow(rollRes.data as Record<string, unknown>)
        : { exposuresLimit: 24 as const, darkroomMode: false };
      const passRow = passRes.data as Record<string, unknown> | null;
      const verifiedPass = passRow
        ? {
            attendeeName: String(passRow.name || 'Checked-In Guest'),
            ticketCode: String(passRow.ticket_code || passQuery),
            checkedIn: Boolean(passRow.checked_in),
            tier: String(passRow.tier || 'General'),
          }
        : null;
      return res.json({ event: sanitizePublicEvent(evt), shots, rollSettings, verifiedPass });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load disposable camera.';
      return res.status(500).json({ error: message });
    }
  });

  app.post('/api/public/camera/:slugOrId/shots', requireSupabaseConfiguredMiddleware, async (req, res) => {
    const shot = req.body as DisposableShot;
    try {
      const evt = await resolveEventForPublicOrOg(req.params.slugOrId);
      if (!evt) {
        return res.status(404).json({ error: 'Event disposable camera not found.' });
      }
      const supabase = createServiceSupabaseClient() ?? createPublicSupabaseClient();
      const [existingShotsRes, rollRes, rawEvtRes] = await Promise.all([
        supabase
          .from('disposable_shots')
          .select('*')
          .eq('event_id', evt.id),
        supabase
          .from('disposable_roll_settings')
          .select('*')
          .eq('event_id', evt.id)
          .maybeSingle(),
        supabase
          .from('events')
          .select('extra_data_config')
          .eq('id', evt.id)
          .maybeSingle(),
      ]);
      const shotShooters = extractEventShotShootersMap(
        (rawEvtRes.data as Record<string, unknown> | null)?.extra_data_config
      );
      const existingShots = (existingShotsRes.data ?? []).map((r) =>
        hydrateShotWithEventMeta(mapShotRow(r as Record<string, unknown>), shotShooters)
      );
      const rollCfg = rollRes.data
        ? mapRollSettingsRow(rollRes.data as Record<string, unknown>)
        : { exposuresLimit: 24 as const, darkroomMode: false };

      if (existingShots.length >= rollCfg.exposuresLimit) {
        return res.status(403).json({
          error: `Film roll full (${rollCfg.exposuresLimit}/${rollCfg.exposuresLimit} exposures).`,
        });
      }

      const effectiveKey = (shot.shooterKey || '').trim();
      const normalizedAuthor = (shot.capturedBy || 'Guest').trim().toLowerCase();
      const userShotCount = existingShots.filter((s) =>
        effectiveKey && s.shooterKey
          ? s.shooterKey === effectiveKey
          : s.capturedBy.trim().toLowerCase() === normalizedAuthor
      ).length;

      if (userShotCount >= MAX_SHOTS_PER_USER) {
        return res.status(403).json({
          error: `Camera limit reached: each user is allowed up to ${MAX_SHOTS_PER_USER} pictures per event.`,
        });
      }

      const nextFrame = existingShots.reduce((max, s) => Math.max(max, s.frameNumber), 0) + 1;
      const insertRow: Record<string, unknown> = {
        id: shot.id || `shot-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`,
        event_id: evt.id,
        frame_number: nextFrame,
        data_url: shot.dataUrl,
        captured_by: shot.capturedBy || 'Guest Photographer',
        shooter_key: effectiveKey || null,
        caption: shot.caption ?? null,
        film_stock: shot.filmStock || 'ilford-bw',
        date_stamp: shot.dateStamp || '',
        captured_at: shot.capturedAt || new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
        developed: !rollCfg.darkroomMode,
        likes: 0,
        liked: false,
      };

      let usedShooterFallback = false;
      let { data, error } = await supabase
        .from('disposable_shots')
        .insert(insertRow)
        .select('*')
        .single();
      if (error && isMissingColumnError(error)) {
        usedShooterFallback = true;
        const { shooter_key: _sk, ...legacyShot } = insertRow;
        const retry = await supabase
          .from('disposable_shots')
          .insert(legacyShot)
          .select('*')
          .single();
        data = retry.data;
        error = retry.error;
      }
      if (error) return res.status(400).json({ error: error.message });
      const mappedShot = mapShotRow(data as Record<string, unknown>);
      if (usedShooterFallback && effectiveKey) {
        await mergeEventShotShooter(supabase, evt.id, mappedShot.id, effectiveKey);
        mappedShot.shooterKey = effectiveKey;
      }
      return res.status(201).json({ shot: mappedShot });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save film frame.';
      return res.status(500).json({ error: message });
    }
  });

  app.patch('/api/public/camera/shots/:id/like', requireSupabaseConfiguredMiddleware, async (req, res) => {
    try {
      const supabase = createServiceSupabaseClient() ?? createPublicSupabaseClient();
      const { data: existing, error: fetchErr } = await supabase
        .from('disposable_shots')
        .select('*')
        .eq('id', req.params.id)
        .single();
      if (fetchErr || !existing) return res.status(404).json({ error: 'Shot not found.' });

      const rec = existing as Record<string, unknown>;
      const nextLiked = !Boolean(rec.liked);
      const nextLikes = nextLiked
        ? Number(rec.likes ?? 0) + 1
        : Math.max(0, Number(rec.likes ?? 0) - 1);

      const { data: updated, error: updErr } = await supabase
        .from('disposable_shots')
        .update({ liked: nextLiked, likes: nextLikes })
        .eq('id', req.params.id)
        .select('*')
        .single();
      if (updErr) return res.status(400).json({ error: updErr.message });
      return res.json({ shot: mapShotRow(updated as Record<string, unknown>) });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update like.';
      return res.status(500).json({ error: message });
    }
  });

  app.post(
    '/api/public/events/:eventId/register',
    requireSupabaseConfiguredMiddleware,
    async (req, res) => {
      const { eventId } = req.params;
      if (
        platformRuntime.flags.publicRegistrationsPaused ||
        platformRuntime.flags.pausedEventIds.includes(eventId)
      ) {
        return res.status(403).json({
          error: 'Public registration for this event is temporarily paused by the organizer.',
        });
      }
      const {
        name,
        email,
        phone,
        organization,
        tier,
        ticketCode,
        validationGroup,
        inviteCodeUsed,
        giftEntry,
        customResponses,
      } = req.body as {
        name?: string;
        email?: string;
        phone?: string;
        organization?: string;
        tier?: Attendee['tier'];
        ticketCode?: string;
        validationGroup?: string;
        inviteCodeUsed?: string;
        giftEntry?: Attendee['giftEntry'];
        customResponses?: Record<string, string>;
      };

      if (!name?.trim() || !email?.trim() || !phone?.trim()) {
        return res.status(400).json({ error: 'Name, email, and phone number are required.' });
      }

      const normalizedPhone = normalizePhoneE164(phone.trim());
      const attendeeId = `att-${Date.now()}-${Math.floor(100 + Math.random() * 899)}`;
      const finalCode = ticketCode?.trim() || `#EVT-2026-${Math.floor(1000 + Math.random() * 8999)}`;

      try {
        const supabase = createServiceSupabaseClient() ?? createPublicSupabaseClient();

        // Enforce invite code if configured on event
        const { data: evtMeta } = await supabase
          .from('events')
          .select('validation_config')
          .eq('id', eventId)
          .maybeSingle();
        const valCfg = (evtMeta as Record<string, unknown> | null)?.validation_config as
          | EventItem['validationConfig']
          | undefined;
        if (valCfg?.requireInviteCode && valCfg.inviteCode?.trim()) {
          if ((inviteCodeUsed || '').trim().toLowerCase() !== valCfg.inviteCode.trim().toLowerCase()) {
            return res.status(403).json({ error: 'Invalid invitation passcode for this event.' });
          }
        }

        let usedExtendedRpcFallback = false;
        let { data: rpcData, error: rpcErr } = await supabase.rpc('register_public_attendee', {
          p_id: attendeeId,
          p_event_id: eventId,
          p_name: name.trim(),
          p_email: email.trim(),
          p_phone: normalizedPhone,
          p_organization: organization?.trim() || 'Fast Pass Attendee',
          p_tier: tier || 'General',
          p_ticket_code: finalCode,
          p_validation_group: validationGroup ?? null,
          p_invite_code_used: inviteCodeUsed ?? null,
          p_gift_entry: giftEntry ?? null,
          p_custom_responses: customResponses ?? null,
        });

        // Graceful fallback if remote RPC hasn't added the extended params yet
        if (rpcErr && rpcErr.message?.toLowerCase().includes('register_public_attendee')) {
          usedExtendedRpcFallback = true;
          const fallbackRpc = await supabase.rpc('register_public_attendee', {
            p_id: attendeeId,
            p_event_id: eventId,
            p_name: name.trim(),
            p_email: email.trim(),
            p_phone: normalizedPhone,
            p_organization: organization?.trim() || 'Fast Pass Attendee',
            p_tier: tier || 'General',
            p_ticket_code: finalCode,
          });
          rpcData = fallbackRpc.data;
          rpcErr = fallbackRpc.error;
        }

        if (rpcErr) {
          if (rpcErr.message.includes('QR_PASS_NOT_PUBLISHED:')) {
            return res.status(403).json({
              error: 'Check-in QR passes have not been published by the event creator yet.',
            });
          }
          if (rpcErr.message.includes('DUPLICATE_PHONE:')) {
            platformRuntime.recordDuplicateBlock(eventId);
            return res.status(409).json({
              error: `Duplicate shield: ${rpcErr.message.split('DUPLICATE_PHONE:')[1]}`,
            });
          }
          platformRuntime.recordError('public/register', rpcErr.message);
          return res.status(400).json({ error: rpcErr.message });
        }

        const payload = rpcData as {
          attendee: Record<string, unknown>;
          event: Record<string, unknown>;
        };

        if (
          usedExtendedRpcFallback ||
          (validationGroup && payload.attendee.validation_group === undefined) ||
          (inviteCodeUsed && payload.attendee.invite_code_used === undefined) ||
          (giftEntry && payload.attendee.gift_entry === undefined) ||
          (customResponses && Object.keys(customResponses).length > 0 && payload.attendee.custom_responses === undefined)
        ) {
          await mergeEventAttendeeMeta(supabase, eventId, attendeeId, {
            validationGroup: validationGroup?.trim() || undefined,
            inviteCodeUsed: inviteCodeUsed?.trim() || undefined,
            giftEntry,
            customResponses,
          });
        }

        const event = mapEventRow(payload.event);

        let replyTo: string | undefined;
        let orgSenderId: string | undefined;
        const organizerId = payload.event?.organizer_id ? String(payload.event.organizer_id) : undefined;
        if (organizerId) {
          const { data: orgProf } = await supabase
            .from('profiles')
            .select('reply_to_email, sender_id')
            .eq('id', organizerId)
            .maybeSingle();
          const profRec = orgProf as Record<string, unknown> | null;
          if (profRec && typeof profRec.reply_to_email === 'string') {
            replyTo = profRec.reply_to_email;
          }
          if (profRec && typeof profRec.sender_id === 'string' && profRec.sender_id.trim()) {
            orgSenderId = profRec.sender_id.trim();
          }
        }

        const resolvedMsg = resolveEventMessage({
          type: 'confirmation',
          event,
          attendeeName: name.trim(),
          ticketCode: finalCode,
          originOverride: resolveBaseUrl(req),
          includeGuestInCameraUrl: true,
        });

        const [smsDelivery, emailDelivery] = await Promise.all([
          dispatchOptionalArkeselSms(
            normalizedPhone,
            event.title,
            finalCode,
            event.senderId || orgSenderId,
            resolvedMsg.text
          ),
          isResendConfigured()
            ? sendEventPassEmail({
                to: email.trim(),
                attendeeName: name.trim(),
                eventTitle: event.title,
                eventDate: event.date,
                eventTime: event.time,
                eventVenue: event.venue,
                eventCity: event.city,
                ticketCode: finalCode,
                tier: tier || 'General',
                organizerName: event.organizer,
                replyTo,
                customMessage: resolvedMsg.text,
                cameraUrl: resolvedMsg.cameraUrl,
              })
            : Promise.resolve({ ok: false, skipped: true }),
        ]);

        const hasLiveArkesel = Boolean((process.env.ARKESEL_API_KEY || '').trim()) && platformRuntime.flags.smsMode !== 'sandbox';
        const finalDeliveryStatus: Attendee['smsStatus'] =
          emailDelivery.ok && (!hasLiveArkesel || smsDelivery === 'Pending')
            ? 'Resend Delivered'
            : smsDelivery;

        if (finalDeliveryStatus !== payload.attendee.sms_status) {
          await supabase
            .from('attendees')
            .update({ sms_status: finalDeliveryStatus })
            .eq('id', attendeeId);
        }

        const attendee = mapAttendeeRow({
          ...payload.attendee,
          sms_status: finalDeliveryStatus,
          validation_group: payload.attendee.validation_group ?? validationGroup ?? null,
          invite_code_used: payload.attendee.invite_code_used ?? inviteCodeUsed ?? null,
          gift_entry: payload.attendee.gift_entry ?? giftEntry ?? null,
          custom_responses: payload.attendee.custom_responses ?? customResponses ?? null,
        });

        return res.status(201).json({ attendee, event: sanitizePublicEvent(event) });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Registration failed.';
        return res.status(500).json({ error: message });
      }
    }
  );

  // Public Pass Lookup (allows returning attendees to retrieve their QR pass from Supabase by code, email, or phone)
  app.post(
    '/api/public/events/:eventId/pass-lookup',
    requireSupabaseConfiguredMiddleware,
    async (req, res) => {
      const { query } = (req.body || {}) as { query?: string };
      const raw = (query || '').trim();
      if (!raw) {
        return res.status(400).json({ error: 'Enter your pass code, phone number, or email.' });
      }
      try {
        const evt = await resolveEventForPublicOrOg(req.params.eventId);
        if (!evt || (evt.status !== 'live' && evt.status !== 'upcoming')) {
          return res.status(404).json({ error: 'Event not found or no longer active.' });
        }
        const supabase = createServiceSupabaseClient() ?? createPublicSupabaseClient();
        const [attRes, rawEvtRes] = await Promise.all([
          supabase.from('attendees').select('*').eq('event_id', evt.id),
          supabase.from('events').select('extra_data_config').eq('id', evt.id).maybeSingle(),
        ]);
        if (attRes.error) {
          return res.status(400).json({ error: attRes.error.message });
        }
        const cleanLower = raw.toLowerCase();
        const cleanCode = cleanLower.replace(/^#/, '');
        const digitsOnly = raw.replace(/\D/g, '');
        const normalizedLookupPhone = digitsOnly.length >= 9 ? normalizePhoneE164(raw) : '';
        const metaMap = extractEventAttendeeMetaMap(
          (rawEvtRes.data as Record<string, unknown> | null)?.extra_data_config
        );

        const matchedRow = (attRes.data ?? []).find((row) => {
          const rec = row as Record<string, unknown>;
          const code = String(rec.ticket_code ?? '').toLowerCase().replace(/^#/, '');
          const email = String(rec.email ?? '').toLowerCase();
          const phone = String(rec.phone ?? '');
          const cleanPhone = phone.replace(/\s+/g, '');
          const phoneDigits = phone.replace(/\D/g, '');
          return (
            code === cleanCode ||
            email === cleanLower ||
            (normalizedLookupPhone && cleanPhone === normalizedLookupPhone) ||
            (digitsOnly.length >= 9 && phoneDigits.endsWith(digitsOnly.slice(-9)))
          );
        });

        if (!matchedRow) {
          return res.status(404).json({
            error: `No registered pass found for "${raw}". Use New Guest Check-In to validate your circle and generate a QR pass.`,
          });
        }
        const attendee = hydrateAttendeeWithEventMeta(
          mapAttendeeRow(matchedRow as Record<string, unknown>),
          metaMap
        );
        return res.json({ attendee });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unable to look up pass.';
        return res.status(500).json({ error: message });
      }
    }
  );

  // Standalone Public Gift Table Entry (never creates registration/attendee pass)
  app.post(
    '/api/public/events/:slugOrId/gifts',
    requireSupabaseConfiguredMiddleware,
    async (req, res) => {
      try {
        const evt = await resolveEventForPublicOrOg(req.params.slugOrId);
        if (!evt || (evt.status !== 'live' && evt.status !== 'upcoming')) {
          return res.status(404).json({ error: 'Event Gift Table not found.' });
        }
        const body = req.body as Partial<GiftTableEntry>;
        const giverName = (body.giverName || '').trim();
        if (!giverName) {
          return res.status(400).json({ error: 'Your name is required on the Gift Table entry.' });
        }
        const giftType: GiftTableEntry['giftType'] =
          body.giftType === 'cash-momo' || body.giftType === 'registry-item' || body.giftType === 'blessing-only'
            ? body.giftType
            : 'cash-momo';
        const giftEntry: GiftTableEntry = {
          id: `gift-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`,
          eventId: evt.id,
          giverName,
          giverPhone: body.giverPhone?.trim() ? normalizePhoneE164(body.giverPhone.trim()) : undefined,
          giftType,
          currency: body.currency === 'USD' ? 'USD' : 'GHS',
          amount:
            giftType === 'cash-momo'
              ? Math.max(1, Number(body.amount) || 0)
              : undefined,
          registryItem:
            giftType === 'registry-item'
              ? body.registryItem?.trim() || evt.extraDataConfig?.giftRegistryItems?.[0] || 'Registry Gift'
              : undefined,
          side: body.side?.trim() || undefined,
          message: body.message?.trim() || undefined,
          recordedVia: 'public-table',
          createdAt: new Date().toISOString(),
        };

        const adminClient = createServiceSupabaseClient() ?? createPublicSupabaseClient();
        const { data: rawRow } = await adminClient
          .from('events')
          .select('extra_data_config')
          .eq('id', evt.id)
          .maybeSingle();
        const currentExtra =
          rawRow && (rawRow as Record<string, unknown>).extra_data_config &&
          typeof (rawRow as Record<string, unknown>).extra_data_config === 'object'
            ? ((rawRow as Record<string, unknown>).extra_data_config as Record<string, unknown>)
            : ({ ...(evt.extraDataConfig ?? { enableGiftTable: true, customFields: [] }) } as Record<string, unknown>);
        const currentLedger = Array.isArray(currentExtra.giftLedger)
          ? (currentExtra.giftLedger as GiftTableEntry[])
          : [];
        const nextExtra = {
          ...currentExtra,
          enableGiftTable: true,
          giftLedger: [giftEntry, ...currentLedger],
        };
        const { data: updatedRow, error: updErr } = await adminClient
          .from('events')
          .update({ extra_data_config: nextExtra })
          .eq('id', evt.id)
          .select('*')
          .single();
        if (updErr) {
          return res.status(400).json({ error: updErr.message });
        }
        return res.status(201).json({
          gift: giftEntry,
          event: sanitizePublicEvent(mapEventRow(updatedRow as Record<string, unknown>)),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to record gift table entry.';
        return res.status(500).json({ error: message });
      }
    }
  );

  // Appointed Gift Table Attendant Link Validation (for people manning the gift desk)
  app.get(
    '/api/public/events/:slugOrId/gift-desk/:token',
    requireSupabaseConfiguredMiddleware,
    async (req, res) => {
      try {
        const evt = await resolveEventForPublicOrOg(req.params.slugOrId);
        if (!evt || (evt.status !== 'live' && evt.status !== 'upcoming')) {
          return res.status(404).json({ error: 'Event Gift Table not found.' });
        }
        const token = req.params.token.trim();
        const links = Array.isArray(evt.extraDataConfig?.attendantLinks)
          ? evt.extraDataConfig!.attendantLinks!
          : [];
        const matchedLink = links.find((l) => l.token === token);
        if (!matchedLink) {
          return res.status(404).json({
            error: 'Gift Table attendant link was not found or has been deleted.',
          });
        }
        if (!matchedLink.active) {
          return res.status(403).json({
            error: 'This Gift Table attendant link has been paused by the organiser.',
            paused: true,
          });
        }
        const { token: _secret, ...safeAttendant } = matchedLink;
        return res.json({
          event: sanitizePublicEvent(evt),
          attendant: safeAttendant,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to verify gift desk link.';
        return res.status(500).json({ error: message });
      }
    }
  );

  // Appointed Gift Table Attendant Recording (receives gifts on behalf of organiser)
  app.post(
    '/api/public/events/:slugOrId/gift-desk/:token',
    requireSupabaseConfiguredMiddleware,
    async (req, res) => {
      try {
        const evt = await resolveEventForPublicOrOg(req.params.slugOrId);
        if (!evt || (evt.status !== 'live' && evt.status !== 'upcoming')) {
          return res.status(404).json({ error: 'Event Gift Table not found.' });
        }
        const token = req.params.token.trim();
        const adminClient = createServiceSupabaseClient() ?? createPublicSupabaseClient();
        const { data: rawRow } = await adminClient
          .from('events')
          .select('extra_data_config')
          .eq('id', evt.id)
          .maybeSingle();
        const currentExtra =
          rawRow && (rawRow as Record<string, unknown>).extra_data_config &&
          typeof (rawRow as Record<string, unknown>).extra_data_config === 'object'
            ? ((rawRow as Record<string, unknown>).extra_data_config as Record<string, unknown>)
            : ({ ...(evt.extraDataConfig ?? { enableGiftTable: true, customFields: [] }) } as Record<string, unknown>);
        const currentLinks = Array.isArray(currentExtra.attendantLinks)
          ? (currentExtra.attendantLinks as GiftTableAttendantLink[])
          : [];
        const matchedLink = currentLinks.find((l) => l.token === token);
        if (!matchedLink) {
          return res.status(404).json({ error: 'Gift Table attendant link not found.' });
        }
        if (!matchedLink.active) {
          return res.status(403).json({
            error: 'This Gift Table attendant link has been paused by the organiser.',
          });
        }

        const body = req.body as Partial<GiftTableEntry>;
        const giverName = (body.giverName || '').trim();
        if (!giverName) {
          return res.status(400).json({ error: 'Giver or donor name is required.' });
        }
        const giftType: GiftTableEntry['giftType'] =
          body.giftType === 'cash-momo' ||
          body.giftType === 'registry-item' ||
          body.giftType === 'blessing-only'
            ? body.giftType
            : 'cash-momo';
        const nowIso = new Date().toISOString();
        const giftEntry: GiftTableEntry = {
          id: `gift-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`,
          eventId: evt.id,
          giverName,
          giverPhone: body.giverPhone?.trim() ? normalizePhoneE164(body.giverPhone.trim()) : undefined,
          giftType,
          currency: body.currency === 'USD' ? 'USD' : 'GHS',
          amount: giftType === 'cash-momo' ? Math.max(1, Number(body.amount) || 0) : undefined,
          registryItem:
            giftType === 'registry-item'
              ? body.registryItem?.trim() || evt.extraDataConfig?.giftRegistryItems?.[0] || 'Registry Gift'
              : undefined,
          side: body.side?.trim() || undefined,
          message: body.message?.trim() || undefined,
          recordedVia: 'gift-desk',
          recordedBy: matchedLink.attendantName,
          attendantLinkId: matchedLink.id,
          createdAt: nowIso,
        };

        const currentLedger = Array.isArray(currentExtra.giftLedger)
          ? (currentExtra.giftLedger as GiftTableEntry[])
          : [];
        const updatedLinks = currentLinks.map((l) =>
          l.id === matchedLink.id
            ? { ...l, recordedCount: (l.recordedCount ?? 0) + 1, lastUsedAt: nowIso }
            : l
        );
        const updatedMatched = updatedLinks.find((l) => l.id === matchedLink.id)!;

        const nextExtra = {
          ...currentExtra,
          enableGiftTable: true,
          giftLedger: [giftEntry, ...currentLedger],
          attendantLinks: updatedLinks,
        };
        const { data: updatedRow, error: updErr } = await adminClient
          .from('events')
          .update({ extra_data_config: nextExtra })
          .eq('id', evt.id)
          .select('*')
          .single();
        if (updErr) {
          return res.status(400).json({ error: updErr.message });
        }
        const { token: _secret, ...safeAttendant } = updatedMatched;
        return res.status(201).json({
          gift: giftEntry,
          event: sanitizePublicEvent(mapEventRow(updatedRow as Record<string, unknown>)),
          attendant: safeAttendant,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to log desk gift entry.';
        return res.status(500).json({ error: message });
      }
    }
  );

  // =========================================================================
  // PROTECTED STUDIO & EVENT MODULE ROUTES (Authenticated Organisers Only)
  // =========================================================================

  app.get('/api/studio/bootstrap', requireSupabaseAuth, async (req: AuthedRequest, res) => {
    try {
      const workspace = await loadOrganizerWorkspace(req.supabase!, req.user!);
      return res.json(workspace);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load workspace.';
      return res.status(500).json({ error: message });
    }
  });

  app.post('/api/studio/seed-starter', requireSupabaseAuth, requireRole('creator', 'organizer'), async (_req: AuthedRequest, res) => {
    return res.status(403).json({
      error: 'Demo and starter data seeding has been removed.',
    });
  });

  app.patch('/api/studio/profile', requireSupabaseAuth, requireRole('creator', 'organizer'), async (req: AuthedRequest, res) => {
    const next = req.body as Partial<OrganizerProfile>;
    try {
      const updatePayload: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
      };
      if (next.name !== undefined) updatePayload.name = next.name;
      if (next.firstName !== undefined) updatePayload.first_name = next.firstName;
      if (next.role !== undefined) updatePayload.role = next.role;
      if (next.email !== undefined) {
        if (next.email.trim()) {
          const emailCheck = validateStrictEmail(next.email);
          if (!emailCheck.ok) return res.status(400).json({ error: emailCheck.error });
          updatePayload.email = emailCheck.normalized;
        }
      }
      let nextPhoneNormalized: string | null | undefined = undefined;
      if (next.phone !== undefined) {
        if (next.phone.trim()) {
          const phoneCheck = validateStrictPhoneE164(next.phone);
          if (!phoneCheck.ok) return res.status(400).json({ error: phoneCheck.error });
          nextPhoneNormalized = phoneCheck.normalized;
          updatePayload.phone = phoneCheck.normalized;
        } else {
          nextPhoneNormalized = null;
          updatePayload.phone = null;
          updatePayload.phone_verified = false;
        }
      }
      if (next.studio !== undefined) updatePayload.studio = next.studio;
      if (next.plan !== undefined) updatePayload.plan = next.plan;
      if (next.smsCredits !== undefined) updatePayload.sms_credits = next.smsCredits;
      if (next.capacityAlertThreshold !== undefined) {
        updatePayload.capacity_alert_threshold = next.capacityAlertThreshold;
      }
      if (next.avatarUrl !== undefined) {
        updatePayload.avatar_url = next.avatarUrl && next.avatarUrl.trim() ? next.avatarUrl.trim() : null;
      }
      if (next.replyToEmail !== undefined) updatePayload.reply_to_email = next.replyToEmail;
      if (next.timezone !== undefined) updatePayload.timezone = next.timezone;
      if (next.twoFactorEnabled !== undefined) {
        updatePayload.two_factor_enabled = next.twoFactorEnabled;
      }
      if (next.senderId !== undefined) updatePayload.sender_id = next.senderId;

      let { data, error } = await req
        .supabase!.from('profiles')
        .update(updatePayload)
        .eq('id', req.user!.id)
        .select('*')
        .single();

      if (error && isMissingColumnError(error)) {
        const {
          phone: _dropPhone,
          phone_verified: _dropPhoneVer,
          app_role: _dropAppRole,
          ...withoutMissingCols
        } = updatePayload;
        const retry = await req
          .supabase!.from('profiles')
          .update(withoutMissingCols)
          .eq('id', req.user!.id)
          .select('*')
          .single();
        data = retry.data;
        error = retry.error;
        if (error && isMissingColumnError(error)) {
          const { sender_id: _dropSender, ...minimalUpdate } = withoutMissingCols;
          const retry2 = await req
            .supabase!.from('profiles')
            .update(minimalUpdate)
            .eq('id', req.user!.id)
            .select('*')
            .single();
          data = retry2.data;
          error = retry2.error;
        }
      }

      if (error) return res.status(400).json({ error: error.message });

      // Persist name/studio/phone into Supabase Auth user_metadata so phone changes survive sessions even if profiles.phone column is absent
      const svc = createServiceSupabaseClient();
      if (svc) {
        try {
          const existingMeta =
            req.user?.user_metadata && typeof req.user.user_metadata === 'object'
              ? { ...req.user.user_metadata }
              : {};
          if (next.name !== undefined) existingMeta.name = next.name;
          if (next.studio !== undefined) existingMeta.studio = next.studio;
          if (nextPhoneNormalized !== undefined) {
            existingMeta.phone = nextPhoneNormalized;
            if (nextPhoneNormalized === null) {
              existingMeta.phone_verified = false;
            }
          }
          await svc.auth.admin.updateUserById(req.user!.id, {
            user_metadata: existingMeta,
          });
        } catch {
          // Non-fatal metadata sync
        }
      }

      const mapped = mapProfileRow(data as Record<string, unknown>, req.user!.email ?? '');
      if (nextPhoneNormalized === null) {
        mapped.phone = undefined;
        mapped.phoneVerified = false;
      } else if (nextPhoneNormalized && !mapped.phone) {
        mapped.phone = nextPhoneNormalized;
      } else if (
        nextPhoneNormalized === undefined &&
        !mapped.phone &&
        req.user?.user_metadata?.phone !== null
      ) {
        const metaPhone =
          (typeof req.user?.user_metadata?.phone === 'string' && req.user.user_metadata.phone.trim()) ||
          (typeof req.user?.phone === 'string' && req.user.phone.trim()) ||
          '';
        if (metaPhone) {
          mapped.phone = normalizePhoneE164(metaPhone);
          mapped.phoneVerified = Boolean(
            req.user?.phone_confirmed_at || req.user?.user_metadata?.phone_verified
          );
        }
      }
      return res.json({ profile: mapped });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update profile.';
      return res.status(500).json({ error: message });
    }
  });

  app.delete('/api/studio/account', requireSupabaseAuth, requireRole('creator', 'organizer', 'gate_staff'), async (req: AuthedRequest, res) => {
    const confirmation = (req.body as { confirmation?: string } | undefined)?.confirmation;
    if (confirmation !== undefined && confirmation.trim().toUpperCase() !== 'DELETE') {
      return res.status(400).json({ error: 'Type DELETE to confirm permanent account deletion.' });
    }
    const svc = createServiceSupabaseClient();
    if (!svc) {
      return res.status(503).json({
        error: 'Server-side account deletion requires SUPABASE_SERVICE_ROLE_KEY to be configured.',
      });
    }
    const user = req.user!;
    try {
      const { data: profRow } = await svc
        .from('profiles')
        .select('email, phone')
        .eq('id', user.id)
        .maybeSingle();

      const rawEmail =
        (typeof profRow?.email === 'string' && profRow.email.trim()) ||
        user.email ||
        '';
      const cleanEmail = rawEmail && !isSyntheticPhoneEmail(rawEmail) ? rawEmail.trim().toLowerCase() : undefined;
      const cleanPhone =
        req.userPhone ||
        (typeof profRow?.phone === 'string' && profRow.phone.trim() ? normalizePhoneE164(profRow.phone) : '') ||
        (user.phone ? normalizePhoneE164(user.phone) : '') ||
        undefined;

      try {
        await clearPendingSignup({ email: cleanEmail, phone: cleanPhone });
      } catch {
        // Do not block account deletion if optional auth_otp_challenges / pending_signups tables are absent
      }

      const { error: deleteErr } = await svc.auth.admin.deleteUser(user.id);
      if (deleteErr) {
        return res.status(400).json({ error: deleteErr.message || 'Failed to delete organiser account.' });
      }

      return res.json({ ok: true, deletedUserId: user.id });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete organiser account.';
      return res.status(500).json({ error: message });
    }
  });

  app.post('/api/studio/sms/test', requireSupabaseAuth, requireRole('creator', 'organizer'), async (req: AuthedRequest, res) => {
    const { phone, senderId } = req.body as { phone?: string; senderId?: string };
    const phoneCheck = validateStrictPhoneE164(phone || '');
    if (!phoneCheck.ok) {
      return res.status(400).json({ error: phoneCheck.error });
    }
    try {
      const client = req.supabase!;
      const { data: prof } = await client
        .from('profiles')
        .select('sms_credits, sender_id')
        .eq('id', req.user!.id)
        .maybeSingle();

      const currentCredits = Number((prof as Record<string, unknown> | null)?.sms_credits ?? 0);
      if (currentCredits <= 0 && platformRuntime.flags.smsMode !== 'sandbox') {
        return res.status(400).json({ error: 'No SMS credits remaining in your organizer balance.' });
      }

      const testCode = String(crypto.randomInt(100000, 999999));
      const effectiveExplicitSender =
        (senderId || '').trim() ||
        (typeof (prof as Record<string, unknown> | null)?.sender_id === 'string'
          ? String((prof as Record<string, unknown>).sender_id)
          : undefined);

      const dispatch = await sendArkeselSmsOtp({
        phone: phoneCheck.normalized,
        code: testCode,
        purpose: 'test',
        senderId: effectiveExplicitSender,
      });

      if (!dispatch.ok) {
        return res.status(400).json({ error: dispatch.error || 'Arkesel SMS test dispatch failed.' });
      }

      let nextCredits = currentCredits;
      if (!dispatch.sandbox) {
        nextCredits = Math.max(0, currentCredits - 1);
        await client
          .from('profiles')
          .update({ sms_credits: nextCredits, updated_at: new Date().toISOString() })
          .eq('id', req.user!.id);
      }

      return res.json({
        ok: true,
        phone: phoneCheck.normalized,
        senderId: dispatch.senderIdUsed,
        messageId: dispatch.messageId,
        sandbox: Boolean(dispatch.sandbox),
        warning: dispatch.warning,
        smsCredits: nextCredits,
      });
    } catch (err) {
      return res.status(500).json({ error: err instanceof Error ? err.message : 'SMS test failed.' });
    }
  });

  app.get('/api/studio/arkesel/status', requireSupabaseAuth, requireRole('creator', 'organizer'), async (req: AuthedRequest, res) => {
    try {
      const client = req.supabase!;
      const { data: prof } = await client
        .from('profiles')
        .select('sms_credits, sender_id')
        .eq('id', req.user!.id)
        .maybeSingle();
      const row = (prof as Record<string, unknown> | null) ?? {};
      const senderInfo = platformRuntime.getEffectiveArkeselSenderId(
        typeof row.sender_id === 'string' ? row.sender_id : undefined
      );
      const bal = await fetchArkeselGatewayBalance();
      return res.json({
        configured: isArkeselConfigured(),
        mode: platformRuntime.flags.smsMode,
        live: bal.ok,
        smsBalance: bal.ok && typeof bal.credits === 'number' ? bal.credits : null,
        mainBalance: bal.ok && typeof bal.mainBalance === 'number' ? bal.mainBalance : null,
        error: bal.ok ? null : (bal.error || null),
        senderId: senderInfo.senderId,
        isDefaultUnverifiedSender: senderInfo.isDefaultUnverifiedWarning,
        organizerCredits: Number(row.sms_credits ?? 0),
        apiInfoUrl: 'https://sms.arkesel.com/user/sms-api/info',
        rechargeUrl: 'https://sms.arkesel.com',
        checkedAt: new Date().toISOString(),
      });
    } catch (err) {
      return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to query Arkesel status.' });
    }
  });

  app.post('/api/studio/sms/purchase-bundle', requireSupabaseAuth, requireRole('creator', 'organizer'), async (req: AuthedRequest, res) => {
    const { bundleId, bundleName, credits, amountGhs, paymentChannel, arkeselReference } = req.body as {
      bundleId?: string;
      bundleName?: string;
      credits?: number;
      amountGhs?: number;
      paymentChannel?: string;
      arkeselReference?: string;
    };

    const parsedCredits = Math.round(Number(credits ?? 0));
    const parsedAmount = Number(amountGhs ?? 0);
    if (!Number.isFinite(parsedCredits) || parsedCredits < 10 || parsedCredits > 100000) {
      return res.status(400).json({ error: 'Bundle credits must be between 10 and 100,000 SMS.' });
    }
    if (!Number.isFinite(parsedAmount) || parsedAmount < 0) {
      return res.status(400).json({ error: 'Invalid bundle price amount.' });
    }

    try {
      const client = req.supabase!;
      const adminClient = createServiceSupabaseClient() ?? client;
      const { data: prof, error: profErr } = await adminClient
        .from('profiles')
        .select('*')
        .eq('id', req.user!.id)
        .single();
      if (profErr || !prof) {
        return res.status(404).json({ error: 'Organizer profile not found.' });
      }

      const row = prof as Record<string, unknown>;
      const currentCredits = Number(row.sms_credits ?? 0);
      const nextCredits = currentCredits + parsedCredits;

      const { data: updatedProf, error: updErr } = await adminClient
        .from('profiles')
        .update({
          sms_credits: nextCredits,
          updated_at: new Date().toISOString(),
        })
        .eq('id', req.user!.id)
        .select('*')
        .single();
      if (updErr || !updatedProf) {
        return res.status(400).json({ error: updErr?.message || 'Failed to update organizer SMS credits.' });
      }

      const senderInfo = platformRuntime.getEffectiveArkeselSenderId(
        typeof row.sender_id === 'string' ? row.sender_id : undefined
      );
      const bal = await fetchArkeselGatewayBalance();
      const mappedProfile = mapProfileRow(
        updatedProf as Record<string, unknown>,
        req.user!.email || ''
      );
      const cleanRef = (arkeselReference || '').trim() || `ARK-${Date.now().toString(36).toUpperCase()}`;

      return res.json({
        ok: true,
        profile: mappedProfile,
        bundleId: bundleId || 'custom',
        bundleName: (bundleName || `${parsedCredits.toLocaleString()} SMS Bundle`).trim(),
        addedCredits: parsedCredits,
        amountGhs: Number(parsedAmount.toFixed(2)),
        paymentChannel: (paymentChannel || 'Arkesel Portal Wallet').trim(),
        arkeselReference: cleanRef,
        portalPurchaseRequired: true,
        arkeselStatus: {
          configured: isArkeselConfigured(),
          mode: platformRuntime.flags.smsMode,
          live: bal.ok,
          smsBalance: bal.ok && typeof bal.credits === 'number' ? bal.credits : null,
          mainBalance: bal.ok && typeof bal.mainBalance === 'number' ? bal.mainBalance : null,
          error: bal.ok ? null : (bal.error || null),
          senderId: senderInfo.senderId,
          isDefaultUnverifiedSender: senderInfo.isDefaultUnverifiedWarning,
          organizerCredits: nextCredits,
          apiInfoUrl: 'https://sms.arkesel.com/user/sms-api/info',
          rechargeUrl: 'https://sms.arkesel.com',
          checkedAt: new Date().toISOString(),
        },
        message: `${parsedCredits.toLocaleString()} SMS credits allocated to your workspace (Ref: ${cleanRef}). Ensure your Arkesel merchant wallet has matching balance.`,
      });
    } catch (err) {
      return res.status(500).json({ error: err instanceof Error ? err.message : 'SMS bundle purchase failed.' });
    }
  });

  app.post('/api/studio/events', requireSupabaseAuth, requireRole('creator', 'organizer'), async (req: AuthedRequest, res) => {
    const { event, blocks } = req.body as { event: EventItem; blocks?: ScheduleBlock[] };
    if (!event?.title) {
      return res.status(400).json({ error: 'Invalid event payload.' });
    }
    try {
      const client = req.supabase!;
      const adminOrUserClient = createServiceSupabaseClient() ?? client;

      const baseSlug =
        (event.slug || event.title)
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9-]+/g, '-')
          .replace(/(^-|-$)+/g, '') || `event-${Date.now().toString(36)}`;

      const { data: existingSlugRow } = await adminOrUserClient
        .from('events')
        .select('id')
        .eq('slug', baseSlug)
        .maybeSingle();

      const uniqueSlug = existingSlugRow
        ? `${baseSlug}-${crypto.randomBytes(2).toString('hex')}`
        : baseSlug;

      const uniqueEventId = `evt-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;

      const eventRow: Record<string, unknown> = {
        id: uniqueEventId,
        organizer_id: req.user!.id,
        slug: uniqueSlug,
        title: event.title,
        subtitle: event.subtitle,
        category: event.category,
        status: event.status,
        date: event.date,
        iso_date: event.isoDate,
        time: event.time,
        venue: event.venue,
        city: event.city,
        capacity: event.capacity,
        registered: event.registered,
        checked_in: event.checkedIn,
        sms_dispatched: event.smsDispatched,
        ticket_price: event.ticketPrice,
        revenue: event.revenue,
        organizer: event.organizer,
        artwork: event.artwork,
        design_theme: event.designTheme ?? null,
        broadcast_error: event.broadcastError ?? null,
        flyer_url: event.flyerUrl ?? null,
        venue_format: event.venueFormat ?? 'in-person',
        sender_id: event.senderId ?? null,
        qr_pass_published: event.status === 'draft' ? false : Boolean(event.qrPassPublished),
        validation_config: event.validationConfig ?? null,
        extra_data_config: withEmbeddedMessageConfig(
          event.extraDataConfig,
          event.messageConfig,
          event.brandColor
        ),
        message_config: event.messageConfig ?? null,
      };

      let { data: createdEvt, error: evtErr } = await client
        .from('events')
        .insert(eventRow)
        .select('*')
        .single();
      if (evtErr && isMissingColumnError(evtErr)) {
        const { message_config: _mc, ...withoutMsgCol } = eventRow;
        const retryWithExtra = await client.from('events').insert(withoutMsgCol).select('*').single();
        createdEvt = retryWithExtra.data;
        evtErr = retryWithExtra.error;
        if (evtErr && isMissingColumnError(evtErr)) {
          const legacyRow = stripOptionalEventColumns(eventRow);
          const retry = await client.from('events').insert(legacyRow).select('*').single();
          createdEvt = retry.data;
          evtErr = retry.error;
        }
      }
      if (evtErr) return res.status(400).json({ error: evtErr.message });

      let createdBlocks: ScheduleBlock[] = [];
      if (blocks && blocks.length > 0) {
        const blockRows = blocks.map((b, idx) => ({
          id: `sch-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}-${idx}`,
          event_id: uniqueEventId,
          time: b.time,
          duration: b.duration,
          title: b.title,
          stage: b.stage,
          lead: b.lead,
          completed: b.completed,
          day: b.day,
        }));
        const { data: insertedBlocks, error: schErr } = await client
          .from('schedule_blocks')
          .insert(blockRows)
          .select('*');
        if (schErr) return res.status(400).json({ error: schErr.message });
        createdBlocks = (insertedBlocks ?? []).map((r) => mapScheduleRow(r as Record<string, unknown>));
      }

      return res.status(201).json({
        event: mapEventRow(createdEvt as Record<string, unknown>),
        blocks: createdBlocks,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create event.';
      return res.status(500).json({ error: message });
    }
  });

  app.patch('/api/studio/events/:id', requireSupabaseAuth, requireRole('creator', 'organizer'), async (req: AuthedRequest, res) => {
    const updated = req.body as EventItem;
    try {
      const { data: existingEvtRow } = await req
        .supabase!.from('events')
        .select('extra_data_config')
        .eq('id', req.params.id)
        .eq('organizer_id', req.user!.id)
        .maybeSingle();

      const updatePayload: Record<string, unknown> = {
        slug: updated.slug,
        title: updated.title,
        subtitle: updated.subtitle,
        category: updated.category,
        status: updated.status,
        date: updated.date,
        iso_date: updated.isoDate,
        time: updated.time,
        venue: updated.venue,
        city: updated.city,
        capacity: updated.capacity,
        ticket_price: updated.ticketPrice,
        organizer: updated.organizer,
        artwork: updated.artwork,
        design_theme: updated.designTheme ?? null,
        broadcast_error: updated.broadcastError ?? null,
        flyer_url: updated.flyerUrl ?? null,
        venue_format: updated.venueFormat ?? 'in-person',
        sender_id: updated.senderId ?? null,
        validation_config: updated.validationConfig ?? null,
        extra_data_config: withEmbeddedMessageConfig(
          updated.extraDataConfig,
          updated.messageConfig,
          updated.brandColor,
          (existingEvtRow as Record<string, unknown> | null)?.extra_data_config
        ),
        message_config: updated.messageConfig ?? null,
      };
      if (updated.status === 'draft') {
        updatePayload.qr_pass_published = false;
      } else if (updated.qrPassPublished !== undefined) {
        updatePayload.qr_pass_published = Boolean(updated.qrPassPublished);
      }

      let { data, error } = await req
        .supabase!.from('events')
        .update(updatePayload)
        .eq('id', req.params.id)
        .eq('organizer_id', req.user!.id)
        .select('*')
        .single();
      if (error && isMissingColumnError(error)) {
        const { message_config: _mc, ...withoutMsgCol } = updatePayload;
        const retryWithExtra = await req
          .supabase!.from('events')
          .update(withoutMsgCol)
          .eq('id', req.params.id)
          .eq('organizer_id', req.user!.id)
          .select('*')
          .single();
        data = retryWithExtra.data;
        error = retryWithExtra.error;
        if (error && isMissingColumnError(error)) {
          const legacyUpdate = stripOptionalEventColumns(updatePayload);
          const retry = await req
            .supabase!.from('events')
            .update(legacyUpdate)
            .eq('id', req.params.id)
            .eq('organizer_id', req.user!.id)
            .select('*')
            .single();
          data = retry.data;
          error = retry.error;
        }
      }
      if (error) return res.status(400).json({ error: error.message });
      return res.json({ event: mapEventRow(data as Record<string, unknown>) });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update event.';
      return res.status(500).json({ error: message });
    }
  });

  app.patch('/api/studio/events/:id/qr-pass', requireSupabaseAuth, requireRole('creator', 'organizer'), async (req: AuthedRequest, res) => {
    const published = Boolean((req.body as { published?: boolean })?.published);
    try {
      const client = req.supabase!;
      const { data: evt, error: fetchErr } = await client
        .from('events')
        .select('*')
        .eq('id', req.params.id)
        .maybeSingle();
      if (fetchErr || !evt) {
        return res.status(404).json({ error: 'Event not found.' });
      }
      const evtRec = evt as Record<string, unknown>;
      if (String(evtRec.organizer_id) !== req.user!.id) {
        return res.status(403).json({
          error: 'Only the event creator can publish or unpublish check-in QR passes.',
        });
      }
      if (published && evtRec.status === 'draft') {
        return res.status(400).json({
          error: 'Publish the event before publishing check-in QR passes.',
        });
      }

      const { data: updated, error: updErr } = await client
        .from('events')
        .update({ qr_pass_published: published })
        .eq('id', req.params.id)
        .eq('organizer_id', req.user!.id)
        .select('*')
        .single();
      if (updErr) {
        if (isMissingColumnError(updErr)) {
          return res.status(400).json({
            error:
              "Supabase column public.events.qr_pass_published is missing or stale in PostgREST's schema cache. Run the latest supabase/schema.sql in your Supabase SQL Editor.",
          });
        }
        return res.status(400).json({ error: updErr.message });
      }
      return res.json({ event: mapEventRow(updated as Record<string, unknown>) });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update check-in QR pass status.';
      return res.status(500).json({ error: message });
    }
  });

  // Standalone Studio Gift Table Desk Recording (never creates registration/attendee)
  app.post(
    '/api/studio/events/:eventId/gifts',
    requireSupabaseAuth,
    requireRole('creator', 'organizer', 'gate_staff'),
    async (req: AuthedRequest, res) => {
      try {
        const client = req.supabase!;
        const { data: evtRow, error: evtErr } = await client
          .from('events')
          .select('*')
          .eq('id', req.params.eventId)
          .maybeSingle();
        if (evtErr || !evtRow) {
          return res.status(404).json({ error: 'Event not found in studio.' });
        }
        const body = req.body as Partial<GiftTableEntry>;
        const giverName = (body.giverName || '').trim();
        if (!giverName) {
          return res.status(400).json({ error: 'Donor or guest name is required.' });
        }
        const giftType: GiftTableEntry['giftType'] =
          body.giftType === 'cash-momo' || body.giftType === 'registry-item' || body.giftType === 'blessing-only'
            ? body.giftType
            : 'cash-momo';
        const evtMapped = mapEventRow(evtRow as Record<string, unknown>);
        const giftEntry: GiftTableEntry = {
          id: `gift-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`,
          eventId: evtMapped.id,
          giverName,
          giverPhone: body.giverPhone?.trim() ? normalizePhoneE164(body.giverPhone.trim()) : undefined,
          giftType,
          currency: body.currency === 'USD' ? 'USD' : 'GHS',
          amount:
            giftType === 'cash-momo'
              ? Math.max(1, Number(body.amount) || 0)
              : undefined,
          registryItem:
            giftType === 'registry-item'
              ? body.registryItem?.trim() || evtMapped.extraDataConfig?.giftRegistryItems?.[0] || 'Registry Gift'
              : undefined,
          side: body.side?.trim() || undefined,
          message: body.message?.trim() || undefined,
          recordedVia: 'gift-desk',
          recordedBy:
            (body.recordedBy || '').trim() ||
            (req.user?.user_metadata?.name as string | undefined) ||
            'Organiser Desk',
          createdAt: new Date().toISOString(),
        };
        const rawExtra =
          (evtRow as Record<string, unknown>).extra_data_config &&
          typeof (evtRow as Record<string, unknown>).extra_data_config === 'object'
            ? ((evtRow as Record<string, unknown>).extra_data_config as Record<string, unknown>)
            : ({ ...(evtMapped.extraDataConfig ?? { enableGiftTable: true, customFields: [] }) } as Record<string, unknown>);
        const currentLedger = Array.isArray(rawExtra.giftLedger)
          ? (rawExtra.giftLedger as GiftTableEntry[])
          : [];
        const nextExtra = {
          ...rawExtra,
          enableGiftTable: true,
          giftLedger: [giftEntry, ...currentLedger],
        };
        const { data: updatedRow, error: updErr } = await client
          .from('events')
          .update({ extra_data_config: nextExtra })
          .eq('id', evtMapped.id)
          .select('*')
          .single();
        if (updErr) {
          return res.status(400).json({ error: updErr.message });
        }
        return res.status(201).json({
          gift: giftEntry,
          event: mapEventRow(updatedRow as Record<string, unknown>),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to log gift desk entry.';
        return res.status(500).json({ error: message });
      }
    }
  );

  // Create Gift Table Attendant Link (for people appointed to man the Gift Table)
  app.post(
    '/api/studio/events/:eventId/gift-links',
    requireSupabaseAuth,
    requireRole('creator', 'organizer'),
    async (req: AuthedRequest, res) => {
      try {
        const client = req.supabase!;
        const { data: evtRow, error: evtErr } = await client
          .from('events')
          .select('*')
          .eq('id', req.params.eventId)
          .eq('organizer_id', req.user!.id)
          .maybeSingle();
        if (evtErr || !evtRow) {
          return res.status(404).json({ error: 'Event not found in studio.' });
        }
        const body = req.body as { attendantName?: string; roleLabel?: string; phone?: string };
        const attendantName = (body.attendantName || '').trim();
        if (!attendantName) {
          return res.status(400).json({ error: 'Attendant or desk representative name is required.' });
        }
        const evtMapped = mapEventRow(evtRow as Record<string, unknown>);
        const newLink: GiftTableAttendantLink = {
          id: `glink-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`,
          eventId: evtMapped.id,
          token: `gd_${crypto.randomBytes(8).toString('hex')}`,
          attendantName,
          roleLabel: body.roleLabel?.trim() || 'Gift Table Attendant',
          phone: body.phone?.trim() ? normalizePhoneE164(body.phone.trim()) : undefined,
          active: true,
          recordedCount: 0,
          createdAt: new Date().toISOString(),
        };
        const rawExtra =
          (evtRow as Record<string, unknown>).extra_data_config &&
          typeof (evtRow as Record<string, unknown>).extra_data_config === 'object'
            ? ((evtRow as Record<string, unknown>).extra_data_config as Record<string, unknown>)
            : ({ ...(evtMapped.extraDataConfig ?? { enableGiftTable: true, customFields: [] }) } as Record<string, unknown>);
        const currentLinks = Array.isArray(rawExtra.attendantLinks)
          ? (rawExtra.attendantLinks as GiftTableAttendantLink[])
          : [];
        const nextExtra = {
          ...rawExtra,
          enableGiftTable: true,
          attendantLinks: [newLink, ...currentLinks],
        };
        const { data: updatedRow, error: updErr } = await client
          .from('events')
          .update({ extra_data_config: nextExtra })
          .eq('id', evtMapped.id)
          .eq('organizer_id', req.user!.id)
          .select('*')
          .single();
        if (updErr) {
          return res.status(400).json({ error: updErr.message });
        }
        return res.status(201).json({
          link: newLink,
          event: mapEventRow(updatedRow as Record<string, unknown>),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to create attendant link.';
        return res.status(500).json({ error: message });
      }
    }
  );

  // Toggle Gift Table Attendant Link Active/Paused
  app.patch(
    '/api/studio/events/:eventId/gift-links/:linkId',
    requireSupabaseAuth,
    requireRole('creator', 'organizer'),
    async (req: AuthedRequest, res) => {
      try {
        const client = req.supabase!;
        const { data: evtRow, error: evtErr } = await client
          .from('events')
          .select('*')
          .eq('id', req.params.eventId)
          .eq('organizer_id', req.user!.id)
          .maybeSingle();
        if (evtErr || !evtRow) {
          return res.status(404).json({ error: 'Event not found in studio.' });
        }
        const evtMapped = mapEventRow(evtRow as Record<string, unknown>);
        const rawExtra =
          (evtRow as Record<string, unknown>).extra_data_config &&
          typeof (evtRow as Record<string, unknown>).extra_data_config === 'object'
            ? ((evtRow as Record<string, unknown>).extra_data_config as Record<string, unknown>)
            : ({ ...(evtMapped.extraDataConfig ?? { enableGiftTable: true, customFields: [] }) } as Record<string, unknown>);
        const currentLinks = Array.isArray(rawExtra.attendantLinks)
          ? (rawExtra.attendantLinks as GiftTableAttendantLink[])
          : [];
        const existing = currentLinks.find((l) => l.id === req.params.linkId);
        if (!existing) {
          return res.status(404).json({ error: 'Gift Table attendant link not found.' });
        }
        const requestedActive = (req.body as { active?: boolean } | undefined)?.active;
        const nextActive = requestedActive !== undefined ? Boolean(requestedActive) : !existing.active;
        const updatedLink: GiftTableAttendantLink = { ...existing, active: nextActive };
        const nextExtra = {
          ...rawExtra,
          attendantLinks: currentLinks.map((l) => (l.id === existing.id ? updatedLink : l)),
        };
        const { data: updatedRow, error: updErr } = await client
          .from('events')
          .update({ extra_data_config: nextExtra })
          .eq('id', evtMapped.id)
          .eq('organizer_id', req.user!.id)
          .select('*')
          .single();
        if (updErr) {
          return res.status(400).json({ error: updErr.message });
        }
        return res.json({
          link: updatedLink,
          event: mapEventRow(updatedRow as Record<string, unknown>),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to update attendant link.';
        return res.status(500).json({ error: message });
      }
    }
  );

  // Delete Gift Table Attendant Link
  app.delete(
    '/api/studio/events/:eventId/gift-links/:linkId',
    requireSupabaseAuth,
    requireRole('creator', 'organizer'),
    async (req: AuthedRequest, res) => {
      try {
        const client = req.supabase!;
        const { data: evtRow, error: evtErr } = await client
          .from('events')
          .select('*')
          .eq('id', req.params.eventId)
          .eq('organizer_id', req.user!.id)
          .maybeSingle();
        if (evtErr || !evtRow) {
          return res.status(404).json({ error: 'Event not found in studio.' });
        }
        const evtMapped = mapEventRow(evtRow as Record<string, unknown>);
        const rawExtra =
          (evtRow as Record<string, unknown>).extra_data_config &&
          typeof (evtRow as Record<string, unknown>).extra_data_config === 'object'
            ? ((evtRow as Record<string, unknown>).extra_data_config as Record<string, unknown>)
            : ({ ...(evtMapped.extraDataConfig ?? { enableGiftTable: true, customFields: [] }) } as Record<string, unknown>);
        const currentLinks = Array.isArray(rawExtra.attendantLinks)
          ? (rawExtra.attendantLinks as GiftTableAttendantLink[])
          : [];
        const nextExtra = {
          ...rawExtra,
          attendantLinks: currentLinks.filter((l) => l.id !== req.params.linkId),
        };
        const { data: updatedRow, error: updErr } = await client
          .from('events')
          .update({ extra_data_config: nextExtra })
          .eq('id', evtMapped.id)
          .eq('organizer_id', req.user!.id)
          .select('*')
          .single();
        if (updErr) {
          return res.status(400).json({ error: updErr.message });
        }
        return res.json({
          ok: true,
          event: mapEventRow(updatedRow as Record<string, unknown>),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to delete attendant link.';
        return res.status(500).json({ error: message });
      }
    }
  );

  app.delete('/api/studio/events/:id', requireSupabaseAuth, requireRole('creator', 'organizer'), async (req: AuthedRequest, res) => {
    try {
      const { error } = await req
        .supabase!.from('events')
        .delete()
        .eq('id', req.params.id)
        .eq('organizer_id', req.user!.id);
      if (error) return res.status(400).json({ error: error.message });
      return res.json({ ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete event.';
      return res.status(500).json({ error: message });
    }
  });

  app.post('/api/studio/events/:eventId/attendees', requireSupabaseAuth, requireRole('creator', 'organizer'), async (req: AuthedRequest, res) => {
    const attendee = req.body as Attendee;
    const { eventId } = req.params;
    try {
      const client = req.supabase!;
      const { data: evt, error: evtFetchErr } = await client
        .from('events')
        .select('*')
        .eq('id', eventId)
        .maybeSingle();
      if (evtFetchErr || !evt) {
        return res.status(404).json({ error: 'Event not found in your organizer studio.' });
      }
      const evtCheckRec = evt as Record<string, unknown>;
      if (String(evtCheckRec.organizer_id) !== req.user!.id) {
        return res.status(403).json({
          error: 'Only the event creator can issue check-in QR passes for this event.',
        });
      }
      if (evtCheckRec.qr_pass_published === false) {
        return res.status(403).json({
          error: 'Check-in QR passes have not been published yet. Publish the Check-In QR Pass as the event creator first.',
        });
      }

      const normalizedPhone = normalizePhoneE164(attendee.phone);
      const evtMapped = mapEventRow(evtCheckRec);
      let replyTo: string | undefined;
      let orgSenderId: string | undefined;
      const { data: orgProf } = await client
        .from('profiles')
        .select('reply_to_email, sender_id')
        .eq('id', req.user!.id)
        .maybeSingle();
      const orgProfRec = orgProf as Record<string, unknown> | null;
      if (orgProfRec && typeof orgProfRec.reply_to_email === 'string') {
        replyTo = orgProfRec.reply_to_email;
      }
      if (orgProfRec && typeof orgProfRec.sender_id === 'string' && orgProfRec.sender_id.trim()) {
        orgSenderId = orgProfRec.sender_id.trim();
      }

      const studioMsgType = attendee.checkedIn ? 'checkin' : 'confirmation';
      const studioResolvedMsg = resolveEventMessage({
        type: studioMsgType,
        event: evtMapped,
        attendeeName: attendee.name,
        ticketCode: attendee.ticketCode,
        originOverride: resolveBaseUrl(req),
        includeGuestInCameraUrl: true,
      });

      const [smsDelivery, emailDelivery] = await Promise.all([
        dispatchOptionalArkeselSms(
          normalizedPhone,
          evtMapped.title,
          attendee.ticketCode,
          evtMapped.senderId || orgSenderId,
          studioResolvedMsg.text
        ),
        isResendConfigured() && attendee.email?.includes('@')
          ? attendee.checkedIn
            ? sendCheckInWelcomeEmail({
                to: attendee.email.trim(),
                attendeeName: attendee.name,
                eventTitle: evtMapped.title,
                eventDate: evtMapped.date,
                eventVenue: evtMapped.venue,
                eventCity: evtMapped.city,
                ticketCode: attendee.ticketCode,
                organizerName: evtMapped.organizer,
                welcomeMessage: studioResolvedMsg.text,
                cameraUrl: studioResolvedMsg.cameraUrl,
                replyTo,
              })
            : sendEventPassEmail({
                to: attendee.email.trim(),
                attendeeName: attendee.name,
                eventTitle: evtMapped.title,
                eventDate: evtMapped.date,
                eventTime: evtMapped.time,
                eventVenue: evtMapped.venue,
                eventCity: evtMapped.city,
                ticketCode: attendee.ticketCode,
                tier: attendee.tier || 'General',
                organizerName: evtMapped.organizer,
                replyTo,
                customMessage: studioResolvedMsg.text,
                cameraUrl: studioResolvedMsg.cameraUrl,
              })
          : Promise.resolve({ ok: false, skipped: true }),
      ]);

      const hasLiveArkesel = Boolean((process.env.ARKESEL_API_KEY || '').trim()) && platformRuntime.flags.smsMode !== 'sandbox';
      const resolvedSmsStatus: Attendee['smsStatus'] =
        emailDelivery.ok && (!hasLiveArkesel || smsDelivery === 'Pending')
          ? 'Resend Delivered'
          : attendee.smsStatus || smsDelivery;

      const attInsertPayload: Record<string, unknown> = {
        id: attendee.id,
        event_id: eventId,
        name: attendee.name,
        email: attendee.email,
        phone: normalizedPhone,
        organization: attendee.organization || 'General Guest',
        tier: attendee.tier || 'General',
        checked_in: Boolean(attendee.checkedIn),
        checked_in_at: attendee.checkedInAt ?? null,
        ticket_code: attendee.ticketCode,
        sms_status: resolvedSmsStatus,
        payment_status: attendee.paymentStatus || 'paid',
        validation_group: attendee.validationGroup ?? null,
        invite_code_used: attendee.inviteCodeUsed ?? null,
        gift_entry: attendee.giftEntry ?? null,
        custom_responses: attendee.customResponses ?? null,
      };

      let usedLegacyAttendeeFallback = false;
      let { data: inserted, error: attErr } = await client
        .from('attendees')
        .insert(attInsertPayload)
        .select('*')
        .single();
      if (attErr && isMissingColumnError(attErr)) {
        usedLegacyAttendeeFallback = true;
        const {
          validation_group: _vg,
          invite_code_used: _ic,
          gift_entry: _ge,
          custom_responses: _cr,
          ...legacyAtt
        } = attInsertPayload;
        const retryAtt = await client.from('attendees').insert(legacyAtt).select('*').single();
        inserted = retryAtt.data;
        attErr = retryAtt.error;
      }

      if (attErr) {
        if (attErr.code === '23505') {
          return res.status(409).json({
            error: `Duplicate shield: ${normalizedPhone} is already registered for this event.`,
          });
        }
        return res.status(400).json({ error: attErr.message });
      }

      const insertedId = String((inserted as Record<string, unknown>).id);
      if (usedLegacyAttendeeFallback) {
        const adminOrClient = createServiceSupabaseClient() ?? client;
        await mergeEventAttendeeMeta(adminOrClient, eventId, insertedId, {
          validationGroup: attendee.validationGroup,
          inviteCodeUsed: attendee.inviteCodeUsed,
          giftEntry: attendee.giftEntry,
          customResponses: attendee.customResponses,
        });
      }

      const evtRec = evt as Record<string, unknown>;
      const { data: updatedEvt, error: evtUpdErr } = await client
        .from('events')
        .update({
          registered: Number(evtRec.registered ?? 0) + 1,
          sms_dispatched: Number(evtRec.sms_dispatched ?? 0) + 1,
          revenue: Number(evtRec.revenue ?? 0) + Number(evtRec.ticket_price ?? 0),
          checked_in: attendee.checkedIn
            ? Number(evtRec.checked_in ?? 0) + 1
            : Number(evtRec.checked_in ?? 0),
        })
        .eq('id', eventId)
        .select('*')
        .single();

      if (evtUpdErr) return res.status(400).json({ error: evtUpdErr.message });

      const mappedAtt = mapAttendeeRow(inserted as Record<string, unknown>);
      if (usedLegacyAttendeeFallback) {
        mappedAtt.validationGroup = mappedAtt.validationGroup ?? attendee.validationGroup;
        mappedAtt.inviteCodeUsed = mappedAtt.inviteCodeUsed ?? attendee.inviteCodeUsed;
        mappedAtt.giftEntry = mappedAtt.giftEntry ?? attendee.giftEntry;
        mappedAtt.customResponses = mappedAtt.customResponses ?? attendee.customResponses;
      }

      return res.status(201).json({
        attendee: mappedAtt,
        event: mapEventRow(updatedEvt as Record<string, unknown>),
        cameraUrl: studioResolvedMsg.cameraUrl,
        dispatchedMessage: studioResolvedMsg.text,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to register attendee.';
      return res.status(500).json({ error: message });
    }
  });

  app.patch('/api/studio/attendees/:id/checkin', requireSupabaseAuth, requireRole('creator', 'organizer', 'gate_staff'), async (req: AuthedRequest, res) => {
    try {
      const client = req.supabase!;
      const { data: existing, error: fetchErr } = await client
        .from('attendees')
        .select('*')
        .eq('id', req.params.id)
        .single();
      if (fetchErr || !existing) {
        return res.status(404).json({ error: 'Attendee not found.' });
      }
      const rec = existing as Record<string, unknown>;
      const nextCheckedIn = !Boolean(rec.checked_in);
      const checkedInAt = nextCheckedIn
        ? new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
        : null;

      const { data: updatedAtt, error: updErr } = await client
        .from('attendees')
        .update({ checked_in: nextCheckedIn, checked_in_at: checkedInAt })
        .eq('id', req.params.id)
        .select('*')
        .single();
      if (updErr) return res.status(400).json({ error: updErr.message });

      const eventId = String(rec.event_id);
      const { data: evtRow } = await client
        .from('events')
        .select('*')
        .eq('id', eventId)
        .single();

      if (evtRow) {
        const currentChecked = Number((evtRow as Record<string, unknown>).checked_in ?? 0);
        const nextTotal = Math.max(0, currentChecked + (nextCheckedIn ? 1 : -1));
        await client.from('events').update({ checked_in: nextTotal }).eq('id', eventId);
      }

      const attMetaMap = evtRow
        ? extractEventAttendeeMetaMap((evtRow as Record<string, unknown>).extra_data_config)
        : undefined;
      const mappedAttendee = hydrateAttendeeWithEventMeta(
        mapAttendeeRow(updatedAtt as Record<string, unknown>),
        attMetaMap
      );
      let checkInMessageSent = false;
      let cameraUrl: string | undefined;
      let dispatchedMessage: string | undefined;

      if (nextCheckedIn && evtRow) {
        const evtMapped = mapEventRow(evtRow as Record<string, unknown>);
        const resolved = resolveEventMessage({
          type: 'checkin',
          event: evtMapped,
          attendeeName: mappedAttendee.name,
          ticketCode: mappedAttendee.ticketCode,
          originOverride: resolveBaseUrl(req),
          includeGuestInCameraUrl: true,
        });
        cameraUrl = resolved.cameraUrl;
        dispatchedMessage = resolved.text;

        let replyTo: string | undefined;
        let orgSenderId: string | undefined;
        const { data: orgProf } = await client
          .from('profiles')
          .select('reply_to_email, sender_id')
          .eq('id', String((evtRow as Record<string, unknown>).organizer_id || req.user!.id))
          .maybeSingle();
        const orgProfRec = orgProf as Record<string, unknown> | null;
        if (orgProfRec && typeof orgProfRec.reply_to_email === 'string') {
          replyTo = orgProfRec.reply_to_email;
        }
        if (orgProfRec && typeof orgProfRec.sender_id === 'string' && orgProfRec.sender_id.trim()) {
          orgSenderId = orgProfRec.sender_id.trim();
        }

        await Promise.all([
          mappedAttendee.phone
            ? dispatchOptionalArkeselSms(
                normalizePhoneE164(mappedAttendee.phone),
                evtMapped.title,
                mappedAttendee.ticketCode,
                evtMapped.senderId || orgSenderId,
                resolved.text
              )
            : Promise.resolve('Pending' as const),
          isResendConfigured() && mappedAttendee.email?.includes('@')
            ? sendCheckInWelcomeEmail({
                to: mappedAttendee.email.trim(),
                attendeeName: mappedAttendee.name,
                eventTitle: evtMapped.title,
                eventDate: evtMapped.date,
                eventVenue: evtMapped.venue,
                eventCity: evtMapped.city,
                ticketCode: mappedAttendee.ticketCode,
                organizerName: evtMapped.organizer,
                welcomeMessage: resolved.text,
                cameraUrl: resolved.cameraUrl,
                replyTo,
              })
            : Promise.resolve({ ok: false, skipped: true }),
        ]);
        checkInMessageSent = true;
      }

      return res.json({ attendee: mappedAttendee, checkInMessageSent, cameraUrl, dispatchedMessage });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to toggle check-in.';
      return res.status(500).json({ error: message });
    }
  });

  app.patch(
    '/api/studio/attendees/:id/retry-payment',
    requireSupabaseAuth,
    requireRole('creator', 'organizer'),
    async (req: AuthedRequest, res) => {
      try {
        const client = req.supabase!;
        const { data: updated, error } = await client
          .from('attendees')
          .update({ payment_status: 'paid' })
          .eq('id', req.params.id)
          .select('*')
          .single();
        if (error) return res.status(400).json({ error: error.message });

        await client
          .from('system_alerts')
          .update({ resolved: true })
          .eq('organizer_id', req.user!.id)
          .eq('category', 'payment');

        return res.json({ attendee: mapAttendeeRow(updated as Record<string, unknown>) });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Payment retry failed.';
        return res.status(500).json({ error: message });
      }
    }
  );

  app.post(
    '/api/studio/broadcast',
    requireSupabaseAuth,
    requireRole('creator', 'organizer'),
    async (req: AuthedRequest, res) => {
      const { attendeeIds, message } = req.body as {
        eventId?: string;
        attendeeIds?: string[];
        message?: string;
      };
      const cleanMessage = (message || '').trim();
      if (!cleanMessage) {
        return res.status(400).json({ error: 'Broadcast message text is required.' });
      }
      if (!Array.isArray(attendeeIds) || attendeeIds.length === 0) {
        return res.status(400).json({ error: 'Select at least one recipient for the broadcast.' });
      }
      try {
        const client = req.supabase!;
        const [{ data: ownedEvents, error: evtsErr }, { data: orgProf }, { data: targetAttRows, error: attErr }] =
          await Promise.all([
            client.from('events').select('*').eq('organizer_id', req.user!.id),
            client.from('profiles').select('reply_to_email, sender_id').eq('id', req.user!.id).maybeSingle(),
            client.from('attendees').select('*').in('id', attendeeIds),
          ]);
        if (evtsErr) return res.status(400).json({ error: evtsErr.message });
        if (attErr) return res.status(400).json({ error: attErr.message });

        const eventById = new Map<string, Record<string, unknown>>();
        for (const r of ownedEvents ?? []) {
          const rec = r as Record<string, unknown>;
          eventById.set(String(rec.id), rec);
        }

        const ownedAttendees = (targetAttRows ?? [])
          .map((r) => mapAttendeeRow(r as Record<string, unknown>))
          .filter((att) => eventById.has(att.eventId));

        if (ownedAttendees.length === 0) {
          return res.status(404).json({ error: 'No matching attendees found in your studio.' });
        }

        const profRec = orgProf as Record<string, unknown> | null;
        const replyTo = typeof profRec?.reply_to_email === 'string' ? profRec.reply_to_email : undefined;
        const orgSenderId =
          typeof profRec?.sender_id === 'string' && profRec.sender_id.trim()
            ? profRec.sender_id.trim()
            : undefined;

        const countsByEvent = new Map<string, number>();
        let sentCount = 0;

        await Promise.all(
          ownedAttendees.map(async (att) => {
            const rawEvt = eventById.get(att.eventId)!;
            const evtMapped = mapEventRow(rawEvt);
            const personalizedText = cleanMessage
              .replace(/\{name\}/gi, att.name)
              .replace(/\{event\}/gi, evtMapped.title)
              .replace(/\{ticket_code\}/gi, att.ticketCode);
            const cameraUrl = `${resolveBaseUrl(req)}/e/${encodeURIComponent(evtMapped.slug || evtMapped.id)}/camera?pass=${encodeURIComponent(att.ticketCode)}&guest=${encodeURIComponent(att.name)}`;

            const [smsRes, emailRes] = await Promise.all([
              att.phone
                ? dispatchOptionalArkeselSms(
                    normalizePhoneE164(att.phone),
                    evtMapped.title,
                    att.ticketCode,
                    evtMapped.senderId || orgSenderId,
                    personalizedText
                  )
                : Promise.resolve('Pending' as const),
              isResendConfigured() && att.email?.includes('@')
                ? sendCheckInWelcomeEmail({
                    to: att.email.trim(),
                    attendeeName: att.name,
                    eventTitle: evtMapped.title,
                    eventDate: evtMapped.date,
                    eventVenue: evtMapped.venue,
                    eventCity: evtMapped.city,
                    ticketCode: att.ticketCode,
                    organizerName: evtMapped.organizer,
                    welcomeMessage: personalizedText,
                    cameraUrl,
                    replyTo,
                  })
                : Promise.resolve({ ok: false, skipped: true }),
            ]);

            if (smsRes !== 'Pending' || emailRes.ok) {
              sentCount += 1;
            }
            countsByEvent.set(att.eventId, (countsByEvent.get(att.eventId) ?? 0) + 1);
          })
        );

        const updatedEvents: EventItem[] = [];
        for (const [evtId, count] of countsByEvent.entries()) {
          const rawEvt = eventById.get(evtId)!;
          const nextDispatched = Number(rawEvt.sms_dispatched ?? 0) + count;
          const { data: updEvt } = await client
            .from('events')
            .update({ sms_dispatched: nextDispatched })
            .eq('id', evtId)
            .eq('organizer_id', req.user!.id)
            .select('*')
            .single();
          if (updEvt) {
            updatedEvents.push(mapEventRow(updEvt as Record<string, unknown>));
          }
        }

        return res.json({
          ok: true,
          recipientCount: ownedAttendees.length,
          sentCount,
          events: updatedEvents,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Broadcast dispatch failed.';
        return res.status(500).json({ error: message });
      }
    }
  );

  app.post('/api/studio/schedule', requireSupabaseAuth, requireRole('creator', 'organizer'), async (req: AuthedRequest, res) => {
    const block = req.body as ScheduleBlock;
    try {
      const { data, error } = await req
        .supabase!.from('schedule_blocks')
        .insert({
          id: block.id,
          event_id: block.eventId,
          time: block.time,
          duration: block.duration,
          title: block.title,
          stage: block.stage,
          lead: block.lead,
          completed: Boolean(block.completed),
          day: block.day,
        })
        .select('*')
        .single();
      if (error) return res.status(400).json({ error: error.message });
      return res.status(201).json({ block: mapScheduleRow(data as Record<string, unknown>) });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to add schedule block.';
      return res.status(500).json({ error: message });
    }
  });

  app.patch('/api/studio/schedule/:id/toggle', requireSupabaseAuth, requireRole('creator', 'organizer'), async (req: AuthedRequest, res) => {
    try {
      const client = req.supabase!;
      const { data: existing, error: fetchErr } = await client
        .from('schedule_blocks')
        .select('*')
        .eq('id', req.params.id)
        .single();
      if (fetchErr || !existing) return res.status(404).json({ error: 'Schedule block not found.' });

      const nextCompleted = !Boolean((existing as Record<string, unknown>).completed);
      const { data: updated, error: updErr } = await client
        .from('schedule_blocks')
        .update({ completed: nextCompleted })
        .eq('id', req.params.id)
        .select('*')
        .single();
      if (updErr) return res.status(400).json({ error: updErr.message });
      return res.json({ block: mapScheduleRow(updated as Record<string, unknown>) });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to toggle schedule block.';
      return res.status(500).json({ error: message });
    }
  });

  app.delete('/api/studio/schedule/:id', requireSupabaseAuth, requireRole('creator', 'organizer'), async (req: AuthedRequest, res) => {
    try {
      const { error } = await req
        .supabase!.from('schedule_blocks')
        .delete()
        .eq('id', req.params.id);
      if (error) return res.status(400).json({ error: error.message });
      return res.json({ ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete schedule block.';
      return res.status(500).json({ error: message });
    }
  });

  app.patch('/api/studio/alerts/:id/resolve', requireSupabaseAuth, requireRole('creator', 'organizer'), async (req: AuthedRequest, res) => {
    try {
      const { data, error } = await req
        .supabase!.from('system_alerts')
        .update({ resolved: true })
        .eq('id', req.params.id)
        .eq('organizer_id', req.user!.id)
        .select('*')
        .single();
      if (error) return res.status(400).json({ error: error.message });
      return res.json({ alert: mapAlertRow(data as Record<string, unknown>) });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to resolve alert.';
      return res.status(500).json({ error: message });
    }
  });

  // Disposable Camera Routes
  app.post('/api/studio/camera/shots', requireSupabaseAuth, requireRole('creator', 'organizer', 'gate_staff'), async (req: AuthedRequest, res) => {
    const shot = req.body as DisposableShot;
    try {
      const client = req.supabase!;
      const [existingShotsRes, rollRes, rawEvtRes] = await Promise.all([
        client.from('disposable_shots').select('*').eq('event_id', shot.eventId),
        client.from('disposable_roll_settings').select('*').eq('event_id', shot.eventId).maybeSingle(),
        client.from('events').select('extra_data_config').eq('id', shot.eventId).maybeSingle(),
      ]);
      const shotShooters = extractEventShotShootersMap(
        (rawEvtRes.data as Record<string, unknown> | null)?.extra_data_config
      );
      const existingShots = (existingShotsRes.data ?? []).map((r) =>
        hydrateShotWithEventMeta(mapShotRow(r as Record<string, unknown>), shotShooters)
      );
      const rollCfg = rollRes.data
        ? mapRollSettingsRow(rollRes.data as Record<string, unknown>)
        : { exposuresLimit: 24 as const, darkroomMode: false };

      if (existingShots.length >= rollCfg.exposuresLimit) {
        return res.status(403).json({
          error: `Film roll full (${rollCfg.exposuresLimit}/${rollCfg.exposuresLimit} exposures).`,
        });
      }

      const effectiveKey = (shot.shooterKey || '').trim();
      const normalizedAuthor = (shot.capturedBy || 'Guest').trim().toLowerCase();
      const userShotCount = existingShots.filter((s) =>
        effectiveKey && s.shooterKey
          ? s.shooterKey === effectiveKey
          : s.capturedBy.trim().toLowerCase() === normalizedAuthor
      ).length;

      if (userShotCount >= MAX_SHOTS_PER_USER) {
        return res.status(403).json({
          error: `Camera limit reached: each user is allowed up to ${MAX_SHOTS_PER_USER} pictures per event.`,
        });
      }

      const shotPayload: Record<string, unknown> = {
        id: shot.id,
        event_id: shot.eventId,
        frame_number: shot.frameNumber,
        data_url: shot.dataUrl,
        captured_by: shot.capturedBy,
        shooter_key: effectiveKey || null,
        caption: shot.caption ?? null,
        film_stock: shot.filmStock,
        date_stamp: shot.dateStamp,
        captured_at: shot.capturedAt,
        developed: Boolean(shot.developed),
        likes: shot.likes ?? 0,
        liked: Boolean(shot.liked),
      };

      let usedShooterFallback = false;
      let { data, error } = await client
        .from('disposable_shots')
        .insert(shotPayload)
        .select('*')
        .single();
      if (error && isMissingColumnError(error)) {
        usedShooterFallback = true;
        const { shooter_key: _sk, ...legacyShot } = shotPayload;
        const retry = await client
          .from('disposable_shots')
          .insert(legacyShot)
          .select('*')
          .single();
        data = retry.data;
        error = retry.error;
      }
      if (error) return res.status(400).json({ error: error.message });
      const mappedShot = mapShotRow(data as Record<string, unknown>);
      if (usedShooterFallback && effectiveKey) {
        const adminOrClient = createServiceSupabaseClient() ?? client;
        await mergeEventShotShooter(adminOrClient, shot.eventId, mappedShot.id, effectiveKey);
        mappedShot.shooterKey = effectiveKey;
      }
      return res.status(201).json({ shot: mappedShot });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save film frame.';
      return res.status(500).json({ error: message });
    }
  });

  app.patch('/api/studio/camera/shots/:id/like', requireSupabaseAuth, requireRole('creator', 'organizer', 'gate_staff'), async (req: AuthedRequest, res) => {
    try {
      const client = req.supabase!;
      const { data: existing, error: fetchErr } = await client
        .from('disposable_shots')
        .select('*')
        .eq('id', req.params.id)
        .single();
      if (fetchErr || !existing) return res.status(404).json({ error: 'Shot not found.' });

      const rec = existing as Record<string, unknown>;
      const nextLiked = !Boolean(rec.liked);
      const nextLikes = nextLiked
        ? Number(rec.likes ?? 0) + 1
        : Math.max(0, Number(rec.likes ?? 0) - 1);

      const { data: updated, error: updErr } = await client
        .from('disposable_shots')
        .update({ liked: nextLiked, likes: nextLikes })
        .eq('id', req.params.id)
        .select('*')
        .single();
      if (updErr) return res.status(400).json({ error: updErr.message });
      return res.json({ shot: mapShotRow(updated as Record<string, unknown>) });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update like.';
      return res.status(500).json({ error: message });
    }
  });

  app.delete('/api/studio/camera/shots/:id', requireSupabaseAuth, requireRole('creator', 'organizer'), async (req: AuthedRequest, res) => {
    try {
      const { error } = await req
        .supabase!.from('disposable_shots')
        .delete()
        .eq('id', req.params.id);
      if (error) return res.status(400).json({ error: error.message });
      return res.json({ ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete shot.';
      return res.status(500).json({ error: message });
    }
  });

  app.post('/api/studio/camera/:eventId/develop', requireSupabaseAuth, requireRole('creator', 'organizer'), async (req: AuthedRequest, res) => {
    try {
      const { error } = await req
        .supabase!.from('disposable_shots')
        .update({ developed: true })
        .eq('event_id', req.params.eventId);
      if (error) return res.status(400).json({ error: error.message });
      return res.json({ ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to develop film roll.';
      return res.status(500).json({ error: message });
    }
  });

  app.put('/api/studio/camera/:eventId/settings', requireSupabaseAuth, requireRole('creator', 'organizer'), async (req: AuthedRequest, res) => {
    const next = req.body as DisposableRollSettings;
    try {
      const { data, error } = await req
        .supabase!.from('disposable_roll_settings')
        .upsert(
          {
            event_id: req.params.eventId,
            exposures_limit: next.exposuresLimit,
            darkroom_mode: Boolean(next.darkroomMode),
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'event_id' }
        )
        .select('*')
        .single();
      if (error) return res.status(400).json({ error: error.message });
      return res.json({ settings: mapRollSettingsRow(data as Record<string, unknown>) });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update roll settings.';
      return res.status(500).json({ error: message });
    }
  });

  // =========================================================================
  // APPS CREATOR CONSOLE ROUTES (Supabase Single Source of Truth)
  // =========================================================================

  app.get('/api/studio/apps', requireSupabaseAuth, requireCreatorVerification, async (req: AuthedRequest, res) => {
    try {
      const { data, error } = await req
        .supabase!.from('creator_apps')
        .select('*')
        .eq('organizer_id', req.user!.id)
        .order('created_at', { ascending: false });
      if (error) {
        if (isMissingTableError(error)) {
          return res.json({ apps: [] });
        }
        return res.status(400).json({ error: error.message });
      }
      return res.json({
        apps: (data ?? []).map((r) => mapCreatorAppRow(r as Record<string, unknown>)),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load creator apps.';
      return res.status(500).json({ error: message });
    }
  });

  app.post('/api/studio/apps', requireSupabaseAuth, requireCreatorVerification, async (req: AuthedRequest, res) => {
    const {
      name,
      description,
      appType,
      environment,
      eventId,
      scopes,
      webhookUrl,
      webhookEvents,
      allowedOrigins,
    } = req.body as {
      name?: string;
      description?: string;
      appType?: CreatorApp['appType'];
      environment?: CreatorApp['environment'];
      eventId?: string;
      scopes?: CreatorApp['scopes'];
      webhookUrl?: string;
      webhookEvents?: CreatorApp['webhookEvents'];
      allowedOrigins?: string[];
    };

    if (!name?.trim()) {
      return res.status(400).json({ error: 'App name is required.' });
    }

    const env = environment === 'production' ? 'production' : 'sandbox';
    const appId = `app-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
    const slug = name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || appId;
    const clientId = generateClientId(env);
    const { rawSecret, secretHash, secretPrefix } = generateAppSecret(env);
    const webhookSecret = generateWebhookSecret();

    try {
      const client = req.supabase!;
      const { data, error } = await client
        .from('creator_apps')
        .insert({
          id: appId,
          organizer_id: req.user!.id,
          name: name.trim(),
          slug,
          description: (description || '').trim(),
          app_type: appType || 'widget',
          environment: env,
          status: 'active',
          event_id: eventId || null,
          client_id: clientId,
          secret_hash: secretHash,
          secret_prefix: secretPrefix,
          webhook_secret: webhookSecret,
          scopes: Array.isArray(scopes) && scopes.length > 0 ? scopes : ['events:read', 'attendees:read'],
          webhook_url: webhookUrl?.trim() || null,
          webhook_events: Array.isArray(webhookEvents) ? webhookEvents : [],
          allowed_origins: Array.isArray(allowedOrigins) ? allowedOrigins : [],
          requests_count: 1,
          last_used_at: 'Just now',
        })
        .select('*')
        .single();

      if (error) {
        if (isMissingTableError(error)) {
          return res.status(503).json({
            error:
              'Database table creator_apps is missing in Supabase. Run the updated supabase/schema.sql in your Supabase SQL Editor.',
          });
        }
        return res.status(400).json({ error: error.message });
      }

      const logId = `log-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`;
      const { data: logRow } = await client
        .from('creator_app_logs')
        .insert({
          id: logId,
          app_id: appId,
          event_type: 'app.provisioned',
          method: 'POST',
          endpoint: '/api/studio/apps',
          status_code: 201,
          latency_ms: 14,
          request_summary: `Provisioned ${name.trim()} (${env}) with ${(scopes ?? ['events:read', 'attendees:read']).length} scopes`,
          response_summary: `client_id=${clientId}`,
        })
        .select('*')
        .maybeSingle();

      return res.status(201).json({
        app: mapCreatorAppRow(data as Record<string, unknown>),
        rawSecret,
        webhookSecret,
        log: logRow ? mapCreatorAppLogRow(logRow as Record<string, unknown>) : null,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create app.';
      return res.status(500).json({ error: message });
    }
  });

  app.patch('/api/studio/apps/:id', requireSupabaseAuth, requireCreatorVerification, async (req: AuthedRequest, res) => {
    const patch = req.body as Record<string, unknown>;
    try {
      const updatePayload: Record<string, unknown> = {};
      if (typeof patch.name === 'string' && patch.name.trim()) updatePayload.name = patch.name.trim();
      if (typeof patch.description === 'string') updatePayload.description = patch.description.trim();
      if (typeof patch.appType === 'string') updatePayload.app_type = patch.appType;
      if (typeof patch.environment === 'string') updatePayload.environment = patch.environment;
      if (typeof patch.status === 'string') updatePayload.status = patch.status;
      if (patch.eventId !== undefined) updatePayload.event_id = patch.eventId || null;
      if (Array.isArray(patch.scopes)) updatePayload.scopes = patch.scopes;
      if (patch.webhookUrl !== undefined) updatePayload.webhook_url = patch.webhookUrl || null;
      if (Array.isArray(patch.webhookEvents)) updatePayload.webhook_events = patch.webhookEvents;
      if (Array.isArray(patch.allowedOrigins)) updatePayload.allowed_origins = patch.allowedOrigins;

      const { data, error } = await req
        .supabase!.from('creator_apps')
        .update(updatePayload)
        .eq('id', req.params.id)
        .eq('organizer_id', req.user!.id)
        .select('*')
        .single();

      if (error) return res.status(400).json({ error: error.message });
      return res.json({ app: mapCreatorAppRow(data as Record<string, unknown>) });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update creator app.';
      return res.status(500).json({ error: message });
    }
  });

  app.post('/api/studio/apps/:id/rotate-secret', requireSupabaseAuth, requireCreatorVerification, async (req: AuthedRequest, res) => {
    try {
      const client = req.supabase!;
      const { data: existing, error: fetchErr } = await client
        .from('creator_apps')
        .select('*')
        .eq('id', req.params.id)
        .eq('organizer_id', req.user!.id)
        .single();

      if (fetchErr || !existing) {
        return res.status(404).json({ error: 'Creator app not found.' });
      }

      const env = (existing as Record<string, unknown>).environment === 'production' ? 'production' : 'sandbox';
      const { rawSecret, secretHash, secretPrefix } = generateAppSecret(env);
      const webhookSecret = generateWebhookSecret();

      const { data: updated, error: updErr } = await client
        .from('creator_apps')
        .update({
          secret_hash: secretHash,
          secret_prefix: secretPrefix,
          webhook_secret: webhookSecret,
        })
        .eq('id', req.params.id)
        .eq('organizer_id', req.user!.id)
        .select('*')
        .single();

      if (updErr) return res.status(400).json({ error: updErr.message });

      const logId = `log-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`;
      const { data: logRow } = await client
        .from('creator_app_logs')
        .insert({
          id: logId,
          app_id: req.params.id,
          event_type: 'credentials.rotated',
          method: 'POST',
          endpoint: `/api/studio/apps/${req.params.id}/rotate-secret`,
          status_code: 200,
          latency_ms: 19,
          request_summary: 'Rotated client secret & HMAC signing key',
          response_summary: `new_prefix=${secretPrefix}`,
        })
        .select('*')
        .maybeSingle();

      return res.json({
        app: mapCreatorAppRow(updated as Record<string, unknown>),
        rawSecret,
        webhookSecret,
        log: logRow ? mapCreatorAppLogRow(logRow as Record<string, unknown>) : null,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to rotate secret.';
      return res.status(500).json({ error: message });
    }
  });

  app.post('/api/studio/apps/:id/test-webhook', requireSupabaseAuth, requireCreatorVerification, async (req: AuthedRequest, res) => {
    const { eventType } = req.body as { eventType?: string };
    const trigger = eventType || 'attendee.registered';
    try {
      const client = req.supabase!;
      const { data: existing, error: fetchErr } = await client
        .from('creator_apps')
        .select('*')
        .eq('id', req.params.id)
        .eq('organizer_id', req.user!.id)
        .single();

      if (fetchErr || !existing) {
        return res.status(404).json({ error: 'Creator app not found.' });
      }

      const rec = existing as Record<string, unknown>;
      const webhookUrl = rec.webhook_url ? String(rec.webhook_url).trim() : '';
      const webhookSecret = String(rec.webhook_secret ?? 'whsec_test');
      const payload = {
        id: `evt_wh_${crypto.randomBytes(6).toString('hex')}`,
        type: trigger,
        createdAt: new Date().toISOString(),
        appId: String(rec.id),
        clientId: String(rec.client_id),
        environment: String(rec.environment ?? 'sandbox'),
        data: {
          eventId: rec.event_id ? String(rec.event_id) : 'evt-test-webhook',
          attendeeName: 'Test Webhook Attendee',
          ticketCode: '#EVT-TEST-2026',
          smsStatus: 'Arkesel Sent',
        },
      };

      const bodyString = JSON.stringify(payload);
      const signature = crypto
        .createHmac('sha256', webhookSecret)
        .update(bodyString)
        .digest('hex');

      const started = Date.now();
      let statusCode = 200;
      let responseSummary = 'Sandbox loop verified locally (no external webhook URL configured)';
      let targetEndpoint = '/sandbox/webhook-loopback';

      if (webhookUrl && /^https?:\/\//i.test(webhookUrl)) {
        targetEndpoint = webhookUrl;
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 5000);
          const remoteResp = await fetch(webhookUrl, {
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

      const latencyMs = Math.max(4, Date.now() - started);
      const nowLabel = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
      const nextCount = Number(rec.requests_count ?? 0) + 1;

      const { data: updatedApp, error: updErr } = await client
        .from('creator_apps')
        .update({ requests_count: nextCount, last_used_at: `Today ${nowLabel}` })
        .eq('id', req.params.id)
        .eq('organizer_id', req.user!.id)
        .select('*')
        .single();

      if (updErr) return res.status(400).json({ error: updErr.message });

      const logId = `log-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`;
      const { data: logRow, error: logErr } = await client
        .from('creator_app_logs')
        .insert({
          id: logId,
          app_id: req.params.id,
          event_type: trigger,
          method: 'POST',
          endpoint: targetEndpoint,
          status_code: statusCode,
          latency_ms: latencyMs,
          request_summary: `Signed webhook ${trigger} (sig ${signature.slice(0, 12)}…)`,
          response_summary: responseSummary,
        })
        .select('*')
        .single();

      if (logErr) return res.status(400).json({ error: logErr.message });

      return res.json({
        app: mapCreatorAppRow(updatedApp as Record<string, unknown>),
        log: mapCreatorAppLogRow(logRow as Record<string, unknown>),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Webhook test failed.';
      return res.status(500).json({ error: message });
    }
  });

  app.post('/api/studio/apps/:id/simulate-call', requireSupabaseAuth, requireCreatorVerification, async (req: AuthedRequest, res) => {
    const { endpoint, method } = req.body as { endpoint?: string; method?: 'GET' | 'POST' };
    const cleanEndpoint = endpoint || '/v1/events';
    const httpMethod = method === 'POST' ? 'POST' : 'GET';

    try {
      const client = req.supabase!;
      const { data: existing, error: fetchErr } = await client
        .from('creator_apps')
        .select('*')
        .eq('id', req.params.id)
        .eq('organizer_id', req.user!.id)
        .single();

      if (fetchErr || !existing) {
        return res.status(404).json({ error: 'Creator app not found.' });
      }

      const rec = existing as Record<string, unknown>;
      const status = String(rec.status ?? 'active');
      const scopes = Array.isArray(rec.scopes) ? (rec.scopes as string[]) : [];
      const scopedEventId = rec.event_id ? String(rec.event_id) : null;
      const started = Date.now();

      let statusCode = 200;
      let result: Record<string, unknown> = {};
      let responseSummary = '';

      if (status !== 'active') {
        statusCode = 403;
        result = { error: 'App client is paused. Resume app to accept API calls.' };
        responseSummary = '403 Forbidden — App is currently paused';
      } else if (cleanEndpoint === '/v1/events') {
        if (!scopes.includes('events:read')) {
          statusCode = 403;
          result = { error: 'Missing required scope: events:read' };
          responseSummary = '403 Missing scope events:read';
        } else {
          let q = client.from('events').select('id,title,status,registered,capacity').eq('organizer_id', req.user!.id);
          if (scopedEventId) q = q.eq('id', scopedEventId);
          const { data: evts } = await q;
          result = { count: (evts ?? []).length, events: evts ?? [] };
          responseSummary = `Returned ${(evts ?? []).length} event(s) for client ${String(rec.client_id)}`;
        }
      } else if (cleanEndpoint === '/v1/attendees') {
        if (!scopes.includes('attendees:read')) {
          statusCode = 403;
          result = { error: 'Missing required scope: attendees:read' };
          responseSummary = '403 Missing scope attendees:read';
        } else {
          const { data: evts } = await client.from('events').select('id').eq('organizer_id', req.user!.id);
          const targetIds = scopedEventId
            ? [scopedEventId]
            : (evts ?? []).map((e) => String((e as Record<string, unknown>).id));
          const { data: atts } =
            targetIds.length > 0
              ? await client.from('attendees').select('id,name,tier,checked_in,ticket_code').in('event_id', targetIds).limit(20)
              : { data: [] };
          result = { count: (atts ?? []).length, attendees: atts ?? [] };
          responseSummary = `Returned ${(atts ?? []).length} attendee pass(es)`;
        }
      } else if (cleanEndpoint === '/v1/checkin') {
        if (!scopes.includes('checkin:write')) {
          statusCode = 403;
          result = { error: 'Missing required scope: checkin:write' };
          responseSummary = '403 Missing scope checkin:write';
        } else {
          result = {
            verified: true,
            mode: String(rec.environment ?? 'sandbox'),
            checkedInAt: new Date().toISOString(),
            clientId: String(rec.client_id),
          };
          responseSummary = `Gate check-in authorization verified (${String(rec.environment ?? 'sandbox')})`;
        }
      } else if (cleanEndpoint === '/v1/camera/shots') {
        if (!scopes.includes('camera:read')) {
          statusCode = 403;
          result = { error: 'Missing required scope: camera:read' };
          responseSummary = '403 Missing scope camera:read';
        } else {
          const { data: evts } = await client.from('events').select('id').eq('organizer_id', req.user!.id);
          const targetIds = scopedEventId
            ? [scopedEventId]
            : (evts ?? []).map((e) => String((e as Record<string, unknown>).id));
          const { data: shots } =
            targetIds.length > 0
              ? await client.from('disposable_shots').select('id,frame_number,film_stock,captured_by,developed').in('event_id', targetIds).limit(20)
              : { data: [] };
          result = { count: (shots ?? []).length, frames: shots ?? [] };
          responseSummary = `Returned ${(shots ?? []).length} 35mm film frame(s)`;
        }
      }

      const latencyMs = Math.max(8, Date.now() - started);
      const nowLabel = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
      const nextCount = Number(rec.requests_count ?? 0) + 1;

      const { data: updatedApp, error: updErr } = await client
        .from('creator_apps')
        .update({ requests_count: nextCount, last_used_at: `Today ${nowLabel}` })
        .eq('id', req.params.id)
        .eq('organizer_id', req.user!.id)
        .select('*')
        .single();

      if (updErr) return res.status(400).json({ error: updErr.message });

      const logId = `log-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`;
      const { data: logRow, error: logErr } = await client
        .from('creator_app_logs')
        .insert({
          id: logId,
          app_id: req.params.id,
          event_type: 'api.invocation',
          method: httpMethod,
          endpoint: cleanEndpoint,
          status_code: statusCode,
          latency_ms: latencyMs,
          request_summary: `${httpMethod} ${cleanEndpoint} (${String(rec.client_id)})`,
          response_summary: responseSummary,
        })
        .select('*')
        .single();

      if (logErr) return res.status(400).json({ error: logErr.message });

      return res.json({
        app: mapCreatorAppRow(updatedApp as Record<string, unknown>),
        log: mapCreatorAppLogRow(logRow as Record<string, unknown>),
        result,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Endpoint test failed.';
      return res.status(500).json({ error: message });
    }
  });

  app.delete('/api/studio/apps/:id', requireSupabaseAuth, requireCreatorVerification, async (req: AuthedRequest, res) => {
    try {
      const { error } = await req
        .supabase!.from('creator_apps')
        .delete()
        .eq('id', req.params.id)
        .eq('organizer_id', req.user!.id);
      if (error) return res.status(400).json({ error: error.message });
      return res.json({ ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete creator app.';
      return res.status(500).json({ error: message });
    }
  });

  // Unmatched /api/* JSON 404 handler (never fall through to SPA HTML)
  app.use('/api', (_req, res) => {
    return res.status(404).json({ error: 'API endpoint not found.' });
  });

  // JSON Error Handler for /api routes
  app.use((err: unknown, req: Request, res: Response, next: NextFunction) => {
    if (!req.path.startsWith('/api/')) return next(err);
    platformRuntime.recordError(req.path, err);
    const message = err instanceof Error ? err.message : 'Internal server error.';
    return res.status(500).json({ error: message });
  });

  // =========================================================================
  // VITE DEV MIDDLEWARE / PRODUCTION STATIC ASSETS WITH SSR OG INJECTION
  // =========================================================================

  const isProd =
    process.env.NODE_ENV === 'production' ||
    process.env.npm_lifecycle_event === 'start' ||
    Boolean(process.env.VERCEL) ||
    Boolean(options?.serverless);
  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR === 'true' ? false : true,
        ws: options?.httpServer ? { server: options.httpServer } : false,
      },
      appType: 'spa',
    });

    app.get(['/e/:slug', '/e/:slug/checkin', '/e/:slug/camera', '/camera', '/'], async (req, res, next) => {
      const slugOrId =
        req.params.slug ||
        (typeof req.query.event === 'string' ? req.query.event.trim() : '');
      if (!slugOrId) return next();
      const evt = await resolveEventForPublicOrOg(slugOrId);
      if (!evt) return next();
      try {
        const indexPath = path.resolve(__dirname, 'index.html');
        const rawHtml = fs.readFileSync(indexPath, 'utf-8');
        const transformed = await vite.transformIndexHtml(req.originalUrl, rawHtml);
        const withOg = injectEventMetaTags(transformed, evt, resolveBaseUrl(req));
        res
          .status(200)
          .set({ 'Content-Type': 'text/html', 'Cache-Control': 'no-cache, must-revalidate' })
          .end(withOg);
      } catch (err) {
        next(err);
      }
    });

    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    const resolveIndexHtmlPath = () => {
      const candidates = [
        path.join(distDir, 'index.html'),
        path.resolve(process.cwd(), 'dist', 'index.html'),
      ];
      return candidates.find((p) => fs.existsSync(p)) ?? null;
    };
    const distAssetsDir = path.join(distDir, 'assets');
    if (fs.existsSync(distAssetsDir)) {
      app.use(
        '/assets',
        express.static(distAssetsDir, {
          immutable: true,
          maxAge: '1y',
        })
      );
    }
    if (fs.existsSync(distDir)) {
      app.use(express.static(distDir, { index: false, maxAge: '1h' }));
    }
    app.get('*', async (req, res) => {
      const indexPath = resolveIndexHtmlPath();
      let rawHtml: string | null = indexPath ? fs.readFileSync(indexPath, 'utf-8') : null;

      if (!rawHtml && (process.env.VERCEL || options?.serverless) && req.headers['x-events-og-fetch'] !== '1') {
        try {
          const origin = resolveBaseUrl(req);
          const htmlRes = await fetch(`${origin}/index.html`, {
            headers: { 'x-events-og-fetch': '1' },
          });
          if (htmlRes.ok) {
            rawHtml = await htmlRes.text();
          }
        } catch {
          rawHtml = null;
        }
      }

      if (!rawHtml) {
        return res
          .status(503)
          .send('Production build not found. Run "npm run build" before starting the server.');
      }

      res.setHeader('Cache-Control', 'no-cache, must-revalidate');
      const slugMatch = req.path.match(/^\/e\/([^/]+)(?:\/(?:checkin|camera))?$/i);
      const slugOrId =
        (slugMatch ? decodeURIComponent(slugMatch[1]) : '') ||
        (typeof req.query.event === 'string' ? req.query.event.trim() : '');
      if (slugOrId) {
        const evt = await resolveEventForPublicOrOg(slugOrId);
        if (evt) {
          const withOg = injectEventMetaTags(rawHtml, evt, resolveBaseUrl(req));
          return res.status(200).set({ 'Content-Type': 'text/html' }).send(withOg);
        }
      }
      return res.status(200).set({ 'Content-Type': 'text/html' }).send(rawHtml);
    });
  }

  return app;
}

const isEntryServerFile =
  Boolean(process.argv[1]) && /\bserver\.(ts|js|mjs)$/i.test(process.argv[1]);
const isServerlessRuntime =
  Boolean(process.env.VERCEL) || process.env.EVENTS_SERVERLESS === '1' || !isEntryServerFile;

if (!isServerlessRuntime) {
  const httpServer = http.createServer();
  createExpressApp({ serverless: false, httpServer })
    .then((app) => {
      httpServer.on('request', app);
      const PORT = Number(process.env.PORT) || 3000;
      const modeLabel = isSupabaseConfigured()
        ? 'Supabase single source of truth'
        : 'In-memory store (Supabase env vars not set)';
      httpServer.listen(PORT, '0.0.0.0', () => {
        console.log(`Events App server listening on http://0.0.0.0:${PORT} (${modeLabel})`);
      });
    })
    .catch((err) => {
      console.error('Failed to start Events App server:', err);
      process.exit(1);
    });
}

