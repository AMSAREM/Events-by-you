import express, { type NextFunction, type Response } from 'express';
import type { User } from '@supabase/supabase-js';
import {
  normalizePhoneE164,
  validateStrictEmail,
  validateStrictPassword,
  validateStrictPhoneE164,
} from '../src/data/initialData.ts';
import type {
  AppRole,
  Attendee,
  CreatorApp,
  DisposableRollSettings,
  DisposableShot,
  EventItem,
  GiftTableEntry,
  OrganizerProfile,
  ScheduleBlock,
} from '../src/types/events.ts';
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
} from './helpers.ts';
import {
  isResendConfigured,
  sendCheckInWelcomeEmail,
  sendEventPassEmail,
} from './resend.ts';
import { resolveEventMessage } from '../src/lib/eventMessages.ts';
import {
  clearPendingSignup,
  consumePendingSignup,
  dispatchDualAuthChallenge,
  getPendingSignup,
  hasActiveAuthChallenge,
  sendArkeselSmsOtp,
  stagePendingSignup,
  verifyAuthOtp,
} from './phoneAuth.ts';
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
  req.userPhone = user.profile.phone;
  req.phoneVerified = user.profile.phoneVerified;
  req.user = {
    id: user.id,
    email: user.email,
    phone: user.profile.phone,
  } as User;
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

  router.post('/studio/creator-unlock', requireMemoryAuth, requireVerifiedPhoneIfSet, (req: AuthedRequest, res) => {
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

  router.post('/auth/signin', async (req, res) => {
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
      const result = memoryStore.signIn(rawIdentifier, password, countryGateway || 'GH');
      if (result.profile.phone && !result.profile.phoneVerified) {
        const delivery = await dispatchDualAuthChallenge({
          phone: result.profile.phone,
          email: result.profile.email || undefined,
          purpose: 'login',
          name: result.profile.name,
          requireBoth: Boolean(result.profile.phone && result.profile.email),
          allowSandboxFallback: true,
        });
        if (!delivery.ok) {
          return res.status(400).json({ error: delivery.error || 'Could not dispatch verification code.' });
        }
        return res.json({
          requiresOtp: true,
          phone: result.profile.phone,
          email: result.profile.email || undefined,
          otpType: 'sms',
          channels: delivery.channels,
          provider: delivery.provider,
        });
      }
      return res.json({
        requiresOtp: false,
        session: result.session,
        profile: result.profile,
      });
    } catch (err) {
      return res.status(401).json({ error: err instanceof Error ? err.message : 'Invalid credentials.' });
    }
  });

  router.post('/auth/signup', async (req, res) => {
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
        error: 'You must agree to the Terms & Conditions and NCA SMS regulations to register.',
      });
    }

    if (memoryStore.getUserByPhone(phoneCheck.normalized)) {
      return res.status(409).json({
        error: `An account with phone number ${phoneCheck.normalized} already exists. Please sign in instead.`,
      });
    }
    if (memoryStore.getUserByEmail(cleanEmail)) {
      return res.status(409).json({
        error: `An account with email ${cleanEmail} already exists. Please sign in instead.`,
      });
    }

    await stagePendingSignup({
      phone: phoneCheck.normalized,
      email: cleanEmail,
      password: password!,
      name: trimmedName,
      studio: (studio || `${trimmedName.split(' ')[0]}'s Events`).trim(),
      countryGateway: gateway,
      appRole: appRole === 'gate_staff' ? 'gate_staff' : 'organizer',
    });

    const delivery = await dispatchDualAuthChallenge({
      phone: phoneCheck.normalized,
      email: cleanEmail,
      purpose: 'signup',
      name: trimmedName,
      requireBoth: true,
      allowSandboxFallback: true,
    });

    if (!delivery.ok) {
      await clearPendingSignup({ phone: phoneCheck.normalized, email: cleanEmail });
      return res.status(400).json({
        error:
          delivery.error ||
          'Could not dispatch verification code to both SMS and email. Account was not created.',
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
  });

  router.post('/auth/verify-otp', async (req, res) => {
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
        const otpRes = await verifyAuthOtp({
          phone: normalizedPhone || undefined,
          email: normalizedEmail || undefined,
          token: cleanToken,
        });
        if (!otpRes.ok) {
          return res.status(401).json({ error: otpRes.error });
        }
        const resolvedPhone = otpRes.phone || normalizedPhone;
        const resolvedEmail = otpRes.email || normalizedEmail;
        const pending = await getPendingSignup({ phone: resolvedPhone, email: resolvedEmail });
        if (pending) {
          const created = memoryStore.signUp({
            email: pending.email,
            phone: pending.phone,
            phoneVerified: true,
            password: pending.password,
            name: pending.name,
            studio: pending.studio,
            appRole: pending.appRole,
          });
          await consumePendingSignup({ phone: pending.phone, email: pending.email });
          return res.json(created);
        }
        const result = memoryStore.verifyOtp(
          { phone: resolvedPhone || undefined, email: resolvedEmail || undefined },
          cleanToken
        );
        return res.json(result);
      }

      const result = memoryStore.verifyOtp({ email: normalizedEmail || email }, cleanToken);
      return res.json(result);
    } catch (err) {
      return res.status(401).json({ error: err instanceof Error ? err.message : 'Invalid verification code.' });
    }
  });

  router.post('/auth/send-otp', async (req, res) => {
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
    if (!target.includes('@')) {
      const phoneCheck = validateStrictPhoneE164(target, countryGateway || 'GH');
      if (!phoneCheck.ok) {
        return res.status(400).json({ error: phoneCheck.error });
      }
      const existingUser = memoryStore.getUserByPhone(phoneCheck.normalized);
      if (!existingUser) {
        return res.status(404).json({
          error: `No registered account found for ${phoneCheck.normalized}. Create a free account first.`,
        });
      }
      const delivery = await dispatchDualAuthChallenge({
        phone: phoneCheck.normalized,
        email: existingUser.email || undefined,
        purpose: 'login',
        name: existingUser.profile.name,
        requireBoth: Boolean(phoneCheck.normalized && existingUser.email),
        allowSandboxFallback: true,
      });
      if (!delivery.ok) {
        return res.status(400).json({ error: delivery.error });
      }
      return res.json({
        ok: true,
        phone: phoneCheck.normalized,
        email: existingUser.email || undefined,
        channels: delivery.channels,
        provider: delivery.provider,
      });
    }

    const emailCheck = validateStrictEmail(target);
    if (!emailCheck.ok) {
      return res.status(400).json({ error: emailCheck.error });
    }
    const cleanEmail = emailCheck.normalized;
    const existingUser = memoryStore.getUserByEmail(cleanEmail);
    if (!existingUser) {
      return res.status(404).json({
        error: `No registered account found for ${cleanEmail}. Create a free account first.`,
      });
    }
    const delivery = await dispatchDualAuthChallenge({
      phone: existingUser.profile.phone || undefined,
      email: cleanEmail,
      purpose: 'login',
      name: existingUser.profile.name,
      requireBoth: Boolean(existingUser.profile.phone && cleanEmail),
      allowSandboxFallback: true,
    });
    if (!delivery.ok) {
      return res.status(400).json({ error: delivery.error });
    }
    return res.json({
      ok: true,
      phone: existingUser.profile.phone || undefined,
      email: cleanEmail,
      channels: delivery.channels,
      provider: delivery.provider,
    });
  });

  router.post('/auth/resend-otp', async (req, res) => {
    const { email, phone, countryGateway, otpType } = req.body as {
      email?: string;
      phone?: string;
      countryGateway?: string;
      otpType?: string;
    };

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
    const existing = normalizedPhone
      ? memoryStore.getUserByPhone(normalizedPhone)
      : cleanEmail
        ? memoryStore.getUserByEmail(cleanEmail)
        : null;

    if (!pending && !existing) {
      return res.status(404).json({
        error: 'No active verification session found. Submit sign-up or sign-in again.',
      });
    }

    const targetPhone = pending?.phone || existing?.profile.phone || normalizedPhone || undefined;
    const targetEmail = pending?.email || existing?.email || cleanEmail || undefined;

    const delivery = await dispatchDualAuthChallenge({
      phone: targetPhone,
      email: targetEmail,
      purpose: otpType === 'recovery' ? 'recovery' : pending ? 'signup' : 'login',
      name: pending?.name || existing?.profile.name,
      requireBoth: Boolean(targetPhone && targetEmail),
      allowSandboxFallback: true,
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
  });

  router.post('/auth/reset-password', async (req, res) => {
    const { email, phone, countryGateway } = req.body as {
      email?: string;
      phone?: string;
      countryGateway?: string;
    };
    if (phone?.trim()) {
      const phoneCheck = validateStrictPhoneE164(phone.trim(), countryGateway || 'GH');
      if (!phoneCheck.ok) {
        return res.status(400).json({ error: phoneCheck.error });
      }
      const existing = memoryStore.getUserByPhone(phoneCheck.normalized);
      if (!existing) {
        return res.status(404).json({
          error: `No account registered with ${phoneCheck.normalized}.`,
        });
      }
      const delivery = await dispatchDualAuthChallenge({
        phone: phoneCheck.normalized,
        email: existing.email || undefined,
        purpose: 'recovery',
        name: existing.profile.name,
        requireBoth: Boolean(phoneCheck.normalized && existing.email),
        allowSandboxFallback: true,
      });
      if (!delivery.ok) {
        return res.status(400).json({ error: delivery.error });
      }
      return res.json({
        ok: true,
        phone: phoneCheck.normalized,
        email: existing.email || undefined,
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
    const existing = memoryStore.getUserByEmail(cleanEmail);
    if (!existing) {
      return res.status(404).json({
        error: `No account registered with ${cleanEmail}.`,
      });
    }
    const delivery = await dispatchDualAuthChallenge({
      phone: existing.profile.phone || undefined,
      email: cleanEmail,
      purpose: 'recovery',
      name: existing.profile.name,
      requireBoth: Boolean(existing.profile.phone && cleanEmail),
      allowSandboxFallback: true,
    });
    if (!delivery.ok) {
      return res.status(400).json({ error: delivery.error });
    }
    return res.json({
      ok: true,
      phone: existing.profile.phone || undefined,
      email: cleanEmail,
      channels: delivery.channels,
      provider: delivery.provider,
    });
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

  router.post('/auth/update-password', requireMemoryAuth, requireVerifiedPhoneIfSet, (req: AuthedRequest, res) => {
    const { password } = req.body as { password?: string };
    const pwCheck = validateStrictPassword(password || '');
    if (!pwCheck.ok) {
      return res.status(400).json({ error: pwCheck.error });
    }
    memoryStore.updatePassword(req.user!.id, password!);
    return res.json({ ok: true });
  });

  // =========================================================================
  // PUBLIC ROUTES (In-Memory Fallback)
  // =========================================================================

  router.get('/public/events', (_req, res) => {
    return res.json({ events: memoryStore.getPublicEvents() });
  });

  router.get('/public/events/:slugOrId', (req, res) => {
    const evt = memoryStore.getPublicEventBySlugOrId(req.params.slugOrId);
    if (!evt) {
      return res.status(404).json({ error: 'Event invitation not found or no longer active.' });
    }
    return res.json({ event: evt });
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
      const targetEvent = memoryStore.getPublicEventBySlugOrId(eventId);
      const orgDefaults = memoryStore.getEventOrganizerDefaults(eventId);
      const requestOrigin = (process.env.APP_URL || '').trim().replace(/\/+$/, '') || `${req.protocol}://${req.get('host')}`;
      const resolvedMsg = targetEvent
        ? resolveEventMessage({
            type: 'confirmation',
            event: targetEvent,
            attendeeName: name.trim(),
            ticketCode: finalCode,
            originOverride: requestOrigin,
            includeGuestInCameraUrl: true,
          })
        : null;

      const [smsDelivery, emailDelivery] = await Promise.all([
        dispatchOptionalArkeselSms(
          normalizedPhone,
          targetEvent?.title ?? 'Events App',
          finalCode,
          targetEvent?.senderId || orgDefaults.senderId,
          resolvedMsg?.text
        ),
        isResendConfigured() && targetEvent
          ? sendEventPassEmail({
              to: email.trim(),
              attendeeName: name.trim(),
              eventTitle: targetEvent.title,
              eventDate: targetEvent.date,
              eventTime: targetEvent.time,
              eventVenue: targetEvent.venue,
              eventCity: targetEvent.city,
              ticketCode: finalCode,
              tier: tier || 'General',
              organizerName: targetEvent.organizer,
              replyTo: orgDefaults.replyToEmail,
              customMessage: resolvedMsg?.text,
              cameraUrl: resolvedMsg?.cameraUrl,
            })
          : Promise.resolve({ ok: false, skipped: true }),
      ]);
      const hasLiveArkesel = Boolean((process.env.ARKESEL_API_KEY || '').trim()) && platformRuntime.flags.smsMode !== 'sandbox';
      const finalDeliveryStatus: Attendee['smsStatus'] =
        emailDelivery.ok && (!hasLiveArkesel || smsDelivery === 'Pending')
          ? 'Resend Delivered'
          : smsDelivery;

      const result = memoryStore.registerPublicAttendee({
        id: attendeeId,
        eventId,
        name: name.trim(),
        email: email.trim(),
        phone: normalizedPhone,
        organization,
        tier,
        ticketCode: finalCode,
        smsStatus: finalDeliveryStatus,
        validationGroup,
        inviteCodeUsed,
        giftEntry,
        customResponses,
      });
      return res.status(201).json(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Registration failed.';
      if (msg.includes('QR_PASS_NOT_PUBLISHED:')) {
        return res.status(403).json({
          error: 'Check-in QR passes have not been published by the event creator yet.',
        });
      }
      if (msg.includes('INVALID_INVITE_CODE:')) {
        return res.status(403).json({
          error: msg.split('INVALID_INVITE_CODE:')[1],
        });
      }
      if (msg.includes('DUPLICATE_PHONE:')) {
        return res.status(409).json({
          error: `Duplicate shield: ${msg.split('DUPLICATE_PHONE:')[1]}`,
        });
      }
      return res.status(400).json({ error: msg });
    }
  });

  // Standalone Public Gift Table endpoint
  router.post('/public/events/:slugOrId/gifts', (req, res) => {
    try {
      const result = memoryStore.recordGiftTableEntry(
        req.params.slugOrId,
        req.body as Partial<GiftTableEntry>,
        'public-table'
      );
      return res.status(201).json(result);
    } catch (err) {
      const status = (err as Error & { status?: number }).status || 400;
      return res.status(status).json({
        error: err instanceof Error ? err.message : 'Failed to record gift table entry.',
      });
    }
  });

  // Public Disposable Camera Routes (for guests clicking SMS/email camera link)
  router.get('/public/camera/:slugOrId', (req, res) => {
    const passQuery = typeof req.query.pass === 'string' ? req.query.pass.trim() : undefined;
    const roll = memoryStore.getPublicCameraRoll(req.params.slugOrId, passQuery);
    if (!roll) {
      return res.status(404).json({ error: 'Event disposable camera not found.' });
    }
    return res.json(roll);
  });

  router.post('/public/camera/:slugOrId/shots', (req, res) => {
    try {
      const shot = memoryStore.addPublicShot(req.params.slugOrId, req.body as DisposableShot);
      return res.status(201).json({ shot });
    } catch (err) {
      const status = (err as Error & { status?: number }).status || 400;
      return res.status(status).json({ error: err instanceof Error ? err.message : 'Failed to save film frame.' });
    }
  });

  router.patch('/public/camera/shots/:id/like', (req, res) => {
    try {
      const shot = memoryStore.togglePublicLikeShot(req.params.id);
      return res.json({ shot });
    } catch (err) {
      const status = (err as Error & { status?: number }).status || 400;
      return res.status(status).json({ error: err instanceof Error ? err.message : 'Failed to update like.' });
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

  router.post('/studio/seed-starter', requireMemoryAuth, requireRole('creator', 'organizer'), (_req: AuthedRequest, res) => {
    return res.status(403).json({ error: 'Demo and starter data seeding has been removed.' });
  });

  router.patch('/studio/profile', requireMemoryAuth, requireRole('creator', 'organizer'), (req: AuthedRequest, res) => {
    try {
      const profile = memoryStore.updateProfile(req.user!.id, req.body as Partial<OrganizerProfile>);
      return res.json({ profile });
    } catch (err) {
      return res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to update profile.' });
    }
  });

  router.delete('/studio/account', requireMemoryAuth, requireRole('creator', 'organizer', 'gate_staff'), async (req: AuthedRequest, res) => {
    const confirmation = (req.body as { confirmation?: string } | undefined)?.confirmation;
    if (confirmation !== undefined && confirmation.trim().toUpperCase() !== 'DELETE') {
      return res.status(400).json({ error: 'Type DELETE to confirm permanent account deletion.' });
    }
    try {
      const deletedUserId = req.user!.id;
      const contacts = memoryStore.deleteAccount(deletedUserId);
      try {
        await clearPendingSignup(contacts);
      } catch {
        // Ignore cleanup errors for optional OTP persistence tables
      }
      return res.json({ ok: true, deletedUserId });
    } catch (err) {
      const status = (err as Error & { status?: number })?.status ?? 400;
      return res.status(status).json({ error: err instanceof Error ? err.message : 'Failed to delete account.' });
    }
  });

  router.post('/studio/sms/test', requireMemoryAuth, requireRole('creator', 'organizer'), async (req: AuthedRequest, res) => {
    const { phone, senderId } = req.body as { phone?: string; senderId?: string };
    const phoneCheck = validateStrictPhoneE164(phone || '');
    if (!phoneCheck.ok) {
      return res.status(400).json({ error: phoneCheck.error });
    }
    try {
      const currentProfile = req.memoryUser!.profile;
      if (currentProfile.smsCredits <= 0 && platformRuntime.flags.smsMode !== 'sandbox') {
        return res.status(400).json({ error: 'No SMS credits remaining in your organizer balance.' });
      }
      const testCode = String(Math.floor(100000 + Math.random() * 899999));
      const dispatch = await sendArkeselSmsOtp({
        phone: phoneCheck.normalized,
        code: testCode,
        purpose: 'test',
        senderId: (senderId || '').trim() || currentProfile.senderId,
      });
      if (!dispatch.ok) {
        return res.status(400).json({ error: dispatch.error || 'Arkesel SMS test dispatch failed.' });
      }
      let nextCredits = currentProfile.smsCredits;
      if (!dispatch.sandbox) {
        const updated = memoryStore.updateProfile(req.user!.id, {
          smsCredits: Math.max(0, currentProfile.smsCredits - 1),
        });
        nextCredits = updated.smsCredits;
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
      const status = (err as Error & { status?: number }).status || 400;
      return res.status(status).json({ error: err instanceof Error ? err.message : 'Failed to update event.' });
    }
  });

  router.patch('/studio/events/:id/qr-pass', requireMemoryAuth, requireRole('creator', 'organizer'), (req: AuthedRequest, res) => {
    try {
      const published = Boolean((req.body as { published?: boolean })?.published);
      const event = memoryStore.publishQrPass(req.user!.id, req.params.id, published);
      return res.json({ event });
    } catch (err) {
      const status = (err as Error & { status?: number }).status || 400;
      return res.status(status).json({ error: err instanceof Error ? err.message : 'Failed to update QR pass state.' });
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

  router.post('/studio/events/:eventId/attendees', requireMemoryAuth, requireRole('creator', 'organizer'), async (req: AuthedRequest, res) => {
    try {
      const payload = req.body as Attendee;
      const result = memoryStore.registerStudioAttendee(
        req.user!.id,
        req.params.eventId,
        payload
      );
      const requestOrigin = (process.env.APP_URL || '').trim().replace(/\/+$/, '') || `${req.protocol}://${req.get('host')}`;
      const msgType = result.attendee.checkedIn ? 'checkin' : 'confirmation';
      const resolvedMsg = resolveEventMessage({
        type: msgType,
        event: result.event,
        attendeeName: result.attendee.name,
        ticketCode: result.attendee.ticketCode,
        originOverride: requestOrigin,
        includeGuestInCameraUrl: true,
      });

      await Promise.all([
        result.attendee.phone
          ? dispatchOptionalArkeselSms(
              result.attendee.phone,
              result.event.title,
              result.attendee.ticketCode,
              result.event.senderId || req.memoryUser?.profile.senderId,
              resolvedMsg.text
            )
          : Promise.resolve('Pending' as const),
        isResendConfigured() && result.attendee.email?.includes('@')
          ? result.attendee.checkedIn
            ? sendCheckInWelcomeEmail({
                to: result.attendee.email,
                attendeeName: result.attendee.name,
                eventTitle: result.event.title,
                eventDate: result.event.date,
                eventVenue: result.event.venue,
                eventCity: result.event.city,
                ticketCode: result.attendee.ticketCode,
                organizerName: result.event.organizer,
                welcomeMessage: resolvedMsg.text,
                cameraUrl: resolvedMsg.cameraUrl,
                replyTo: req.memoryUser?.profile.replyToEmail,
              })
            : sendEventPassEmail({
                to: result.attendee.email,
                attendeeName: result.attendee.name,
                eventTitle: result.event.title,
                eventDate: result.event.date,
                eventTime: result.event.time,
                eventVenue: result.event.venue,
                eventCity: result.event.city,
                ticketCode: result.attendee.ticketCode,
                tier: result.attendee.tier,
                organizerName: result.event.organizer,
                replyTo: req.memoryUser?.profile.replyToEmail,
                customMessage: resolvedMsg.text,
                cameraUrl: resolvedMsg.cameraUrl,
              })
          : Promise.resolve({ ok: false, skipped: true }),
      ]);
      return res.status(201).json({
        ...result,
        cameraUrl: resolvedMsg.cameraUrl,
        dispatchedMessage: resolvedMsg.text,
      });
    } catch (err) {
      const status = (err as Error & { status?: number }).status || 400;
      return res.status(status).json({ error: err instanceof Error ? err.message : 'Failed to register attendee.' });
    }
  });

  router.post('/studio/events/:eventId/gifts', requireMemoryAuth, requireRole('creator', 'organizer', 'gate_staff'), (req: AuthedRequest, res) => {
    try {
      const result = memoryStore.recordGiftTableEntry(
        req.params.eventId,
        req.body as Partial<GiftTableEntry>,
        'gift-desk'
      );
      return res.status(201).json(result);
    } catch (err) {
      const status = (err as Error & { status?: number }).status || 400;
      return res.status(status).json({
        error: err instanceof Error ? err.message : 'Failed to record gift desk entry.',
      });
    }
  });

  router.patch('/studio/attendees/:id/checkin', requireMemoryAuth, requireRole('creator', 'organizer', 'gate_staff'), async (req: AuthedRequest, res) => {
    try {
      const attendee = memoryStore.toggleCheckIn(req.user!.id, req.params.id);
      let checkInMessageSent = false;
      let cameraUrl: string | undefined;
      let dispatchedMessage: string | undefined;

      if (attendee.checkedIn) {
        const evt = memoryStore.getAnyEventBySlugOrId(attendee.eventId);
        if (evt) {
          const requestOrigin = (process.env.APP_URL || '').trim().replace(/\/+$/, '') || `${req.protocol}://${req.get('host')}`;
          const resolved = resolveEventMessage({
            type: 'checkin',
            event: evt,
            attendeeName: attendee.name,
            ticketCode: attendee.ticketCode,
            originOverride: requestOrigin,
            includeGuestInCameraUrl: true,
          });
          cameraUrl = resolved.cameraUrl;
          dispatchedMessage = resolved.text;
          await Promise.all([
            attendee.phone
              ? dispatchOptionalArkeselSms(
                  attendee.phone,
                  evt.title,
                  attendee.ticketCode,
                  evt.senderId || req.memoryUser?.profile.senderId,
                  resolved.text
                )
              : Promise.resolve('Pending' as const),
            isResendConfigured() && attendee.email?.includes('@')
              ? sendCheckInWelcomeEmail({
                  to: attendee.email,
                  attendeeName: attendee.name,
                  eventTitle: evt.title,
                  eventDate: evt.date,
                  eventVenue: evt.venue,
                  eventCity: evt.city,
                  ticketCode: attendee.ticketCode,
                  organizerName: evt.organizer,
                  welcomeMessage: resolved.text,
                  cameraUrl: resolved.cameraUrl,
                  replyTo: req.memoryUser?.profile.replyToEmail,
                })
              : Promise.resolve({ ok: false, skipped: true }),
          ]);
          checkInMessageSent = true;
        }
      }

      return res.json({ attendee, checkInMessageSent, cameraUrl, dispatchedMessage });
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
      const status = (err as Error & { status?: number }).status || 400;
      return res.status(status).json({ error: err instanceof Error ? err.message : 'Failed to save film frame.' });
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
