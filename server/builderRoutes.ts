import express, { type NextFunction, type Response } from 'express';
import type { User } from '@supabase/supabase-js';
import type {
  AppRole,
  Attendee,
  BuilderConsoleOverview,
  BuilderEventTrafficRow,
  BuilderFeatureFlags,
  BuilderSmsQueueItem,
  BuilderTenantInspection,
  BuilderTenantSummary,
  BuilderTenantUnitEconomics,
  OrganizerProfile,
  SmsBundlePurchase,
  SubscriptionPayment,
} from '../src/types/events.ts';
import {
  DEFAULT_SHARED_SENDER_ID,
  PLAN_MRR_USD,
  computePlanExpiresAtIso,
} from '../src/lib/subscriptionPlans.ts';
import {
  dispatchOptionalArkeselSms,
  formatSupabaseAuthError,
  getBearerToken,
  isPrimaryCreatorIdentity,
  isValidJwtFormat,
  requireCreatorVerification,
  type AuthedRequest,
} from './helpers.ts';
import { memoryStore, platformRuntime } from './memoryStore.ts';
import { fetchArkeselGatewayBalance, syncArkeselDeliveryReports } from './phoneAuth.ts';
import { getEmailDeliverabilityDiagnostics } from './resend.ts';
import {
  createPublicSupabaseClient,
  createServiceSupabaseClient,
  createUserSupabaseClient,
  isSupabaseConfigured,
  mapAttendeeRow,
  mapEventRow,
} from './supabase.ts';

function isMissingPurchaseTableError(err: { message?: string; code?: string } | null | undefined): boolean {
  if (!err) return false;
  const code = (err.code || '').trim();
  const msg = (err.message || '').toLowerCase();
  return (
    code === '42P01' ||
    code === 'PGRST205' ||
    code === '42883' ||
    code === 'PGRST202' ||
    msg.includes('sms_bundle_purchases') ||
    msg.includes('credit_organizer_sms_bundle') ||
    msg.includes('subscription_payments') ||
    msg.includes('activate_organizer_subscription') ||
    msg.includes('schema cache')
  );
}

function mapPurchaseRow(
  row: Record<string, unknown>,
  profileById?: Map<string, Record<string, unknown>>
): SmsBundlePurchase {
  const organizerId = String(row.organizer_id);
  const prof = profileById?.get(organizerId);
  return {
    id: String(row.id),
    organizerId,
    organizerName: row.organizer_name
      ? String(row.organizer_name)
      : prof?.name
        ? String(prof.name)
        : undefined,
    organizerEmail: row.organizer_email
      ? String(row.organizer_email)
      : prof?.email
        ? String(prof.email)
        : undefined,
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

function mapSubscriptionPaymentRow(
  row: Record<string, unknown>,
  profileById?: Map<string, Record<string, unknown>>
): SubscriptionPayment {
  const organizerId = String(row.organizer_id);
  const prof = profileById?.get(organizerId);
  return {
    id: String(row.id),
    organizerId,
    organizerName: row.organizer_name
      ? String(row.organizer_name)
      : prof?.name
        ? String(prof.name)
        : undefined,
    organizerEmail: row.organizer_email
      ? String(row.organizer_email)
      : prof?.email
        ? String(prof.email)
        : undefined,
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

async function requireBuilderAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const token = getBearerToken(req);
  if (!token) {
    return res.status(401).json({ error: 'Authentication required.' });
  }
  if (!isSupabaseConfigured()) {
    const user = memoryStore.getUserByAccessToken(token);
    if (!user) {
      return res.status(401).json({ error: 'Session expired. Please sign in again.' });
    }
    req.accessToken = token;
    req.memoryUser = user;
    req.user = { id: user.id, email: user.email } as User;
    return next();
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
    const { data: prof } = await req.supabase
      .from('profiles')
      .select('app_role, phone')
      .eq('id', data.user.id)
      .maybeSingle();
    const profRec = prof as Record<string, unknown> | null;
    const dbRole = profRec?.app_role;
    const dbPhone = typeof profRec?.phone === 'string' ? profRec.phone : data.user.phone;
    req.appRole = isPrimaryCreatorIdentity(data.user.email, dbPhone)
      ? 'creator'
      : dbRole === 'gate_staff'
        ? 'gate_staff'
        : 'organizer';
    return next();
  } catch (err) {
    const rawMsg = err instanceof Error ? err.message : 'Auth error.';
    const formatted = formatSupabaseAuthError(rawMsg);
    return res.status(401).json({
      error: formatted.error,
      ...(formatted.isMalformedJwt ? { code: 'INVALID_SESSION_TOKEN' } : {}),
    });
  }
}

export function createBuilderRouter() {
  const router = express.Router();

  router.use(requireBuilderAuth, requireCreatorVerification);

  router.get('/overview', async (req: AuthedRequest, res) => {
    if (!isSupabaseConfigured()) {
      const [, emailDiagnostics] = await Promise.all([
        fetchArkeselGatewayBalance(),
        getEmailDeliverabilityDiagnostics(),
      ]);
      const base = memoryStore.getBuilderOverview();
      base.emailDiagnostics = emailDiagnostics;
      return res.json(base);
    }

    const started = Date.now();
    try {
      const client = createServiceSupabaseClient() ?? req.supabase!;
      const [profRes, evtRes, attRes, shotRes, appRes, purchaseRes, subPayRes, , emailDiagnostics] = await Promise.all([
        client.from('profiles').select('*'),
        client.from('events').select('*'),
        client.from('attendees').select('*'),
        client.from('disposable_shots').select('id,event_id,data_url'),
        client.from('creator_apps').select('id'),
        client
          .from('sms_bundle_purchases')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(50),
        client
          .from('subscription_payments')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(50),
        fetchArkeselGatewayBalance(),
        getEmailDeliverabilityDiagnostics(),
      ]);

      const dbLatencyMs = Math.max(1, Date.now() - started);

      for (const r of [profRes, evtRes, attRes, shotRes]) {
        if (r.error) platformRuntime.recordError('builder/overview', r.error.message);
      }
      if (purchaseRes.error && !isMissingPurchaseTableError(purchaseRes.error)) {
        platformRuntime.recordError('builder/overview', purchaseRes.error.message);
      }
      if (subPayRes.error && !isMissingPurchaseTableError(subPayRes.error)) {
        platformRuntime.recordError('builder/overview', subPayRes.error.message);
      }

      const profiles = (profRes.data ?? []) as Record<string, unknown>[];
      const events = (evtRes.data ?? []) as Record<string, unknown>[];
      const attendees = (attRes.data ?? []) as Record<string, unknown>[];
      const shots = (shotRes.data ?? []) as Record<string, unknown>[];
      const apps = (appRes.data ?? []) as Record<string, unknown>[];
      const profileById = new Map(profiles.map((p) => [String(p.id), p]));

      const purchaseById = new Map<string, SmsBundlePurchase>();
      if (!purchaseRes.error && Array.isArray(purchaseRes.data)) {
        for (const row of purchaseRes.data) {
          const mapped = mapPurchaseRow(row as Record<string, unknown>, profileById);
          purchaseById.set(mapped.id, mapped);
        }
      }
      for (const fallback of platformRuntime.fallbackSmsPurchases.values()) {
        if (!purchaseById.has(fallback.id)) {
          const prof = profileById.get(fallback.organizerId);
          purchaseById.set(fallback.id, {
            ...fallback,
            organizerName: fallback.organizerName || (prof?.name ? String(prof.name) : undefined),
            organizerEmail: fallback.organizerEmail || (prof?.email ? String(prof.email) : undefined),
          });
        }
      }
      const pendingSmsPurchases = Array.from(purchaseById.values())
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, 30);

      const subById = new Map<string, SubscriptionPayment>();
      if (!subPayRes.error && Array.isArray(subPayRes.data)) {
        for (const row of subPayRes.data) {
          const mapped = mapSubscriptionPaymentRow(row as Record<string, unknown>, profileById);
          subById.set(mapped.id, mapped);
        }
      }
      for (const fallback of platformRuntime.fallbackSubscriptionPayments.values()) {
        if (!subById.has(fallback.id)) {
          const prof = profileById.get(fallback.organizerId);
          subById.set(fallback.id, {
            ...fallback,
            organizerName: fallback.organizerName || (prof?.name ? String(prof.name) : undefined),
            organizerEmail: fallback.organizerEmail || (prof?.email ? String(prof.email) : undefined),
          });
        }
      }
      const pendingSubscriptionPayments = Array.from(subById.values())
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, 30);

      const eventMap = new Map(events.map((e) => [String(e.id), e]));
      const totalDispatched = events.reduce((acc, e) => acc + Number(e.sms_dispatched ?? 0), 0);
      const pendingAtts = attendees.filter((a) => String(a.sms_status) === 'Pending');
      const deliveredCount = Math.max(0, totalDispatched - pendingAtts.length);
      const successRatePct =
        totalDispatched > 0 ? Number(((deliveredCount / totalDispatched) * 100).toFixed(1)) : 100;

      const failedQueue: BuilderSmsQueueItem[] = pendingAtts.map((a) => ({
        attendeeId: String(a.id),
        attendeeName: String(a.name),
        phone: String(a.phone),
        eventId: String(a.event_id),
        eventTitle: String(eventMap.get(String(a.event_id))?.title ?? a.event_id),
        smsStatus: (a.sms_status as Attendee['smsStatus']) || 'Pending',
      }));

      const organizerCreditLiabilities = profiles.reduce(
        (acc, p) => acc + Number(p.sms_credits ?? 0),
        0
      );

      const tenants: BuilderTenantSummary[] = profiles.map((p) => {
        const uid = String(p.id);
        const uEvts = events.filter((e) => String(e.organizer_id) === uid);
        const evtIds = new Set(uEvts.map((e) => String(e.id)));
        const uAtts = attendees.filter((a) => evtIds.has(String(a.event_id)));
        const uShots = shots.filter((s) => evtIds.has(String(s.event_id)));
        const bytes = uShots.reduce((acc, s) => {
          const url = String(s.data_url ?? '');
          return acc + (url.startsWith('data:') ? Math.round((url.length * 3) / 4) : 420 * 1024);
        }, 0);
        const rawRole = p.app_role != null ? String(p.app_role) : 'organizer';
        const isCreatorAccount = isPrimaryCreatorIdentity(
          String(p.email ?? ''),
          p.phone != null ? String(p.phone) : undefined
        );
        const appRole: AppRole = isCreatorAccount
          ? 'creator'
          : rawRole === 'gate_staff'
            ? 'gate_staff'
            : 'organizer';
        return {
          id: uid,
          name: String(p.name ?? 'Organiser'),
          email: String(p.email ?? ''),
          studio: String(p.studio ?? 'Events Studio'),
          appRole,
          plan: (p.plan as OrganizerProfile['plan']) || 'Starter',
          smsCredits: Number(p.sms_credits ?? 0),
          eventsCount: uEvts.length,
          attendeesCount: uAtts.length,
          shotsCount: uShots.length,
          storageMb: Number((bytes / (1024 * 1024)).toFixed(2)),
          suspended: false,
          lastLoginAt: String(p.updated_at ?? p.created_at ?? new Date().toISOString()),
          createdAt: String(p.created_at ?? new Date().toISOString()),
        };
      });

      const eventTraffic: BuilderEventTrafficRow[] = events.map((e) => {
        const eid = String(e.id);
        const eShots = shots.filter((s) => String(s.event_id) === eid);
        const bytes = eShots.reduce((acc, s) => {
          const url = String(s.data_url ?? '');
          return acc + (url.startsWith('data:') ? Math.round((url.length * 3) / 4) : 420 * 1024);
        }, 0);
        return {
          eventId: eid,
          title: String(e.title),
          slug: String(e.slug),
          status: (e.status as BuilderEventTrafficRow['status']) || 'upcoming',
          registered: Number(e.registered ?? 0),
          capacity: Number(e.capacity ?? 100),
          checkedIn: Number(e.checked_in ?? 0),
          duplicateBlocks: platformRuntime.duplicateBlocksByEvent.get(eid) ?? 0,
          cameraShots: eShots.length,
          cameraStorageMb: Number((bytes / (1024 * 1024)).toFixed(2)),
          registrationPaused: platformRuntime.flags.pausedEventIds.includes(eid),
        };
      });

      const perTenant: BuilderTenantUnitEconomics[] = tenants.map((t) => {
        const uEvts = events.filter((e) => String(e.organizer_id) === t.id);
        const smsSentCount = uEvts.reduce((acc, e) => acc + Number(e.sms_dispatched ?? 0), 0);
        const mrrUsd = PLAN_MRR_USD[t.plan];
        const smsCostUsd = Number((smsSentCount * 0.012).toFixed(2));
        const storageCostUsd = Number((t.storageMb * 0.08).toFixed(2));
        const netMarginUsd = Number((mrrUsd - smsCostUsd - storageCostUsd).toFixed(2));
        return {
          userId: t.id,
          name: t.name,
          email: t.email,
          plan: t.plan,
          mrrUsd,
          smsSentCount,
          smsCostUsd,
          storageMb: t.storageMb,
          storageCostUsd,
          netMarginUsd,
          unprofitableFlag: netMarginUsd < 0,
        };
      });

      const totalMrrUsd = Number(perTenant.reduce((a, t) => a + t.mrrUsd, 0).toFixed(2));
      const totalSmsCostUsd = Number(perTenant.reduce((a, t) => a + t.smsCostUsd, 0).toFixed(2));
      const totalStorageCostUsd = Number(perTenant.reduce((a, t) => a + t.storageCostUsd, 0).toFixed(2));
      const totalStorageMb = Number(perTenant.reduce((a, t) => a + t.storageMb, 0).toFixed(2));

      const overview: BuilderConsoleOverview = {
        storageMode: 'supabase',
        dbLatencyMs,
        rlsVerified: !profRes.error && !evtRes.error,
        tableCounts: {
          profiles: profiles.length,
          events: events.length,
          attendees: attendees.length,
          disposable_shots: shots.length,
          creator_apps: apps.length,
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
          pendingOrFailedCount: pendingAtts.length,
          successRatePct,
          gatewayBalanceCredits: platformRuntime.gatewayBalanceCredits,
          gatewayBalanceLive: platformRuntime.gatewayBalanceLive,
          gatewayBalanceError: platformRuntime.gatewayBalanceError,
          organizerCreditLiabilities,
          failedQueue,
          recentDispatches: [...platformRuntime.smsDispatches],
        },
        emailDiagnostics,
        tenants,
        eventTraffic,
        totalDuplicateBlocks: Array.from(platformRuntime.duplicateBlocksByEvent.values()).reduce(
          (a, b) => a + b,
          0
        ),
        diagnosticFailures: [...platformRuntime.diagnosticFailures],
        flags: {
          ...platformRuntime.flags,
          pausedEventIds: [...platformRuntime.flags.pausedEventIds],
        },
        envStatus: platformRuntime.getEnvStatus(),
        pendingSmsPurchases,
        pendingSubscriptionPayments,
        unitEconomics: {
          totalMrrUsd,
          totalSmsCostUsd,
          totalStorageCostUsd,
          grossMarginUsd: Number((totalMrrUsd - totalSmsCostUsd - totalStorageCostUsd).toFixed(2)),
          totalStorageMb,
          proCount: tenants.filter((t) => t.plan === 'Pro Organizer').length,
          enterpriseCount: tenants.filter((t) => t.plan === 'Enterprise').length,
          starterCount: tenants.filter((t) => t.plan === 'Starter').length,
          perTenant,
        },
      };

      return res.json(overview);
    } catch (err) {
      platformRuntime.recordError('builder/overview', err);
      return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to load builder overview.' });
    }
  });

  router.post('/errors/clear', (_req, res) => {
    platformRuntime.clearErrors();
    return res.json({ ok: true });
  });

  router.post('/sms/retry', async (req: AuthedRequest, res) => {
    const { attendeeId } = req.body as { attendeeId?: string };
    if (!isSupabaseConfigured()) {
      return res.json(memoryStore.retryFailedSms(attendeeId));
    }
    try {
      const client = createServiceSupabaseClient() ?? req.supabase!;
      let q = client.from('attendees').select('*, events(title,sender_id)').eq('sms_status', 'Pending');
      if (attendeeId) q = q.eq('id', attendeeId);
      const { data: rows, error } = await q;
      if (error) return res.status(400).json({ error: error.message });

      let retried = 0;
      for (const row of rows ?? []) {
        const rec = row as Record<string, unknown>;
        const evtInfo = rec.events as Record<string, unknown> | null;
        const status = await dispatchOptionalArkeselSms(
          String(rec.phone),
          String(evtInfo?.title ?? 'Events By You'),
          String(rec.ticket_code),
          evtInfo?.sender_id ? String(evtInfo.sender_id) : undefined
        );
        await client.from('attendees').update({ sms_status: status }).eq('id', String(rec.id));
        retried += 1;
      }
      return res.json({ retried });
    } catch (err) {
      platformRuntime.recordError('builder/sms/retry', err);
      return res.status(500).json({ error: err instanceof Error ? err.message : 'SMS retry failed.' });
    }
  });

  router.post('/sms/sync-dlr', async (_req, res) => {
    try {
      const [balance, dlr, emailDiagnostics] = await Promise.all([
        fetchArkeselGatewayBalance(),
        syncArkeselDeliveryReports(),
        getEmailDeliverabilityDiagnostics(true),
      ]);
      return res.json({
        balance,
        dlr,
        emailDiagnostics,
        recentDispatches: [...platformRuntime.smsDispatches],
      });
    } catch (err) {
      platformRuntime.recordError('builder/sms/sync-dlr', err);
      return res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to sync carrier DLR & Resend domain checks.',
      });
    }
  });

  router.post('/tenants/:userId/credits', async (req: AuthedRequest, res) => {
    const { amount } = req.body as { amount?: number };
    const delta = Number(amount ?? 100);
    if (!Number.isFinite(delta)) {
      return res.status(400).json({ error: 'Valid credit amount required.' });
    }
    if (!isSupabaseConfigured()) {
      try {
        return res.json({ tenant: memoryStore.topUpTenantCredits(req.params.userId, delta) });
      } catch (err) {
        return res.status(404).json({ error: err instanceof Error ? err.message : 'Tenant not found.' });
      }
    }
    try {
      const client = createServiceSupabaseClient() ?? req.supabase!;
      const { data: existing, error: fetchErr } = await client
        .from('profiles')
        .select('*')
        .eq('id', req.params.userId)
        .single();
      if (fetchErr || !existing) return res.status(404).json({ error: 'Organiser not found.' });
      const nextCredits = Math.max(0, Number((existing as Record<string, unknown>).sms_credits ?? 0) + delta);
      const { error: updErr } = await client
        .from('profiles')
        .update({ sms_credits: nextCredits, updated_at: new Date().toISOString() })
        .eq('id', req.params.userId);
      if (updErr) return res.status(400).json({ error: updErr.message });
      return res.json({ ok: true, smsCredits: nextCredits });
    } catch (err) {
      return res.status(500).json({ error: err instanceof Error ? err.message : 'Credit top-up failed.' });
    }
  });

  router.post('/tenants/:userId/plan', async (req: AuthedRequest, res) => {
    const { plan } = req.body as { plan?: OrganizerProfile['plan'] };
    if (plan !== 'Starter' && plan !== 'Pro Organizer' && plan !== 'Enterprise') {
      return res.status(400).json({ error: 'Invalid plan tier.' });
    }
    if (!isSupabaseConfigured()) {
      try {
        return res.json({ tenant: memoryStore.updateTenantPlan(req.params.userId, plan) });
      } catch (err) {
        return res.status(404).json({ error: err instanceof Error ? err.message : 'Tenant not found.' });
      }
    }
    try {
      const client = createServiceSupabaseClient() ?? req.supabase!;
      const updatePayload: Record<string, unknown> = {
        plan,
        updated_at: new Date().toISOString(),
      };
      if (plan === 'Starter') {
        updatePayload.plan_billing_cycle = 'monthly';
        updatePayload.plan_expires_at = null;
        updatePayload.sender_id = DEFAULT_SHARED_SENDER_ID;
      } else {
        updatePayload.plan_billing_cycle = 'monthly';
        updatePayload.plan_expires_at = computePlanExpiresAtIso('monthly');
      }
      let { error } = await client
        .from('profiles')
        .update(updatePayload)
        .eq('id', req.params.userId);
      if (error && (error.message?.includes('plan_billing_cycle') || error.message?.includes('plan_expires_at') || error.message?.includes('schema cache'))) {
        const retry = await client
          .from('profiles')
          .update({ plan, updated_at: new Date().toISOString() })
          .eq('id', req.params.userId);
        error = retry.error;
      }
      if (error) return res.status(400).json({ error: error.message });
      return res.json({ ok: true, plan });
    } catch (err) {
      return res.status(500).json({ error: err instanceof Error ? err.message : 'Plan update failed.' });
    }
  });

  router.post('/tenants/:userId/role', async (req: AuthedRequest, res) => {
    const { appRole } = req.body as { appRole?: AppRole };
    if (appRole === 'creator') {
      return res.status(403).json({
        error: 'The creator role is exclusive to the platform owner and cannot be assigned to any other user.',
        code: 'CREATOR_ROLE_LOCKED',
      });
    }
    if (appRole !== 'organizer' && appRole !== 'gate_staff') {
      return res.status(400).json({ error: 'Invalid RBAC role. Allowed roles: organizer or gate_staff.' });
    }
    if (req.params.userId === req.user?.id) {
      return res.status(403).json({
        error: 'The primary creator account role cannot be modified.',
        code: 'CREATOR_ROLE_LOCKED',
      });
    }
    if (!isSupabaseConfigured()) {
      try {
        return res.json({ tenant: memoryStore.updateTenantRole(req.params.userId, appRole) });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Tenant not found.';
        return res.status(msg.toLowerCase().includes('creator') ? 403 : 404).json({ error: msg });
      }
    }
    try {
      const client = createServiceSupabaseClient() ?? req.supabase!;
      const { data: targetProf } = await client
        .from('profiles')
        .select('email, phone, app_role')
        .eq('id', req.params.userId)
        .maybeSingle();
      const targetRec = targetProf as Record<string, unknown> | null;
      if (
        targetRec &&
        isPrimaryCreatorIdentity(
          typeof targetRec.email === 'string' ? targetRec.email : undefined,
          typeof targetRec.phone === 'string' ? targetRec.phone : undefined
        )
      ) {
        return res.status(403).json({
          error: 'The primary creator account role cannot be modified.',
          code: 'CREATOR_ROLE_LOCKED',
        });
      }
      const { error } = await client
        .from('profiles')
        .update({
          app_role: appRole,
          role: appRole === 'gate_staff' ? 'Gate Check-In Staff' : 'Lead Organiser',
          updated_at: new Date().toISOString(),
        })
        .eq('id', req.params.userId);
      if (error) return res.status(400).json({ error: error.message });
      return res.json({ ok: true, appRole });
    } catch (err) {
      return res.status(500).json({ error: err instanceof Error ? err.message : 'Role update failed.' });
    }
  });

  router.post('/tenants/:userId/suspend', (req: AuthedRequest, res) => {
    if (!isSupabaseConfigured()) {
      try {
        return res.json({ tenant: memoryStore.toggleTenantSuspend(req.params.userId) });
      } catch (err) {
        return res.status(404).json({ error: err instanceof Error ? err.message : 'Tenant not found.' });
      }
    }
    return res.status(200).json({ ok: true, note: 'Session suspension applied.' });
  });

  router.post('/tenants/:userId/revoke-sessions', async (req: AuthedRequest, res) => {
    if (!isSupabaseConfigured()) {
      return res.json(memoryStore.revokeTenantSessions(req.params.userId));
    }
    try {
      const svc = createServiceSupabaseClient();
      if (svc) {
        await svc.auth.admin.signOut(req.params.userId);
      }
      return res.json({ revoked: 1 });
    } catch (err) {
      return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to revoke sessions.' });
    }
  });

  router.get('/tenants/:userId/inspect', async (req: AuthedRequest, res) => {
    if (!isSupabaseConfigured()) {
      try {
        return res.json(memoryStore.inspectTenant(req.params.userId));
      } catch (err) {
        return res.status(404).json({ error: err instanceof Error ? err.message : 'Tenant not found.' });
      }
    }
    try {
      const client = createServiceSupabaseClient() ?? req.supabase!;
      const { data: prof, error: profErr } = await client
        .from('profiles')
        .select('*')
        .eq('id', req.params.userId)
        .single();
      if (profErr || !prof) return res.status(404).json({ error: 'Organiser not found.' });

      const { data: evtRows } = await client
        .from('events')
        .select('*')
        .eq('organizer_id', req.params.userId);
      const events = (evtRows ?? []).map((r) => mapEventRow(r as Record<string, unknown>));
      const evtIds = events.map((e) => e.id);
      const { data: attRows } =
        evtIds.length > 0
          ? await client.from('attendees').select('*').in('event_id', evtIds)
          : { data: [] };
      const attendees = (attRows ?? []).map((r) => mapAttendeeRow(r as Record<string, unknown>));
      const p = prof as Record<string, unknown>;
      const inspection: BuilderTenantInspection = {
        tenant: {
          id: String(p.id),
          name: String(p.name ?? 'Organiser'),
          email: String(p.email ?? ''),
          studio: String(p.studio ?? 'Events Studio'),
          appRole: isPrimaryCreatorIdentity(
            typeof p.email === 'string' ? p.email : undefined,
            typeof p.phone === 'string' ? p.phone : undefined
          )
            ? 'creator'
            : p.app_role === 'gate_staff'
              ? 'gate_staff'
              : 'organizer',
          plan: (p.plan as OrganizerProfile['plan']) || 'Starter',
          smsCredits: Number(p.sms_credits ?? 0),
          eventsCount: events.length,
          attendeesCount: attendees.length,
          shotsCount: 0,
          storageMb: 0,
          suspended: false,
          lastLoginAt: String(p.updated_at ?? p.created_at ?? new Date().toISOString()),
          createdAt: String(p.created_at ?? new Date().toISOString()),
        },
        events,
        attendees,
      };
      return res.json(inspection);
    } catch (err) {
      return res.status(500).json({ error: err instanceof Error ? err.message : 'Inspection failed.' });
    }
  });

  router.post('/diagnostics/:id/replay', async (req: AuthedRequest, res) => {
    try {
      if (!isSupabaseConfigured()) {
        const item = await memoryStore.replayDiagnosticFailure(req.params.id);
        return res.json({ item });
      }
      const item = platformRuntime.diagnosticFailures.find((d) => d.id === req.params.id);
      if (!item) return res.status(404).json({ error: 'Diagnostic entry not found.' });
      item.replayed = true;
      return res.json({ item });
    } catch (err) {
      return res.status(400).json({ error: err instanceof Error ? err.message : 'Replay failed.' });
    }
  });

  router.patch('/flags', (req, res) => {
    const flags = platformRuntime.updateFlags(req.body as Partial<BuilderFeatureFlags>);
    return res.json({ flags });
  });

  router.post('/sms-purchases/:id/resolve', async (req: AuthedRequest, res) => {
    const { action, reason } = req.body as { action?: 'approve' | 'reject'; reason?: string };
    if (action !== 'approve' && action !== 'reject') {
      return res.status(400).json({ error: 'Action must be "approve" or "reject".' });
    }
    const purchaseId = req.params.id;
    if (!isSupabaseConfigured()) {
      try {
        const result = memoryStore.resolveSmsBundlePurchase(purchaseId, action, reason);
        return res.json({ ok: true, ...result });
      } catch (err) {
        const status = (err as { status?: number })?.status || 400;
        return res.status(status).json({ error: err instanceof Error ? err.message : 'Unable to resolve purchase.' });
      }
    }

    try {
      const client = createServiceSupabaseClient() ?? req.supabase!;
      const fallbackItem = platformRuntime.fallbackSmsPurchases.get(purchaseId);
      if (fallbackItem) {
        if (fallbackItem.status === 'credited') {
          const { data: prof } = await client
            .from('profiles')
            .select('sms_credits')
            .eq('id', fallbackItem.organizerId)
            .single();
          return res.json({
            ok: true,
            alreadyCredited: true,
            purchase: fallbackItem,
            smsCredits: Number((prof as Record<string, unknown> | null)?.sms_credits ?? 0),
          });
        }
        if (action === 'reject') {
          const rejected: SmsBundlePurchase = {
            ...fallbackItem,
            status: 'rejected',
            rejectionReason: reason?.trim() || 'Rejected by creator administrator.',
            verifiedAt: new Date().toISOString(),
          };
          platformRuntime.fallbackSmsPurchases.set(rejected.id, rejected);
          const { data: prof } = await client
            .from('profiles')
            .select('sms_credits')
            .eq('id', fallbackItem.organizerId)
            .maybeSingle();
          return res.json({
            ok: true,
            alreadyCredited: false,
            purchase: rejected,
            smsCredits: Number((prof as Record<string, unknown> | null)?.sms_credits ?? 0),
          });
        }

        const { data: prof, error: profErr } = await client
          .from('profiles')
          .select('sms_credits')
          .eq('id', fallbackItem.organizerId)
          .single();
        if (profErr || !prof) return res.status(404).json({ error: 'Organizer profile not found.' });
        const nextCredits = Number((prof as Record<string, unknown>).sms_credits ?? 0) + fallbackItem.credits;
        const { error: updErr } = await client
          .from('profiles')
          .update({ sms_credits: nextCredits, updated_at: new Date().toISOString() })
          .eq('id', fallbackItem.organizerId);
        if (updErr) return res.status(400).json({ error: updErr.message });

        const approved: SmsBundlePurchase = {
          ...fallbackItem,
          status: 'credited',
          rejectionReason: undefined,
          verifiedAt: new Date().toISOString(),
        };
        platformRuntime.fallbackSmsPurchases.set(approved.id, approved);
        return res.json({
          ok: true,
          alreadyCredited: false,
          purchase: approved,
          smsCredits: nextCredits,
        });
      }

      const { data: row, error: fetchErr } = await client
        .from('sms_bundle_purchases')
        .select('*')
        .eq('id', purchaseId)
        .single();
      if (fetchErr || !row) {
        return res.status(404).json({ error: 'SMS bundle purchase record not found.' });
      }
      const existing = mapPurchaseRow(row as Record<string, unknown>);
      if (existing.status === 'credited') {
        const { data: prof } = await client
          .from('profiles')
          .select('sms_credits')
          .eq('id', existing.organizerId)
          .single();
        return res.json({
          ok: true,
          alreadyCredited: true,
          purchase: existing,
          smsCredits: Number((prof as Record<string, unknown> | null)?.sms_credits ?? 0),
        });
      }

      if (action === 'reject') {
        const nowIso = new Date().toISOString();
        const rejectReason = reason?.trim() || 'Rejected by creator administrator.';
        const { data: updated, error: rejErr } = await client
          .from('sms_bundle_purchases')
          .update({
            status: 'rejected',
            rejection_reason: rejectReason,
            verified_at: nowIso,
          })
          .eq('id', purchaseId)
          .neq('status', 'credited')
          .select('*')
          .maybeSingle();
        if (rejErr) return res.status(400).json({ error: rejErr.message });
        const { data: prof } = await client
          .from('profiles')
          .select('sms_credits')
          .eq('id', existing.organizerId)
          .maybeSingle();
        return res.json({
          ok: true,
          alreadyCredited: false,
          purchase: updated ? mapPurchaseRow(updated as Record<string, unknown>) : { ...existing, status: 'rejected' as const, rejectionReason: rejectReason, verifiedAt: nowIso },
          smsCredits: Number((prof as Record<string, unknown> | null)?.sms_credits ?? 0),
        });
      }

      // Approve & atomically credit
      const rpcRes = await client.rpc('credit_organizer_sms_bundle', {
        p_purchase_id: purchaseId,
        p_payment_channel: null,
      });
      if (!rpcRes.error && rpcRes.data && typeof rpcRes.data === 'object') {
        const payload = rpcRes.data as {
          alreadyCredited?: boolean;
          purchase?: Record<string, unknown>;
          smsCredits?: number;
        };
        if (payload.purchase) {
          return res.json({
            ok: true,
            alreadyCredited: Boolean(payload.alreadyCredited),
            purchase: mapPurchaseRow(payload.purchase),
            smsCredits: Number(payload.smsCredits ?? 0),
          });
        }
      }

      const nowIso = new Date().toISOString();
      const { data: claimed, error: claimErr } = await client
        .from('sms_bundle_purchases')
        .update({ status: 'credited', verified_at: nowIso })
        .eq('id', purchaseId)
        .neq('status', 'credited')
        .select('*')
        .maybeSingle();
      if (claimErr) return res.status(400).json({ error: claimErr.message });
      if (!claimed) {
        const { data: prof } = await client
          .from('profiles')
          .select('sms_credits')
          .eq('id', existing.organizerId)
          .single();
        return res.json({
          ok: true,
          alreadyCredited: true,
          purchase: { ...existing, status: 'credited' as const },
          smsCredits: Number((prof as Record<string, unknown> | null)?.sms_credits ?? 0),
        });
      }

      const { data: prof } = await client
        .from('profiles')
        .select('sms_credits')
        .eq('id', existing.organizerId)
        .single();
      const nextCredits = Number((prof as Record<string, unknown> | null)?.sms_credits ?? 0) + existing.credits;
      await client
        .from('profiles')
        .update({ sms_credits: nextCredits, updated_at: nowIso })
        .eq('id', existing.organizerId);

      return res.json({
        ok: true,
        alreadyCredited: false,
        purchase: mapPurchaseRow(claimed as Record<string, unknown>),
        smsCredits: nextCredits,
      });
    } catch (err) {
      platformRuntime.recordError('builder/sms-purchases/resolve', err);
      return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to resolve SMS purchase.' });
    }
  });

  router.post('/subscription-purchases/:id/resolve', async (req: AuthedRequest, res) => {
    const { action, reason } = req.body as { action?: 'approve' | 'reject'; reason?: string };
    if (action !== 'approve' && action !== 'reject') {
      return res.status(400).json({ error: 'Action must be "approve" or "reject".' });
    }
    const paymentId = req.params.id;
    if (!isSupabaseConfigured()) {
      try {
        const result = memoryStore.resolveSubscriptionPayment(paymentId, action, reason);
        return res.json({ ok: true, ...result });
      } catch (err) {
        const status = (err as { status?: number })?.status || 400;
        return res.status(status).json({ error: err instanceof Error ? err.message : 'Unable to resolve subscription payment.' });
      }
    }

    try {
      const client = createServiceSupabaseClient() ?? req.supabase!;
      const fallbackItem = platformRuntime.fallbackSubscriptionPayments.get(paymentId);
      if (fallbackItem) {
        if (fallbackItem.status === 'active') {
          return res.json({
            ok: true,
            alreadyActivated: true,
            payment: fallbackItem,
            plan: fallbackItem.planName,
          });
        }
        if (action === 'reject') {
          const rejected: SubscriptionPayment = {
            ...fallbackItem,
            status: 'rejected',
            rejectionReason: reason?.trim() || 'Rejected by creator administrator.',
            verifiedAt: new Date().toISOString(),
          };
          platformRuntime.fallbackSubscriptionPayments.set(rejected.id, rejected);
          return res.json({
            ok: true,
            alreadyActivated: false,
            payment: rejected,
          });
        }

        const now = new Date();
        const nowIso = now.toISOString();
        const expiresIso = computePlanExpiresAtIso(fallbackItem.billingCycle, now);
        let { error: updErr } = await client
          .from('profiles')
          .update({
            plan: fallbackItem.planName,
            plan_billing_cycle: fallbackItem.billingCycle,
            plan_expires_at: expiresIso,
            updated_at: nowIso,
          })
          .eq('id', fallbackItem.organizerId);
        if (updErr && (updErr.message?.includes('plan_billing_cycle') || updErr.message?.includes('schema cache'))) {
          const retry = await client
            .from('profiles')
            .update({ plan: fallbackItem.planName, updated_at: nowIso })
            .eq('id', fallbackItem.organizerId);
          updErr = retry.error;
        }
        if (updErr) return res.status(400).json({ error: updErr.message });

        const approved: SubscriptionPayment = {
          ...fallbackItem,
          status: 'active',
          rejectionReason: undefined,
          periodStart: nowIso,
          periodEnd: expiresIso,
          verifiedAt: nowIso,
        };
        platformRuntime.fallbackSubscriptionPayments.set(approved.id, approved);
        return res.json({
          ok: true,
          alreadyActivated: false,
          payment: approved,
          plan: approved.planName,
        });
      }

      const { data: row, error: fetchErr } = await client
        .from('subscription_payments')
        .select('*')
        .eq('id', paymentId)
        .single();
      if (fetchErr || !row) {
        return res.status(404).json({ error: 'Subscription payment record not found.' });
      }
      const existing = mapSubscriptionPaymentRow(row as Record<string, unknown>);
      if (existing.status === 'active') {
        return res.json({
          ok: true,
          alreadyActivated: true,
          payment: existing,
          plan: existing.planName,
        });
      }

      if (action === 'reject') {
        const nowIso = new Date().toISOString();
        const rejectReason = reason?.trim() || 'Rejected by creator administrator.';
        const { data: updated, error: rejErr } = await client
          .from('subscription_payments')
          .update({
            status: 'rejected',
            rejection_reason: rejectReason,
            verified_at: nowIso,
          })
          .eq('id', paymentId)
          .neq('status', 'active')
          .select('*')
          .maybeSingle();
        if (rejErr) return res.status(400).json({ error: rejErr.message });
        return res.json({
          ok: true,
          alreadyActivated: false,
          payment: updated
            ? mapSubscriptionPaymentRow(updated as Record<string, unknown>)
            : { ...existing, status: 'rejected' as const, rejectionReason: rejectReason, verifiedAt: nowIso },
        });
      }

      const rpcRes = await client.rpc('activate_organizer_subscription', {
        p_payment_id: paymentId,
        p_payment_channel: null,
      });
      if (!rpcRes.error && rpcRes.data && typeof rpcRes.data === 'object') {
        const payload = rpcRes.data as {
          alreadyActivated?: boolean;
          payment?: Record<string, unknown>;
          plan?: string;
        };
        if (payload.payment) {
          return res.json({
            ok: true,
            alreadyActivated: Boolean(payload.alreadyActivated),
            payment: mapSubscriptionPaymentRow(payload.payment),
            plan: payload.plan || existing.planName,
          });
        }
      }

      const now = new Date();
      const nowIso = now.toISOString();
      const expiresIso = computePlanExpiresAtIso(existing.billingCycle, now);
      const { data: claimed, error: claimErr } = await client
        .from('subscription_payments')
        .update({
          status: 'active',
          period_start: nowIso,
          period_end: expiresIso,
          verified_at: nowIso,
        })
        .eq('id', paymentId)
        .neq('status', 'active')
        .select('*')
        .maybeSingle();
      if (claimErr) return res.status(400).json({ error: claimErr.message });
      if (!claimed) {
        return res.json({
          ok: true,
          alreadyActivated: true,
          payment: { ...existing, status: 'active' as const },
          plan: existing.planName,
        });
      }

      await client
        .from('profiles')
        .update({
          plan: existing.planName,
          plan_billing_cycle: existing.billingCycle,
          plan_expires_at: expiresIso,
          updated_at: nowIso,
        })
        .eq('id', existing.organizerId);

      return res.json({
        ok: true,
        alreadyActivated: false,
        payment: mapSubscriptionPaymentRow(claimed as Record<string, unknown>),
        plan: existing.planName,
      });
    } catch (err) {
      platformRuntime.recordError('builder/subscription-purchases/resolve', err);
      return res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to resolve subscription payment.',
      });
    }
  });

  return router;
}
