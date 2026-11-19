import 'dotenv/config';
import crypto from 'node:crypto';
import express, { type NextFunction, type Request, type Response } from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import {
  createPublicSupabaseClient,
  createServiceSupabaseClient,
  createUserSupabaseClient,
  ensureProfileRow,
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
import {
  isResendConfigured,
  sendAuthOtpEmail,
  sendEventPassEmail,
} from './server/resend.ts';
import {
  buildSyntheticPhoneEmail,
  clearPendingSignup,
  consumePendingSignup,
  dispatchDualAuthChallenge,
  getPendingSignup,
  hasActiveAuthChallenge,
  isArkeselConfigured,
  isSyntheticPhoneEmail,
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

  const attendees = (attRes.data ?? []).map((r) => mapAttendeeRow(r as Record<string, unknown>));
  const scheduleBlocks = (schRes.data ?? []).map((r) => mapScheduleRow(r as Record<string, unknown>));
  const disposableShots = (shotRes.data ?? []).map((r) => mapShotRow(r as Record<string, unknown>));

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

async function createAppServer() {
  const app = express();
  app.use(express.json({ limit: '15mb' }));

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
        `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urlEntries.join('\n')}\n</urlset>\n`
      );
  });

  app.get('/api/health', (_req, res) => {
    const creator = getCreatorCredentials();
    const configured = isSupabaseConfigured();
    res.json({
      ok: true,
      database: configured ? 'supabase' : 'in-memory',
      supabaseConfigured: configured,
      serviceRoleConfigured: Boolean((process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()),
      resendConfigured: isResendConfigured(),
      arkeselConfigured: isArkeselConfigured(),
      inMemoryFallback: !configured,
      creatorEmail: creator.email,
      creatorPasswordConfigured: creator.configured,
      sessionTimeoutMinutes: 30,
      timestamp: new Date().toISOString(),
    });
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
          const { data: listData } = await svc.auth.admin.listUsers({ perPage: 200 });
          const existingUser = listData?.users?.find(
            (u) => (u.email || '').toLowerCase() === creator.email
          );
          if (existingUser) {
            await svc.auth.admin.updateUserById(existingUser.id, {
              password: creator.password,
              email_confirm: true,
            });
          } else {
            await svc.auth.admin.createUser({
              email: creator.email,
              password: creator.password,
              email_confirm: true,
              user_metadata: {
                name: 'Apps Creator',
                studio: 'Apps Creator Console',
              },
            });
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
      const profile = await ensureProfileRow(userClient, signInRes.data.user);
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

      // Stage registration in volatile memory ONLY (zero writes to Supabase auth.users or public.profiles yet)
      stagePendingSignup({
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
        clearPendingSignup({ phone: phoneCheck.normalized, email: cleanEmail });
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
      });
    } catch (err) {
      clearPendingSignup({ phone: phoneCheck.normalized, email: cleanEmail });
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
        hasActiveAuthChallenge({ phone: normalizedPhone, email: normalizedEmail });

      if (useDualChallenge) {
        const otpCheck = verifyAuthOtp({
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
        const pending = getPendingSignup({ phone: resolvedPhone, email: resolvedEmail });
        const publicClient = createPublicSupabaseClient();

        if (pending) {
          // Re-verify uniqueness right before atomic commit
          const dupPhone = await findSupabaseUserByPhone(svc, pending.phone);
          if (dupPhone) {
            consumePendingSignup({ phone: pending.phone, email: pending.email });
            return res.status(409).json({
              error: `An account with phone number ${pending.phone} already exists. Please sign in instead.`,
            });
          }
          if (pending.email) {
            const dupEmail = await findSupabaseUserByEmail(svc, pending.email);
            if (dupEmail) {
              consumePendingSignup({ phone: pending.phone, email: pending.email });
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

            consumePendingSignup({ phone: pending.phone, email: pending.email });
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

      const pending = getPendingSignup({ phone: normalizedPhone, email: cleanEmail });
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
        : `${req.protocol}://${req.get('host')}`;
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
      const events = (data ?? []).map((r) => mapEventRow(r as Record<string, unknown>));
      return res.json({ events });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load events.';
      return res.status(500).json({ error: message, events: [] });
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
      const { name, email, phone, organization, tier, ticketCode } = req.body as {
        name?: string;
        email?: string;
        phone?: string;
        organization?: string;
        tier?: Attendee['tier'];
        ticketCode?: string;
      };

      if (!name?.trim() || !email?.trim() || !phone?.trim()) {
        return res.status(400).json({ error: 'Name, email, and phone number are required.' });
      }

      const normalizedPhone = normalizePhoneE164(phone.trim());
      const attendeeId = `att-${Date.now()}-${Math.floor(100 + Math.random() * 899)}`;
      const finalCode = ticketCode?.trim() || `#EVT-2026-${Math.floor(1000 + Math.random() * 8999)}`;

      try {
        const supabase = createServiceSupabaseClient() ?? createPublicSupabaseClient();

        const { data: rpcData, error: rpcErr } = await supabase.rpc('register_public_attendee', {
          p_id: attendeeId,
          p_event_id: eventId,
          p_name: name.trim(),
          p_email: email.trim(),
          p_phone: normalizedPhone,
          p_organization: organization?.trim() || 'Fast Pass Attendee',
          p_tier: tier || 'General',
          p_ticket_code: finalCode,
        });

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
        const event = mapEventRow(payload.event);

        let replyTo: string | undefined;
        const organizerId = payload.event?.organizer_id ? String(payload.event.organizer_id) : undefined;
        if (organizerId) {
          const { data: orgProf } = await supabase
            .from('profiles')
            .select('reply_to_email')
            .eq('id', organizerId)
            .maybeSingle();
          if (orgProf && typeof (orgProf as Record<string, unknown>).reply_to_email === 'string') {
            replyTo = String((orgProf as Record<string, unknown>).reply_to_email);
          }
        }

        const [smsDelivery, emailDelivery] = await Promise.all([
          dispatchOptionalArkeselSms(
            normalizedPhone,
            event.title,
            finalCode,
            event.senderId
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
        });

        return res.status(201).json({ attendee, event });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Registration failed.';
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

  const seedInFlightByUser = new Map<string, Promise<unknown>>();

  app.post('/api/studio/seed-starter', requireSupabaseAuth, requireRole('creator', 'organizer'), async (req: AuthedRequest, res) => {
    if (!platformRuntime.flags.starterSeedingEnabled) {
      return res.status(403).json({
        error: 'Starter data seeding is currently disabled by platform administrator.',
      });
    }
    const client = req.supabase!;
    const user = req.user!;

    const existingPromise = seedInFlightByUser.get(user.id);
    if (existingPromise) {
      try {
        const workspace = await existingPromise;
        return res.json(workspace);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to seed starter data.';
        return res.status(500).json({ error: message });
      }
    }

    const runSeed = async () => {
      const profile = await ensureProfileRow(client, user);
      const adminOrUserClient = createServiceSupabaseClient() ?? client;

      const buildSeededEvents = (suffix: string) =>
        INITIAL_EVENTS.map((evt) => ({
          id: `${evt.id}-${suffix}`,
          organizer_id: user.id,
          slug: `${evt.slug}-${suffix}`,
          title: evt.title,
          subtitle: evt.subtitle,
          category: evt.category,
          status: evt.status,
          date: evt.date,
          iso_date: evt.isoDate,
          time: evt.time,
          venue: evt.venue,
          city: evt.city,
          capacity: evt.capacity,
          registered: evt.registered,
          checked_in: evt.checkedIn,
          sms_dispatched: evt.smsDispatched,
          ticket_price: evt.ticketPrice,
          revenue: evt.revenue,
          organizer: profile.name || evt.organizer,
          artwork: evt.artwork,
          broadcast_error: evt.broadcastError ?? null,
          flyer_url: evt.flyerUrl ?? null,
          venue_format: evt.venueFormat ?? 'in-person',
          sender_id: evt.senderId ?? null,
          qr_pass_published: evt.qrPassPublished ?? evt.status !== 'draft',
        }));

      let idSuffix = user.id.slice(0, 6);
      const candidateIds = INITIAL_EVENTS.map((evt) => `${evt.id}-${idSuffix}`);
      const candidateSlugs = INITIAL_EVENTS.map((evt) => `${evt.slug}-${idSuffix}`);
      const [{ data: collidingIds }, { data: collidingSlugs }] = await Promise.all([
        adminOrUserClient.from('events').select('id, organizer_id').in('id', candidateIds),
        adminOrUserClient.from('events').select('id, organizer_id').in('slug', candidateSlugs),
      ]);

      const claimedByOther = [...(collidingIds ?? []), ...(collidingSlugs ?? [])].some(
        (r) => String((r as Record<string, unknown>).organizer_id) !== user.id
      );
      if (claimedByOther) {
        idSuffix = `${user.id.slice(0, 6)}-${crypto.randomBytes(3).toString('hex')}`;
      }

      let { error: evtErr } = await client
        .from('events')
        .upsert(buildSeededEvents(idSuffix), { onConflict: 'id' });

      if (
        evtErr &&
        (evtErr.code === '23505' ||
          evtErr.message.toLowerCase().includes('duplicate key') ||
          evtErr.message.toLowerCase().includes('row-level security'))
      ) {
        idSuffix = `${user.id.slice(0, 6)}-${crypto.randomBytes(3).toString('hex')}`;
        const retryRes = await client
          .from('events')
          .upsert(buildSeededEvents(idSuffix), { onConflict: 'id' });
        evtErr = retryRes.error;
      }

      if (evtErr) throw new Error(evtErr.message);

      const seededAttendees = INITIAL_ATTENDEES.map((att) => ({
        id: `${att.id}-${idSuffix}`,
        event_id: `${att.eventId}-${idSuffix}`,
        name: att.name,
        email: att.email,
        phone: att.phone,
        organization: att.organization,
        tier: att.tier,
        checked_in: att.checkedIn,
        checked_in_at: att.checkedInAt ?? null,
        ticket_code: att.ticketCode,
        sms_status: att.smsStatus,
        payment_status: att.paymentStatus,
      }));
      const { error: attErr } = await client
        .from('attendees')
        .upsert(seededAttendees, { onConflict: 'id' });
      if (attErr) throw new Error(attErr.message);

      const seededSchedule = INITIAL_SCHEDULE.map((sch) => ({
        id: `${sch.id}-${idSuffix}`,
        event_id: `${sch.eventId}-${idSuffix}`,
        time: sch.time,
        duration: sch.duration,
        title: sch.title,
        stage: sch.stage,
        lead: sch.lead,
        completed: sch.completed,
        day: sch.day,
      }));
      const { error: schErr } = await client
        .from('schedule_blocks')
        .upsert(seededSchedule, { onConflict: 'id' });
      if (schErr) throw new Error(schErr.message);

      const seededAlerts = INITIAL_ALERTS.map((al) => ({
        id: `${al.id}-${idSuffix}`,
        organizer_id: user.id,
        title: al.title,
        detail: al.detail,
        category: al.category,
        event_id: al.eventId ? `${al.eventId}-${idSuffix}` : null,
        timestamp: al.timestamp,
        resolved: al.resolved,
      }));
      const { error: altErr } = await client
        .from('system_alerts')
        .upsert(seededAlerts, { onConflict: 'id' });
      if (altErr) throw new Error(altErr.message);

      const rollRows = Object.entries(INITIAL_ROLL_SETTINGS).map(([evtId, cfg]) => ({
        event_id: `${evtId}-${idSuffix}`,
        exposures_limit: cfg.exposuresLimit,
        darkroom_mode: cfg.darkroomMode,
      }));
      if (rollRows.length > 0) {
        const { error: rollErr } = await client
          .from('disposable_roll_settings')
          .upsert(rollRows, { onConflict: 'event_id' });
        if (rollErr) throw new Error(rollErr.message);
      }

      const shotRows = INITIAL_DISPOSABLE_SHOTS.map((s) => ({
        id: `${s.id}-${idSuffix}`,
        event_id: `${s.eventId}-${idSuffix}`,
        frame_number: s.frameNumber,
        data_url: s.dataUrl,
        captured_by: s.capturedBy,
        caption: s.caption ?? null,
        film_stock: s.filmStock,
        date_stamp: s.dateStamp,
        captured_at: s.capturedAt,
        developed: s.developed,
        likes: s.likes,
        liked: Boolean(s.liked),
      }));
      const { error: shotErr } = await client
        .from('disposable_shots')
        .upsert(shotRows, { onConflict: 'id' });
      if (shotErr) throw new Error(shotErr.message);

      return loadOrganizerWorkspace(client, user);
    };

    const seedPromise = runSeed();
    seedInFlightByUser.set(user.id, seedPromise);
    try {
      const workspace = await seedPromise;
      return res.json(workspace);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to seed starter data.';
      return res.status(500).json({ error: message });
    } finally {
      seedInFlightByUser.delete(user.id);
    }
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
      if (next.phone !== undefined && next.phone.trim()) {
        const phoneCheck = validateStrictPhoneE164(next.phone);
        if (!phoneCheck.ok) return res.status(400).json({ error: phoneCheck.error });
        updatePayload.phone = phoneCheck.normalized;
      }
      if (next.studio !== undefined) updatePayload.studio = next.studio;
      if (next.plan !== undefined) updatePayload.plan = next.plan;
      if (next.smsCredits !== undefined) updatePayload.sms_credits = next.smsCredits;
      if (next.capacityAlertThreshold !== undefined) {
        updatePayload.capacity_alert_threshold = next.capacityAlertThreshold;
      }
      if (next.avatarUrl !== undefined) updatePayload.avatar_url = next.avatarUrl;
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

      if (error && error.message?.toLowerCase().includes('phone')) {
        const { phone: _dropPhone, ...legacyUpdate } = updatePayload;
        const retry = await req
          .supabase!.from('profiles')
          .update(legacyUpdate)
          .eq('id', req.user!.id)
          .select('*')
          .single();
        data = retry.data;
        error = retry.error;
      }

      if (error) return res.status(400).json({ error: error.message });
      return res.json({ profile: mapProfileRow(data as Record<string, unknown>, req.user!.email ?? '') });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update profile.';
      return res.status(500).json({ error: message });
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

      const eventRow = {
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
        broadcast_error: event.broadcastError ?? null,
        flyer_url: event.flyerUrl ?? null,
        venue_format: event.venueFormat ?? 'in-person',
        sender_id: event.senderId ?? null,
        qr_pass_published: event.status === 'draft' ? false : Boolean(event.qrPassPublished),
      };

      const { data: createdEvt, error: evtErr } = await client
        .from('events')
        .insert(eventRow)
        .select('*')
        .single();
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
        broadcast_error: updated.broadcastError ?? null,
        flyer_url: updated.flyerUrl ?? null,
        venue_format: updated.venueFormat ?? 'in-person',
        sender_id: updated.senderId ?? null,
      };
      if (updated.status === 'draft') {
        updatePayload.qr_pass_published = false;
      } else if (updated.qrPassPublished !== undefined) {
        updatePayload.qr_pass_published = Boolean(updated.qrPassPublished);
      }

      const { data, error } = await req
        .supabase!.from('events')
        .update(updatePayload)
        .eq('id', req.params.id)
        .eq('organizer_id', req.user!.id)
        .select('*')
        .single();
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
      if (updErr) return res.status(400).json({ error: updErr.message });
      return res.json({ event: mapEventRow(updated as Record<string, unknown>) });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update check-in QR pass status.';
      return res.status(500).json({ error: message });
    }
  });

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
      if (isResendConfigured()) {
        const { data: orgProf } = await client
          .from('profiles')
          .select('reply_to_email')
          .eq('id', req.user!.id)
          .maybeSingle();
        if (orgProf && typeof (orgProf as Record<string, unknown>).reply_to_email === 'string') {
          replyTo = String((orgProf as Record<string, unknown>).reply_to_email);
        }
      }

      const [smsDelivery, emailDelivery] = await Promise.all([
        dispatchOptionalArkeselSms(
          normalizedPhone,
          evtMapped.title,
          attendee.ticketCode,
          evtMapped.senderId
        ),
        isResendConfigured() && attendee.email?.includes('@')
          ? sendEventPassEmail({
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
            })
          : Promise.resolve({ ok: false, skipped: true }),
      ]);

      const hasLiveArkesel = Boolean((process.env.ARKESEL_API_KEY || '').trim()) && platformRuntime.flags.smsMode !== 'sandbox';
      const resolvedSmsStatus: Attendee['smsStatus'] =
        emailDelivery.ok && (!hasLiveArkesel || smsDelivery === 'Pending')
          ? 'Resend Delivered'
          : attendee.smsStatus || smsDelivery;

      const { data: inserted, error: attErr } = await client
        .from('attendees')
        .insert({
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
        })
        .select('*')
        .single();

      if (attErr) {
        if (attErr.code === '23505') {
          return res.status(409).json({
            error: `Duplicate shield: ${normalizedPhone} is already registered for this event.`,
          });
        }
        return res.status(400).json({ error: attErr.message });
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

      return res.status(201).json({
        attendee: mapAttendeeRow(inserted as Record<string, unknown>),
        event: mapEventRow(updatedEvt as Record<string, unknown>),
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
        .select('checked_in')
        .eq('id', eventId)
        .single();

      if (evtRow) {
        const currentChecked = Number((evtRow as Record<string, unknown>).checked_in ?? 0);
        const nextTotal = Math.max(0, currentChecked + (nextCheckedIn ? 1 : -1));
        await client.from('events').update({ checked_in: nextTotal }).eq('id', eventId);
      }

      return res.json({ attendee: mapAttendeeRow(updatedAtt as Record<string, unknown>) });
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
      const { data, error } = await req
        .supabase!.from('disposable_shots')
        .insert({
          id: shot.id,
          event_id: shot.eventId,
          frame_number: shot.frameNumber,
          data_url: shot.dataUrl,
          captured_by: shot.capturedBy,
          caption: shot.caption ?? null,
          film_stock: shot.filmStock,
          date_stamp: shot.dateStamp,
          captured_at: shot.capturedAt,
          developed: Boolean(shot.developed),
          likes: shot.likes ?? 0,
          liked: Boolean(shot.liked),
        })
        .select('*')
        .single();
      if (error) return res.status(400).json({ error: error.message });
      return res.status(201).json({ shot: mapShotRow(data as Record<string, unknown>) });
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
          eventId: rec.event_id ? String(rec.event_id) : 'evt-tech-leaders-2026',
          attendeeName: 'Ama Serwaa (Test Dispatch)',
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
  // VITE DEV MIDDLEWARE / PRODUCTION STATIC ASSETS
  // =========================================================================

  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const PORT = Number(process.env.PORT) || 3000;
  const modeLabel = isSupabaseConfigured()
    ? 'Supabase single source of truth'
    : 'In-memory store (Supabase env vars not set)';
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Events App server listening on http://0.0.0.0:${PORT} (${modeLabel})`);
  });
}

createAppServer().catch((err) => {
  console.error('Failed to start Events App server:', err);
  process.exit(1);
});
