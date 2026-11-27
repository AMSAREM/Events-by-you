import 'dotenv/config';
import crypto from 'node:crypto';
import http from 'node:http';
import express, { type NextFunction, type Request, type Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import {
  createImplicitSupabaseClient,
  createPublicSupabaseClient,
  createServiceSupabaseClient,
  createUserSupabaseClient,
  ensureProfileRow,
  extractEventAttendeeMetaMap,
  extractEventScheduleDatesMap,
  extractEventShotShootersMap,
  findSupabaseUserByEmail,
  findSupabaseUserByPhone,
  isSupabaseConfigured,
  mapAlertRow,
  mapAttendeeRow,
  mapCreatorAppLogRow,
  mapCreatorAppRow,
  mapEventRow,
  mapPlanningRow,
  mapProfileRow,
  mapRollSettingsRow,
  mapScheduleRow,
  mapShotRow,
  resolveProfilePlanAttendeeCapacity,
  resolveSupabaseUserContacts,
  syncAuthAppMetadataPlanCapacity,
} from './server/supabase.ts';
import {
  buildGoogleAuthorizeUrl,
  getGoogleOAuthCallbackUrl,
  handleGoogleOAuthCallback,
  isGoogleOAuthConfigured,
} from './server/googleAuth.ts';
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
  EventPlanningConfig,
  EventPoll,
  EventPollStatus,
  GiftTableAttendantLink,
  GiftTableEntry,
  OrganizerProfile,
  ScheduleBlock,
  SmsBundlePurchase,
  SubscriptionPayment,
} from './src/types/events.ts';
import {
  dispatchOptionalArkeselSms,
  formatSupabaseAuthError,
  getBearerToken,
  getCreatorCredentials,
  isPrimaryCreatorIdentity,
  isValidJwtFormat,
  requireCreatorVerification,
  requireRole,
  requireVerifiedPhoneIfSet,
  safeTimingEqual,
  signCreatorSessionToken,
  type AuthedRequest,
} from './server/helpers.ts';
import { buildEventOgSvg, injectEventMetaTags, injectNotFoundSsrHtml, type PublicEventSubPath } from './server/ogImage.ts';
import { CANONICAL_ORIGIN, isPublicIndexableEvent, STATIC_MARKETING_PATHS } from './src/lib/seoConfig.ts';
import {
  isResendConfigured,
  sendAuthOtpEmail,
  sendCheckInWelcomeEmail,
  sendEventPassEmail,
  type EmailScheduleItem,
} from './server/resend.ts';
import {
  appendPoweredByLine,
  calculateSmsCredits,
  MAX_SHOTS_PER_USER,
  resolveEventMessage,
} from './src/lib/eventMessages.ts';
import {
  compareScheduleBlocksChronological,
  formatEventDateSpan,
  getEventCheckInPolicy,
  getScheduleBlockDayFromIso,
  getTodayIsoDate,
  getWeekdayForIsoDate,
  normalizeScheduleDay,
  resolveScheduleBlockDate,
  sanitizeCheckedInDates,
  sanitizeCheckInPolicy,
  sanitizeIsoDate,
} from './src/lib/eventDates.ts';
import {
  buildValidatedPollOptions,
  normalizePollStatus,
  sanitizePollForPublic,
  sanitizePublicExtraDataConfig,
} from './src/lib/polls.ts';
import {
  createStarterPlanningConfig,
  sanitizeEventPlanningConfig,
} from './src/lib/planningTemplates.ts';
import {
  resolveAuthoritativeSmsBundle,
  validateReceiptReference,
} from './src/lib/smsBundles.ts';
import {
  DEFAULT_SHARED_SENDER_ID,
  computePlanExpiresAtIso,
  getEffectiveEventCapacity,
  getPlanEntitlements,
  isActiveEventStatus,
  resolveAuthoritativeSubscriptionQuote,
  resolvePlanAttendeeCapacityValue,
} from './src/lib/subscriptionPlans.ts';
import {
  initializePaystackTransaction,
  isPaystackConfigured,
  verifyPaystackTransaction,
} from './server/paystack.ts';
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
  const msg = (err.message || '').toLowerCase();
  return (
    err.code === '42P01' ||
    err.code === 'PGRST205' ||
    err.code === 'PGRST202' ||
    msg.includes('creator_app') ||
    msg.includes('sms_bundle_purchases') ||
    msg.includes('credit_organizer_sms_bundle') ||
    msg.includes('subscription_payments') ||
    msg.includes('activate_organizer_subscription') ||
    msg.includes('does not exist') ||
    msg.includes('schema cache')
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
): Omit<
  T,
  | 'qr_pass_published'
  | 'design_theme'
  | 'validation_config'
  | 'extra_data_config'
  | 'message_config'
  | 'planning_config'
> {
  const {
    qr_pass_published: _q,
    design_theme: _d,
    validation_config: _v,
    extra_data_config: _e,
    message_config: _m,
    planning_config: _p,
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
    if ((extraDataConfig as EventItem['extraDataConfig'])?.polls === undefined && existingObj.polls !== undefined) {
      base.polls = existingObj.polls;
    }
    if ((extraDataConfig as EventItem['extraDataConfig'])?.planningConfig === undefined && existingObj.planningConfig !== undefined) {
      base.planningConfig = existingObj.planningConfig;
    }
    if ((extraDataConfig as EventItem['extraDataConfig'])?.endIsoDate === undefined && existingObj.endIsoDate !== undefined) {
      base.endIsoDate = existingObj.endIsoDate;
    }
    if ((extraDataConfig as EventItem['extraDataConfig'])?.checkInPolicy === undefined && existingObj.checkInPolicy !== undefined) {
      base.checkInPolicy = existingObj.checkInPolicy;
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
      checkedInDates?: string[];
    }
  >
): Attendee {
  const meta = metaMap?.[attendee.id];
  const normalizedDates = sanitizeCheckedInDates(attendee.checkedInDates ?? meta?.checkedInDates);
  if (!meta && normalizedDates === undefined) return attendee;
  return {
    ...attendee,
    validationGroup: attendee.validationGroup ?? meta?.validationGroup,
    inviteCodeUsed: attendee.inviteCodeUsed ?? meta?.inviteCodeUsed,
    giftEntry: attendee.giftEntry ?? meta?.giftEntry,
    customResponses: attendee.customResponses ?? meta?.customResponses,
    ...(normalizedDates !== undefined ? { checkedInDates: normalizedDates } : {}),
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

async function consumeSupabaseSmsCredits(
  client: SupabaseClient,
  organizerId: string,
  cost: number
): Promise<{ ok: boolean; remaining: number }> {
  const admin = createServiceSupabaseClient() ?? client;
  const needed = Math.max(0, Math.round(cost));
  const { data: prof } = await admin
    .from('profiles')
    .select('sms_credits')
    .eq('id', organizerId)
    .maybeSingle();
  const current = Number((prof as Record<string, unknown> | null)?.sms_credits ?? 0);
  if (needed === 0) {
    return { ok: true, remaining: current };
  }
  if (current < needed) {
    return { ok: false, remaining: current };
  }
  const next = current - needed;
  const { data: updated, error } = await admin
    .from('profiles')
    .update({ sms_credits: next, updated_at: new Date().toISOString() })
    .eq('id', organizerId)
    .gte('sms_credits', needed)
    .select('sms_credits')
    .maybeSingle();
  if (error || !updated) {
    const { data: refreshed } = await admin
      .from('profiles')
      .select('sms_credits')
      .eq('id', organizerId)
      .maybeSingle();
    return {
      ok: false,
      remaining: Number((refreshed as Record<string, unknown> | null)?.sms_credits ?? current),
    };
  }
  return { ok: true, remaining: Number((updated as Record<string, unknown>).sms_credits ?? next) };
}

async function refundSupabaseSmsCredits(
  client: SupabaseClient,
  organizerId: string,
  amount: number
): Promise<number> {
  const admin = createServiceSupabaseClient() ?? client;
  const delta = Math.max(0, Math.round(amount));
  const { data: prof } = await admin
    .from('profiles')
    .select('sms_credits')
    .eq('id', organizerId)
    .maybeSingle();
  const current = Number((prof as Record<string, unknown> | null)?.sms_credits ?? 0);
  if (delta === 0) return current;
  const next = current + delta;
  await admin
    .from('profiles')
    .update({ sms_credits: next, updated_at: new Date().toISOString() })
    .eq('id', organizerId);
  return next;
}

function mapSmsPurchaseRow(row: Record<string, unknown>): SmsBundlePurchase {
  return {
    id: String(row.id),
    organizerId: String(row.organizer_id),
    organizerName: row.organizer_name ? String(row.organizer_name) : undefined,
    organizerEmail: row.organizer_email ? String(row.organizer_email) : undefined,
    bundleId: String(row.bundle_id || 'custom'),
    bundleName: String(row.bundle_name || 'SMS Bundle'),
    credits: Number(row.credits ?? 0),
    amountGhs: Number(row.amount_ghs ?? 0),
    paymentChannel: String(row.payment_channel || 'Arkesel Portal Wallet'),
    provider:
      row.provider === 'paystack' || row.provider === 'sandbox'
        ? row.provider
        : 'arkesel_manual',
    reference: String(row.reference || ''),
    status:
      row.status === 'pending_payment' ||
      row.status === 'pending_verification' ||
      row.status === 'credited' ||
      row.status === 'rejected' ||
      row.status === 'failed'
        ? row.status
        : 'pending_verification',
    createdAt: String(row.created_at || new Date().toISOString()),
    verifiedAt: row.verified_at ? String(row.verified_at) : undefined,
    rejectionReason: row.rejection_reason ? String(row.rejection_reason) : undefined,
  };
}

async function atomicCreditSupabasePurchase(
  adminClient: SupabaseClient,
  purchaseId: string,
  paymentChannel?: string
): Promise<{ alreadyCredited: boolean; purchase: SmsBundlePurchase; smsCredits: number }> {
  // Check runtime fallback ledger first if DB table isn't provisioned yet
  const fallbackItem = platformRuntime.fallbackSmsPurchases.get(purchaseId);
  if (fallbackItem) {
    if (fallbackItem.status === 'credited') {
      const { data: prof } = await adminClient
        .from('profiles')
        .select('sms_credits')
        .eq('id', fallbackItem.organizerId)
        .single();
      return {
        alreadyCredited: true,
        purchase: fallbackItem,
        smsCredits: Number((prof as Record<string, unknown> | null)?.sms_credits ?? 0),
      };
    }
    const nextCredits = await refundSupabaseSmsCredits(
      adminClient,
      fallbackItem.organizerId,
      fallbackItem.credits
    );
    const updated: SmsBundlePurchase = {
      ...fallbackItem,
      paymentChannel: paymentChannel || fallbackItem.paymentChannel,
      status: 'credited',
      verifiedAt: new Date().toISOString(),
    };
    platformRuntime.fallbackSmsPurchases.set(updated.id, updated);
    return { alreadyCredited: false, purchase: updated, smsCredits: nextCredits };
  }

  const rpcRes = await adminClient.rpc('credit_organizer_sms_bundle', {
    p_purchase_id: purchaseId,
    p_payment_channel: paymentChannel || null,
  });

  if (!rpcRes.error && rpcRes.data && typeof rpcRes.data === 'object') {
    const payload = rpcRes.data as {
      alreadyCredited?: boolean;
      purchase?: Record<string, unknown>;
      smsCredits?: number;
    };
    if (payload.purchase) {
      return {
        alreadyCredited: Boolean(payload.alreadyCredited),
        purchase: mapSmsPurchaseRow(payload.purchase),
        smsCredits: Number(payload.smsCredits ?? 0),
      };
    }
  }

  // Fallback when table exists without RPC or conditional update
  const { data: row, error: fetchErr } = await adminClient
    .from('sms_bundle_purchases')
    .select('*')
    .eq('id', purchaseId)
    .single();
  if (fetchErr || !row) {
    throw new Error(fetchErr?.message || 'SMS purchase record not found.');
  }
  const purchase = mapSmsPurchaseRow(row as Record<string, unknown>);
  if (purchase.status === 'credited') {
    const { data: prof } = await adminClient
      .from('profiles')
      .select('sms_credits')
      .eq('id', purchase.organizerId)
      .single();
    return {
      alreadyCredited: true,
      purchase,
      smsCredits: Number((prof as Record<string, unknown> | null)?.sms_credits ?? 0),
    };
  }
  const nowIso = new Date().toISOString();
  const { data: claimed, error: claimErr } = await adminClient
    .from('sms_bundle_purchases')
    .update({
      status: 'credited',
      payment_channel: paymentChannel || purchase.paymentChannel,
      verified_at: nowIso,
    })
    .eq('id', purchaseId)
    .neq('status', 'credited')
    .select('*')
    .maybeSingle();

  if (claimErr) throw new Error(claimErr.message);
  if (!claimed) {
    const { data: prof } = await adminClient
      .from('profiles')
      .select('sms_credits')
      .eq('id', purchase.organizerId)
      .single();
    return {
      alreadyCredited: true,
      purchase: { ...purchase, status: 'credited' },
      smsCredits: Number((prof as Record<string, unknown> | null)?.sms_credits ?? 0),
    };
  }

  const nextCredits = await refundSupabaseSmsCredits(
    adminClient,
    purchase.organizerId,
    purchase.credits
  );
  return {
    alreadyCredited: false,
    purchase: mapSmsPurchaseRow(claimed as Record<string, unknown>),
    smsCredits: nextCredits,
  };
}

function mapSubscriptionPaymentRow(row: Record<string, unknown>): SubscriptionPayment {
  return {
    id: String(row.id),
    organizerId: String(row.organizer_id),
    organizerName: row.organizer_name ? String(row.organizer_name) : undefined,
    organizerEmail: row.organizer_email ? String(row.organizer_email) : undefined,
    planId: row.plan_id === 'enterprise' ? 'enterprise' : 'pro',
    planName: row.plan_name === 'Enterprise' ? 'Enterprise' : 'Pro Organizer',
    billingCycle: row.billing_cycle === 'annual' ? 'annual' : 'monthly',
    amountUsd: Number(row.amount_usd ?? 0),
    amountGhs: Number(row.amount_ghs ?? 0),
    paymentChannel: String(row.payment_channel || 'Mobile Money / Bank Transfer'),
    provider:
      row.provider === 'paystack' || row.provider === 'sandbox' ? row.provider : 'manual',
    reference: String(row.reference || ''),
    status:
      row.status === 'pending_payment' ||
      row.status === 'pending_verification' ||
      row.status === 'active' ||
      row.status === 'rejected' ||
      row.status === 'failed'
        ? row.status
        : 'pending_verification',
    periodStart: row.period_start ? String(row.period_start) : undefined,
    periodEnd: row.period_end ? String(row.period_end) : undefined,
    createdAt: String(row.created_at || new Date().toISOString()),
    verifiedAt: row.verified_at ? String(row.verified_at) : undefined,
    rejectionReason: row.rejection_reason ? String(row.rejection_reason) : undefined,
  };
}

async function atomicActivateSupabaseSubscription(
  adminClient: SupabaseClient,
  paymentId: string,
  paymentChannel?: string
): Promise<{ alreadyActivated: boolean; payment: SubscriptionPayment }> {
  const fallbackItem = platformRuntime.fallbackSubscriptionPayments.get(paymentId);
  if (fallbackItem) {
    if (fallbackItem.status === 'active') {
      return { alreadyActivated: true, payment: fallbackItem };
    }
    const now = new Date();
    const nowIso = now.toISOString();
    const expiresIso = computePlanExpiresAtIso(fallbackItem.billingCycle, now);
    let { error: updErr } = await adminClient
      .from('profiles')
      .update({
        plan: fallbackItem.planName,
        plan_billing_cycle: fallbackItem.billingCycle,
        plan_expires_at: expiresIso,
        plan_attendee_capacity: null,
        updated_at: nowIso,
      })
      .eq('id', fallbackItem.organizerId);
    if (
      updErr &&
      (updErr.message?.includes('plan_billing_cycle') ||
        updErr.message?.includes('plan_attendee_capacity') ||
        updErr.message?.includes('schema cache'))
    ) {
      const retry = await adminClient
        .from('profiles')
        .update({ plan: fallbackItem.planName, updated_at: nowIso })
        .eq('id', fallbackItem.organizerId);
      updErr = retry.error;
    }
    if (updErr) throw new Error(updErr.message);
    platformRuntime.planAttendeeCapacityOverrides.set(fallbackItem.organizerId, null);
    await syncAuthAppMetadataPlanCapacity(adminClient, fallbackItem.organizerId, null);

    const activated: SubscriptionPayment = {
      ...fallbackItem,
      paymentChannel: paymentChannel || fallbackItem.paymentChannel,
      status: 'active',
      rejectionReason: undefined,
      periodStart: nowIso,
      periodEnd: expiresIso,
      verifiedAt: nowIso,
    };
    platformRuntime.fallbackSubscriptionPayments.set(activated.id, activated);
    return { alreadyActivated: false, payment: activated };
  }

  const rpcRes = await adminClient.rpc('activate_organizer_subscription', {
    p_payment_id: paymentId,
    p_payment_channel: paymentChannel || null,
  });

  if (!rpcRes.error && rpcRes.data && typeof rpcRes.data === 'object') {
    const payload = rpcRes.data as {
      alreadyActivated?: boolean;
      payment?: Record<string, unknown>;
    };
    if (payload.payment) {
      const mappedPay = mapSubscriptionPaymentRow(payload.payment);
      platformRuntime.planAttendeeCapacityOverrides.set(mappedPay.organizerId, null);
      await adminClient
        .from('profiles')
        .update({ plan_attendee_capacity: null })
        .eq('id', mappedPay.organizerId)
        .then(() => undefined, () => undefined);
      await syncAuthAppMetadataPlanCapacity(adminClient, mappedPay.organizerId, null);
      return {
        alreadyActivated: Boolean(payload.alreadyActivated),
        payment: mappedPay,
      };
    }
  }

  const { data: row, error: fetchErr } = await adminClient
    .from('subscription_payments')
    .select('*')
    .eq('id', paymentId)
    .single();
  if (fetchErr || !row) {
    throw new Error(fetchErr?.message || 'Subscription payment record not found.');
  }
  const existing = mapSubscriptionPaymentRow(row as Record<string, unknown>);
  if (existing.status === 'active') {
    return { alreadyActivated: true, payment: existing };
  }

  const now = new Date();
  const nowIso = now.toISOString();
  const expiresIso = computePlanExpiresAtIso(existing.billingCycle, now);
  const { data: claimed, error: claimErr } = await adminClient
    .from('subscription_payments')
    .update({
      status: 'active',
      payment_channel: paymentChannel || existing.paymentChannel,
      period_start: nowIso,
      period_end: expiresIso,
      verified_at: nowIso,
    })
    .eq('id', paymentId)
    .neq('status', 'active')
    .select('*')
    .maybeSingle();

  if (claimErr) throw new Error(claimErr.message);
  if (!claimed) {
    return { alreadyActivated: true, payment: { ...existing, status: 'active' } };
  }

  let { error: profUpdErr } = await adminClient
    .from('profiles')
    .update({
      plan: existing.planName,
      plan_billing_cycle: existing.billingCycle,
      plan_expires_at: expiresIso,
      plan_attendee_capacity: null,
      updated_at: nowIso,
    })
    .eq('id', existing.organizerId);
  if (
    profUpdErr &&
    (profUpdErr.message?.includes('plan_billing_cycle') ||
      profUpdErr.message?.includes('plan_attendee_capacity') ||
      profUpdErr.message?.includes('schema cache'))
  ) {
    const retry = await adminClient
      .from('profiles')
      .update({ plan: existing.planName, updated_at: nowIso })
      .eq('id', existing.organizerId);
    profUpdErr = retry.error;
  }
  if (profUpdErr) throw new Error(profUpdErr.message);
  platformRuntime.planAttendeeCapacityOverrides.set(existing.organizerId, null);
  await syncAuthAppMetadataPlanCapacity(adminClient, existing.organizerId, null);

  return {
    alreadyActivated: false,
    payment: mapSubscriptionPaymentRow(claimed as Record<string, unknown>),
  };
}

async function resolveOwnerEntitlementProfile(
  client: SupabaseClient,
  organizerId: string,
  userHint?: User
): Promise<Pick<OrganizerProfile, 'plan' | 'planExpiresAt' | 'planAttendeeCapacity'>> {
  const { data: prof } = await client
    .from('profiles')
    .select('*')
    .eq('id', organizerId)
    .maybeSingle();
  const rec = (prof ?? {}) as Record<string, unknown>;
  let fallbackCap = platformRuntime.planAttendeeCapacityOverrides.get(organizerId);
  if (fallbackCap === undefined && userHint?.app_metadata?.plan_attendee_capacity !== undefined) {
    fallbackCap = resolvePlanAttendeeCapacityValue(userHint.app_metadata.plan_attendee_capacity);
  }
  if (fallbackCap === undefined) {
    const svc = createServiceSupabaseClient();
    if (svc) {
      try {
        const { data: uRes } = await svc.auth.admin.getUserById(organizerId);
        const metaCap = resolvePlanAttendeeCapacityValue(
          uRes?.user?.app_metadata?.plan_attendee_capacity
        );
        if (metaCap !== undefined) fallbackCap = metaCap;
      } catch {
        // Non-fatal fallback
      }
    }
  }
  const planAttendeeCapacity = resolveProfilePlanAttendeeCapacity(rec, fallbackCap);
  return {
    plan: (rec.plan as OrganizerProfile['plan']) || 'Starter',
    planExpiresAt: rec.plan_expires_at != null ? String(rec.plan_expires_at) : undefined,
    ...(planAttendeeCapacity !== undefined ? { planAttendeeCapacity } : {}),
  };
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
    checkedInDates?: string[];
  }
) {
  const hasCheckedInDatesUpdate = 'checkedInDates' in meta;
  const hasAny =
    Boolean(meta.validationGroup) ||
    Boolean(meta.inviteCodeUsed) ||
    Boolean(meta.giftEntry) ||
    Boolean(meta.customResponses && Object.keys(meta.customResponses).length > 0) ||
    hasCheckedInDatesUpdate;
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
    const prevEntry = currentMap[attendeeId] ?? {};
    const nextEntry: Record<string, unknown> = {
      ...prevEntry,
      ...(meta.validationGroup ? { validationGroup: meta.validationGroup } : {}),
      ...(meta.inviteCodeUsed ? { inviteCodeUsed: meta.inviteCodeUsed } : {}),
      ...(meta.giftEntry ? { giftEntry: meta.giftEntry } : {}),
      ...(meta.customResponses && Object.keys(meta.customResponses).length > 0
        ? { customResponses: meta.customResponses }
        : {}),
    };
    if (hasCheckedInDatesUpdate) {
      const cleanDates = sanitizeCheckedInDates(meta.checkedInDates) ?? [];
      if (cleanDates.length > 0) {
        nextEntry.checkedInDates = cleanDates;
      } else {
        delete nextEntry.checkedInDates;
      }
    }
    currentExtra.__attendeeMeta = {
      ...currentMap,
      [attendeeId]: nextEntry,
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

async function removeEventShotShooter(
  client: SupabaseClient,
  eventId: string,
  shotId: string
) {
  try {
    const { data: rawRow } = await client
      .from('events')
      .select('extra_data_config')
      .eq('id', eventId)
      .maybeSingle();
    const rawExtra = (rawRow as Record<string, unknown> | null)?.extra_data_config;
    if (!rawExtra || typeof rawExtra !== 'object') return;
    const currentExtra = { ...(rawExtra as Record<string, unknown>) };
    const currentMap = extractEventShotShootersMap(currentExtra);
    if (!(shotId in currentMap)) return;
    delete currentMap[shotId];
    currentExtra.__shotShooters = currentMap;
    await client.from('events').update({ extra_data_config: currentExtra }).eq('id', eventId);
  } catch {
    // Non-fatal fallback
  }
}

function isScheduleDayCheckError(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false;
  const msg = (err.message || '').toLowerCase();
  return err.code === '23514' || msg.includes('schedule_blocks_day_check') || msg.includes('check constraint');
}

function toLegacyScheduleDay(
  day: ScheduleBlock['day'],
  isoDate?: string
): 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri' | 'Sat' {
  const candidate = isoDate ? getWeekdayForIsoDate(isoDate) ?? day : day;
  if (
    candidate === 'Mon' ||
    candidate === 'Tue' ||
    candidate === 'Wed' ||
    candidate === 'Thu' ||
    candidate === 'Fri' ||
    candidate === 'Sat'
  ) {
    return candidate;
  }
  return 'Sat';
}

async function mergeEventScheduleDatesMeta(
  client: SupabaseClient,
  eventId: string,
  updates: Record<string, { date?: string; day?: string } | null>
) {
  if (Object.keys(updates).length === 0) return;
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
    const currentMap = extractEventScheduleDatesMap(currentExtra);
    for (const [blockId, val] of Object.entries(updates)) {
      if (val === null) {
        delete currentMap[blockId];
      } else {
        currentMap[blockId] = { ...(currentMap[blockId] ?? {}), ...val };
      }
    }
    currentExtra.__scheduleDates = currentMap;
    await client.from('events').update({ extra_data_config: currentExtra }).eq('id', eventId);
  } catch {
    // Non-fatal fallback
  }
}

async function fetchSortedEventScheduleItems(
  client: SupabaseClient,
  evt: Pick<EventItem, 'id' | 'isoDate' | 'endIsoDate'>,
  rawExtraConfig?: unknown
): Promise<EmailScheduleItem[]> {
  try {
    const { data, error } = await client
      .from('schedule_blocks')
      .select('*')
      .eq('event_id', evt.id)
      .order('created_at', { ascending: true });
    if (error || !data) return [];
    const fallbackMap = extractEventScheduleDatesMap(rawExtraConfig);
    const blocks = data
      .map((r) => {
        const rec = r as Record<string, unknown>;
        return mapScheduleRow(rec, fallbackMap[String(rec.id)]);
      })
      .map((blk) => {
        const resolvedDate = resolveScheduleBlockDate(blk, evt);
        return resolvedDate && !blk.date ? { ...blk, date: resolvedDate } : blk;
      })
      .sort((a, b) => compareScheduleBlocksChronological(a, b, evt));
    return blocks.map((b) => ({
      time: b.time,
      title: b.title,
      stage: b.stage,
      lead: b.lead,
      date: b.date,
      day: b.day,
    }));
  } catch {
    return [];
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

  if (!isValidJwtFormat(token)) {
    return res.status(401).json({
      error: 'Your session token is invalid or from an offline workspace. Please sign in again.',
      code: 'INVALID_SESSION_TOKEN',
    });
  }

  try {
    const publicClient = createPublicSupabaseClient();
    const { data, error } = await publicClient.auth.getUser(token);
    if (error || !data.user) {
      const formatted = formatSupabaseAuthError(error?.message);
      return res.status(401).json({
        error: formatted.error,
        ...(formatted.isMalformedJwt ? { code: 'INVALID_SESSION_TOKEN' } : {}),
      });
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
    const rawPhone =
      (typeof prof?.phone === 'string' && prof.phone.trim()) ||
      (typeof data.user.phone === 'string' && data.user.phone.trim()) ||
      (typeof data.user.user_metadata?.phone === 'string' && data.user.user_metadata.phone.trim()) ||
      '';
    req.appRole = isPrimaryCreatorIdentity(data.user.email, rawPhone)
      ? 'creator'
      : dbRole === 'gate_staff'
        ? 'gate_staff'
        : 'organizer';
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
    const rawMsg = err instanceof Error ? err.message : 'Unable to verify session';
    const formatted = formatSupabaseAuthError(rawMsg);
    return res.status(401).json({
      error: formatted.error,
      ...(formatted.isMalformedJwt ? { code: 'INVALID_SESSION_TOKEN' } : {}),
    });
  }
}

async function syncEventPlanningRow(
  client: SupabaseClient,
  eventId: string,
  organizerId: string,
  planning: EventPlanningConfig
): Promise<void> {
  const nowIso = planning.updatedAt || new Date().toISOString();
  const payload = {
    event_id: eventId,
    organizer_id: organizerId,
    applied_template_category: planning.appliedTemplateCategory || 'Events',
    currency: planning.currency === 'USD' ? 'USD' : 'GHS',
    target_budget: Number(planning.targetBudget) || 0,
    tasks: planning.tasks ?? [],
    budget_items: planning.budgetItems ?? [],
    vendors: planning.vendors ?? [],
    team_roles: planning.teamRoles ?? [],
    event_dates: planning.eventDates ?? [],
    day_schedule_notes: planning.dayScheduleNotes ?? {},
    updated_at: nowIso,
  };
  let { error } = await client
    .from('event_planning_configs')
    .upsert(payload, { onConflict: 'event_id' });
  if (error && isMissingColumnError(error)) {
    const { event_dates: _ed, day_schedule_notes: _dn, ...legacyPayload } = payload;
    const retry = await client
      .from('event_planning_configs')
      .upsert(legacyPayload, { onConflict: 'event_id' });
    error = retry.error;
  }
  if (error && !isMissingTableError(error)) {
    throw new Error(error.message);
  }
}

async function loadOrganizerWorkspace(client: SupabaseClient, user: User) {
  const profile = await ensureProfileRow(client, user);
  const runtimeCap = platformRuntime.planAttendeeCapacityOverrides.get(user.id);
  if (profile.planAttendeeCapacity === undefined && runtimeCap !== undefined && runtimeCap !== null) {
    profile.planAttendeeCapacity = runtimeCap;
  }

  const { data: eventRows, error: eventsErr } = await client
    .from('events')
    .select('*')
    .eq('organizer_id', user.id)
    .order('created_at', { ascending: false });

  if (eventsErr) throw new Error(eventsErr.message);

  const attendeeMetaByEvent = new Map<string, ReturnType<typeof extractEventAttendeeMetaMap>>();
  const shotShootersByEvent = new Map<string, Record<string, string>>();
  const scheduleDatesByEvent = new Map<string, Record<string, { date?: string; day?: string }>>();
  const eventCategoryById = new Map<string, string>();
  const eventDateContextById = new Map<string, Pick<EventItem, 'isoDate' | 'endIsoDate'>>();
  for (const row of eventRows ?? []) {
    const rec = row as Record<string, unknown>;
    const evtId = String(rec.id);
    attendeeMetaByEvent.set(evtId, extractEventAttendeeMetaMap(rec.extra_data_config));
    shotShootersByEvent.set(evtId, extractEventShotShootersMap(rec.extra_data_config));
    scheduleDatesByEvent.set(evtId, extractEventScheduleDatesMap(rec.extra_data_config));
    eventCategoryById.set(evtId, String(rec.category ?? 'Events'));
    const extraObj =
      rec.extra_data_config && typeof rec.extra_data_config === 'object'
        ? (rec.extra_data_config as Record<string, unknown>)
        : undefined;
    const startIso = sanitizeIsoDate(String(rec.iso_date ?? '')) ?? getTodayIsoDate();
    const rawEnd = sanitizeIsoDate(
      (rec.end_iso_date as string | undefined) ??
        (typeof extraObj?.endIsoDate === 'string' ? extraObj.endIsoDate : undefined)
    );
    eventDateContextById.set(evtId, {
      isoDate: startIso,
      endIsoDate: rawEnd && rawEnd > startIso ? rawEnd : undefined,
    });
  }

  const rawEventRows = eventRows ?? [];
  const rawEventIds = rawEventRows.map((r) => String((r as Record<string, unknown>).id));

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

  if (rawEventIds.length === 0) {
    return {
      profile,
      events: [] as EventItem[],
      attendees: [] as Attendee[],
      scheduleBlocks: [] as ScheduleBlock[],
      alerts,
      disposableShots: [] as DisposableShot[],
      rollSettings: {} as Record<string, DisposableRollSettings>,
      creatorApps,
      creatorAppLogs,
    };
  }

  const [attRes, schRes, shotRes, rollRes, planningRes] = await Promise.all([
    client.from('attendees').select('*').in('event_id', rawEventIds).order('created_at', { ascending: false }),
    client.from('schedule_blocks').select('*').in('event_id', rawEventIds).order('created_at', { ascending: true }),
    client.from('disposable_shots').select('*').in('event_id', rawEventIds).order('created_at', { ascending: false }),
    client.from('disposable_roll_settings').select('*').in('event_id', rawEventIds),
    client.from('event_planning_configs').select('*').in('event_id', rawEventIds),
  ]);

  if (attRes.error) throw new Error(attRes.error.message);
  if (schRes.error) throw new Error(schRes.error.message);
  if (shotRes.error) throw new Error(shotRes.error.message);
  if (rollRes.error) throw new Error(rollRes.error.message);
  if (planningRes.error && !isMissingTableError(planningRes.error)) {
    throw new Error(planningRes.error.message);
  }

  const planningByEvent = new Map<string, EventPlanningConfig>();
  if (!planningRes.error) {
    for (const row of planningRes.data ?? []) {
      const rec = row as Record<string, unknown>;
      const eid = String(rec.event_id);
      planningByEvent.set(
        eid,
        mapPlanningRow(rec, eventCategoryById.get(eid) || 'Events', eventDateContextById.get(eid))
      );
    }
  }

  const events = rawEventRows.map((r) => {
    const rec = r as Record<string, unknown>;
    return mapEventRow(rec, planningByEvent.get(String(rec.id)));
  });

  const attendees = (attRes.data ?? []).map((r) => {
    const mapped = mapAttendeeRow(r as Record<string, unknown>);
    return hydrateAttendeeWithEventMeta(mapped, attendeeMetaByEvent.get(mapped.eventId));
  });
  const scheduleBlocks = (schRes.data ?? [])
    .map((r) => {
      const rec = r as Record<string, unknown>;
      const eid = String(rec.event_id);
      const fallback = scheduleDatesByEvent.get(eid)?.[String(rec.id)];
      const mapped = mapScheduleRow(rec, fallback);
      const ctx = eventDateContextById.get(eid);
      const resolvedDate = resolveScheduleBlockDate(mapped, ctx);
      return resolvedDate && !mapped.date ? { ...mapped, date: resolvedDate } : mapped;
    })
    .sort((a, b) =>
      compareScheduleBlocksChronological(a, b, eventDateContextById.get(a.eventId) ?? null)
    );
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
      res.setHeader(
        'Access-Control-Allow-Headers',
        'Content-Type, Authorization, X-Creator-Token, X-CheckIn-Active'
      );
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
    const forwardedHost = (req.headers['x-forwarded-host'] as string)?.split(',')[0]?.trim();
    const host = forwardedHost || req.get('host') || 'eventsbyyou.xyz';
    const hostname = host.split(':')[0].toLowerCase();
    if (hostname === 'eventsbyyou.xyz' || hostname === 'www.eventsbyyou.xyz') {
      return `https://${host}`.replace(/\/+$/, '');
    }
    if (process.env.APP_URL) return process.env.APP_URL.replace(/\/+$/, '');
    const proto = (req.headers['x-forwarded-proto'] as string) || req.protocol || 'https';
    if (host.includes('localhost') || host.includes('127.0.0.1')) {
      return CANONICAL_ORIGIN;
    }
    return `${proto}://${host}`.replace(/\/+$/, '');
  };

  app.get(['/robots.txt', '/robot.txt'], (req, res) => {
    const baseUrl = resolveBaseUrl(req);
    res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=60');
    res.type('text/plain; charset=utf-8').send(
      [
        'User-agent: *',
        'Allow: /',
        'Allow: /features',
        'Allow: /pricing',
        'Allow: /how-it-works',
        'Allow: /faq',
        'Allow: /about',
        'Allow: /contact',
        'Allow: /blog',
        'Allow: /terms',
        'Allow: /privacy',
        'Allow: /e/',
        'Disallow: /api/',
        'Disallow: /studio',
        'Disallow: /camera',
        'Disallow: /signin',
        'Disallow: /signup',
        'Disallow: /reset-password',
        'Disallow: /verify-otp',
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

    const indexableEvents = publicEvents.filter((evt) =>
      isPublicIndexableEvent(evt as EventItem & { unlisted?: boolean; visibility?: string })
    );

    const escapeXml = (str: string) =>
      str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');

    const staticMeta: Record<string, { changefreq: string; priority: string }> = {
      '/': { changefreq: 'daily', priority: '1.0' },
      '/features': { changefreq: 'weekly', priority: '0.9' },
      '/pricing': { changefreq: 'weekly', priority: '0.9' },
      '/how-it-works': { changefreq: 'monthly', priority: '0.8' },
      '/faq': { changefreq: 'weekly', priority: '0.8' },
      '/about': { changefreq: 'monthly', priority: '0.7' },
      '/contact': { changefreq: 'monthly', priority: '0.7' },
      '/blog': { changefreq: 'weekly', priority: '0.8' },
      '/terms': { changefreq: 'monthly', priority: '0.4' },
      '/privacy': { changefreq: 'monthly', priority: '0.4' },
    };

    const urlEntries = [
      ...STATIC_MARKETING_PATHS.map((p) => {
        const meta = staticMeta[p] ?? { changefreq: 'weekly', priority: '0.7' };
        return `  <url>\n    <loc>${escapeXml(`${baseUrl}${p}`)}</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>${meta.changefreq}</changefreq>\n    <priority>${meta.priority}</priority>\n  </url>`;
      }),
      ...indexableEvents.map((evt) => {
        const cleanSlug = encodeURIComponent(evt.slug || evt.id);
        return `  <url>\n    <loc>${escapeXml(`${baseUrl}/e/${cleanSlug}`)}</loc>\n    <lastmod>${escapeXml(evt.isoDate || today)}</lastmod>\n    <changefreq>daily</changefreq>\n    <priority>0.8</priority>\n  </url>`;
      }),
    ];

    res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=60');
    res
      .type('application/xml; charset=utf-8')
      .send(
        `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urlEntries.join('\n')}\n</urlset>\n`
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
      id: 'events-by-you',
      slug: 'events-by-you',
      title: 'Events By You',
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
      organizer: 'Events By You',
      artwork: 'architecture' as const,
    };
    const svg = buildEventOgSvg(evt, baseUrl);
    res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=300');
    return res.send(svg);
  });

  app.get('/api/health', (req, res) => {
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
      googleOAuthConfigured: isGoogleOAuthConfigured(),
      googleCallbackUrl: getGoogleOAuthCallbackUrl(req),
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

  // Google OAuth Popup Callback (works in both Supabase and In-Memory modes, iframe-safe)
  app.get(['/auth/callback', '/auth/callback/'], handleGoogleOAuthCallback);

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
              smsSenderId: delivery.smsSenderId,
              smsMessageId: delivery.smsMessageId,
              smsWarning: delivery.smsWarning,
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
      const profile = await ensureProfileRow(userClient, data.user).catch((err) => {
        if (svc) return ensureProfileRow(svc, data.user!);
        throw err;
      });
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
          smsSenderId: challenge.smsSenderId,
          smsMessageId: challenge.smsMessageId,
          smsWarning: challenge.smsWarning,
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
        const profile = await ensureProfileRow(userClient, sessionRes.data.user).catch((err) => {
          if (svc) return ensureProfileRow(svc, sessionRes.data.user!);
          throw err;
        });
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
      const profile = await ensureProfileRow(userClient, result.data.user).catch((err) => {
        if (svc) return ensureProfileRow(svc, result.data.user!);
        throw err;
      });
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
              redirectTo: redirectTo || process.env.APP_URL || 'https://eventsbyyou.xyz',
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
          smsSenderId: delivery.smsSenderId,
          smsMessageId: delivery.smsMessageId,
          smsWarning: delivery.smsWarning,
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
            redirectTo: redirectTo || process.env.APP_URL || 'https://eventsbyyou.xyz',
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
          smsSenderId: delivery.smsSenderId,
          smsMessageId: delivery.smsMessageId,
          smsWarning: delivery.smsWarning,
        });
      }

      const supabase = createPublicSupabaseClient();
      const { error } = await supabase.auth.resetPasswordForEmail(cleanEmail, {
        redirectTo: redirectTo || process.env.APP_URL || 'https://eventsbyyou.xyz',
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
    if (provider !== 'google') {
      return res.status(400).json({ error: 'Only Google OAuth is supported.' });
    }
    const callbackUrl = getGoogleOAuthCallbackUrl(req);
    const mode = req.query.mode === 'signup' ? 'signup' : 'signin';
    const studio = typeof req.query.studio === 'string' ? req.query.studio : undefined;
    const appRole = req.query.appRole === 'gate_staff' ? 'gate_staff' : 'organizer';

    if (isGoogleOAuthConfigured() && createServiceSupabaseClient()) {
      try {
        const { url } = buildGoogleAuthorizeUrl(req, { mode, studio, appRole });
        return res.json({ url, mode: 'direct', callbackUrl });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unable to start Google OAuth.';
        return res.status(500).json({ error: message });
      }
    }

    try {
      const supabase = createImplicitSupabaseClient();
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: callbackUrl,
          skipBrowserRedirect: true,
          queryParams: {
            prompt: 'select_account',
          },
        },
      });
      if (error || !data.url) {
        return res.status(400).json({ error: error?.message || 'Google OAuth initialization failed.' });
      }
      return res.json({ url: data.url, mode: 'supabase', callbackUrl });
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
      const svcFallback = createServiceSupabaseClient();
      const profile = await ensureProfileRow(userClient, data.user).catch((err) => {
        if (svcFallback) return ensureProfileRow(svcFallback, data.user!);
        throw err;
      });
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
      const svcFallback = createServiceSupabaseClient();
      const profile = await ensureProfileRow(req.supabase!, req.user!).catch((err) => {
        if (svcFallback) return ensureProfileRow(svcFallback, req.user!);
        throw err;
      });
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
      const svc = createServiceSupabaseClient();
      if (svc && req.user?.id) {
        const { error: adminErr } = await svc.auth.admin.updateUserById(req.user.id, {
          password: password!,
        });
        if (adminErr) {
          return res.status(400).json({ error: adminErr.message });
        }
        return res.json({ ok: true });
      }
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

  const sanitizePublicEvent = (evt: EventItem): EventItem => ({
    ...evt,
    checkedIn: 0,
    extraDataConfig: sanitizePublicExtraDataConfig(evt.extraDataConfig),
  });

  app.get('/api/public/events', async (_req, res) => {
    if (!isSupabaseConfigured()) {
      return res.status(503).json({
        error:
          'Supabase is not configured on this server. Set SUPABASE_URL and SUPABASE_ANON_KEY in your environment.',
        code: 'SUPABASE_NOT_CONFIGURED',
        events: [],
        scheduleBlocks: [],
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
        return res.status(500).json({ error: error.message, events: [], scheduleBlocks: [] });
      }
      const rows = data ?? [];
      const scheduleDatesByEvent = new Map<string, Record<string, { date?: string; day?: string }>>();
      const events = rows.map((r) => {
        const rec = r as Record<string, unknown>;
        scheduleDatesByEvent.set(String(rec.id), extractEventScheduleDatesMap(rec.extra_data_config));
        return sanitizePublicEvent(mapEventRow(rec));
      });
      const eventById = new Map(events.map((e) => [e.id, e]));
      let scheduleBlocks: ScheduleBlock[] = [];
      if (events.length > 0) {
        const { data: schRows } = await supabase
          .from('schedule_blocks')
          .select('*')
          .in(
            'event_id',
            events.map((e) => e.id)
          )
          .order('created_at', { ascending: true });
        scheduleBlocks = (schRows ?? [])
          .map((r) => {
            const rec = r as Record<string, unknown>;
            const eid = String(rec.event_id);
            const mapped = mapScheduleRow(rec, scheduleDatesByEvent.get(eid)?.[String(rec.id)]);
            const evtCtx = eventById.get(eid);
            const resolvedDate = resolveScheduleBlockDate(mapped, evtCtx);
            return resolvedDate && !mapped.date ? { ...mapped, date: resolvedDate } : mapped;
          })
          .sort((a, b) =>
            compareScheduleBlocksChronological(a, b, eventById.get(a.eventId) ?? null)
          );
      }
      return res.json({ events, scheduleBlocks });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load events.';
      return res.status(500).json({ error: message, events: [], scheduleBlocks: [] });
    }
  });

  app.get('/api/public/events/:slugOrId', async (req, res) => {
    if (!isSupabaseConfigured()) {
      return res.status(503).json({
        error:
          'Supabase is not configured on this server. Set SUPABASE_URL and SUPABASE_ANON_KEY in your environment.',
      });
    }
    try {
      const evt = await resolveEventForPublicOrOg(req.params.slugOrId);
      if (!evt || (evt.status !== 'live' && evt.status !== 'upcoming')) {
        return res.status(404).json({ error: 'Event invitation not found or no longer active.' });
      }
      const supabase = createServiceSupabaseClient() ?? createPublicSupabaseClient();
      const [{ data: rawEvt }, { data: schRows }] = await Promise.all([
        supabase.from('events').select('extra_data_config').eq('id', evt.id).maybeSingle(),
        supabase
          .from('schedule_blocks')
          .select('*')
          .eq('event_id', evt.id)
          .order('created_at', { ascending: true }),
      ]);
      const fallbackMap = extractEventScheduleDatesMap(
        (rawEvt as Record<string, unknown> | null)?.extra_data_config
      );
      const scheduleBlocks = (schRows ?? [])
        .map((r) => {
          const rec = r as Record<string, unknown>;
          const mapped = mapScheduleRow(rec, fallbackMap[String(rec.id)]);
          const resolvedDate = resolveScheduleBlockDate(mapped, evt);
          return resolvedDate && !mapped.date ? { ...mapped, date: resolvedDate } : mapped;
        })
        .sort((a, b) => compareScheduleBlocksChronological(a, b, evt));
      return res.json({ event: sanitizePublicEvent(evt), scheduleBlocks });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load event.';
      return res.status(500).json({ error: message });
    }
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

  app.delete('/api/public/camera/shots/:id', requireSupabaseConfiguredMiddleware, async (req, res) => {
    try {
      const rawKey =
        typeof req.query.shooterKey === 'string'
          ? req.query.shooterKey
          : typeof (req.body as Record<string, unknown> | undefined)?.shooterKey === 'string'
            ? String((req.body as Record<string, unknown>).shooterKey)
            : typeof req.headers['x-shooter-key'] === 'string'
              ? req.headers['x-shooter-key']
              : '';
      const shooterKey = rawKey.trim();
      if (!shooterKey) {
        return res.status(400).json({ error: 'Missing shooterKey to verify photo ownership.' });
      }

      const supabase = createServiceSupabaseClient() ?? createPublicSupabaseClient();
      const { data: existing, error: fetchErr } = await supabase
        .from('disposable_shots')
        .select('*')
        .eq('id', req.params.id)
        .maybeSingle();
      if (fetchErr || !existing) {
        return res.status(404).json({ error: 'Photo not found.' });
      }

      const mapped = mapShotRow(existing as Record<string, unknown>);
      const { data: rawEvtRow } = await supabase
        .from('events')
        .select('extra_data_config')
        .eq('id', mapped.eventId)
        .maybeSingle();
      const shotShooters = extractEventShotShootersMap(
        (rawEvtRow as Record<string, unknown> | null)?.extra_data_config
      );
      const hydrated = hydrateShotWithEventMeta(mapped, shotShooters);

      if (!hydrated.shooterKey || hydrated.shooterKey !== shooterKey) {
        return res.status(403).json({ error: 'You can only delete photos you captured.' });
      }

      const { error: delErr } = await supabase
        .from('disposable_shots')
        .delete()
        .eq('id', req.params.id);
      if (delErr) return res.status(400).json({ error: delErr.message });

      await removeEventShotShooter(supabase, hydrated.eventId, req.params.id);
      return res.json({ ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete photo.';
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

      if (!name?.trim() || !phone?.trim()) {
        return res.status(400).json({ error: 'Full name and mobile phone number are required.' });
      }

      const cleanEmail = email?.trim() || '';
      if (cleanEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
        return res.status(400).json({ error: 'Please enter a valid email address or leave it blank.' });
      }
      const normalizedPhone = normalizePhoneE164(phone.trim());
      const attendeeId = `att-${Date.now()}-${Math.floor(100 + Math.random() * 899)}`;
      const finalCode = ticketCode?.trim() || `#EVT-2026-${Math.floor(1000 + Math.random() * 8999)}`;

      try {
        const supabase = createServiceSupabaseClient() ?? createPublicSupabaseClient();

        // Enforce invite code & organizer plan capacity if configured on event
        const { data: evtMeta } = await supabase
          .from('events')
          .select('id, title, status, organizer_id, capacity, registered, ticket_price, qr_pass_published, validation_config')
          .eq('id', eventId)
          .maybeSingle();
        const evtMetaRec = evtMeta as Record<string, unknown> | null;
        if (!evtMetaRec || !['live', 'upcoming'].includes(String(evtMetaRec.status || ''))) {
          return res.status(404).json({ error: 'Event not found or not open for registration.' });
        }
        if (evtMetaRec.qr_pass_published === false) {
          return res.status(403).json({
            error: 'Check-in QR passes have not been published by the event creator yet.',
          });
        }
        const valCfg = evtMetaRec.validation_config as EventItem['validationConfig'] | undefined;
        if (valCfg?.requireInviteCode && valCfg.inviteCode?.trim()) {
          if ((inviteCodeUsed || '').trim().toLowerCase() !== valCfg.inviteCode.trim().toLowerCase()) {
            return res.status(403).json({ error: 'Invalid invitation passcode for this event.' });
          }
        }

        const evtOrganizerId = evtMetaRec.organizer_id ? String(evtMetaRec.organizer_id) : '';
        const ownerEntProfile = evtOrganizerId
          ? await resolveOwnerEntitlementProfile(supabase, evtOrganizerId)
          : { plan: 'Starter' as const };
        const effectiveCap = getEffectiveEventCapacity(
          Number(evtMetaRec.capacity ?? 50),
          ownerEntProfile
        );
        if (Number(evtMetaRec.registered ?? 0) >= effectiveCap) {
          return res.status(409).json({
            error: `${String(evtMetaRec.title || 'This event')} has reached its attendee limit (${effectiveCap.toLocaleString()} seats).`,
          });
        }

        let normalizedValidationGroup: string | null = null;
        if (typeof validationGroup === 'string' && validationGroup.trim()) {
          const trimmedGroup = validationGroup.trim().slice(0, 120);
          const allowedOptions = Array.isArray(valCfg?.options) ? valCfg.options : [];
          const matchedOpt = allowedOptions.find(
            (opt) => opt.trim().toLowerCase() === trimmedGroup.toLowerCase()
          );
          normalizedValidationGroup = matchedOpt ? matchedOpt.trim() : trimmedGroup;
        }

        let usedExtendedRpcFallback = false;
        let { data: rpcData, error: rpcErr } = await supabase.rpc('register_public_attendee', {
          p_id: attendeeId,
          p_event_id: eventId,
          p_name: name.trim(),
          p_email: cleanEmail,
          p_phone: normalizedPhone,
          p_organization: organization?.trim() || 'Fast Pass Attendee',
          p_tier: tier || 'General',
          p_ticket_code: finalCode,
          p_validation_group: normalizedValidationGroup,
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
            p_email: cleanEmail,
            p_phone: normalizedPhone,
            p_organization: organization?.trim() || 'Fast Pass Attendee',
            p_tier: tier || 'General',
            p_ticket_code: finalCode,
          });
          rpcData = fallbackRpc.data;
          rpcErr = fallbackRpc.error;
        }

        // If remote SQL RPC still enforces legacy 50-seat limit despite creator capacity boost, complete registration safely in TypeScript
        if (
          rpcErr &&
          rpcErr.message.includes('CAPACITY_REACHED:') &&
          ownerEntProfile.planAttendeeCapacity !== undefined &&
          Number(evtMetaRec.registered ?? 0) < effectiveCap
        ) {
          const { data: dupCheck } = await supabase
            .from('attendees')
            .select('id')
            .eq('event_id', eventId)
            .eq('phone', normalizedPhone)
            .maybeSingle();
          if (dupCheck) {
            platformRuntime.recordDuplicateBlock(eventId);
            return res.status(409).json({
              error: `Duplicate shield: ${normalizedPhone} already holds a pass for ${String(evtMetaRec.title || 'this event')}`,
            });
          }

          const { data: directAtt, error: directAttErr } = await supabase
            .from('attendees')
            .insert({
              id: attendeeId,
              event_id: eventId,
              name: name.trim(),
              email: cleanEmail,
              phone: normalizedPhone,
              organization: organization?.trim() || 'Fast Pass Attendee',
              tier: tier || 'General',
              checked_in: false,
              ticket_code: finalCode,
              sms_status: 'Arkesel Sent',
              payment_status: 'paid',
              validation_group: normalizedValidationGroup,
              invite_code_used: inviteCodeUsed ?? null,
              gift_entry: giftEntry ?? null,
              custom_responses: customResponses ?? null,
            })
            .select('*')
            .single();

          if (!directAttErr && directAtt) {
            const nextReg = Number(evtMetaRec.registered ?? 0) + 1;
            const nextRev = Number(evtMetaRec.revenue ?? 0) + Number(evtMetaRec.ticket_price ?? 0);
            const { data: updatedEvt } = await supabase
              .from('events')
              .update({
                registered: nextReg,
                sms_dispatched: Number(evtMetaRec.sms_dispatched ?? 0) + 1,
                revenue: nextRev,
              })
              .eq('id', eventId)
              .select('*')
              .single();
            rpcData = {
              attendee: directAtt,
              event: updatedEvt ?? { ...evtMetaRec, registered: nextReg },
            };
            rpcErr = null;
          } else if (directAttErr) {
            rpcErr = directAttErr;
          }
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
          if (rpcErr.message.includes('CAPACITY_REACHED:')) {
            return res.status(409).json({
              error: rpcErr.message.split('CAPACITY_REACHED:')[1],
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
          (normalizedValidationGroup && payload.attendee.validation_group === undefined) ||
          (inviteCodeUsed && payload.attendee.invite_code_used === undefined) ||
          (giftEntry && payload.attendee.gift_entry === undefined) ||
          (customResponses && Object.keys(customResponses).length > 0 && payload.attendee.custom_responses === undefined)
        ) {
          await mergeEventAttendeeMeta(supabase, eventId, attendeeId, {
            validationGroup: normalizedValidationGroup || undefined,
            inviteCodeUsed: inviteCodeUsed?.trim() || undefined,
            giftEntry,
            customResponses,
          });
        }

        let event = mapEventRow(payload.event);

        let replyTo: string | undefined;
        let orgSenderId: string | undefined;
        let organizerCredits = 0;
        const organizerId = payload.event?.organizer_id ? String(payload.event.organizer_id) : undefined;
        if (organizerId) {
          const { data: orgProf } = await supabase
            .from('profiles')
            .select('reply_to_email, sender_id, sms_credits')
            .eq('id', organizerId)
            .maybeSingle();
          const profRec = orgProf as Record<string, unknown> | null;
          if (profRec && typeof profRec.reply_to_email === 'string') {
            replyTo = profRec.reply_to_email;
          }
          if (profRec && typeof profRec.sender_id === 'string' && profRec.sender_id.trim()) {
            orgSenderId = profRec.sender_id.trim();
          }
          if (profRec) {
            organizerCredits = Number(profRec.sms_credits ?? 0);
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

        const smsCost = Math.max(1, calculateSmsCredits(resolvedMsg.text));
        let smsCreditsUsed = 0;
        let smsCreditsRemaining = organizerCredits;
        let smsSkippedReason: string | undefined;
        let debitReserved = false;
        if (organizerId) {
          const debit = await consumeSupabaseSmsCredits(supabase, organizerId, smsCost);
          debitReserved = debit.ok;
          smsCreditsRemaining = debit.remaining;
        }
        if (!debitReserved) {
          smsSkippedReason = 'Organizer SMS bundle balance is 0 (no purchased SMS credits remaining).';
        }

        const publicScheduleItems =
          isResendConfigured() && cleanEmail.includes('@')
            ? await fetchSortedEventScheduleItems(supabase, event)
            : [];

        const [smsDelivery, emailDelivery] = await Promise.all([
          debitReserved
            ? dispatchOptionalArkeselSms(
                normalizedPhone,
                event.title,
                finalCode,
                event.senderId || orgSenderId,
                resolvedMsg.text
              )
            : Promise.resolve('Pending' as const),
          isResendConfigured() && cleanEmail.includes('@')
            ? sendEventPassEmail({
                to: cleanEmail,
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
                eventUrl: resolvedMsg.eventUrl,
                scheduleBlocks: publicScheduleItems,
              })
            : Promise.resolve({ ok: false, skipped: true }),
        ]);

        const hasLiveArkesel = Boolean((process.env.ARKESEL_API_KEY || '').trim()) && platformRuntime.flags.smsMode !== 'sandbox';
        if (debitReserved && organizerId && smsDelivery === 'Pending' && hasLiveArkesel) {
          smsCreditsRemaining = await refundSupabaseSmsCredits(supabase, organizerId, smsCost);
          smsCreditsUsed = 0;
        } else if (debitReserved && smsDelivery === 'Arkesel Sent') {
          smsCreditsUsed = smsCost;
        }

        if (smsCreditsUsed === 0) {
          const adjustedDispatched = Math.max(0, Number(payload.event.sms_dispatched ?? 1) - 1);
          await supabase
            .from('events')
            .update({ sms_dispatched: adjustedDispatched })
            .eq('id', eventId);
          event = { ...event, smsDispatched: adjustedDispatched };
        }

        const finalDeliveryStatus: Attendee['smsStatus'] =
          smsCreditsUsed > 0
            ? 'Arkesel Sent'
            : emailDelivery.ok && (!hasLiveArkesel || smsDelivery === 'Pending')
              ? 'Resend Delivered'
              : 'Pending';

        if (finalDeliveryStatus !== payload.attendee.sms_status) {
          await supabase
            .from('attendees')
            .update({ sms_status: finalDeliveryStatus })
            .eq('id', attendeeId);
        }

        const attendee = mapAttendeeRow({
          ...payload.attendee,
          sms_status: finalDeliveryStatus,
          validation_group: payload.attendee.validation_group ?? normalizedValidationGroup ?? null,
          invite_code_used: payload.attendee.invite_code_used ?? inviteCodeUsed ?? null,
          gift_entry: payload.attendee.gift_entry ?? giftEntry ?? null,
          custom_responses: payload.attendee.custom_responses ?? customResponses ?? null,
        });

        return res.status(201).json({
          attendee,
          event: sanitizePublicEvent(event),
          smsCreditsUsed,
          smsCreditsRemaining,
          smsSkippedReason,
        });
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
          const email = String(rec.email ?? '').trim().toLowerCase();
          const phone = String(rec.phone ?? '');
          const cleanPhone = phone.replace(/\s+/g, '');
          const phoneDigits = phone.replace(/\D/g, '');
          return (
            Boolean(cleanCode && code === cleanCode) ||
            Boolean(email && email === cleanLower) ||
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

  // Public Corporate Polls & Audience Voting
  app.get(
    '/api/public/events/:slugOrId/polls',
    requireSupabaseConfiguredMiddleware,
    async (req, res) => {
      try {
        const evt = await resolveEventForPublicOrOg(req.params.slugOrId);
        if (!evt || (evt.status !== 'live' && evt.status !== 'upcoming')) {
          return res.status(404).json({ error: 'Event polls not found.' });
        }
        const cleanEvent = sanitizePublicEvent(evt);
        return res.json({
          event: cleanEvent,
          polls: cleanEvent.extraDataConfig?.polls ?? [],
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to load event polls.';
        return res.status(500).json({ error: message });
      }
    }
  );

  app.post(
    '/api/public/events/:slugOrId/polls/:pollId/vote',
    requireSupabaseConfiguredMiddleware,
    async (req, res) => {
      try {
        const evt = await resolveEventForPublicOrOg(req.params.slugOrId);
        if (!evt || (evt.status !== 'live' && evt.status !== 'upcoming')) {
          return res.status(404).json({ error: 'Event not found or no longer active.' });
        }
        const adminClient = createServiceSupabaseClient() ?? createPublicSupabaseClient();
        const { data: rawRow, error: fetchErr } = await adminClient
          .from('events')
          .select('*')
          .eq('id', evt.id)
          .maybeSingle();
        if (fetchErr || !rawRow) {
          return res.status(404).json({ error: 'Event not found.' });
        }
        const rowRec = rawRow as Record<string, unknown>;
        const rawExtra =
          rowRec.extra_data_config && typeof rowRec.extra_data_config === 'object'
            ? (rowRec.extra_data_config as Record<string, unknown>)
            : ({ ...(evt.extraDataConfig ?? { enableGiftTable: false, customFields: [] }) } as Record<string, unknown>);
        const polls = Array.isArray(rawExtra.polls) ? (rawExtra.polls as EventPoll[]) : [];
        const pollIdx = polls.findIndex((p) => p.id === req.params.pollId);
        if (pollIdx === -1) {
          return res.status(404).json({ error: 'Poll not found.' });
        }
        const poll = polls[pollIdx];
        if (poll.status !== 'active') {
          return res.status(403).json({ error: 'This poll is currently closed for voting.' });
        }

        const body = (req.body || {}) as {
          optionIds?: unknown;
          voterKey?: unknown;
          passCode?: unknown;
        };
        const rawIds = Array.isArray(body.optionIds)
          ? body.optionIds.map((id) => String(id).trim()).filter(Boolean)
          : [];
        const uniqueIds = Array.from(new Set(rawIds));
        const validOptionSet = new Set((poll.options || []).map((o) => o.id));
        const chosenIds = uniqueIds.filter((id) => validOptionSet.has(id));
        if (chosenIds.length === 0) {
          return res.status(400).json({ error: 'Select at least one valid option to cast your vote.' });
        }
        if (!poll.allowMultiple && chosenIds.length > 1) {
          return res.status(400).json({ error: 'This poll allows only one choice.' });
        }

        let dedupeKey = '';
        if (poll.requireVerifiedPass) {
          const rawPass = typeof body.passCode === 'string' ? body.passCode.trim() : '';
          if (!rawPass) {
            return res.status(403).json({
              error: 'This accredited poll requires your Event Pass Code, registered email, or phone number.',
            });
          }
          const { data: attRows, error: attErr } = await adminClient
            .from('attendees')
            .select('id, ticket_code, email, phone')
            .eq('event_id', evt.id);
          if (attErr) {
            return res.status(400).json({ error: attErr.message });
          }
          const cleanLower = rawPass.toLowerCase();
          const cleanCode = rawPass.toUpperCase().replace(/^#/, '');
          const digitsOnly = rawPass.replace(/\D/g, '');
          const normalizedPassPhone = digitsOnly.length >= 9 ? normalizePhoneE164(rawPass) : '';
          const matchedAtt = (attRows ?? []).find((row) => {
            const rec = row as Record<string, unknown>;
            const attCode = String(rec.ticket_code ?? '').toUpperCase().replace(/^#/, '');
            const attEmail = String(rec.email ?? '').trim().toLowerCase();
            const attPhoneRaw = String(rec.phone ?? '');
            const attPhone = normalizePhoneE164(attPhoneRaw);
            const attDigits = attPhoneRaw.replace(/\D/g, '');
            return (
              Boolean(cleanCode && attCode === cleanCode) ||
              Boolean(attEmail && attEmail === cleanLower) ||
              (normalizedPassPhone && attPhone === normalizedPassPhone) ||
              (digitsOnly.length >= 9 && attDigits.endsWith(digitsOnly.slice(-9)))
            );
          });
          if (!matchedAtt) {
            return res.status(403).json({
              error: 'No registered delegate pass matched that code, email, or phone number.',
            });
          }
          dedupeKey = `att:${String((matchedAtt as Record<string, unknown>).id)}`;
        } else {
          const rawKey = typeof body.voterKey === 'string' ? body.voterKey.trim().slice(0, 80) : '';
          dedupeKey = rawKey
            ? `anon:${rawKey}`
            : `anon:${crypto.randomBytes(8).toString('hex')}`;
        }

        const existingVoters = Array.isArray(poll.voterKeys) ? poll.voterKeys : [];
        if (existingVoters.includes(dedupeKey)) {
          return res.status(409).json({ error: 'Your vote has already been recorded for this poll.' });
        }

        const chosenSet = new Set(chosenIds);
        const updatedPoll: EventPoll = {
          ...poll,
          options: (poll.options || []).map((opt) =>
            chosenSet.has(opt.id) ? { ...opt, votes: (opt.votes || 0) + 1 } : opt
          ),
          totalVotes: (poll.totalVotes || 0) + 1,
          voterKeys: [...existingVoters, dedupeKey],
        };

        const nextExtra = {
          ...rawExtra,
          enablePolls: true,
          polls: polls.map((p, idx) => (idx === pollIdx ? updatedPoll : p)),
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
        return res.json({
          poll: sanitizePollForPublic(updatedPoll),
          event: sanitizePublicEvent(mapEventRow(updatedRow as Record<string, unknown>)),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to submit poll vote.';
        return res.status(500).json({ error: message });
      }
    }
  );

  // =========================================================================
  // PROTECTED STUDIO & EVENT MODULE ROUTES (Authenticated Organisers Only)
  // =========================================================================

  app.get('/api/studio/bootstrap', requireSupabaseAuth, requireRole('creator', 'organizer'), async (req: AuthedRequest, res) => {
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

      const runtimeProfileCap = platformRuntime.planAttendeeCapacityOverrides.get(req.user!.id);
      const mapped = mapProfileRow(
        data as Record<string, unknown>,
        req.user!.email ?? '',
        runtimeProfileCap !== undefined
          ? runtimeProfileCap
          : req.user?.app_metadata?.plan_attendee_capacity
      );
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

      const debit = await consumeSupabaseSmsCredits(client, req.user!.id, 1);
      if (!debit.ok) {
        return res.status(402).json({
          error: 'Insufficient SMS credits (0 remaining). Purchase an SMS bundle in Plan & Credits to send SMS.',
        });
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
        await refundSupabaseSmsCredits(client, req.user!.id, 1);
        return res.status(400).json({ error: dispatch.error || 'Arkesel SMS test dispatch failed.' });
      }

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
        paystackConfigured: isPaystackConfigured(),
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

  app.get('/api/studio/sms/purchases', requireSupabaseAuth, requireRole('creator', 'organizer'), async (req: AuthedRequest, res) => {
    try {
      const client = createServiceSupabaseClient() ?? req.supabase!;
      const { data, error } = await client
        .from('sms_bundle_purchases')
        .select('*')
        .eq('organizer_id', req.user!.id)
        .order('created_at', { ascending: false })
        .limit(50);

      let purchases: SmsBundlePurchase[] = [];
      if (!error && Array.isArray(data)) {
        purchases = data.map((r) => mapSmsPurchaseRow(r as Record<string, unknown>));
      } else if (error && !isMissingTableError(error)) {
        return res.status(400).json({ error: error.message });
      }

      const runtimeFallback = Array.from(platformRuntime.fallbackSmsPurchases.values())
        .filter((p) => p.organizerId === req.user!.id)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

      const merged = purchases.length > 0 ? purchases : runtimeFallback;
      return res.json({
        purchases: merged,
        paystackConfigured: isPaystackConfigured(),
        mode: platformRuntime.flags.smsMode,
      });
    } catch (err) {
      return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to load SMS purchases.' });
    }
  });

  app.post('/api/studio/sms/paystack/initialize', requireSupabaseAuth, requireRole('creator', 'organizer'), async (req: AuthedRequest, res) => {
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

    try {
      const client = req.supabase!;
      const adminClient = createServiceSupabaseClient() ?? client;
      const { data: prof } = await adminClient
        .from('profiles')
        .select('name, email')
        .eq('id', req.user!.id)
        .maybeSingle();

      const email = String(
        (prof as Record<string, unknown> | null)?.email || req.user!.email || ''
      ).trim();
      if (!email || !email.includes('@')) {
        return res.status(400).json({
          error: 'Add a valid email address in Account Settings before starting Paystack checkout.',
        });
      }

      const reference = `EBY-SMS-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
      const purchaseId = `smsp-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
      const originHeader =
        (typeof req.headers.origin === 'string' && /^https?:\/\//i.test(req.headers.origin)
          ? req.headers.origin
          : (process.env.APP_URL || '').trim().replace(/\/+$/, '')) || 'http://localhost:3000';
      let safeCallback = `${originHeader}/?paystack_ref=${encodeURIComponent(reference)}`;
      if (typeof callbackUrl === 'string' && /^https?:\/\//i.test(callbackUrl)) {
        try {
          const parsedCb = new URL(callbackUrl);
          const parsedOrigin = new URL(originHeader);
          const reqHost = typeof req.headers.host === 'string' ? req.headers.host.toLowerCase() : '';
          if (
            parsedCb.origin === parsedOrigin.origin ||
            (reqHost && parsedCb.host.toLowerCase() === reqHost)
          ) {
            safeCallback = parsedCb.toString();
          }
        } catch {
          // Fall back to default same-origin callback URL
        }
      }

      const nowIso = new Date().toISOString();
      const pendingRecord: SmsBundlePurchase = {
        id: purchaseId,
        organizerId: req.user!.id,
        organizerName: String((prof as Record<string, unknown> | null)?.name || ''),
        organizerEmail: email,
        bundleId: quote.bundleId,
        bundleName: quote.bundleName,
        credits: quote.credits,
        amountGhs: quote.amountGhs,
        paymentChannel: 'Paystack Checkout',
        provider: 'paystack',
        reference,
        status: 'pending_payment',
        createdAt: nowIso,
      };

      let storedInDb = false;
      const { error: insErr } = await adminClient.from('sms_bundle_purchases').insert({
        id: pendingRecord.id,
        organizer_id: pendingRecord.organizerId,
        bundle_id: pendingRecord.bundleId,
        bundle_name: pendingRecord.bundleName,
        credits: pendingRecord.credits,
        amount_ghs: pendingRecord.amountGhs,
        payment_channel: pendingRecord.paymentChannel,
        provider: pendingRecord.provider,
        reference: pendingRecord.reference,
        status: pendingRecord.status,
        created_at: pendingRecord.createdAt,
      });
      if (!insErr) {
        storedInDb = true;
      } else if (isMissingTableError(insErr)) {
        platformRuntime.fallbackSmsPurchases.set(pendingRecord.id, pendingRecord);
      } else {
        return res.status(400).json({ error: insErr.message });
      }

      const initRes = await initializePaystackTransaction({
        email,
        amountGhs: quote.amountGhs,
        reference,
        callbackUrl: safeCallback,
        metadata: {
          userId: req.user!.id,
          purchaseId,
          bundleId: quote.bundleId,
          credits: quote.credits,
        },
      });

      if (!initRes.ok || !initRes.authorizationUrl) {
        if (storedInDb) {
          await adminClient
            .from('sms_bundle_purchases')
            .update({ status: 'failed', rejection_reason: initRes.error || 'Initialization failed' })
            .eq('id', purchaseId);
        } else {
          platformRuntime.fallbackSmsPurchases.set(purchaseId, {
            ...pendingRecord,
            status: 'failed',
            rejectionReason: initRes.error || 'Initialization failed',
          });
        }
        return res.status(400).json({ error: initRes.error || 'Paystack initialization failed.' });
      }

      return res.json({
        ok: true,
        reference: initRes.reference,
        authorizationUrl: initRes.authorizationUrl,
        accessCode: initRes.accessCode,
        purchase: pendingRecord,
        quote,
      });
    } catch (err) {
      return res.status(500).json({ error: err instanceof Error ? err.message : 'Paystack initialization failed.' });
    }
  });

  app.get('/api/studio/sms/paystack/verify/:reference', requireSupabaseAuth, requireRole('creator', 'organizer'), async (req: AuthedRequest, res) => {
    if (!isPaystackConfigured()) {
      return res.status(503).json({ error: 'PAYSTACK_SECRET_KEY is not configured on the server.' });
    }
    const reference = (req.params.reference || '').trim();
    if (!reference) {
      return res.status(400).json({ error: 'Payment reference is required.' });
    }

    try {
      const client = req.supabase!;
      const adminClient = createServiceSupabaseClient() ?? client;

      let purchase: SmsBundlePurchase | null = null;
      let storedInDb = false;

      const { data: row, error: rowErr } = await adminClient
        .from('sms_bundle_purchases')
        .select('*')
        .eq('reference', reference)
        .maybeSingle();

      if (!rowErr && row) {
        purchase = mapSmsPurchaseRow(row as Record<string, unknown>);
        storedInDb = true;
      } else if (!rowErr || isMissingTableError(rowErr)) {
        for (const item of platformRuntime.fallbackSmsPurchases.values()) {
          if (item.reference.toLowerCase() === reference.toLowerCase()) {
            purchase = item;
            break;
          }
        }
      } else {
        return res.status(400).json({ error: rowErr.message });
      }

      if (!purchase) {
        return res.status(404).json({ error: `Purchase record for reference "${reference}" not found.` });
      }
      if (purchase.organizerId !== req.user!.id && req.appRole !== 'creator') {
        return res.status(403).json({ error: 'Forbidden: payment reference belongs to another organizer.' });
      }

      if (purchase.status === 'credited') {
        const { data: prof } = await adminClient
          .from('profiles')
          .select('*')
          .eq('id', purchase.organizerId)
          .single();
        const runtimeCap = platformRuntime.planAttendeeCapacityOverrides.get(purchase.organizerId);
        const mappedProfile = mapProfileRow(
          prof as Record<string, unknown>,
          req.user!.email || '',
          runtimeCap !== undefined ? runtimeCap : req.user?.app_metadata?.plan_attendee_capacity
        );
        const senderInfo = platformRuntime.getEffectiveArkeselSenderId(mappedProfile.senderId);
        const bal = await fetchArkeselGatewayBalance();
        return res.json({
          ok: true,
          alreadyCredited: true,
          profile: mappedProfile,
          purchase,
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
            organizerCredits: mappedProfile.smsCredits,
            apiInfoUrl: 'https://sms.arkesel.com/user/sms-api/info',
            rechargeUrl: 'https://sms.arkesel.com',
            checkedAt: new Date().toISOString(),
          },
          message: `Payment ${reference} was already verified and credited (+${purchase.credits.toLocaleString()} SMS).`,
        });
      }

      const verify = await verifyPaystackTransaction(reference);
      if (!verify.ok) {
        return res.status(400).json({ error: verify.error || 'Paystack verification failed.' });
      }
      if (!verify.paid) {
        if (verify.gatewayStatus === 'failed' || verify.gatewayStatus === 'abandoned') {
          if (storedInDb) {
            await adminClient
              .from('sms_bundle_purchases')
              .update({ status: 'failed', rejection_reason: `Gateway status: ${verify.gatewayStatus}` })
              .eq('id', purchase.id);
          } else {
            platformRuntime.fallbackSmsPurchases.set(purchase.id, {
              ...purchase,
              status: 'failed',
              rejectionReason: `Gateway status: ${verify.gatewayStatus}`,
            });
          }
        }
        return res.status(402).json({
          error: `Payment ${reference} has status "${verify.gatewayStatus}" on Paystack and has not settled.`,
        });
      }

      if (verify.currency !== 'GHS') {
        return res.status(400).json({ error: `Expected GHS currency from Paystack, got ${verify.currency}.` });
      }
      const expectedPesewas = Math.round(purchase.amountGhs * 100);
      if (verify.amountPesewas < expectedPesewas) {
        return res.status(400).json({
          error: `Underpayment detected: paid GH₵ ${(verify.amountPesewas / 100).toFixed(2)}, expected GH₵ ${purchase.amountGhs.toFixed(2)}.`,
        });
      }
      const metaUserId = verify.metadata?.userId ? String(verify.metadata.userId) : undefined;
      if (metaUserId && metaUserId !== purchase.organizerId) {
        return res.status(403).json({ error: 'Paystack transaction metadata does not match this organizer.' });
      }

      const completed = await atomicCreditSupabasePurchase(
        adminClient,
        purchase.id,
        verify.channel ? `Paystack (${verify.channel})` : 'Paystack Checkout'
      );

      const { data: updatedProf } = await adminClient
        .from('profiles')
        .select('*')
        .eq('id', purchase.organizerId)
        .single();
      const runtimeCap = platformRuntime.planAttendeeCapacityOverrides.get(purchase.organizerId);
      const mappedProfile = mapProfileRow(
        updatedProf as Record<string, unknown>,
        req.user!.email || '',
        runtimeCap !== undefined ? runtimeCap : req.user?.app_metadata?.plan_attendee_capacity
      );
      const senderInfo = platformRuntime.getEffectiveArkeselSenderId(mappedProfile.senderId);
      const bal = await fetchArkeselGatewayBalance();

      return res.json({
        ok: true,
        alreadyCredited: completed.alreadyCredited,
        profile: mappedProfile,
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
          organizerCredits: mappedProfile.smsCredits,
          apiInfoUrl: 'https://sms.arkesel.com/user/sms-api/info',
          rechargeUrl: 'https://sms.arkesel.com',
          checkedAt: new Date().toISOString(),
        },
        message: `Paystack payment verified (${reference}). +${completed.purchase.credits.toLocaleString()} SMS credits added to your workspace.`,
      });
    } catch (err) {
      return res.status(500).json({ error: err instanceof Error ? err.message : 'Paystack verification failed.' });
    }
  });

  app.post('/api/studio/sms/purchase-bundle', requireSupabaseAuth, requireRole('creator', 'organizer'), async (req: AuthedRequest, res) => {
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

      // Replay check against both Supabase ledger and fallback ledger
      const { data: dupRow, error: dupErr } = await adminClient
        .from('sms_bundle_purchases')
        .select('id')
        .ilike('reference', cleanRef)
        .maybeSingle();

      if (!dupErr && dupRow) {
        return res.status(409).json({
          error: `Transaction reference "${cleanRef}" has already been submitted. Duplicate redemptions are blocked.`,
        });
      }
      for (const fallbackItem of platformRuntime.fallbackSmsPurchases.values()) {
        if (fallbackItem.reference.trim().toLowerCase() === cleanRef.toLowerCase()) {
          return res.status(409).json({
            error: `Transaction reference "${cleanRef}" has already been submitted. Duplicate redemptions are blocked.`,
          });
        }
      }

      const isSandbox = platformRuntime.flags.smsMode === 'sandbox';
      const nowIso = new Date().toISOString();
      const channel = (paymentChannel || 'Arkesel Portal Wallet').trim().slice(0, 64);
      const purchaseId = `smsp-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
      const profRec = prof as Record<string, unknown>;

      let purchaseRecord: SmsBundlePurchase = {
        id: purchaseId,
        organizerId: req.user!.id,
        organizerName: String(profRec.name || ''),
        organizerEmail: String(profRec.email || req.user!.email || ''),
        bundleId: quote.bundleId,
        bundleName: quote.bundleName,
        credits: quote.credits,
        amountGhs: quote.amountGhs,
        paymentChannel: channel,
        provider: isSandbox ? 'sandbox' : 'arkesel_manual',
        reference: cleanRef,
        status: isSandbox ? 'credited' : 'pending_verification',
        createdAt: nowIso,
        verifiedAt: isSandbox ? nowIso : undefined,
      };

      const { error: insErr } = await adminClient.from('sms_bundle_purchases').insert({
        id: purchaseRecord.id,
        organizer_id: purchaseRecord.organizerId,
        bundle_id: purchaseRecord.bundleId,
        bundle_name: purchaseRecord.bundleName,
        credits: purchaseRecord.credits,
        amount_ghs: purchaseRecord.amountGhs,
        payment_channel: purchaseRecord.paymentChannel,
        provider: purchaseRecord.provider,
        reference: purchaseRecord.reference,
        status: isSandbox ? 'pending_verification' : 'pending_verification',
        created_at: purchaseRecord.createdAt,
      });

      if (insErr) {
        if (insErr.code === '23505') {
          return res.status(409).json({
            error: `Transaction reference "${cleanRef}" has already been submitted. Duplicate redemptions are blocked.`,
          });
        }
        if (isMissingTableError(insErr)) {
          platformRuntime.fallbackSmsPurchases.set(purchaseRecord.id, {
            ...purchaseRecord,
            status: 'pending_verification',
            verifiedAt: undefined,
          });
        } else {
          return res.status(400).json({ error: insErr.message });
        }
      }

      let addedCredits = 0;
      let latestCredits = Number(profRec.sms_credits ?? 0);

      if (isSandbox) {
        const credited = await atomicCreditSupabasePurchase(adminClient, purchaseRecord.id, channel);
        purchaseRecord = credited.purchase;
        addedCredits = credited.alreadyCredited ? 0 : quote.credits;
        latestCredits = credited.smsCredits;
      }

      const { data: latestProf } = await adminClient
        .from('profiles')
        .select('*')
        .eq('id', req.user!.id)
        .single();
      const runtimeCap = platformRuntime.planAttendeeCapacityOverrides.get(req.user!.id);
      const mappedProfile = mapProfileRow(
        (latestProf ?? prof) as Record<string, unknown>,
        req.user!.email || '',
        runtimeCap !== undefined ? runtimeCap : req.user?.app_metadata?.plan_attendee_capacity
      );
      mappedProfile.smsCredits = latestCredits;

      const senderInfo = platformRuntime.getEffectiveArkeselSenderId(mappedProfile.senderId);
      const bal = await fetchArkeselGatewayBalance();
      const pendingVerification = !isSandbox;

      return res.status(pendingVerification ? 202 : 200).json({
        ok: true,
        profile: mappedProfile,
        purchase: purchaseRecord,
        bundleId: quote.bundleId,
        bundleName: quote.bundleName,
        addedCredits,
        amountGhs: quote.amountGhs,
        paymentChannel: channel,
        arkeselReference: cleanRef,
        pendingVerification,
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
          organizerCredits: latestCredits,
          apiInfoUrl: 'https://sms.arkesel.com/user/sms-api/info',
          rechargeUrl: 'https://sms.arkesel.com',
          checkedAt: new Date().toISOString(),
        },
        message: pendingVerification
          ? `Receipt ${cleanRef} for ${quote.bundleName} (GH₵ ${quote.amountGhs.toFixed(2)}) is queued for payment verification before +${quote.credits.toLocaleString()} SMS are credited.`
          : `Sandbox Mode: +${quote.credits.toLocaleString()} SMS credits allocated for ${quote.bundleName} (Ref: ${cleanRef}).`,
      });
    } catch (err) {
      return res.status(500).json({ error: err instanceof Error ? err.message : 'SMS bundle purchase failed.' });
    }
  });

  app.get('/api/studio/subscription/payments', requireSupabaseAuth, requireRole('creator', 'organizer'), async (req: AuthedRequest, res) => {
    try {
      const client = req.supabase!;
      const adminClient = createServiceSupabaseClient() ?? client;
      const { data: rows, error } = await adminClient
        .from('subscription_payments')
        .select('*')
        .eq('organizer_id', req.user!.id)
        .order('created_at', { ascending: false })
        .limit(30);

      let payments: SubscriptionPayment[] = [];
      if (!error && Array.isArray(rows)) {
        payments = rows.map((r) => mapSubscriptionPaymentRow(r as Record<string, unknown>));
      } else if (error && !isMissingTableError(error)) {
        return res.status(400).json({ error: error.message });
      }

      const runtimeFallback = Array.from(platformRuntime.fallbackSubscriptionPayments.values())
        .filter((p) => p.organizerId === req.user!.id)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

      const merged = payments.length > 0 ? payments : runtimeFallback;
      return res.json({
        payments: merged,
        paystackConfigured: isPaystackConfigured(),
        mode: platformRuntime.flags.smsMode,
      });
    } catch (err) {
      return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to load subscription payments.' });
    }
  });

  app.post('/api/studio/subscription/paystack/initialize', requireSupabaseAuth, requireRole('creator', 'organizer'), async (req: AuthedRequest, res) => {
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

    try {
      const client = req.supabase!;
      const adminClient = createServiceSupabaseClient() ?? client;
      const { data: prof } = await adminClient
        .from('profiles')
        .select('name, email')
        .eq('id', req.user!.id)
        .maybeSingle();

      const email = String(
        (prof as Record<string, unknown> | null)?.email || req.user!.email || ''
      ).trim();
      if (!email || !email.includes('@')) {
        return res.status(400).json({
          error: 'Add a valid email address in Account Settings before starting Paystack card/MoMo checkout.',
        });
      }

      const reference = `EBY-SUB-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
      const paymentId = `subp-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
      const originHeader =
        (typeof req.headers.origin === 'string' && /^https?:\/\//i.test(req.headers.origin)
          ? req.headers.origin
          : (process.env.APP_URL || '').trim().replace(/\/+$/, '')) || 'http://localhost:3000';
      let safeCallback = `${originHeader}/?sub_ref=${encodeURIComponent(reference)}`;
      if (typeof callbackUrl === 'string' && /^https?:\/\//i.test(callbackUrl)) {
        try {
          const parsedCb = new URL(callbackUrl);
          const parsedOrigin = new URL(originHeader);
          const reqHost = typeof req.headers.host === 'string' ? req.headers.host.toLowerCase() : '';
          if (
            parsedCb.origin === parsedOrigin.origin ||
            (reqHost && parsedCb.host.toLowerCase() === reqHost)
          ) {
            safeCallback = parsedCb.toString();
          }
        } catch {
          // Fall back to default same-origin callback URL
        }
      }

      const nowIso = new Date().toISOString();
      const pendingRecord: SubscriptionPayment = {
        id: paymentId,
        organizerId: req.user!.id,
        organizerName: String((prof as Record<string, unknown> | null)?.name || ''),
        organizerEmail: email,
        planId: quote.planId,
        planName: quote.planName,
        billingCycle: quote.billingCycle,
        amountUsd: quote.amountUsd,
        amountGhs: quote.amountGhs,
        paymentChannel: 'Paystack Checkout',
        provider: 'paystack',
        reference,
        status: 'pending_payment',
        createdAt: nowIso,
      };

      let storedInDb = false;
      const { error: insErr } = await adminClient.from('subscription_payments').insert({
        id: pendingRecord.id,
        organizer_id: pendingRecord.organizerId,
        plan_id: pendingRecord.planId,
        plan_name: pendingRecord.planName,
        billing_cycle: pendingRecord.billingCycle,
        amount_usd: pendingRecord.amountUsd,
        amount_ghs: pendingRecord.amountGhs,
        payment_channel: pendingRecord.paymentChannel,
        provider: pendingRecord.provider,
        reference: pendingRecord.reference,
        status: pendingRecord.status,
        created_at: pendingRecord.createdAt,
      });
      if (!insErr) {
        storedInDb = true;
      } else if (isMissingTableError(insErr)) {
        platformRuntime.fallbackSubscriptionPayments.set(pendingRecord.id, pendingRecord);
      } else {
        return res.status(400).json({ error: insErr.message });
      }

      const initRes = await initializePaystackTransaction({
        email,
        amountGhs: quote.amountGhs,
        reference,
        callbackUrl: safeCallback,
        metadata: {
          type: 'subscription',
          userId: req.user!.id,
          paymentId,
          planId: quote.planId,
          planName: quote.planName,
          billingCycle: quote.billingCycle,
        },
      });

      if (!initRes.ok || !initRes.authorizationUrl) {
        if (storedInDb) {
          await adminClient
            .from('subscription_payments')
            .update({ status: 'failed', rejection_reason: initRes.error || 'Initialization failed' })
            .eq('id', paymentId);
        } else {
          platformRuntime.fallbackSubscriptionPayments.set(paymentId, {
            ...pendingRecord,
            status: 'failed',
            rejectionReason: initRes.error || 'Initialization failed',
          });
        }
        return res.status(400).json({ error: initRes.error || 'Paystack initialization failed.' });
      }

      return res.json({
        ok: true,
        reference: initRes.reference,
        authorizationUrl: initRes.authorizationUrl,
        accessCode: initRes.accessCode,
        payment: pendingRecord,
        quote,
      });
    } catch (err) {
      return res.status(500).json({ error: err instanceof Error ? err.message : 'Paystack subscription initialization failed.' });
    }
  });

  app.get('/api/studio/subscription/paystack/verify/:reference', requireSupabaseAuth, requireRole('creator', 'organizer'), async (req: AuthedRequest, res) => {
    if (!isPaystackConfigured()) {
      return res.status(503).json({ error: 'PAYSTACK_SECRET_KEY is not configured on the server.' });
    }
    const reference = (req.params.reference || '').trim();
    if (!reference) {
      return res.status(400).json({ error: 'Payment reference is required.' });
    }

    try {
      const client = req.supabase!;
      const adminClient = createServiceSupabaseClient() ?? client;

      let existing: SubscriptionPayment | null = null;
      let storedInDb = false;

      const { data: row, error: rowErr } = await adminClient
        .from('subscription_payments')
        .select('*')
        .eq('reference', reference)
        .maybeSingle();

      if (!rowErr && row) {
        existing = mapSubscriptionPaymentRow(row as Record<string, unknown>);
        storedInDb = true;
      } else if (!rowErr || isMissingTableError(rowErr)) {
        for (const item of platformRuntime.fallbackSubscriptionPayments.values()) {
          if (item.reference.toLowerCase() === reference.toLowerCase()) {
            existing = item;
            break;
          }
        }
      } else {
        return res.status(400).json({ error: rowErr.message });
      }

      if (!existing) {
        return res.status(404).json({ error: `Subscription payment record for "${reference}" not found.` });
      }
      if (existing.organizerId !== req.user!.id && req.appRole !== 'creator') {
        return res.status(403).json({ error: 'Forbidden: payment reference belongs to another organizer.' });
      }

      if (existing.status === 'active') {
        const { data: prof } = await adminClient
          .from('profiles')
          .select('*')
          .eq('id', existing.organizerId)
          .single();
        const profEmail = String(
          (prof as Record<string, unknown> | null)?.email ||
            existing.organizerEmail ||
            req.user!.email ||
            ''
        );
        const runtimeCap = platformRuntime.planAttendeeCapacityOverrides.get(existing.organizerId);
        return res.json({
          ok: true,
          alreadyActivated: true,
          profile: mapProfileRow(
            prof as Record<string, unknown>,
            profEmail,
            runtimeCap !== undefined ? runtimeCap : req.user?.app_metadata?.plan_attendee_capacity
          ),
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
          if (storedInDb) {
            await adminClient
              .from('subscription_payments')
              .update({ status: 'failed', rejection_reason: `Gateway status: ${verify.gatewayStatus}` })
              .eq('id', existing.id);
          } else {
            platformRuntime.fallbackSubscriptionPayments.set(existing.id, {
              ...existing,
              status: 'failed',
              rejectionReason: `Gateway status: ${verify.gatewayStatus}`,
            });
          }
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

      const completed = await atomicActivateSupabaseSubscription(
        adminClient,
        existing.id,
        verify.channel ? `Paystack (${verify.channel})` : 'Paystack Checkout'
      );

      const { data: updatedProf } = await adminClient
        .from('profiles')
        .select('*')
        .eq('id', existing.organizerId)
        .single();
      const updatedEmail = String(
        (updatedProf as Record<string, unknown> | null)?.email ||
          existing.organizerEmail ||
          req.user!.email ||
          ''
      );
      const mappedProfile = mapProfileRow(
        updatedProf as Record<string, unknown>,
        updatedEmail
      );

      return res.json({
        ok: true,
        alreadyActivated: completed.alreadyActivated,
        profile: mappedProfile,
        payment: completed.payment,
        message: `Paystack verified (${reference}). ${completed.payment.planName} (${completed.payment.billingCycle}) is now active.`,
      });
    } catch (err) {
      return res.status(500).json({ error: err instanceof Error ? err.message : 'Paystack verification failed.' });
    }
  });

  app.post('/api/studio/subscription/purchase', requireSupabaseAuth, requireRole('creator', 'organizer'), async (req: AuthedRequest, res) => {
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
    const cleanRef = refCheck.normalized;

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

      const { data: dupRow, error: dupErr } = await adminClient
        .from('subscription_payments')
        .select('id')
        .ilike('reference', cleanRef)
        .maybeSingle();

      if (!dupErr && dupRow) {
        return res.status(409).json({
          error: `Payment reference "${cleanRef}" has already been submitted. Duplicate redemptions are blocked.`,
        });
      }
      for (const fallbackItem of platformRuntime.fallbackSubscriptionPayments.values()) {
        if (fallbackItem.reference.trim().toLowerCase() === cleanRef.toLowerCase()) {
          return res.status(409).json({
            error: `Payment reference "${cleanRef}" has already been submitted. Duplicate redemptions are blocked.`,
          });
        }
      }

      const isSandbox = platformRuntime.flags.smsMode === 'sandbox';
      const nowIso = new Date().toISOString();
      const channel = (paymentChannel || 'Mobile Money / Bank Transfer').trim().slice(0, 64);
      const paymentId = `subp-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
      const profRec = prof as Record<string, unknown>;

      let paymentRecord: SubscriptionPayment = {
        id: paymentId,
        organizerId: req.user!.id,
        organizerName: String(profRec.name || ''),
        organizerEmail: String(profRec.email || req.user!.email || ''),
        planId: quote.planId,
        planName: quote.planName,
        billingCycle: quote.billingCycle,
        amountUsd: quote.amountUsd,
        amountGhs: quote.amountGhs,
        paymentChannel: channel,
        provider: isSandbox ? 'sandbox' : 'manual',
        reference: cleanRef,
        status: 'pending_verification',
        createdAt: nowIso,
      };

      const { error: insErr } = await adminClient.from('subscription_payments').insert({
        id: paymentRecord.id,
        organizer_id: paymentRecord.organizerId,
        plan_id: paymentRecord.planId,
        plan_name: paymentRecord.planName,
        billing_cycle: paymentRecord.billingCycle,
        amount_usd: paymentRecord.amountUsd,
        amount_ghs: paymentRecord.amountGhs,
        payment_channel: paymentRecord.paymentChannel,
        provider: paymentRecord.provider,
        reference: paymentRecord.reference,
        status: 'pending_verification',
        created_at: paymentRecord.createdAt,
      });

      if (insErr) {
        if (insErr.code === '23505') {
          return res.status(409).json({
            error: `Payment reference "${cleanRef}" has already been submitted. Duplicate redemptions are blocked.`,
          });
        }
        if (isMissingTableError(insErr)) {
          platformRuntime.fallbackSubscriptionPayments.set(paymentRecord.id, paymentRecord);
        } else {
          return res.status(400).json({ error: insErr.message });
        }
      }

      if (isSandbox) {
        const activatedRes = await atomicActivateSupabaseSubscription(adminClient, paymentRecord.id, channel);
        paymentRecord = activatedRes.payment;
      }

      const { data: latestProf } = await adminClient
        .from('profiles')
        .select('*')
        .eq('id', req.user!.id)
        .single();
      const runtimeCap = platformRuntime.planAttendeeCapacityOverrides.get(req.user!.id);
      const mappedProfile = mapProfileRow(
        (latestProf ?? prof) as Record<string, unknown>,
        req.user!.email || '',
        runtimeCap !== undefined ? runtimeCap : req.user?.app_metadata?.plan_attendee_capacity
      );
      const pendingVerification = !isSandbox;

      return res.status(pendingVerification ? 202 : 200).json({
        ok: true,
        profile: mappedProfile,
        payment: paymentRecord,
        activated: isSandbox,
        pendingVerification,
        message: pendingVerification
          ? `Payment reference ${cleanRef} for ${quote.planName} (GH₵ ${quote.amountGhs.toFixed(2)}) is queued for administrator verification before activation.`
          : `Sandbox Mode: ${quote.planName} (${quote.billingCycle}) activated immediately (Ref: ${cleanRef}).`,
      });
    } catch (err) {
      return res.status(500).json({ error: err instanceof Error ? err.message : 'Subscription purchase failed.' });
    }
  });

  app.post('/api/studio/subscription/downgrade', requireSupabaseAuth, requireRole('creator', 'organizer'), async (req: AuthedRequest, res) => {
    try {
      const client = req.supabase!;
      const adminClient = createServiceSupabaseClient() ?? client;
      const nowIso = new Date().toISOString();
      let { error } = await adminClient
        .from('profiles')
        .update({
          plan: 'Starter',
          plan_billing_cycle: 'monthly',
          plan_expires_at: null,
          plan_attendee_capacity: null,
          sender_id: DEFAULT_SHARED_SENDER_ID,
          updated_at: nowIso,
        })
        .eq('id', req.user!.id);

      if (
        error &&
        (error.message?.includes('plan_billing_cycle') ||
          error.message?.includes('plan_expires_at') ||
          error.message?.includes('plan_attendee_capacity') ||
          error.message?.includes('schema cache'))
      ) {
        const retry = await adminClient
          .from('profiles')
          .update({
            plan: 'Starter',
            sender_id: DEFAULT_SHARED_SENDER_ID,
            updated_at: nowIso,
          })
          .eq('id', req.user!.id);
        error = retry.error;
      }
      if (error) {
        return res.status(400).json({ error: error.message });
      }
      platformRuntime.planAttendeeCapacityOverrides.set(req.user!.id, null);
      await syncAuthAppMetadataPlanCapacity(adminClient, req.user!.id, null);

      const { data: latestProf } = await adminClient
        .from('profiles')
        .select('*')
        .eq('id', req.user!.id)
        .single();
      const mappedProfile = mapProfileRow(latestProf as Record<string, unknown>, req.user!.email || '');
      return res.json({
        ok: true,
        profile: mappedProfile,
        message: 'Workspace downgraded to Starter (Free). Existing events remain intact; Starter quotas now apply.',
      });
    } catch (err) {
      return res.status(500).json({ error: err instanceof Error ? err.message : 'Downgrade failed.' });
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
      const ownerEntProfile = await resolveOwnerEntitlementProfile(
        adminOrUserClient,
        req.user!.id,
        req.user
      );
      const ent = getPlanEntitlements(ownerEntProfile);
      if (ent.maxActiveEvents != null && isActiveEventStatus(event.status)) {
        const { count: activeCount } = await client
          .from('events')
          .select('id', { count: 'exact', head: true })
          .eq('organizer_id', req.user!.id)
          .in('status', ['live', 'upcoming']);
        if ((activeCount ?? 0) >= ent.maxActiveEvents) {
          return res.status(403).json({
            error: `Starter plan allows at most ${ent.maxActiveEvents} active (live or upcoming) event. Save as draft or upgrade to Pro Organizer for unlimited concurrent events.`,
          });
        }
      }
      if (ent.maxAttendeesPerEvent != null && Number(event.capacity || 0) > ent.maxAttendeesPerEvent) {
        return res.status(403).json({
          error: `${ent.plan} plan limits event capacity to ${ent.maxAttendeesPerEvent.toLocaleString()} attendees per event. Upgrade or request a creator capacity boost for higher venue capacities.`,
        });
      }
      const enforcedCapacity = getEffectiveEventCapacity(event.capacity, ownerEntProfile);

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

      const cleanStartIso = sanitizeIsoDate(event.isoDate) ?? getTodayIsoDate();
      const rawEndIso = sanitizeIsoDate(event.endIsoDate ?? event.extraDataConfig?.endIsoDate);
      const cleanEndIso = rawEndIso && rawEndIso > cleanStartIso ? rawEndIso : undefined;
      const cleanPolicy = sanitizeCheckInPolicy(
        event.checkInPolicy ?? event.extraDataConfig?.checkInPolicy
      );
      const dateContext = { isoDate: cleanStartIso, endIsoDate: cleanEndIso };
      const formattedDate = cleanEndIso
        ? formatEventDateSpan(cleanStartIso, cleanEndIso, event.date)
        : event.date;

      const starterPlanning = sanitizeEventPlanningConfig(
        event.extraDataConfig?.planningConfig ??
          createStarterPlanningConfig(
            event.category || 'Events',
            event.organizer || 'Organiser',
            event.venue || 'Main Venue',
            dateContext
          ),
        event.category || 'Events',
        dateContext
      );

      const eventRow: Record<string, unknown> = {
        id: uniqueEventId,
        organizer_id: req.user!.id,
        slug: uniqueSlug,
        title: event.title,
        subtitle: event.subtitle,
        category: event.category,
        status: event.status,
        date: formattedDate,
        iso_date: cleanStartIso,
        time: event.time,
        venue: event.venue,
        city: event.city,
        capacity: enforcedCapacity,
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
        planning_config: starterPlanning,
        extra_data_config: withEmbeddedMessageConfig(
          {
            ...(event.extraDataConfig ?? { enableGiftTable: false, customFields: [] }),
            planningConfig: starterPlanning,
            ...(cleanEndIso ? { endIsoDate: cleanEndIso } : {}),
            ...(cleanPolicy ? { checkInPolicy: cleanPolicy } : {}),
          },
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
        const { message_config: _mc, planning_config: _pc, ...withoutNewCols } = eventRow;
        const retryWithExtra = await client.from('events').insert(withoutNewCols).select('*').single();
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

      await syncEventPlanningRow(client, uniqueEventId, req.user!.id, starterPlanning);

      let createdBlocks: ScheduleBlock[] = [];
      if (blocks && blocks.length > 0) {
        const metaMap: Record<string, { date?: string; day?: string }> = {};
        const blockRows = blocks.map((b, idx) => {
          const id = `sch-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}-${idx}`;
          const resolvedDate =
            sanitizeIsoDate(b.date) ??
            resolveScheduleBlockDate({ day: b.day, date: b.date }, dateContext);
          const resolvedDay = resolvedDate
            ? getScheduleBlockDayFromIso(resolvedDate, dateContext, normalizeScheduleDay(b.day, 'Sat'))
            : normalizeScheduleDay(b.day, 'Sat');
          if (resolvedDate || resolvedDay) {
            metaMap[id] = { ...(resolvedDate ? { date: resolvedDate } : {}), day: resolvedDay };
          }
          return {
            id,
            event_id: uniqueEventId,
            time: b.time,
            duration: b.duration,
            title: b.title,
            stage: b.stage,
            lead: b.lead,
            completed: b.completed,
            day: resolvedDay,
            ...(resolvedDate ? { date: resolvedDate } : {}),
          };
        });
        let { data: insertedBlocks, error: schErr } = await client
          .from('schedule_blocks')
          .insert(blockRows)
          .select('*');
        if (schErr && (isMissingColumnError(schErr) || isScheduleDayCheckError(schErr))) {
          const legacyBlockRows = blockRows.map(({ date: blkDate, ...rest }) => ({
            ...rest,
            day: toLegacyScheduleDay(rest.day as ScheduleBlock['day'], blkDate),
          }));
          const retryBlocks = await client
            .from('schedule_blocks')
            .insert(legacyBlockRows)
            .select('*');
          insertedBlocks = retryBlocks.data;
          schErr = retryBlocks.error;
        }
        if (schErr) return res.status(400).json({ error: schErr.message });
        await mergeEventScheduleDatesMeta(adminOrUserClient, uniqueEventId, metaMap);
        createdBlocks = (insertedBlocks ?? []).map((r) => {
          const rec = r as Record<string, unknown>;
          return mapScheduleRow(rec, metaMap[String(rec.id)]);
        });
      }

      return res.status(201).json({
        event: mapEventRow(createdEvt as Record<string, unknown>, starterPlanning),
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
      const adminOrUserClient = createServiceSupabaseClient() ?? req.supabase!;
      const ownerEntProfile = await resolveOwnerEntitlementProfile(
        adminOrUserClient,
        req.user!.id,
        req.user
      );
      const ent = getPlanEntitlements(ownerEntProfile);
      if (
        ent.maxAttendeesPerEvent != null &&
        updated.capacity !== undefined &&
        Number(updated.capacity) > ent.maxAttendeesPerEvent
      ) {
        return res.status(403).json({
          error: `${ent.plan} plan limits event capacity to ${ent.maxAttendeesPerEvent.toLocaleString()} attendees per event. Upgrade or request a creator capacity boost to raise venue capacity.`,
        });
      }

      const { data: existingEvtRow } = await req
        .supabase!.from('events')
        .select('iso_date, date, extra_data_config, planning_config, category, capacity')
        .eq('id', req.params.id)
        .eq('organizer_id', req.user!.id)
        .maybeSingle();

      const existingRec = existingEvtRow as Record<string, unknown> | null;
      const existingExtraObj =
        existingRec?.extra_data_config && typeof existingRec.extra_data_config === 'object'
          ? (existingRec.extra_data_config as Record<string, unknown>)
          : {};

      const cleanStartIso =
        sanitizeIsoDate(updated.isoDate) ??
        sanitizeIsoDate(existingRec?.iso_date as string | undefined) ??
        getTodayIsoDate();
      const hasExplicitEndDate =
        'endIsoDate' in updated ||
        Boolean(updated.extraDataConfig && 'endIsoDate' in updated.extraDataConfig);
      const rawEndIso = hasExplicitEndDate
        ? sanitizeIsoDate(updated.endIsoDate ?? updated.extraDataConfig?.endIsoDate)
        : sanitizeIsoDate(existingExtraObj.endIsoDate as string | undefined);
      const cleanEndIso = rawEndIso && rawEndIso > cleanStartIso ? rawEndIso : undefined;
      const dateContext = { isoDate: cleanStartIso, endIsoDate: cleanEndIso };

      const incomingPlanning = updated.extraDataConfig?.planningConfig
        ? sanitizeEventPlanningConfig(
            updated.extraDataConfig.planningConfig,
            updated.category || String(existingRec?.category || 'Events'),
            dateContext
          )
        : existingRec?.planning_config || existingExtraObj.planningConfig
          ? sanitizeEventPlanningConfig(
              existingRec?.planning_config ?? existingExtraObj.planningConfig,
              updated.category || String(existingRec?.category || 'Events'),
              dateContext
            )
          : undefined;

      const hasExplicitPolicy =
        'checkInPolicy' in updated ||
        Boolean(updated.extraDataConfig && 'checkInPolicy' in updated.extraDataConfig);
      const cleanPolicy = hasExplicitPolicy
        ? sanitizeCheckInPolicy(updated.checkInPolicy ?? updated.extraDataConfig?.checkInPolicy)
        : sanitizeCheckInPolicy(existingExtraObj.checkInPolicy);

      const embeddedExtra =
        withEmbeddedMessageConfig(
          incomingPlanning && updated.extraDataConfig
            ? { ...updated.extraDataConfig, planningConfig: incomingPlanning }
            : updated.extraDataConfig,
          updated.messageConfig,
          updated.brandColor,
          existingRec?.extra_data_config
        ) ?? {};
      if (incomingPlanning) {
        embeddedExtra.planningConfig = incomingPlanning;
      }
      if (cleanEndIso) {
        embeddedExtra.endIsoDate = cleanEndIso;
      } else if (hasExplicitEndDate) {
        delete embeddedExtra.endIsoDate;
      }
      if (cleanPolicy) {
        embeddedExtra.checkInPolicy = cleanPolicy;
      } else if (hasExplicitPolicy) {
        delete embeddedExtra.checkInPolicy;
      }

      const formattedDate = cleanEndIso
        ? formatEventDateSpan(cleanStartIso, cleanEndIso, updated.date || String(existingRec?.date || ''))
        : updated.date;

      const updatePayload: Record<string, unknown> = {
        slug: updated.slug,
        title: updated.title,
        subtitle: updated.subtitle,
        category: updated.category,
        status: updated.status,
        date: formattedDate,
        iso_date: cleanStartIso,
        time: updated.time,
        venue: updated.venue,
        city: updated.city,
        capacity: getEffectiveEventCapacity(
          updated.capacity ?? Number(existingRec?.capacity ?? 50),
          ownerEntProfile
        ),
        ticket_price: updated.ticketPrice,
        organizer: updated.organizer,
        artwork: updated.artwork,
        design_theme: updated.designTheme ?? null,
        broadcast_error: updated.broadcastError ?? null,
        flyer_url: updated.flyerUrl ?? null,
        venue_format: updated.venueFormat ?? 'in-person',
        sender_id: updated.senderId ?? null,
        validation_config: updated.validationConfig ?? null,
        ...(incomingPlanning ? { planning_config: incomingPlanning } : {}),
        extra_data_config: embeddedExtra,
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
        const { message_config: _mc, planning_config: _pc, ...withoutNewCols } = updatePayload;
        const retryWithExtra = await req
          .supabase!.from('events')
          .update(withoutNewCols)
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

      if (incomingPlanning) {
        await syncEventPlanningRow(req.supabase!, req.params.id, req.user!.id, incomingPlanning);
      }

      return res.json({
        event: mapEventRow(data as Record<string, unknown>, incomingPlanning),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update event.';
      return res.status(500).json({ error: message });
    }
  });

  app.get(
    '/api/studio/events/:eventId/planning',
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

        const { data: planRow, error: planErr } = await client
          .from('event_planning_configs')
          .select('*')
          .eq('event_id', req.params.eventId)
          .maybeSingle();
        if (planErr && !isMissingTableError(planErr)) {
          return res.status(400).json({ error: planErr.message });
        }

        const rec = evtRow as Record<string, unknown>;
        const mappedBase = mapEventRow(rec);
        const override =
          !planErr && planRow
            ? mapPlanningRow(
                planRow as Record<string, unknown>,
                String(rec.category ?? 'Events'),
                { isoDate: mappedBase.isoDate, endIsoDate: mappedBase.endIsoDate }
              )
            : undefined;
        const mappedEvent = override ? mapEventRow(rec, override) : mappedBase;
        return res.json({
          planningConfig: mappedEvent.extraDataConfig?.planningConfig ?? null,
          event: mappedEvent,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to load event planning config.';
        return res.status(500).json({ error: message });
      }
    }
  );

  app.put(
    '/api/studio/events/:eventId/planning',
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

        const rec = evtRow as Record<string, unknown>;
        const mappedExisting = mapEventRow(rec);
        const sanitizedPlanning = sanitizeEventPlanningConfig(
          req.body,
          String(rec.category ?? 'Events'),
          { isoDate: mappedExisting.isoDate, endIsoDate: mappedExisting.endIsoDate }
        );
        const existingExtra =
          rec.extra_data_config && typeof rec.extra_data_config === 'object'
            ? (rec.extra_data_config as Record<string, unknown>)
            : { enableGiftTable: false, customFields: [] };
        const nextExtra: Record<string, unknown> = {
          ...existingExtra,
          planningConfig: sanitizedPlanning,
        };

        let { data: updatedEvt, error: updErr } = await client
          .from('events')
          .update({
            planning_config: sanitizedPlanning,
            extra_data_config: nextExtra,
          })
          .eq('id', req.params.eventId)
          .eq('organizer_id', req.user!.id)
          .select('*')
          .single();

        if (updErr && isMissingColumnError(updErr)) {
          const retry = await client
            .from('events')
            .update({ extra_data_config: nextExtra })
            .eq('id', req.params.eventId)
            .eq('organizer_id', req.user!.id)
            .select('*')
            .single();
          updatedEvt = retry.data;
          updErr = retry.error;
        }
        if (updErr) {
          return res.status(400).json({ error: updErr.message });
        }

        await syncEventPlanningRow(client, req.params.eventId, req.user!.id, sanitizedPlanning);

        return res.json({
          planningConfig: sanitizedPlanning,
          event: mapEventRow(updatedEvt as Record<string, unknown>, sanitizedPlanning),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to save planning configuration.';
        return res.status(500).json({ error: message });
      }
    }
  );

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
    requireRole('creator', 'organizer'),
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

  // Studio Corporate Event Polls CRUD
  app.post(
    '/api/studio/events/:eventId/polls',
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
        const body = (req.body || {}) as {
          question?: string;
          description?: string;
          sessionLabel?: string;
          options?: unknown[];
          status?: EventPollStatus;
          allowMultiple?: boolean;
          showResultsToPublic?: boolean;
          requireVerifiedPass?: boolean;
        };
        const question = (body.question || '').trim();
        if (!question) {
          return res.status(400).json({ error: 'Poll question is required.' });
        }
        const options = buildValidatedPollOptions(Array.isArray(body.options) ? body.options : []);
        if (options.length < 2) {
          return res.status(400).json({ error: 'Provide at least two distinct answer choices.' });
        }
        const status = normalizePollStatus(body.status, 'active');
        const evtMapped = mapEventRow(evtRow as Record<string, unknown>);
        const newPoll: EventPoll = {
          id: `poll-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`,
          eventId: evtMapped.id,
          question: question.slice(0, 220),
          description: body.description?.trim().slice(0, 320) || undefined,
          sessionLabel: body.sessionLabel?.trim().slice(0, 80) || undefined,
          options,
          status,
          allowMultiple: Boolean(body.allowMultiple),
          showResultsToPublic: body.showResultsToPublic !== false,
          requireVerifiedPass: Boolean(body.requireVerifiedPass),
          totalVotes: 0,
          voterKeys: [],
          createdAt: new Date().toISOString(),
          closedAt: status === 'closed' ? new Date().toISOString() : undefined,
        };
        const rawExtra =
          (evtRow as Record<string, unknown>).extra_data_config &&
          typeof (evtRow as Record<string, unknown>).extra_data_config === 'object'
            ? ((evtRow as Record<string, unknown>).extra_data_config as Record<string, unknown>)
            : ({ ...(evtMapped.extraDataConfig ?? { enableGiftTable: false, customFields: [] }) } as Record<string, unknown>);
        const currentPolls = Array.isArray(rawExtra.polls) ? (rawExtra.polls as EventPoll[]) : [];
        const nextExtra = {
          ...rawExtra,
          enablePolls: true,
          polls: [newPoll, ...currentPolls],
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
          poll: newPoll,
          event: mapEventRow(updatedRow as Record<string, unknown>),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to create event poll.';
        return res.status(500).json({ error: message });
      }
    }
  );

  app.patch(
    '/api/studio/events/:eventId/polls/:pollId',
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
            : ({ ...(evtMapped.extraDataConfig ?? { enableGiftTable: false, customFields: [] }) } as Record<string, unknown>);
        const currentPolls = Array.isArray(rawExtra.polls) ? (rawExtra.polls as EventPoll[]) : [];
        const target = currentPolls.find((p) => p.id === req.params.pollId);
        if (!target) {
          return res.status(404).json({ error: 'Poll not found.' });
        }
        const patch = (req.body || {}) as {
          question?: string;
          description?: string;
          sessionLabel?: string;
          status?: EventPollStatus;
          allowMultiple?: boolean;
          showResultsToPublic?: boolean;
          requireVerifiedPass?: boolean;
        };
        const nextStatus =
          patch.status !== undefined ? normalizePollStatus(patch.status, target.status) : target.status;
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
        const nextExtra = {
          ...rawExtra,
          enablePolls: true,
          polls: currentPolls.map((p) => (p.id === target.id ? updatedPoll : p)),
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
          poll: updatedPoll,
          event: mapEventRow(updatedRow as Record<string, unknown>),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to update event poll.';
        return res.status(500).json({ error: message });
      }
    }
  );

  app.delete(
    '/api/studio/events/:eventId/polls/:pollId',
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
            : ({ ...(evtMapped.extraDataConfig ?? { enableGiftTable: false, customFields: [] }) } as Record<string, unknown>);
        const currentPolls = Array.isArray(rawExtra.polls) ? (rawExtra.polls as EventPoll[]) : [];
        const nextExtra = {
          ...rawExtra,
          polls: currentPolls.filter((p) => p.id !== req.params.pollId),
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
        const message = err instanceof Error ? err.message : 'Failed to delete event poll.';
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

      const cleanAttEmail = (attendee.email || '').trim();
      if (cleanAttEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanAttEmail)) {
        return res.status(400).json({ error: 'Please enter a valid email address or leave it blank.' });
      }
      const normalizedPhone = normalizePhoneE164(attendee.phone);
      const evtMapped = mapEventRow(evtCheckRec);
      const ownerEntProfile = await resolveOwnerEntitlementProfile(
        createServiceSupabaseClient() ?? client,
        req.user!.id,
        req.user
      );
      const effectiveCap = getEffectiveEventCapacity(evtMapped.capacity, ownerEntProfile);
      if (evtMapped.registered >= effectiveCap) {
        return res.status(409).json({
          error: `${evtMapped.title} has reached its attendee capacity (${effectiveCap.toLocaleString()} seats). Upgrade plan or increase venue capacity to add more attendees.`,
        });
      }
      let normalizedStudioValidationGroup: string | null = null;
      if (typeof attendee.validationGroup === 'string' && attendee.validationGroup.trim()) {
        const trimmedGroup = attendee.validationGroup.trim().slice(0, 120);
        const allowedOptions = evtMapped.validationConfig?.options ?? [];
        const matchedOpt = allowedOptions.find(
          (opt) => opt.trim().toLowerCase() === trimmedGroup.toLowerCase()
        );
        normalizedStudioValidationGroup = matchedOpt ? matchedOpt.trim() : trimmedGroup;
      }
      let replyTo: string | undefined;
      let orgSenderId: string | undefined;
      const { data: orgProf } = await client
        .from('profiles')
        .select('reply_to_email, sender_id, sms_credits')
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

      const smsCost = Math.max(1, calculateSmsCredits(studioResolvedMsg.text));
      let smsCreditsUsed = 0;
      let smsCreditsRemaining = Number(orgProfRec?.sms_credits ?? 0);
      let smsSkippedReason: string | undefined;
      let debitReserved = false;

      if (normalizedPhone) {
        const debit = await consumeSupabaseSmsCredits(client, req.user!.id, smsCost);
        debitReserved = debit.ok;
        smsCreditsRemaining = debit.remaining;
        if (!debitReserved) {
          smsSkippedReason = `Insufficient SMS credits (${smsCreditsRemaining} remaining, ${smsCost} needed). Purchase an SMS bundle to deliver pass SMS.`;
        }
      }

      const studioScheduleItems =
        isResendConfigured() && attendee.email?.includes('@')
          ? await fetchSortedEventScheduleItems(client, evtMapped, (evt as Record<string, unknown>).extra_data_config)
          : [];

      const [smsDelivery, emailDelivery] = await Promise.all([
        debitReserved && normalizedPhone
          ? dispatchOptionalArkeselSms(
              normalizedPhone,
              evtMapped.title,
              attendee.ticketCode,
              evtMapped.senderId || orgSenderId,
              studioResolvedMsg.text
            )
          : Promise.resolve('Pending' as const),
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
                eventUrl: studioResolvedMsg.eventUrl,
                scheduleBlocks: studioScheduleItems,
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
                eventUrl: studioResolvedMsg.eventUrl,
                scheduleBlocks: studioScheduleItems,
              })
          : Promise.resolve({ ok: false, skipped: true }),
      ]);

      const hasLiveArkesel = Boolean((process.env.ARKESEL_API_KEY || '').trim()) && platformRuntime.flags.smsMode !== 'sandbox';
      if (debitReserved && smsDelivery === 'Pending' && hasLiveArkesel) {
        smsCreditsRemaining = await refundSupabaseSmsCredits(client, req.user!.id, smsCost);
        smsCreditsUsed = 0;
      } else if (debitReserved && smsDelivery === 'Arkesel Sent') {
        smsCreditsUsed = smsCost;
      }

      const resolvedSmsStatus: Attendee['smsStatus'] =
        smsCreditsUsed > 0
          ? 'Arkesel Sent'
          : emailDelivery.ok && (!hasLiveArkesel || smsDelivery === 'Pending')
            ? 'Resend Delivered'
            : 'Pending';

      const attInsertPayload: Record<string, unknown> = {
        id: attendee.id,
        event_id: eventId,
        name: attendee.name,
        email: cleanAttEmail,
        phone: normalizedPhone,
        organization: attendee.organization || 'General Guest',
        tier: attendee.tier || 'General',
        checked_in: Boolean(attendee.checkedIn),
        checked_in_at: attendee.checkedInAt ?? null,
        ticket_code: attendee.ticketCode,
        sms_status: resolvedSmsStatus,
        payment_status: attendee.paymentStatus || 'paid',
        validation_group: normalizedStudioValidationGroup,
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
        if (smsCreditsUsed > 0) {
          smsCreditsRemaining = await refundSupabaseSmsCredits(client, req.user!.id, smsCreditsUsed);
          smsCreditsUsed = 0;
        }
        if (attErr.code === '23505') {
          return res.status(409).json({
            error: `Duplicate shield: ${normalizedPhone} is already registered for this event.`,
          });
        }
        return res.status(400).json({ error: attErr.message });
      }

      const insertedId = String((inserted as Record<string, unknown>).id);
      const initialCheckedInDates = attendee.checkedIn
        ? sanitizeCheckedInDates(attendee.checkedInDates) ?? [getTodayIsoDate()]
        : [];
      if (usedLegacyAttendeeFallback || initialCheckedInDates.length > 0) {
        const adminOrClient = createServiceSupabaseClient() ?? client;
        await mergeEventAttendeeMeta(adminOrClient, eventId, insertedId, {
          ...(usedLegacyAttendeeFallback
            ? {
                validationGroup: attendee.validationGroup,
                inviteCodeUsed: attendee.inviteCodeUsed,
                giftEntry: attendee.giftEntry,
                customResponses: attendee.customResponses,
              }
            : {}),
          ...(initialCheckedInDates.length > 0 ? { checkedInDates: initialCheckedInDates } : {}),
        });
      }

      const evtRec = evt as Record<string, unknown>;
      const { data: updatedEvt, error: evtUpdErr } = await client
        .from('events')
        .update({
          registered: Number(evtRec.registered ?? 0) + 1,
          sms_dispatched: Number(evtRec.sms_dispatched ?? 0) + (smsCreditsUsed > 0 ? 1 : 0),
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
      if (initialCheckedInDates.length > 0) {
        mappedAtt.checkedInDates = initialCheckedInDates;
      }

      return res.status(201).json({
        attendee: mappedAtt,
        event: mapEventRow(updatedEvt as Record<string, unknown>),
        cameraUrl: studioResolvedMsg.cameraUrl,
        dispatchedMessage: studioResolvedMsg.text,
        smsCredits: smsCreditsRemaining,
        smsCreditsUsed,
        smsSkippedReason,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to register attendee.';
      return res.status(500).json({ error: message });
    }
  });

  app.patch('/api/studio/attendees/:id/checkin', requireSupabaseAuth, requireRole('creator', 'organizer'), async (req: AuthedRequest, res) => {
    try {
      const client = req.supabase!;
      const reqBody = (req.body || {}) as { mode?: 'toggle' | 'checkin' | 'undo'; dateIso?: string };
      const mode = reqBody.mode === 'checkin' || reqBody.mode === 'undo' ? reqBody.mode : 'toggle';
      const targetDateIso = sanitizeIsoDate(reqBody.dateIso) ?? getTodayIsoDate();

      const { data: existing, error: fetchErr } = await client
        .from('attendees')
        .select('*')
        .eq('id', req.params.id)
        .single();
      if (fetchErr || !existing) {
        return res.status(404).json({ error: 'Attendee not found.' });
      }
      const rec = existing as Record<string, unknown>;
      const eventId = String(rec.event_id);

      const { data: evtRow } = await client
        .from('events')
        .select('*')
        .eq('id', eventId)
        .single();
      if (!evtRow || String((evtRow as Record<string, unknown>).organizer_id) !== req.user!.id) {
        return res.status(403).json({ error: 'Unauthorized to modify check-ins for this event.' });
      }

      const evtMapped = mapEventRow(evtRow as Record<string, unknown>);
      const policy = getEventCheckInPolicy(evtMapped);
      const prevAttMetaMap = extractEventAttendeeMetaMap((evtRow as Record<string, unknown>).extra_data_config);
      const existingDates =
        sanitizeCheckedInDates(
          (rec.checked_in_dates as unknown) ?? prevAttMetaMap?.[req.params.id]?.checkedInDates
        ) ?? [];
      const wasCheckedIn = Boolean(rec.checked_in);
      const nowTime = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

      let nextDates: string[] = [];
      let nextCheckedIn = false;
      let checkedInAt: string | null = null;
      let addedDay = false;

      if (policy === 'daily-reentry') {
        nextDates = [...existingDates];
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
        nextCheckedIn = nextDates.length > 0;
        addedDay = nextDates.includes(targetDateIso) && !existingDates.includes(targetDateIso);
        checkedInAt = nextCheckedIn
          ? addedDay
            ? nowTime
            : typeof rec.checked_in_at === 'string' && rec.checked_in_at
              ? rec.checked_in_at
              : nowTime
          : null;
      } else {
        nextCheckedIn = mode === 'checkin' ? true : mode === 'undo' ? false : !wasCheckedIn;
        addedDay = !wasCheckedIn && nextCheckedIn;
        nextDates = nextCheckedIn ? [targetDateIso] : [];
        checkedInAt = nextCheckedIn ? nowTime : null;
      }

      const addedFirstTime = !wasCheckedIn && nextCheckedIn;

      const { data: updatedAtt, error: updErr } = await client
        .from('attendees')
        .update({ checked_in: nextCheckedIn, checked_in_at: checkedInAt })
        .eq('id', req.params.id)
        .select('*')
        .single();
      if (updErr) return res.status(400).json({ error: updErr.message });

      const adminOrClient = createServiceSupabaseClient() ?? client;
      await mergeEventAttendeeMeta(adminOrClient, eventId, req.params.id, {
        checkedInDates: nextDates,
      });

      if (!wasCheckedIn && nextCheckedIn) {
        const currentChecked = Number((evtRow as Record<string, unknown>).checked_in ?? 0);
        await client.from('events').update({ checked_in: currentChecked + 1 }).eq('id', eventId);
      } else if (wasCheckedIn && !nextCheckedIn) {
        const currentChecked = Number((evtRow as Record<string, unknown>).checked_in ?? 0);
        await client.from('events').update({ checked_in: Math.max(0, currentChecked - 1) }).eq('id', eventId);
      }

      const mappedAttendee = hydrateAttendeeWithEventMeta(
        mapAttendeeRow(updatedAtt as Record<string, unknown>),
        {
          ...prevAttMetaMap,
          [req.params.id]: {
            ...(prevAttMetaMap?.[req.params.id] ?? {}),
            checkedInDates: nextDates,
          },
        }
      );
      mappedAttendee.checkedInDates = nextDates;

      let checkInMessageSent = false;
      let checkInSmsSent = false;
      let cameraUrl: string | undefined;
      let dispatchedMessage: string | undefined;
      let smsCredits: number | undefined;
      let smsCreditsUsed = 0;
      let smsSkippedReason: string | undefined;

      if (addedDay) {
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

        if (addedFirstTime) {
          const orgId = String((evtRow as Record<string, unknown>).organizer_id || req.user!.id);
          let replyTo: string | undefined;
          let orgSenderId: string | undefined;
          const { data: orgProf } = await adminOrClient
            .from('profiles')
            .select('reply_to_email, sender_id, sms_credits')
            .eq('id', orgId)
            .maybeSingle();
          const orgProfRec = orgProf as Record<string, unknown> | null;
          if (orgProfRec && typeof orgProfRec.reply_to_email === 'string') {
            replyTo = orgProfRec.reply_to_email;
          }
          if (orgProfRec && typeof orgProfRec.sender_id === 'string' && orgProfRec.sender_id.trim()) {
            orgSenderId = orgProfRec.sender_id.trim();
          }
          smsCredits = Number(orgProfRec?.sms_credits ?? 0);

          const smsCost = Math.max(1, calculateSmsCredits(resolved.text));
          let debitReserved = false;
          if (mappedAttendee.phone) {
            const debit = await consumeSupabaseSmsCredits(client, orgId, smsCost);
            debitReserved = debit.ok;
            smsCredits = debit.remaining;
            if (!debitReserved) {
              smsSkippedReason = `No SMS credits remaining (${smsCredits} left, ${smsCost} needed). Purchase an SMS bundle for check-in SMS.`;
            }
          }

          const checkInScheduleItems =
            isResendConfigured() && mappedAttendee.email?.includes('@')
              ? await fetchSortedEventScheduleItems(adminOrClient, evtMapped, (evtRow as Record<string, unknown>).extra_data_config)
              : [];

          const [smsRes, emailRes] = await Promise.all([
            debitReserved && mappedAttendee.phone
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
                  eventUrl: resolved.eventUrl,
                  scheduleBlocks: checkInScheduleItems,
                  replyTo,
                })
              : Promise.resolve({ ok: false, skipped: true }),
          ]);

          const hasLiveArkesel = Boolean((process.env.ARKESEL_API_KEY || '').trim()) && platformRuntime.flags.smsMode !== 'sandbox';
          if (debitReserved && smsRes === 'Pending' && hasLiveArkesel) {
            smsCredits = await refundSupabaseSmsCredits(client, orgId, smsCost);
          } else if (debitReserved && smsRes === 'Arkesel Sent') {
            smsCreditsUsed = smsCost;
            checkInSmsSent = true;
            const prevDispatched = Number((evtRow as Record<string, unknown>).sms_dispatched ?? 0);
            await adminOrClient
              .from('events')
              .update({ sms_dispatched: prevDispatched + 1 })
              .eq('id', eventId);
          }
          checkInMessageSent = checkInSmsSent || Boolean(emailRes.ok);
        }
      }

      return res.json({
        attendee: mappedAttendee,
        checkInMessageSent,
        checkInSmsSent,
        cameraUrl,
        dispatchedMessage,
        smsCredits,
        smsCreditsUsed,
        smsSkippedReason,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to toggle check-in.';
      return res.status(500).json({ error: message });
    }
  });

  app.delete(
    '/api/studio/attendees/:id',
    requireSupabaseAuth,
    requireRole('creator', 'organizer'),
    async (req: AuthedRequest, res) => {
      try {
        const client = req.supabase!;
        const { data: existing, error: fetchErr } = await client
          .from('attendees')
          .select('*')
          .eq('id', req.params.id)
          .maybeSingle();
        if (fetchErr || !existing) {
          return res.status(404).json({ error: 'Attendee not found.' });
        }

        const attRec = existing as Record<string, unknown>;
        const eventId = String(attRec.event_id);
        const { data: evtRow, error: evtErr } = await client
          .from('events')
          .select('*')
          .eq('id', eventId)
          .maybeSingle();
        if (evtErr || !evtRow) {
          return res.status(404).json({ error: 'Parent event not found.' });
        }
        const evtRec = evtRow as Record<string, unknown>;
        if (String(evtRec.organizer_id) !== req.user!.id) {
          return res.status(403).json({
            error: 'Only the event creator can delete attendees from this event.',
          });
        }

        const { error: delErr } = await client
          .from('attendees')
          .delete()
          .eq('id', req.params.id)
          .eq('event_id', eventId);
        if (delErr) {
          return res.status(400).json({ error: delErr.message });
        }

        const wasCheckedIn = Boolean(attRec.checked_in);
        const wasPaid = attRec.payment_status === 'paid';
        const ticketPrice = Number(evtRec.ticket_price ?? 0);
        const nextRegistered = Math.max(0, Number(evtRec.registered ?? 0) - 1);
        const nextCheckedIn = wasCheckedIn
          ? Math.max(0, Number(evtRec.checked_in ?? 0) - 1)
          : Math.max(0, Number(evtRec.checked_in ?? 0));
        const nextRevenue = wasPaid
          ? Math.max(0, Number(evtRec.revenue ?? 0) - ticketPrice)
          : Math.max(0, Number(evtRec.revenue ?? 0));

        const updateFields: Record<string, unknown> = {
          registered: nextRegistered,
          checked_in: nextCheckedIn,
          revenue: nextRevenue,
        };

        if (
          evtRec.extra_data_config &&
          typeof evtRec.extra_data_config === 'object'
        ) {
          const extraObj = { ...(evtRec.extra_data_config as Record<string, unknown>) };
          if (
            extraObj.__attendeeMeta &&
            typeof extraObj.__attendeeMeta === 'object' &&
            req.params.id in (extraObj.__attendeeMeta as Record<string, unknown>)
          ) {
            const nextMeta = { ...(extraObj.__attendeeMeta as Record<string, unknown>) };
            delete nextMeta[req.params.id];
            extraObj.__attendeeMeta = nextMeta;
            updateFields.extra_data_config = extraObj;
          }
        }

        const { data: updatedEvt } = await client
          .from('events')
          .update(updateFields)
          .eq('id', eventId)
          .eq('organizer_id', req.user!.id)
          .select('*')
          .maybeSingle();

        return res.json({
          ok: true,
          deletedAttendeeId: req.params.id,
          event: mapEventRow((updatedEvt ?? { ...evtRec, ...updateFields }) as Record<string, unknown>),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to delete attendee.';
        return res.status(500).json({ error: message });
      }
    }
  );

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
            client.from('profiles').select('reply_to_email, sender_id, sms_credits').eq('id', req.user!.id).maybeSingle(),
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

        const prepared = ownedAttendees.map((att) => {
          const rawEvt = eventById.get(att.eventId)!;
          const evtMapped = mapEventRow(rawEvt);
          const personalizedRaw = cleanMessage
            .replace(/\{name\}/gi, att.name)
            .replace(/\{event\}/gi, evtMapped.title)
            .replace(/\{ticket_code\}|\{code\}/gi, att.ticketCode);
          const personalizedText = appendPoweredByLine(personalizedRaw);
          const smsCost = att.phone ? calculateSmsCredits(personalizedText) : 0;
          const cameraUrl = `${resolveBaseUrl(req)}/e/${encodeURIComponent(evtMapped.slug || evtMapped.id)}/camera?pass=${encodeURIComponent(att.ticketCode)}&guest=${encodeURIComponent(att.name)}`;
          return { att, evtMapped, personalizedText, smsCost, cameraUrl };
        });

        const requiredSmsCredits = prepared.reduce((acc, item) => acc + item.smsCost, 0);
        let remainingCredits = Number(profRec?.sms_credits ?? 0);
        if (requiredSmsCredits > 0) {
          const debit = await consumeSupabaseSmsCredits(client, req.user!.id, requiredSmsCredits);
          remainingCredits = debit.remaining;
          if (!debit.ok) {
            return res.status(402).json({
              error: `Insufficient SMS bundle credits: you have ${remainingCredits.toLocaleString()} SMS remaining, but this broadcast requires ${requiredSmsCredits.toLocaleString()} SMS.`,
            });
          }
        }

        const countsByEvent = new Map<string, number>();
        let sentCount = 0;
        let failedSmsRefund = 0;

        await Promise.all(
          prepared.map(async ({ att, evtMapped, personalizedText, smsCost, cameraUrl }) => {
            const [smsRes, emailRes] = await Promise.all([
              att.phone && smsCost > 0
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

            if (att.phone && smsCost > 0) {
              if (smsRes === 'Arkesel Sent') {
                countsByEvent.set(att.eventId, (countsByEvent.get(att.eventId) ?? 0) + 1);
              } else {
                failedSmsRefund += smsCost;
              }
            }
            if (smsRes !== 'Pending' || emailRes.ok) {
              sentCount += 1;
            }
          })
        );

        if (failedSmsRefund > 0) {
          remainingCredits = await refundSupabaseSmsCredits(client, req.user!.id, failedSmsRefund);
        }
        const creditsUsed = Math.max(0, requiredSmsCredits - failedSmsRefund);

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
          creditsUsed,
          smsCredits: remainingCredits,
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
      const client = req.supabase!;
      const { data: evtCheck } = await client
        .from('events')
        .select('id, organizer_id, iso_date, extra_data_config')
        .eq('id', block.eventId)
        .maybeSingle();
      if (!evtCheck || String((evtCheck as Record<string, unknown>).organizer_id) !== req.user!.id) {
        return res.status(403).json({ error: 'Only the event organizer can add schedule blocks.' });
      }
      const evtMapped = mapEventRow(evtCheck as Record<string, unknown>);
      const resolvedDate =
        sanitizeIsoDate(block.date) ??
        resolveScheduleBlockDate({ day: block.day, date: block.date }, evtMapped);
      const resolvedDay = resolvedDate
        ? getScheduleBlockDayFromIso(resolvedDate, evtMapped, normalizeScheduleDay(block.day, 'Sat'))
        : normalizeScheduleDay(block.day, 'Sat');
      const insertRow: Record<string, unknown> = {
        id: block.id,
        event_id: block.eventId,
        time: block.time,
        duration: block.duration,
        title: block.title,
        stage: block.stage,
        lead: block.lead,
        completed: Boolean(block.completed),
        day: resolvedDay,
        ...(resolvedDate ? { date: resolvedDate } : {}),
      };

      let { data, error } = await client
        .from('schedule_blocks')
        .insert(insertRow)
        .select('*')
        .single();
      if (error && (isMissingColumnError(error) || isScheduleDayCheckError(error))) {
        const { date: _d, ...withoutDate } = insertRow;
        const retry = await client
          .from('schedule_blocks')
          .insert({
            ...withoutDate,
            day: toLegacyScheduleDay(resolvedDay, resolvedDate),
          })
          .select('*')
          .single();
        data = retry.data;
        error = retry.error;
      }
      if (error) return res.status(400).json({ error: error.message });

      const metaEntry = {
        ...(resolvedDate ? { date: resolvedDate } : {}),
        day: resolvedDay,
      };
      await mergeEventScheduleDatesMeta(client, block.eventId, {
        [String((data as Record<string, unknown>).id)]: metaEntry,
      });

      return res.status(201).json({
        block: mapScheduleRow(data as Record<string, unknown>, metaEntry),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to add schedule block.';
      return res.status(500).json({ error: message });
    }
  });

  app.patch('/api/studio/schedule/:id', requireSupabaseAuth, requireRole('creator', 'organizer'), async (req: AuthedRequest, res) => {
    try {
      const client = req.supabase!;
      const patch = (req.body || {}) as Partial<ScheduleBlock>;
      const { data: existing, error: fetchErr } = await client
        .from('schedule_blocks')
        .select('*')
        .eq('id', req.params.id)
        .single();
      if (fetchErr || !existing) {
        return res.status(404).json({ error: 'Schedule block not found.' });
      }
      const existingRec = existing as Record<string, unknown>;
      const eventId = String(existingRec.event_id);

      const { data: evtRow } = await client
        .from('events')
        .select('id, organizer_id, iso_date, extra_data_config')
        .eq('id', eventId)
        .maybeSingle();
      if (!evtRow || String((evtRow as Record<string, unknown>).organizer_id) !== req.user!.id) {
        return res.status(403).json({ error: 'Unauthorized to edit schedule blocks for this event.' });
      }

      const evtMapped = mapEventRow(evtRow as Record<string, unknown>);
      const existingMeta = extractEventScheduleDatesMap(
        (evtRow as Record<string, unknown>).extra_data_config
      )[req.params.id];
      const currentMapped = mapScheduleRow(existingRec, existingMeta);

      const explicitDateProvided = 'date' in patch;
      const cleanedExplicitDate = explicitDateProvided ? sanitizeIsoDate(patch.date) : currentMapped.date;
      let nextDay =
        patch.day !== undefined ? normalizeScheduleDay(patch.day, currentMapped.day) : currentMapped.day;
      let nextDate = cleanedExplicitDate;

      if (explicitDateProvided && cleanedExplicitDate) {
        nextDay =
          patch.day !== undefined
            ? normalizeScheduleDay(
                patch.day,
                getScheduleBlockDayFromIso(cleanedExplicitDate, evtMapped, currentMapped.day)
              )
            : getScheduleBlockDayFromIso(cleanedExplicitDate, evtMapped, currentMapped.day);
      } else if (patch.day !== undefined && !explicitDateProvided) {
        nextDate = resolveScheduleBlockDate({ day: nextDay, date: undefined }, evtMapped) ?? currentMapped.date;
      }

      const updPayload: Record<string, unknown> = {
        ...(typeof patch.time === 'string' && patch.time.trim() ? { time: patch.time.trim() } : {}),
        ...(typeof patch.duration === 'string' && patch.duration.trim()
          ? { duration: patch.duration.trim() }
          : {}),
        ...(typeof patch.title === 'string' && patch.title.trim() ? { title: patch.title.trim() } : {}),
        ...(typeof patch.stage === 'string' && patch.stage.trim() ? { stage: patch.stage.trim() } : {}),
        ...(typeof patch.lead === 'string' && patch.lead.trim() ? { lead: patch.lead.trim() } : {}),
        ...(typeof patch.completed === 'boolean' ? { completed: patch.completed } : {}),
        day: nextDay,
        date: nextDate ?? null,
      };

      let { data: updated, error: updErr } = await client
        .from('schedule_blocks')
        .update(updPayload)
        .eq('id', req.params.id)
        .select('*')
        .single();
      if (updErr && (isMissingColumnError(updErr) || isScheduleDayCheckError(updErr))) {
        const { date: _d, ...withoutDate } = updPayload;
        const retry = await client
          .from('schedule_blocks')
          .update({
            ...withoutDate,
            day: toLegacyScheduleDay(nextDay, nextDate),
          })
          .eq('id', req.params.id)
          .select('*')
          .single();
        updated = retry.data;
        updErr = retry.error;
      }
      if (updErr) return res.status(400).json({ error: updErr.message });

      const metaEntry = nextDate || nextDay ? { ...(nextDate ? { date: nextDate } : {}), day: nextDay } : null;
      await mergeEventScheduleDatesMeta(client, eventId, {
        [req.params.id]: metaEntry,
      });

      return res.json({
        block: mapScheduleRow(updated as Record<string, unknown>, metaEntry ?? undefined),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update schedule block.';
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

      const existingRec = existing as Record<string, unknown>;
      const nextCompleted = !Boolean(existingRec.completed);
      const { data: updated, error: updErr } = await client
        .from('schedule_blocks')
        .update({ completed: nextCompleted })
        .eq('id', req.params.id)
        .select('*')
        .single();
      if (updErr) return res.status(400).json({ error: updErr.message });

      const { data: evtRow } = await client
        .from('events')
        .select('extra_data_config')
        .eq('id', String(existingRec.event_id))
        .maybeSingle();
      const meta = extractEventScheduleDatesMap(
        (evtRow as Record<string, unknown> | null)?.extra_data_config
      )[req.params.id];
      return res.json({ block: mapScheduleRow(updated as Record<string, unknown>, meta) });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to toggle schedule block.';
      return res.status(500).json({ error: message });
    }
  });

  app.delete('/api/studio/schedule/:id', requireSupabaseAuth, requireRole('creator', 'organizer'), async (req: AuthedRequest, res) => {
    try {
      const client = req.supabase!;
      const { data: existing } = await client
        .from('schedule_blocks')
        .select('event_id')
        .eq('id', req.params.id)
        .maybeSingle();
      const { error } = await client
        .from('schedule_blocks')
        .delete()
        .eq('id', req.params.id);
      if (error) return res.status(400).json({ error: error.message });
      if (existing && (existing as Record<string, unknown>).event_id) {
        await mergeEventScheduleDatesMeta(
          client,
          String((existing as Record<string, unknown>).event_id),
          { [req.params.id]: null }
        );
      }
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
  app.post('/api/studio/camera/shots', requireSupabaseAuth, requireRole('creator', 'organizer'), async (req: AuthedRequest, res) => {
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

  app.patch('/api/studio/camera/shots/:id/like', requireSupabaseAuth, requireRole('creator', 'organizer'), async (req: AuthedRequest, res) => {
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
      const client = req.supabase!;
      const { data: existing, error: fetchErr } = await client
        .from('disposable_shots')
        .select('id, event_id')
        .eq('id', req.params.id)
        .maybeSingle();
      if (fetchErr || !existing) {
        return res.status(404).json({ error: 'Photo not found.' });
      }
      const eventId = String((existing as Record<string, unknown>).event_id || '');
      if (req.appRole !== 'creator') {
        const { data: evtRow, error: evtErr } = await client
          .from('events')
          .select('organizer_id')
          .eq('id', eventId)
          .maybeSingle();
        if (evtErr || !evtRow || String((evtRow as Record<string, unknown>).organizer_id || '') !== req.user!.id) {
          return res.status(403).json({ error: 'Unauthorized to delete shots for this event.' });
        }
      }

      const { error } = await client
        .from('disposable_shots')
        .delete()
        .eq('id', req.params.id);
      if (error) return res.status(400).json({ error: error.message });

      const adminOrClient = createServiceSupabaseClient() ?? client;
      if (eventId) {
        await removeEventShotShooter(adminOrClient, eventId, req.params.id);
      }
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
    const reqTarget = req.originalUrl || req.url || req.path || '';
    if (!reqTarget.startsWith('/api')) return next(err);
    platformRuntime.recordError(reqTarget, err);
    const errObj = err as { status?: number; statusCode?: number; message?: string } | null;
    const rawStatus = Number(errObj?.status ?? errObj?.statusCode ?? 500);
    const status = Number.isInteger(rawStatus) && rawStatus >= 400 && rawStatus <= 599 ? rawStatus : 500;
    const rawMsg =
      err instanceof Error
        ? err.message
        : typeof errObj?.message === 'string'
          ? errObj.message
          : '';
    const message = rawMsg.trim() || (status === 413 ? 'Uploaded payload is too large.' : 'Internal server error.');
    if (res.headersSent) return next(err);
    return res.status(status).json({ error: message });
  });

  // =========================================================================
  // VITE DEV MIDDLEWARE / PRODUCTION STATIC ASSETS WITH SSR OG INJECTION
  // =========================================================================

  const resolvePublicEventSubPath = (pathname: string): PublicEventSubPath => {
    if (/\/(?:checkin|walk-?in)\/?$/i.test(pathname)) return 'checkin';
    if (/\/(?:gifts|gift-desk)\/?$/i.test(pathname)) return 'gifts';
    if (/\/camera\/?$/i.test(pathname) || pathname.toLowerCase() === '/camera') return 'camera';
    return 'top';
  };

  const applySsrEventResponse = (
    res: Response,
    html: string,
    evt: EventItem | null,
    baseUrl: string,
    pathname: string
  ) => {
    if (!evt) {
      return res
        .status(404)
        .set({
          'Content-Type': 'text/html; charset=utf-8',
          'X-Robots-Tag': 'noindex, nofollow',
          'Cache-Control': 'no-store',
        })
        .send(injectNotFoundSsrHtml(html, baseUrl, pathname));
    }
    const subPath = resolvePublicEventSubPath(pathname);
    const indexable =
      isPublicIndexableEvent(evt as EventItem & { unlisted?: boolean; visibility?: string }) &&
      subPath !== 'camera';
    const withOg = injectEventMetaTags(html, evt, baseUrl, subPath);
    const headers: Record<string, string> = {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': indexable
        ? 'public, max-age=60, s-maxage=300, stale-while-revalidate=60'
        : 'private, no-store',
    };
    if (!indexable) {
      headers['X-Robots-Tag'] = 'noindex, nofollow';
    }
    return res.status(200).set(headers).send(withOg);
  };

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

    app.get(
      [
        '/e/:slug',
        '/e/:slug/checkin',
        '/e/:slug/walkin',
        '/e/:slug/walk-in',
        '/e/:slug/gifts',
        '/e/:slug/gift-desk',
        '/e/:slug/polls',
        '/e/:slug/camera',
        '/camera',
        '/',
      ],
      async (req, res, next) => {
        const isDirectEventRoute = req.path.startsWith('/e/');
        const slugOrId =
          req.params.slug ||
          (typeof req.query.event === 'string' ? req.query.event.trim() : '');
        if (!slugOrId && !isDirectEventRoute) return next();
        const evt = slugOrId ? await resolveEventForPublicOrOg(slugOrId) : null;
        if (!evt && !isDirectEventRoute) return next();
        try {
          const indexPath = path.resolve(__dirname, 'index.html');
          const rawHtml = fs.readFileSync(indexPath, 'utf-8');
          const transformed = await vite.transformIndexHtml(req.originalUrl, rawHtml);
          return applySsrEventResponse(res, transformed, evt, resolveBaseUrl(req), req.path);
        } catch (err) {
          next(err);
        }
      }
    );

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
    const resolvePrerenderedHtmlPath = (reqPath: string) => {
      const clean = reqPath.replace(/^\/+|\/+$/g, '');
      if (!clean) return resolveIndexHtmlPath();
      if (clean.includes('..') || clean.includes('.')) return null;
      const candidates = [
        path.join(distDir, `${clean}.html`),
        path.join(distDir, clean, 'index.html'),
        path.resolve(process.cwd(), 'dist', `${clean}.html`),
        path.resolve(process.cwd(), 'dist', clean, 'index.html'),
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
      app.use(
        express.static(distDir, {
          index: false,
          maxAge: '1h',
          setHeaders: (res, filePath) => {
            if (/(?:sw\.js|workbox-[^/]+\.js|manifest\.webmanifest)$/i.test(filePath)) {
              res.setHeader('Cache-Control', 'no-cache, must-revalidate');
            }
          },
        })
      );
    }
    app.get('*', async (req, res) => {
      const slugMatch = req.path.match(
        /^\/e\/([^/]+)(?:\/(?:checkin|walk-?in|gifts|gift-desk|polls|camera))?\/?$/i
      );
      const isDirectEventRoute = req.path.startsWith('/e/');
      const slugOrId =
        (slugMatch ? decodeURIComponent(slugMatch[1]) : '') ||
        (typeof req.query.event === 'string' ? req.query.event.trim() : '');

      // Serve prerendered static HTML page when available for marketing/legal routes
      if (!slugOrId && !isDirectEventRoute) {
        const prerenderPath = resolvePrerenderedHtmlPath(req.path);
        if (prerenderPath) {
          const ssgHtml = fs.readFileSync(prerenderPath, 'utf-8');
          return res
            .status(200)
            .set({
              'Content-Type': 'text/html; charset=utf-8',
              'Cache-Control': 'public, max-age=300, stale-while-revalidate=60',
            })
            .send(ssgHtml);
        }
      }

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

      if (slugOrId || isDirectEventRoute) {
        const evt = slugOrId ? await resolveEventForPublicOrOg(slugOrId) : null;
        return applySsrEventResponse(res, rawHtml, evt, resolveBaseUrl(req), req.path);
      }

      res.setHeader('Cache-Control', 'no-cache, must-revalidate');
      return res.status(200).set({ 'Content-Type': 'text/html; charset=utf-8' }).send(rawHtml);
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
        console.log(`Events By You server listening on http://0.0.0.0:${PORT} (${modeLabel})`);
      });
    })
    .catch((err) => {
      console.error('Failed to start Events By You server:', err);
      process.exit(1);
    });
}

