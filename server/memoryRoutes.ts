import crypto from 'node:crypto';
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
import {
  appendPoweredByLine,
  calculateSmsCredits,
  resolveEventMessage,
} from '../src/lib/eventMessages.ts';
import {
  resolveAuthoritativeSmsBundle,
  validateReceiptReference,
} from '../src/lib/smsBundles.ts';
import {
  DEFAULT_SHARED_SENDER_ID,
  getPlanEntitlements,
  hasCustomSenderIdValue,
  resolveAuthoritativeSubscriptionQuote,
} from '../src/lib/subscriptionPlans.ts';
import {
  initializePaystackTransaction,
  isPaystackConfigured,
  verifyPaystackTransaction,
} from './paystack.ts';
import {
  clearPendingSignup,
  consumePendingSignup,
  dispatchDualAuthChallenge,
  fetchArkeselGatewayBalance,
  getPendingSignup,
  hasActiveAuthChallenge,
  isArkeselConfigured,
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

      const smsCost = Math.max(1, calculateSmsCredits(resolvedMsg?.text || `${targetEvent?.title ?? 'Event'} pass ${finalCode}`));
      const hasCredits = Boolean(orgDefaults.organizerId && orgDefaults.smsCredits >= smsCost);
      let smsDelivery: Attendee['smsStatus'] = 'Pending';
      let smsCreditsUsed = 0;
      let smsCreditsRemaining = orgDefaults.smsCredits;
      let smsSkippedReason: string | undefined;

      const [smsResult, emailDelivery] = await Promise.all([
        hasCredits
          ? dispatchOptionalArkeselSms(
              normalizedPhone,
              targetEvent?.title ?? 'Events By You',
              finalCode,
              orgDefaults.allowCustomSenderId
                ? targetEvent?.senderId || orgDefaults.senderId
                : DEFAULT_SHARED_SENDER_ID,
              resolvedMsg?.text
            )
          : Promise.resolve('Pending' as const),
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

      if (!hasCredits) {
        smsSkippedReason = 'Organizer SMS bundle balance is 0 (no purchased SMS credits remaining).';
      } else if (smsResult === 'Arkesel Sent' && orgDefaults.organizerId) {
        const debit = memoryStore.consumeSmsCredits(orgDefaults.organizerId, smsCost);
        if (debit.ok) {
          smsDelivery = 'Arkesel Sent';
          smsCreditsUsed = smsCost;
          smsCreditsRemaining = debit.remaining;
        } else {
          smsCreditsRemaining = debit.remaining;
          smsSkippedReason = 'Organizer SMS bundle balance is insufficient.';
        }
      }

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
        smsCreditsUsed,
        validationGroup,
        inviteCodeUsed,
        giftEntry,
        customResponses,
      });
      return res.status(201).json({
        ...result,
        smsCreditsUsed,
        smsCreditsRemaining,
        smsSkippedReason,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Registration failed.';
      if (msg.includes('QR_PASS_NOT_PUBLISHED:')) {
        return res.status(403).json({
          error: 'Check-in QR passes have not been published by the event creator yet.',
        });
      }
      if (msg.includes('CAPACITY_REACHED:')) {
        return res.status(403).json({
          error: msg.split('CAPACITY_REACHED:')[1],
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

  router.get('/public/events/:slugOrId/gift-desk/:token', (req, res) => {
    try {
      const result = memoryStore.getGiftDeskSession(req.params.slugOrId, req.params.token);
      return res.json(result);
    } catch (err) {
      const status = (err as Error & { status?: number }).status || 400;
      return res.status(status).json({
        error: err instanceof Error ? err.message : 'Failed to verify gift desk link.',
      });
    }
  });

  router.post('/public/events/:slugOrId/gift-desk/:token', (req, res) => {
    try {
      const result = memoryStore.recordGiftDeskEntry(
        req.params.slugOrId,
        req.params.token,
        req.body as Partial<GiftTableEntry>
      );
      return res.status(201).json(result);
    } catch (err) {
      const status = (err as Error & { status?: number }).status || 400;
      return res.status(status).json({
        error: err instanceof Error ? err.message : 'Failed to log desk gift entry.',
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
      const status = (err as { status?: number })?.status || 400;
      return res.status(status).json({ error: err instanceof Error ? err.message : 'Failed to update profile.' });
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
      const ent = getPlanEntitlements(currentProfile);
      if (!ent.allowCustomSenderId && hasCustomSenderIdValue(senderId)) {
        return res.status(403).json({
          error: 'Custom Alphanumeric Sender ID requires Pro Organizer or Enterprise plan.',
        });
      }
      if (currentProfile.smsCredits < 1) {
        return res.status(402).json({
          error: 'Insufficient SMS credits (0 remaining). Purchase an SMS bundle in Plan & Credits to send SMS.',
        });
      }
      const testCode = String(Math.floor(100000 + Math.random() * 899999));
      const effectiveSenderId = ent.allowCustomSenderId
        ? (senderId || '').trim() || currentProfile.senderId
        : DEFAULT_SHARED_SENDER_ID;
      const dispatch = await sendArkeselSmsOtp({
        phone: phoneCheck.normalized,
        code: testCode,
        purpose: 'test',
        senderId: effectiveSenderId,
      });
      if (!dispatch.ok) {
        return res.status(400).json({ error: dispatch.error || 'Arkesel SMS test dispatch failed.' });
      }
      const debit = memoryStore.consumeSmsCredits(req.user!.id, 1);
      return res.json({
        ok: true,
        phone: phoneCheck.normalized,
        senderId: dispatch.senderIdUsed,
        messageId: dispatch.messageId,
        sandbox: Boolean(dispatch.sandbox),
        warning: dispatch.warning,
        smsCredits: debit.remaining,
      });
    } catch (err) {
      return res.status(500).json({ error: err instanceof Error ? err.message : 'SMS test failed.' });
    }
  });

  router.get('/studio/arkesel/status', requireMemoryAuth, requireRole('creator', 'organizer'), async (req: AuthedRequest, res) => {
    try {
      const currentProfile = req.memoryUser!.profile;
      const senderInfo = platformRuntime.getEffectiveArkeselSenderId(currentProfile.senderId);
      const bal = await fetchArkeselGatewayBalance();
      return res.json({
        configured: isArkeselConfigured(),
        paystackConfigured: isPaystackConfigured(),
        mode: platformRuntime.flags.smsMode,
        live: bal.ok,
        smsBalance: bal.ok && typeof bal.credits === 'number' ? bal.credits : null,
        mainBalance: bal.ok && typeof bal.mainBalance === 'number' ? bal.mainBalance : null,
        error: bal.ok ? null : (bal.error || null),
        senderId: senderInfo.senderId,
        isDefaultUnverifiedSender: senderInfo.isDefaultUnverifiedWarning,
        organizerCredits: currentProfile.smsCredits,
        apiInfoUrl: 'https://sms.arkesel.com/user/sms-api/info',
        rechargeUrl: 'https://sms.arkesel.com',
        checkedAt: new Date().toISOString(),
      });
    } catch (err) {
      return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to query Arkesel status.' });
    }
  });

  router.get('/studio/sms/purchases', requireMemoryAuth, requireRole('creator', 'organizer'), (req: AuthedRequest, res) => {
    const purchases = memoryStore.listSmsPurchases(req.user!.id);
    return res.json({
      purchases,
      paystackConfigured: isPaystackConfigured(),
      mode: platformRuntime.flags.smsMode,
    });
  });

  router.post('/studio/sms/paystack/initialize', requireMemoryAuth, requireRole('creator', 'organizer'), async (req: AuthedRequest, res) => {
    if (!isPaystackConfigured()) {
      return res.status(503).json({
        error: 'Paystack checkout is not configured on the server yet. Set PAYSTACK_SECRET_KEY or submit a verified Arkesel receipt reference.',
      });
    }
    const { bundleId, credits, amountGhs, callbackUrl } = req.body as {
      bundleId?: string;
      credits?: number;
      amountGhs?: number;
      callbackUrl?: string;
    };

    let quote;
    try {
      quote = resolveAuthoritativeSmsBundle({
        bundleId,
        credits,
        expectedAmountGhs: amountGhs,
      });
    } catch (err) {
      return res.status(400).json({ error: err instanceof Error ? err.message : 'Invalid SMS bundle selection.' });
    }

    const email = (req.memoryUser?.email || req.memoryUser?.profile.email || '').trim();
    if (!email || !email.includes('@')) {
      return res.status(400).json({
        error: 'Add a valid email address in Account Settings before starting Paystack card/MoMo checkout.',
      });
    }

    const reference = `EBY-SMS-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    const originHeader =
      (typeof req.headers.origin === 'string' && /^https?:\/\//i.test(req.headers.origin)
        ? req.headers.origin
        : (process.env.APP_URL || '').trim().replace(/\/+$/, '')) || 'http://localhost:3000';
    const safeCallback =
      typeof callbackUrl === 'string' && /^https?:\/\//i.test(callbackUrl)
        ? callbackUrl
        : `${originHeader}/?paystack_ref=${encodeURIComponent(reference)}`;

    const pending = memoryStore.createPaystackPendingPurchase(req.user!.id, {
      bundleId: quote.bundleId,
      bundleName: quote.bundleName,
      credits: quote.credits,
      amountGhs: quote.amountGhs,
      reference,
    });

    const initRes = await initializePaystackTransaction({
      email,
      amountGhs: quote.amountGhs,
      reference,
      callbackUrl: safeCallback,
      metadata: {
        userId: req.user!.id,
        purchaseId: pending.id,
        bundleId: quote.bundleId,
        credits: quote.credits,
      },
    });

    if (!initRes.ok || !initRes.authorizationUrl) {
      memoryStore.markPaystackPurchaseFailed(reference, initRes.error);
      return res.status(400).json({ error: initRes.error || 'Paystack initialization failed.' });
    }

    return res.json({
      ok: true,
      reference: initRes.reference,
      authorizationUrl: initRes.authorizationUrl,
      accessCode: initRes.accessCode,
      purchase: pending,
      quote,
    });
  });

  router.get('/studio/sms/paystack/verify/:reference', requireMemoryAuth, requireRole('creator', 'organizer'), async (req: AuthedRequest, res) => {
    if (!isPaystackConfigured()) {
      return res.status(503).json({ error: 'PAYSTACK_SECRET_KEY is not configured on the server.' });
    }
    const reference = (req.params.reference || '').trim();
    if (!reference) {
      return res.status(400).json({ error: 'Payment reference is required.' });
    }

    const existing = memoryStore.findSmsPurchaseByReference(reference);
    if (!existing) {
      return res.status(404).json({ error: `Purchase record for reference "${reference}" not found.` });
    }
    if (existing.organizerId !== req.user!.id && req.memoryUser?.profile.appRole !== 'creator') {
      return res.status(403).json({ error: 'Forbidden: payment reference belongs to another organizer.' });
    }

    if (existing.status === 'credited') {
      const bal = await fetchArkeselGatewayBalance();
      const senderInfo = platformRuntime.getEffectiveArkeselSenderId(req.memoryUser!.profile.senderId);
      return res.json({
        ok: true,
        alreadyCredited: true,
        profile: req.memoryUser!.profile,
        purchase: existing,
        arkeselStatus: {
          configured: isArkeselConfigured(),
          paystackConfigured: true,
          mode: platformRuntime.flags.smsMode,
          live: bal.ok,
          smsBalance: bal.ok && typeof bal.credits === 'number' ? bal.credits : null,
          mainBalance: bal.ok && typeof bal.mainBalance === 'number' ? bal.mainBalance : null,
          error: bal.ok ? null : (bal.error || null),
          senderId: senderInfo.senderId,
          isDefaultUnverifiedSender: senderInfo.isDefaultUnverifiedWarning,
          organizerCredits: req.memoryUser!.profile.smsCredits,
          apiInfoUrl: 'https://sms.arkesel.com/user/sms-api/info',
          rechargeUrl: 'https://sms.arkesel.com',
          checkedAt: new Date().toISOString(),
        },
        message: `Payment ${reference} was already verified and credited (+${existing.credits.toLocaleString()} SMS).`,
      });
    }

    const verify = await verifyPaystackTransaction(reference);
    if (!verify.ok) {
      return res.status(400).json({ error: verify.error || 'Paystack verification failed.' });
    }
    if (!verify.paid) {
      if (verify.gatewayStatus === 'failed' || verify.gatewayStatus === 'abandoned') {
        memoryStore.markPaystackPurchaseFailed(reference, `Gateway status: ${verify.gatewayStatus}`);
      }
      return res.status(402).json({
        error: `Payment ${reference} has status "${verify.gatewayStatus}" on Paystack and has not settled.`,
      });
    }
    if (verify.currency !== 'GHS') {
      return res.status(400).json({ error: `Expected GHS currency from Paystack, got ${verify.currency}.` });
    }
    const expectedPesewas = Math.round(existing.amountGhs * 100);
    if (verify.amountPesewas < expectedPesewas) {
      return res.status(400).json({
        error: `Underpayment detected: paid GH₵ ${(verify.amountPesewas / 100).toFixed(2)}, expected GH₵ ${existing.amountGhs.toFixed(2)}.`,
      });
    }
    const metaUserId = verify.metadata?.userId ? String(verify.metadata.userId) : undefined;
    if (metaUserId && metaUserId !== existing.organizerId) {
      return res.status(403).json({ error: 'Paystack transaction metadata does not match this organizer.' });
    }

    const completed = memoryStore.completePaystackPurchase(existing.organizerId, reference, verify.channel);
    const bal = await fetchArkeselGatewayBalance();
    const senderInfo = platformRuntime.getEffectiveArkeselSenderId(completed.profile.senderId);

    return res.json({
      ok: true,
      alreadyCredited: completed.alreadyCredited,
      profile: completed.profile,
      purchase: completed.purchase,
      arkeselStatus: {
        configured: isArkeselConfigured(),
        paystackConfigured: true,
        mode: platformRuntime.flags.smsMode,
        live: bal.ok,
        smsBalance: bal.ok && typeof bal.credits === 'number' ? bal.credits : null,
        mainBalance: bal.ok && typeof bal.mainBalance === 'number' ? bal.mainBalance : null,
        error: bal.ok ? null : (bal.error || null),
        senderId: senderInfo.senderId,
        isDefaultUnverifiedSender: senderInfo.isDefaultUnverifiedWarning,
        organizerCredits: completed.profile.smsCredits,
        apiInfoUrl: 'https://sms.arkesel.com/user/sms-api/info',
        rechargeUrl: 'https://sms.arkesel.com',
        checkedAt: new Date().toISOString(),
      },
      message: `Paystack payment verified (${reference}). +${completed.purchase.credits.toLocaleString()} SMS credits added to your workspace.`,
    });
  });

  router.post('/studio/sms/purchase-bundle', requireMemoryAuth, requireRole('creator', 'organizer'), async (req: AuthedRequest, res) => {
    const { bundleId, credits, amountGhs, paymentChannel, arkeselReference } = req.body as {
      bundleId?: string;
      credits?: number;
      amountGhs?: number;
      paymentChannel?: string;
      arkeselReference?: string;
    };

    let quote;
    try {
      quote = resolveAuthoritativeSmsBundle({
        bundleId,
        credits,
        expectedAmountGhs: amountGhs,
      });
    } catch (err) {
      return res.status(400).json({ error: err instanceof Error ? err.message : 'Invalid SMS bundle selection.' });
    }

    const refCheck = validateReceiptReference(arkeselReference);
    if (!refCheck.ok) {
      return res.status(400).json({ error: refCheck.error });
    }
    const cleanRef = refCheck.normalized;

    try {
      const channel = (paymentChannel || 'Arkesel Portal Wallet').trim().slice(0, 64);
      const outcome = memoryStore.submitManualSmsBundlePurchase(req.user!.id, {
        bundleId: quote.bundleId,
        bundleName: quote.bundleName,
        credits: quote.credits,
        amountGhs: quote.amountGhs,
        paymentChannel: channel,
        reference: cleanRef,
        smsMode: platformRuntime.flags.smsMode,
      });

      const senderInfo = platformRuntime.getEffectiveArkeselSenderId(outcome.profile.senderId);
      const bal = await fetchArkeselGatewayBalance();

      return res.status(outcome.pendingVerification ? 202 : 200).json({
        ok: true,
        profile: outcome.profile,
        purchase: outcome.purchase,
        bundleId: quote.bundleId,
        bundleName: quote.bundleName,
        addedCredits: outcome.addedCredits,
        amountGhs: quote.amountGhs,
        paymentChannel: channel,
        arkeselReference: cleanRef,
        pendingVerification: outcome.pendingVerification,
        portalPurchaseRequired: true,
        arkeselStatus: {
          configured: isArkeselConfigured(),
          paystackConfigured: isPaystackConfigured(),
          mode: platformRuntime.flags.smsMode,
          live: bal.ok,
          smsBalance: bal.ok && typeof bal.credits === 'number' ? bal.credits : null,
          mainBalance: bal.ok && typeof bal.mainBalance === 'number' ? bal.mainBalance : null,
          error: bal.ok ? null : (bal.error || null),
          senderId: senderInfo.senderId,
          isDefaultUnverifiedSender: senderInfo.isDefaultUnverifiedWarning,
          organizerCredits: outcome.profile.smsCredits,
          apiInfoUrl: 'https://sms.arkesel.com/user/sms-api/info',
          rechargeUrl: 'https://sms.arkesel.com',
          checkedAt: new Date().toISOString(),
        },
        message: outcome.pendingVerification
          ? `Receipt ${cleanRef} for ${quote.bundleName} (GH₵ ${quote.amountGhs.toFixed(2)}) is queued for payment verification before +${quote.credits.toLocaleString()} SMS are credited.`
          : `Sandbox Mode: +${quote.credits.toLocaleString()} SMS credits allocated for ${quote.bundleName} (Ref: ${cleanRef}).`,
      });
    } catch (err) {
      const status = (err as Error & { status?: number })?.status ?? 400;
      return res.status(status).json({ error: err instanceof Error ? err.message : 'SMS bundle purchase failed.' });
    }
  });

  router.get('/studio/subscription/payments', requireMemoryAuth, requireRole('creator', 'organizer'), (req: AuthedRequest, res) => {
    const payments = memoryStore.listSubscriptionPayments(req.user!.id);
    return res.json({
      payments,
      paystackConfigured: isPaystackConfigured(),
      mode: platformRuntime.flags.smsMode,
    });
  });

  router.post('/studio/subscription/paystack/initialize', requireMemoryAuth, requireRole('creator', 'organizer'), async (req: AuthedRequest, res) => {
    if (!isPaystackConfigured()) {
      return res.status(503).json({
        error: 'Paystack checkout is not configured on the server yet. Set PAYSTACK_SECRET_KEY or submit a verified payment receipt reference.',
      });
    }
    const { planId, planName, billingCycle, amountGhs, callbackUrl } = req.body as {
      planId?: string;
      planName?: string;
      billingCycle?: string;
      amountGhs?: number;
      callbackUrl?: string;
    };

    let quote;
    try {
      quote = resolveAuthoritativeSubscriptionQuote({
        planId,
        planName,
        billingCycle,
        expectedAmountGhs: amountGhs,
      });
    } catch (err) {
      return res.status(400).json({ error: err instanceof Error ? err.message : 'Invalid subscription plan.' });
    }

    const email = (req.memoryUser?.email || req.memoryUser?.profile.email || '').trim();
    if (!email || !email.includes('@')) {
      return res.status(400).json({
        error: 'Add a valid email address in Account Settings before starting Paystack card/MoMo checkout.',
      });
    }

    const reference = `EBY-SUB-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    const originHeader =
      (typeof req.headers.origin === 'string' && /^https?:\/\//i.test(req.headers.origin)
        ? req.headers.origin
        : (process.env.APP_URL || '').trim().replace(/\/+$/, '')) || 'http://localhost:3000';
    const safeCallback =
      typeof callbackUrl === 'string' && /^https?:\/\//i.test(callbackUrl)
        ? callbackUrl
        : `${originHeader}/?sub_ref=${encodeURIComponent(reference)}`;

    const pending = memoryStore.createPaystackPendingSubscription(req.user!.id, {
      planId: quote.planId,
      planName: quote.planName,
      billingCycle: quote.billingCycle,
      amountUsd: quote.amountUsd,
      amountGhs: quote.amountGhs,
      reference,
    });

    const initRes = await initializePaystackTransaction({
      email,
      amountGhs: quote.amountGhs,
      reference,
      callbackUrl: safeCallback,
      metadata: {
        type: 'subscription',
        userId: req.user!.id,
        paymentId: pending.id,
        planId: quote.planId,
        planName: quote.planName,
        billingCycle: quote.billingCycle,
      },
    });

    if (!initRes.ok || !initRes.authorizationUrl) {
      memoryStore.markPaystackSubscriptionFailed(reference, initRes.error);
      return res.status(400).json({ error: initRes.error || 'Paystack initialization failed.' });
    }

    return res.json({
      ok: true,
      reference: initRes.reference,
      authorizationUrl: initRes.authorizationUrl,
      accessCode: initRes.accessCode,
      payment: pending,
      quote,
    });
  });

  router.get('/studio/subscription/paystack/verify/:reference', requireMemoryAuth, requireRole('creator', 'organizer'), async (req: AuthedRequest, res) => {
    if (!isPaystackConfigured()) {
      return res.status(503).json({ error: 'PAYSTACK_SECRET_KEY is not configured on the server.' });
    }
    const reference = (req.params.reference || '').trim();
    if (!reference) {
      return res.status(400).json({ error: 'Payment reference is required.' });
    }

    const existing = memoryStore.findSubscriptionPaymentByReference(reference);
    if (!existing) {
      return res.status(404).json({ error: `Subscription payment record for "${reference}" not found.` });
    }
    if (existing.organizerId !== req.user!.id && req.memoryUser?.profile.appRole !== 'creator') {
      return res.status(403).json({ error: 'Forbidden: payment reference belongs to another organizer.' });
    }

    if (existing.status === 'active') {
      return res.json({
        ok: true,
        alreadyActivated: true,
        profile: req.memoryUser!.profile,
        payment: existing,
        message: `Subscription ${reference} is already active on ${existing.planName}.`,
      });
    }

    const verify = await verifyPaystackTransaction(reference);
    if (!verify.ok) {
      return res.status(400).json({ error: verify.error || 'Paystack verification failed.' });
    }
    if (!verify.paid) {
      if (verify.gatewayStatus === 'failed' || verify.gatewayStatus === 'abandoned') {
        memoryStore.markPaystackSubscriptionFailed(reference, `Gateway status: ${verify.gatewayStatus}`);
      }
      return res.status(402).json({
        error: `Payment ${reference} has status "${verify.gatewayStatus}" on Paystack and has not settled.`,
      });
    }
    if (verify.currency !== 'GHS') {
      return res.status(400).json({ error: `Expected GHS currency from Paystack, got ${verify.currency}.` });
    }
    const expectedPesewas = Math.round(existing.amountGhs * 100);
    if (verify.amountPesewas < expectedPesewas) {
      return res.status(400).json({
        error: `Underpayment detected: paid GH₵ ${(verify.amountPesewas / 100).toFixed(2)}, expected GH₵ ${existing.amountGhs.toFixed(2)}.`,
      });
    }
    const metaUserId = verify.metadata?.userId ? String(verify.metadata.userId) : undefined;
    if (metaUserId && metaUserId !== existing.organizerId) {
      return res.status(403).json({ error: 'Paystack transaction metadata does not match this organizer.' });
    }

    const completed = memoryStore.completePaystackSubscription(existing.organizerId, reference, verify.channel);
    return res.json({
      ok: true,
      alreadyActivated: completed.alreadyActivated,
      profile: completed.profile,
      payment: completed.payment,
      message: `Paystack verified (${reference}). ${completed.payment.planName} (${completed.payment.billingCycle}) is now active.`,
    });
  });

  router.post('/studio/subscription/purchase', requireMemoryAuth, requireRole('creator', 'organizer'), (req: AuthedRequest, res) => {
    const { planId, planName, billingCycle, amountGhs, paymentChannel, receiptReference } = req.body as {
      planId?: string;
      planName?: string;
      billingCycle?: string;
      amountGhs?: number;
      paymentChannel?: string;
      receiptReference?: string;
    };

    let quote;
    try {
      quote = resolveAuthoritativeSubscriptionQuote({
        planId,
        planName,
        billingCycle,
        expectedAmountGhs: amountGhs,
      });
    } catch (err) {
      return res.status(400).json({ error: err instanceof Error ? err.message : 'Invalid subscription plan.' });
    }

    const refCheck = validateReceiptReference(receiptReference);
    if (!refCheck.ok) {
      return res.status(400).json({ error: refCheck.error });
    }

    try {
      const channel = (paymentChannel || 'Mobile Money / Bank Transfer').trim().slice(0, 64);
      const outcome = memoryStore.submitManualSubscriptionPayment(req.user!.id, {
        planId: quote.planId,
        planName: quote.planName,
        billingCycle: quote.billingCycle,
        amountUsd: quote.amountUsd,
        amountGhs: quote.amountGhs,
        paymentChannel: channel,
        reference: refCheck.normalized,
        smsMode: platformRuntime.flags.smsMode,
      });

      return res.status(outcome.pendingVerification ? 202 : 200).json({
        ok: true,
        profile: outcome.profile,
        payment: outcome.payment,
        activated: outcome.activated,
        pendingVerification: outcome.pendingVerification,
        message: outcome.pendingVerification
          ? `Payment reference ${refCheck.normalized} for ${quote.planName} (GH₵ ${quote.amountGhs.toFixed(2)}) is queued for administrator verification before activation.`
          : `Sandbox Mode: ${quote.planName} (${quote.billingCycle}) activated immediately (Ref: ${refCheck.normalized}).`,
      });
    } catch (err) {
      const status = (err as Error & { status?: number })?.status ?? 400;
      return res.status(status).json({ error: err instanceof Error ? err.message : 'Subscription purchase failed.' });
    }
  });

  router.post('/studio/subscription/downgrade', requireMemoryAuth, requireRole('creator', 'organizer'), (req: AuthedRequest, res) => {
    try {
      const profile = memoryStore.downgradeToStarter(req.user!.id);
      return res.json({
        ok: true,
        profile,
        message: 'Workspace downgraded to Starter (Free). Existing events remain intact; Starter quotas now apply.',
      });
    } catch (err) {
      const status = (err as Error & { status?: number })?.status ?? 400;
      return res.status(status).json({ error: err instanceof Error ? err.message : 'Downgrade failed.' });
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
      const status = (err as Error & { status?: number }).status || 400;
      return res.status(status).json({ error: err instanceof Error ? err.message : 'Failed to create event.' });
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

  router.post('/studio/events/:eventId/gift-links', requireMemoryAuth, requireRole('creator', 'organizer'), (req: AuthedRequest, res) => {
    try {
      const result = memoryStore.createGiftAttendantLink(
        req.user!.id,
        req.params.eventId,
        req.body as { attendantName: string; roleLabel?: string; phone?: string }
      );
      return res.status(201).json(result);
    } catch (err) {
      const status = (err as Error & { status?: number }).status || 400;
      return res.status(status).json({
        error: err instanceof Error ? err.message : 'Failed to create attendant link.',
      });
    }
  });

  router.patch('/studio/events/:eventId/gift-links/:linkId', requireMemoryAuth, requireRole('creator', 'organizer'), (req: AuthedRequest, res) => {
    try {
      const result = memoryStore.toggleGiftAttendantLink(
        req.user!.id,
        req.params.eventId,
        req.params.linkId,
        (req.body as { active?: boolean } | undefined)?.active
      );
      return res.json(result);
    } catch (err) {
      const status = (err as Error & { status?: number }).status || 400;
      return res.status(status).json({
        error: err instanceof Error ? err.message : 'Failed to update attendant link.',
      });
    }
  });

  router.delete('/studio/events/:eventId/gift-links/:linkId', requireMemoryAuth, requireRole('creator', 'organizer'), (req: AuthedRequest, res) => {
    try {
      const event = memoryStore.deleteGiftAttendantLink(
        req.user!.id,
        req.params.eventId,
        req.params.linkId
      );
      return res.json({ ok: true, event });
    } catch (err) {
      const status = (err as Error & { status?: number }).status || 400;
      return res.status(status).json({
        error: err instanceof Error ? err.message : 'Failed to delete attendant link.',
      });
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

      const smsCost = Math.max(1, calculateSmsCredits(resolvedMsg.text));
      const availableCredits = memoryStore.getSmsCredits(req.user!.id);
      const canSendSms = Boolean(result.attendee.phone && availableCredits >= smsCost);
      let smsCreditsUsed = 0;
      let smsCreditsRemaining = availableCredits;
      let smsSkippedReason: string | undefined;

      const ownerEnt = getPlanEntitlements(req.memoryUser?.profile);
      const effectiveSenderId = ownerEnt.allowCustomSenderId
        ? result.event.senderId || req.memoryUser?.profile.senderId
        : DEFAULT_SHARED_SENDER_ID;

      const [smsDelivery, emailDelivery] = await Promise.all([
        canSendSms
          ? dispatchOptionalArkeselSms(
              result.attendee.phone,
              result.event.title,
              result.attendee.ticketCode,
              effectiveSenderId,
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

      if (result.attendee.phone && !canSendSms) {
        smsSkippedReason = `Insufficient SMS credits (${availableCredits} remaining, ${smsCost} needed). Purchase an SMS bundle to deliver pass SMS.`;
      } else if (smsDelivery === 'Arkesel Sent') {
        const debit = memoryStore.consumeSmsCredits(req.user!.id, smsCost);
        if (debit.ok) {
          smsCreditsUsed = smsCost;
          smsCreditsRemaining = debit.remaining;
          memoryStore.incrementEventSmsDispatched(req.params.eventId, 1);
        }
      }

      const hasLiveArkesel = Boolean((process.env.ARKESEL_API_KEY || '').trim()) && platformRuntime.flags.smsMode !== 'sandbox';
      const resolvedSmsStatus: Attendee['smsStatus'] =
        smsCreditsUsed > 0
          ? 'Arkesel Sent'
          : emailDelivery.ok && (!hasLiveArkesel || smsDelivery === 'Pending')
            ? 'Resend Delivered'
            : 'Pending';
      const updatedAtt = memoryStore.setAttendeeSmsStatus(result.attendee.id, resolvedSmsStatus) ?? {
        ...result.attendee,
        smsStatus: resolvedSmsStatus,
      };
      const updatedEvt = memoryStore.getAnyEventBySlugOrId(req.params.eventId) ?? result.event;

      return res.status(201).json({
        attendee: updatedAtt,
        event: updatedEvt,
        cameraUrl: resolvedMsg.cameraUrl,
        dispatchedMessage: resolvedMsg.text,
        smsCredits: smsCreditsRemaining,
        smsCreditsUsed,
        smsSkippedReason,
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
      let checkInSmsSent = false;
      let cameraUrl: string | undefined;
      let dispatchedMessage: string | undefined;
      let smsCredits = memoryStore.getSmsCredits(req.user!.id);
      let smsCreditsUsed = 0;
      let smsSkippedReason: string | undefined;

      if (attendee.checkedIn) {
        const evt = memoryStore.getAnyEventBySlugOrId(attendee.eventId);
        if (evt) {
          const orgDefaults = memoryStore.getEventOrganizerDefaults(evt.id);
          const orgId = orgDefaults.organizerId || req.user!.id;
          smsCredits = orgDefaults.organizerId ? orgDefaults.smsCredits : smsCredits;
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

          const smsCost = Math.max(1, calculateSmsCredits(resolved.text));
          const canSendSms = Boolean(attendee.phone && smsCredits >= smsCost);
          const [smsRes, emailRes] = await Promise.all([
            canSendSms
              ? dispatchOptionalArkeselSms(
                  attendee.phone,
                  evt.title,
                  attendee.ticketCode,
                  orgDefaults.allowCustomSenderId
                    ? evt.senderId || orgDefaults.senderId || req.memoryUser?.profile.senderId
                    : DEFAULT_SHARED_SENDER_ID,
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
                  replyTo: orgDefaults.replyToEmail || req.memoryUser?.profile.replyToEmail,
                })
              : Promise.resolve({ ok: false, skipped: true }),
          ]);

          if (attendee.phone && !canSendSms) {
            smsSkippedReason = `No SMS credits remaining (${smsCredits} left, ${smsCost} needed). Purchase an SMS bundle for check-in SMS.`;
          } else if (smsRes === 'Arkesel Sent') {
            const debit = memoryStore.consumeSmsCredits(orgId, smsCost);
            if (debit.ok) {
              smsCreditsUsed = smsCost;
              smsCredits = debit.remaining;
              checkInSmsSent = true;
              memoryStore.incrementEventSmsDispatched(evt.id, 1);
            }
          }
          checkInMessageSent = checkInSmsSent || Boolean(emailRes.ok);
        }
      }

      return res.json({
        attendee,
        checkInMessageSent,
        checkInSmsSent,
        cameraUrl,
        dispatchedMessage,
        smsCredits,
        smsCreditsUsed,
        smsSkippedReason,
      });
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

  router.post('/studio/broadcast', requireMemoryAuth, requireRole('creator', 'organizer'), async (req: AuthedRequest, res) => {
    const { attendeeIds, message, channel } = req.body as {
      eventId?: string;
      attendeeIds?: string[];
      message?: string;
      channel?: 'email' | 'sms' | 'dual';
    };
    const cleanMessage = (message || '').trim();
    if (!cleanMessage) {
      return res.status(400).json({ error: 'Broadcast message text is required.' });
    }
    if (!Array.isArray(attendeeIds) || attendeeIds.length === 0) {
      return res.status(400).json({ error: 'Select at least one recipient for the broadcast.' });
    }
    try {
      const ownerEnt = getPlanEntitlements(req.memoryUser?.profile);
      const requestedChannel = channel === 'email' || channel === 'sms' || channel === 'dual' ? channel : undefined;
      if (!ownerEnt.allowSmsBroadcast && requestedChannel !== 'email') {
        return res.status(403).json({
          error:
            'Bulk SMS & Dual SMS/Email broadcasts require Pro Organizer or Enterprise plan. Starter accounts can send Resend Email broadcasts only.',
        });
      }
      const sendSms = ownerEnt.allowSmsBroadcast && requestedChannel !== 'email';
      const sendEmail = requestedChannel !== 'sms';

      const { attendees: ownedAttendees, eventById } = memoryStore.broadcastOwnedAttendees(
        req.user!.id,
        attendeeIds
      );
      if (ownedAttendees.length === 0) {
        return res.status(404).json({ error: 'No matching attendees found in your studio.' });
      }
      const requestOrigin = (process.env.APP_URL || '').trim().replace(/\/+$/, '') || `${req.protocol}://${req.get('host')}`;
      const prepared = ownedAttendees.map((att) => {
        const evtMapped = eventById.get(att.eventId)!;
        const personalizedRaw = cleanMessage
          .replace(/\{name\}/gi, att.name)
          .replace(/\{event\}/gi, evtMapped.title)
          .replace(/\{ticket_code\}|\{code\}/gi, att.ticketCode);
        const personalizedText = appendPoweredByLine(personalizedRaw);
        const smsCost = sendSms && att.phone ? calculateSmsCredits(personalizedText) : 0;
        const cameraUrl = `${requestOrigin}/e/${encodeURIComponent(evtMapped.slug || evtMapped.id)}/camera?pass=${encodeURIComponent(att.ticketCode)}&guest=${encodeURIComponent(att.name)}`;
        return { att, evtMapped, personalizedText, smsCost, cameraUrl };
      });
      const requiredSmsCredits = prepared.reduce((acc, item) => acc + item.smsCost, 0);
      const currentCredits = memoryStore.getSmsCredits(req.user!.id);
      if (requiredSmsCredits > 0 && currentCredits < requiredSmsCredits) {
        return res.status(402).json({
          error: `Insufficient SMS bundle credits: you have ${currentCredits.toLocaleString()} SMS remaining, but this broadcast requires ${requiredSmsCredits.toLocaleString()} SMS.`,
        });
      }

      const countsByEvent = new Map<string, number>();
      let sentCount = 0;
      let totalCreditsUsed = 0;

      await Promise.all(
        prepared.map(async ({ att, evtMapped, personalizedText, smsCost, cameraUrl }) => {
          const effectiveSenderId = ownerEnt.allowCustomSenderId
            ? evtMapped.senderId || req.memoryUser?.profile.senderId
            : DEFAULT_SHARED_SENDER_ID;
          const [smsRes, emailRes] = await Promise.all([
            sendSms && att.phone && smsCost > 0
              ? dispatchOptionalArkeselSms(
                  normalizePhoneE164(att.phone),
                  evtMapped.title,
                  att.ticketCode,
                  effectiveSenderId,
                  personalizedText
                )
              : Promise.resolve('Pending' as const),
            sendEmail && isResendConfigured() && att.email?.includes('@')
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
                  replyTo: req.memoryUser?.profile.replyToEmail,
                })
              : Promise.resolve({ ok: false, skipped: true }),
          ]);
          if (smsRes === 'Arkesel Sent') {
            totalCreditsUsed += smsCost;
            countsByEvent.set(att.eventId, (countsByEvent.get(att.eventId) ?? 0) + 1);
          }
          if (smsRes !== 'Pending' || emailRes.ok) {
            sentCount += 1;
          }
        })
      );

      if (totalCreditsUsed > 0) {
        memoryStore.consumeSmsCredits(req.user!.id, totalCreditsUsed);
      }
      const updatedEvents: EventItem[] = [];
      for (const [evtId, count] of countsByEvent.entries()) {
        const updated = memoryStore.incrementEventSmsDispatched(evtId, count);
        if (updated) updatedEvents.push(updated);
      }
      const remainingCredits = memoryStore.getSmsCredits(req.user!.id);

      return res.json({
        ok: true,
        recipientCount: ownedAttendees.length,
        sentCount,
        creditsUsed: totalCreditsUsed,
        smsCredits: remainingCredits,
        events: updatedEvents,
      });
    } catch (err) {
      return res.status(500).json({ error: err instanceof Error ? err.message : 'Broadcast dispatch failed.' });
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
