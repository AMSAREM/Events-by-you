import express, { type NextFunction, type Response } from 'express';
import type { User } from '@supabase/supabase-js';
import { normalizePhoneE164 } from '../src/data/initialData.ts';
import type {
  AppRole,
  Attendee,
  CreatorApp,
  DisposableRollSettings,
  DisposableShot,
  EventItem,
  OrganizerProfile,
  ScheduleBlock,
} from '../src/types/events.ts';
import {
  dispatchOptionalArkeselSms,
  getBearerToken,
  getCreatorCredentials,
  requireCreatorVerification,
  requireRole,
  safeTimingEqual,
  signCreatorSessionToken,
  type AuthedRequest,
} from './helpers.ts';
import { memoryStore, platformRuntime } from './memoryStore.ts';

function requireMemoryAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const token = getBearerToken(req);
  if (!token) {
    return res.status(401).json({ error: 'Authentication required. Please sign in.' });
  }
  const user = memoryStore.getUserByAccessToken(token);
  if (!user) {
    return res.status(401).json({ error: 'Session expired. Please sign in again.' });
  }
  req.accessToken = token;
  req.memoryUser = user;
  req.user = { id: user.id, email: user.email } as User;
  return next();
}

export function createMemoryRouter() {
  const router = express.Router();

  // =========================================================================
  // AUTH ROUTES (In-Memory Fallback)
  // =========================================================================

  router.post('/auth/creator-login', (req, res) => {
    const { email, password } = req.body as { email?: string; password?: string };
    const creator = getCreatorCredentials();
    if (!email?.trim() || !password) {
      return res.status(400).json({ error: 'Creator email and password are required.' });
    }
    const normalizedEmail = email.trim().toLowerCase();
    if (!safeTimingEqual(normalizedEmail, creator.email)) {
      return res.status(401).json({ error: `Apps Creator login is restricted to ${creator.email}.` });
    }
    if (creator.configured && !safeTimingEqual(password, creator.password)) {
      return res.status(401).json({ error: 'Invalid App Creator email or CREATOR_PASSWORD.' });
    }
    try {
      const creatorToken = signCreatorSessionToken(creator.email, creator.password || undefined);
      const result = memoryStore.creatorLogin(normalizedEmail, password);
      return res.json({
        requiresOtp: false,
        creatorToken,
        session: result.session,
        profile: result.profile,
      });
    } catch (err) {
      platformRuntime.recordError('auth/creator-login', err);
      return res.status(401).json({ error: err instanceof Error ? err.message : 'Creator login failed.' });
    }
  });

  router.post('/studio/creator-unlock', requireMemoryAuth, (req: AuthedRequest, res) => {
    const creator = getCreatorCredentials();
    if (!creator.configured) {
      const creatorToken = signCreatorSessionToken(req.memoryUser!.email);
      return res.json({ unlocked: true, creatorToken });
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

  router.post('/auth/signin', (req, res) => {
    const { email, password } = req.body as { email?: string; password?: string };
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }
    try {
      const result = memoryStore.signIn(email, password);
      return res.json({
        requiresOtp: false,
        session: result.session,
        profile: result.profile,
      });
    } catch (err) {
      return res.status(401).json({ error: err instanceof Error ? err.message : 'Invalid credentials.' });
    }
  });

  router.post('/auth/signup', (req, res) => {
    const { email, password, name, studio, appRole } = req.body as {
      email?: string;
      password?: string;
      name?: string;
      studio?: string;
      appRole?: AppRole;
    };
    if (!email || !password || !name) {
      return res.status(400).json({ error: 'Name, email, and password are required.' });
    }
    try {
      const result = memoryStore.signUp({ email, password, name, studio, appRole });
      return res.json({
        requiresOtp: false,
        session: result.session,
        profile: result.profile,
      });
    } catch (err) {
      return res.status(400).json({ error: err instanceof Error ? err.message : 'Sign-up failed.' });
    }
  });

  router.post('/auth/verify-otp', (req, res) => {
    const { email, token } = req.body as { email?: string; token?: string };
    if (!email || !token) {
      return res.status(400).json({ error: 'Email and 6-digit verification code are required.' });
    }
    try {
      const result = memoryStore.verifyOtp(email, token);
      return res.json(result);
    } catch (err) {
      return res.status(401).json({ error: err instanceof Error ? err.message : 'Invalid verification code.' });
    }
  });

  router.post('/auth/send-otp', (req, res) => {
    const { email } = req.body as { email?: string };
    if (!email?.trim()) {
      return res.status(400).json({ error: 'Email address is required.' });
    }
    return res.json({ ok: true, email: email.trim() });
  });

  router.post('/auth/resend-otp', (req, res) => {
    const { email } = req.body as { email?: string };
    if (!email) {
      return res.status(400).json({ error: 'Email is required.' });
    }
    return res.json({ ok: true });
  });

  router.post('/auth/reset-password', (req, res) => {
    const { email } = req.body as { email?: string };
    if (!email) {
      return res.status(400).json({ error: 'Email address is required.' });
    }
    return res.json({ ok: true });
  });

  router.get('/auth/oauth/:provider', (req, res) => {
    const provider = req.params.provider;
    if (provider !== 'google' && provider !== 'github') {
      return res.status(400).json({ error: 'Unsupported OAuth provider.' });
    }
    const redirectTo =
      typeof req.query.redirectTo === 'string' && req.query.redirectTo
        ? req.query.redirectTo.replace(/\/$/, '')
        : `${req.protocol}://${req.get('host')}`;
    const creator = getCreatorCredentials();
    const session = memoryStore.issueOAuthSession(creator.email);
    const url = `${redirectTo}/#access_token=${encodeURIComponent(session.accessToken)}&refresh_token=${encodeURIComponent(session.refreshToken)}&expires_in=604800`;
    return res.json({ url });
  });

  router.post('/auth/refresh', (req, res) => {
    const { refreshToken } = req.body as { refreshToken?: string };
    if (!refreshToken) {
      return res.status(400).json({ error: 'Refresh token required.' });
    }
    const refreshed = memoryStore.refreshSession(refreshToken);
    if (!refreshed) {
      return res.status(401).json({ error: 'Could not refresh session.' });
    }
    return res.json(refreshed);
  });

  router.post('/auth/signout', (req, res) => {
    const token = getBearerToken(req);
    if (token) memoryStore.signOut(token);
    return res.json({ ok: true });
  });

  router.get('/auth/session', requireMemoryAuth, (req: AuthedRequest, res) => {
    return res.json({ profile: req.memoryUser!.profile });
  });

  router.post('/auth/update-password', requireMemoryAuth, (req: AuthedRequest, res) => {
    const { password } = req.body as { password?: string };
    if (!password || password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    }
    memoryStore.updatePassword(req.user!.id, password);
    return res.json({ ok: true });
  });

  // =========================================================================
  // PUBLIC ROUTES (In-Memory Fallback)
  // =========================================================================

  router.get('/public/events', (_req, res) => {
    return res.json({ events: memoryStore.getPublicEvents() });
  });

  router.post('/public/events/:eventId/register', async (req, res) => {
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
      const publicEvents = memoryStore.getPublicEvents();
      const targetEvent = publicEvents.find((e) => e.id === eventId);
      const smsDelivery = await dispatchOptionalArkeselSms(
        normalizedPhone,
        targetEvent?.title ?? 'Events App',
        finalCode,
        targetEvent?.senderId
      );
      const result = memoryStore.registerPublicAttendee({
        id: attendeeId,
        eventId,
        name: name.trim(),
        email: email.trim(),
        phone: normalizedPhone,
        organization,
        tier,
        ticketCode: finalCode,
        smsStatus: smsDelivery,
      });
      return res.status(201).json(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Registration failed.';
      if (msg.includes('DUPLICATE_PHONE:')) {
        return res.status(409).json({
          error: `Duplicate shield: ${msg.split('DUPLICATE_PHONE:')[1]}`,
        });
      }
      return res.status(400).json({ error: msg });
    }
  });

  // =========================================================================
  // STUDIO ROUTES (In-Memory Fallback)
  // =========================================================================

  router.get('/studio/bootstrap', requireMemoryAuth, (req: AuthedRequest, res) => {
    try {
      return res.json(memoryStore.loadWorkspace(req.user!.id));
    } catch (err) {
      platformRuntime.recordError('studio/bootstrap', err);
      return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to load workspace.' });
    }
  });

  router.post('/studio/seed-starter', requireMemoryAuth, requireRole('creator', 'organizer'), (req: AuthedRequest, res) => {
    try {
      return res.json(memoryStore.seedStarter(req.user!.id));
    } catch (err) {
      return res.status(403).json({ error: err instanceof Error ? err.message : 'Failed to seed starter data.' });
    }
  });

  router.patch('/studio/profile', requireMemoryAuth, requireRole('creator', 'organizer'), (req: AuthedRequest, res) => {
    try {
      const profile = memoryStore.updateProfile(req.user!.id, req.body as Partial<OrganizerProfile>);
      return res.json({ profile });
    } catch (err) {
      return res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to update profile.' });
    }
  });

  router.post('/studio/events', requireMemoryAuth, requireRole('creator', 'organizer'), (req: AuthedRequest, res) => {
    const { event, blocks } = req.body as { event: EventItem; blocks?: ScheduleBlock[] };
    if (!event?.title) {
      return res.status(400).json({ error: 'Invalid event payload.' });
    }
    try {
      return res.status(201).json(memoryStore.createEvent(req.user!.id, event, blocks));
    } catch (err) {
      return res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to create event.' });
    }
  });

  router.patch('/studio/events/:id', requireMemoryAuth, requireRole('creator', 'organizer'), (req: AuthedRequest, res) => {
    try {
      const event = memoryStore.updateEvent(req.user!.id, req.params.id, req.body as EventItem);
      return res.json({ event });
    } catch (err) {
      return res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to update event.' });
    }
  });

  router.delete('/studio/events/:id', requireMemoryAuth, requireRole('creator', 'organizer'), (req: AuthedRequest, res) => {
    try {
      memoryStore.deleteEvent(req.user!.id, req.params.id);
      return res.json({ ok: true });
    } catch (err) {
      return res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to delete event.' });
    }
  });

  router.post('/studio/events/:eventId/attendees', requireMemoryAuth, requireRole('creator', 'organizer', 'gate_staff'), (req: AuthedRequest, res) => {
    try {
      const result = memoryStore.registerStudioAttendee(
        req.user!.id,
        req.params.eventId,
        req.body as Attendee
      );
      return res.status(201).json(result);
    } catch (err) {
      const status = (err as Error & { status?: number }).status || 400;
      return res.status(status).json({ error: err instanceof Error ? err.message : 'Failed to register attendee.' });
    }
  });

  router.patch('/studio/attendees/:id/checkin', requireMemoryAuth, requireRole('creator', 'organizer', 'gate_staff'), (req: AuthedRequest, res) => {
    try {
      const attendee = memoryStore.toggleCheckIn(req.user!.id, req.params.id);
      return res.json({ attendee });
    } catch (err) {
      return res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to toggle check-in.' });
    }
  });

  router.patch('/studio/attendees/:id/retry-payment', requireMemoryAuth, requireRole('creator', 'organizer'), (req: AuthedRequest, res) => {
    try {
      const attendee = memoryStore.retryPayment(req.user!.id, req.params.id);
      return res.json({ attendee });
    } catch (err) {
      return res.status(400).json({ error: err instanceof Error ? err.message : 'Payment retry failed.' });
    }
  });

  router.post('/studio/schedule', requireMemoryAuth, requireRole('creator', 'organizer'), (req: AuthedRequest, res) => {
    try {
      const block = memoryStore.addScheduleBlock(req.user!.id, req.body as ScheduleBlock);
      return res.status(201).json({ block });
    } catch (err) {
      return res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to add schedule block.' });
    }
  });

  router.patch('/studio/schedule/:id/toggle', requireMemoryAuth, requireRole('creator', 'organizer'), (req: AuthedRequest, res) => {
    try {
      const block = memoryStore.toggleScheduleBlock(req.user!.id, req.params.id);
      return res.json({ block });
    } catch (err) {
      return res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to toggle schedule block.' });
    }
  });

  router.delete('/studio/schedule/:id', requireMemoryAuth, requireRole('creator', 'organizer'), (req: AuthedRequest, res) => {
    try {
      memoryStore.deleteScheduleBlock(req.user!.id, req.params.id);
      return res.json({ ok: true });
    } catch (err) {
      return res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to delete schedule block.' });
    }
  });

  router.patch('/studio/alerts/:id/resolve', requireMemoryAuth, requireRole('creator', 'organizer'), (req: AuthedRequest, res) => {
    try {
      const alert = memoryStore.resolveAlert(req.user!.id, req.params.id);
      return res.json({ alert });
    } catch (err) {
      return res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to resolve alert.' });
    }
  });

  router.post('/studio/camera/shots', requireMemoryAuth, requireRole('creator', 'organizer', 'gate_staff'), (req: AuthedRequest, res) => {
    try {
      const shot = memoryStore.addShot(req.user!.id, req.body as DisposableShot);
      return res.status(201).json({ shot });
    } catch (err) {
      return res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to save film frame.' });
    }
  });

  router.patch('/studio/camera/shots/:id/like', requireMemoryAuth, requireRole('creator', 'organizer', 'gate_staff'), (req: AuthedRequest, res) => {
    try {
      const shot = memoryStore.toggleLikeShot(req.user!.id, req.params.id);
      return res.json({ shot });
    } catch (err) {
      return res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to update like.' });
    }
  });

  router.delete('/studio/camera/shots/:id', requireMemoryAuth, requireRole('creator', 'organizer'), (req: AuthedRequest, res) => {
    try {
      memoryStore.deleteShot(req.user!.id, req.params.id);
      return res.json({ ok: true });
    } catch (err) {
      return res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to delete shot.' });
    }
  });

  router.post('/studio/camera/:eventId/develop', requireMemoryAuth, requireRole('creator', 'organizer'), (req: AuthedRequest, res) => {
    try {
      memoryStore.developRoll(req.user!.id, req.params.eventId);
      return res.json({ ok: true });
    } catch (err) {
      return res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to develop roll.' });
    }
  });

  router.put('/studio/camera/:eventId/settings', requireMemoryAuth, requireRole('creator', 'organizer'), (req: AuthedRequest, res) => {
    try {
      const settings = memoryStore.updateRollSettings(
        req.user!.id,
        req.params.eventId,
        req.body as DisposableRollSettings
      );
      return res.json({ settings });
    } catch (err) {
      return res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to update settings.' });
    }
  });

  // =========================================================================
  // CREATOR APPS ROUTES (In-Memory Fallback)
  // =========================================================================

  router.post('/studio/apps', requireMemoryAuth, requireCreatorVerification, (req: AuthedRequest, res) => {
    const payload = req.body as {
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
    if (!payload.name?.trim()) {
      return res.status(400).json({ error: 'App name is required.' });
    }
    try {
      const result = memoryStore.createCreatorApp(req.user!.id, {
        ...payload,
        name: payload.name,
      });
      return res.status(201).json(result);
    } catch (err) {
      return res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to create app.' });
    }
  });

  router.patch('/studio/apps/:id', requireMemoryAuth, requireCreatorVerification, (req: AuthedRequest, res) => {
    try {
      const app = memoryStore.updateCreatorApp(req.user!.id, req.params.id, req.body);
      return res.json({ app });
    } catch (err) {
      return res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to update app.' });
    }
  });

  router.post('/studio/apps/:id/rotate-secret', requireMemoryAuth, requireCreatorVerification, (req: AuthedRequest, res) => {
    try {
      return res.json(memoryStore.rotateCreatorAppSecret(req.user!.id, req.params.id));
    } catch (err) {
      return res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to rotate secret.' });
    }
  });

  router.post('/studio/apps/:id/test-webhook', requireMemoryAuth, requireCreatorVerification, async (req: AuthedRequest, res) => {
    try {
      const { eventType } = req.body as { eventType?: string };
      const result = await memoryStore.testCreatorWebhook(req.user!.id, req.params.id, eventType);
      return res.json(result);
    } catch (err) {
      return res.status(400).json({ error: err instanceof Error ? err.message : 'Webhook test failed.' });
    }
  });

  router.post('/studio/apps/:id/simulate-call', requireMemoryAuth, requireCreatorVerification, (req: AuthedRequest, res) => {
    try {
      const { endpoint, method } = req.body as { endpoint?: string; method?: 'GET' | 'POST' };
      const result = memoryStore.simulateCreatorEndpointCall(
        req.user!.id,
        req.params.id,
        endpoint,
        method
      );
      return res.json(result);
    } catch (err) {
      return res.status(400).json({ error: err instanceof Error ? err.message : 'Endpoint test failed.' });
    }
  });

  router.delete('/studio/apps/:id', requireMemoryAuth, requireCreatorVerification, (req: AuthedRequest, res) => {
    try {
      memoryStore.deleteCreatorApp(req.user!.id, req.params.id);
      return res.json({ ok: true });
    } catch (err) {
      return res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to delete app.' });
    }
  });

  return router;
}
