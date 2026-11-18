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
} from './server/supabase.ts';
import {
  INITIAL_ALERTS,
  INITIAL_ATTENDEES,
  INITIAL_DISPOSABLE_SHOTS,
  INITIAL_EVENTS,
  INITIAL_ROLL_SETTINGS,
  INITIAL_SCHEDULE,
  normalizePhoneE164,
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
  safeTimingEqual,
  signCreatorSessionToken,
  type AuthedRequest,
} from './server/helpers.ts';
import { createMemoryRouter } from './server/memoryRoutes.ts';
import { createBuilderRouter } from './server/builderRoutes.ts';
import { platformRuntime } from './server/memoryStore.ts';

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
    const { data: prof } = await req.supabase
      .from('profiles')
      .select('app_role')
      .eq('id', data.user.id)
      .maybeSingle();
    const dbRole = (prof as Record<string, unknown> | null)?.app_role;
    if (dbRole === 'creator' || dbRole === 'organizer' || dbRole === 'gate_staff') {
      req.appRole = dbRole;
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

  app.get('/api/health', (_req, res) => {
    const creator = getCreatorCredentials();
    const configured = isSupabaseConfigured();
    res.json({
      ok: true,
      database: configured ? 'supabase' : 'in-memory',
      supabaseConfigured: configured,
      inMemoryFallback: !configured,
      creatorEmail: creator.email,
      creatorPasswordConfigured: creator.configured,
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
    const { email, password } = req.body as { email?: string; password?: string };
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }
    try {
      const supabase = createPublicSupabaseClient();
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (error || !data.session || !data.user) {
        if (error?.message?.toLowerCase().includes('email not confirmed')) {
          return res.json({ requiresOtp: true, email: email.trim(), otpType: 'signup' });
        }
        return res.status(401).json({ error: error?.message || 'Invalid credentials.' });
      }
      const userClient = createUserSupabaseClient(data.session.access_token);
      const profile = await ensureProfileRow(userClient, data.user);
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
    const { email, password, name, studio, countryGateway, appRole } = req.body as {
      email?: string;
      password?: string;
      name?: string;
      studio?: string;
      countryGateway?: string;
      appRole?: AppRole;
    };
    if (!email || !password || !name) {
      return res.status(400).json({ error: 'Name, email, and password are required.' });
    }
    try {
      const supabase = createPublicSupabaseClient();
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: {
            name: name.trim(),
            first_name: name.trim().split(' ')[0] || 'Organiser',
            studio: (studio || 'Events Studio').trim(),
            country_gateway: countryGateway || 'GH',
            app_role: appRole === 'gate_staff' ? 'gate_staff' : 'organizer',
          },
        },
      });
      if (error) {
        return res.status(400).json({ error: error.message });
      }
      if (data.session && data.user) {
        const userClient = createUserSupabaseClient(data.session.access_token);
        const profile = await ensureProfileRow(userClient, data.user);
        return res.json({
          requiresOtp: false,
          session: {
            accessToken: data.session.access_token,
            refreshToken: data.session.refresh_token,
            expiresAt: data.session.expires_at,
          },
          profile,
        });
      }
      return res.json({
        requiresOtp: true,
        email: email.trim(),
        otpType: 'signup',
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Sign-up failed.';
      return res.status(500).json({ error: message });
    }
  });

  app.post('/api/auth/verify-otp', requireSupabaseConfiguredMiddleware, async (req, res) => {
    const { email, token, otpType } = req.body as {
      email?: string;
      token?: string;
      otpType?: 'signup' | 'email' | 'recovery';
    };
    if (!email || !token) {
      return res.status(400).json({ error: 'Email and 6-digit verification code are required.' });
    }
    try {
      const supabase = createPublicSupabaseClient();
      const typeToTry = otpType || 'signup';
      let result = await supabase.auth.verifyOtp({
        email: email.trim(),
        token: token.trim(),
        type: typeToTry,
      });

      if (result.error && typeToTry !== 'email') {
        result = await supabase.auth.verifyOtp({
          email: email.trim(),
          token: token.trim(),
          type: 'email',
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
    const { email } = req.body as { email?: string };
    if (!email?.trim()) {
      return res.status(400).json({ error: 'Email address is required.' });
    }
    try {
      const supabase = createPublicSupabaseClient();
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: {
          shouldCreateUser: true,
        },
      });
      if (error) {
        return res.status(400).json({ error: error.message });
      }
      return res.json({ ok: true, email: email.trim() });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not dispatch 6-digit code.';
      return res.status(500).json({ error: message });
    }
  });

  app.post('/api/auth/resend-otp', requireSupabaseConfiguredMiddleware, async (req, res) => {
    const { email } = req.body as { email?: string };
    if (!email) {
      return res.status(400).json({ error: 'Email is required.' });
    }
    try {
      const supabase = createPublicSupabaseClient();
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email: email.trim(),
      });
      if (error) {
        const otpFallback = await supabase.auth.signInWithOtp({ email: email.trim() });
        if (otpFallback.error) {
          return res.status(400).json({ error: otpFallback.error.message });
        }
      }
      return res.json({ ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not resend code.';
      return res.status(500).json({ error: message });
    }
  });

  app.post('/api/auth/reset-password', requireSupabaseConfiguredMiddleware, async (req, res) => {
    const { email, redirectTo } = req.body as { email?: string; redirectTo?: string };
    if (!email) {
      return res.status(400).json({ error: 'Email address is required.' });
    }
    try {
      const supabase = createPublicSupabaseClient();
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: redirectTo || undefined,
      });
      if (error) {
        return res.status(400).json({ error: error.message });
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

  app.post('/api/auth/update-password', requireSupabaseAuth, async (req: AuthedRequest, res) => {
    const { password } = req.body as { password?: string };
    if (!password || password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    }
    try {
      const { error } = await req.supabase!.auth.updateUser({ password });
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
        const smsDelivery = await dispatchOptionalArkeselSms(
          normalizedPhone,
          event.title,
          finalCode,
          event.senderId
        );

        const attendee = mapAttendeeRow({
          ...payload.attendee,
          sms_status: smsDelivery,
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
      if (next.email !== undefined) updatePayload.email = next.email;
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

      const { data, error } = await req
        .supabase!.from('profiles')
        .update(updatePayload)
        .eq('id', req.user!.id)
        .select('*')
        .single();

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
      const { data, error } = await req
        .supabase!.from('events')
        .update({
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
        })
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

  app.post('/api/studio/events/:eventId/attendees', requireSupabaseAuth, requireRole('creator', 'organizer', 'gate_staff'), async (req: AuthedRequest, res) => {
    const attendee = req.body as Attendee;
    const { eventId } = req.params;
    try {
      const client = req.supabase!;
      const { data: evt, error: evtFetchErr } = await client
        .from('events')
        .select('*')
        .eq('id', eventId)
        .eq('organizer_id', req.user!.id)
        .single();
      if (evtFetchErr || !evt) {
        return res.status(404).json({ error: 'Event not found in your organizer studio.' });
      }

      const normalizedPhone = normalizePhoneE164(attendee.phone);
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
          sms_status: attendee.smsStatus || 'Arkesel Sent',
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
