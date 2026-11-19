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
} from '../src/types/events.ts';
import {
  dispatchOptionalArkeselSms,
  getBearerToken,
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

const PLAN_MRR_USD: Record<OrganizerProfile['plan'], number> = {
  Starter: 0,
  'Pro Organizer': 29,
  Enterprise: 99,
};

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
  try {
    const publicClient = createPublicSupabaseClient();
    const { data, error } = await publicClient.auth.getUser(token);
    if (error || !data.user) {
      return res.status(401).json({ error: error?.message || 'Session expired.' });
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
    return res.status(401).json({ error: err instanceof Error ? err.message : 'Auth error.' });
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
      const [profRes, evtRes, attRes, shotRes, appRes, , emailDiagnostics] = await Promise.all([
        client.from('profiles').select('*'),
        client.from('events').select('*'),
        client.from('attendees').select('*'),
        client.from('disposable_shots').select('id,event_id,data_url'),
        client.from('creator_apps').select('id'),
        fetchArkeselGatewayBalance(),
        getEmailDeliverabilityDiagnostics(),
      ]);

      const dbLatencyMs = Math.max(1, Date.now() - started);

      for (const r of [profRes, evtRes, attRes, shotRes]) {
        if (r.error) platformRuntime.recordError('builder/overview', r.error.message);
      }

      const profiles = (profRes.data ?? []) as Record<string, unknown>[];
      const events = (evtRes.data ?? []) as Record<string, unknown>[];
      const attendees = (attRes.data ?? []) as Record<string, unknown>[];
      const shots = (shotRes.data ?? []) as Record<string, unknown>[];
      const apps = (appRes.data ?? []) as Record<string, unknown>[];

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
        const appRole: AppRole =
          rawRole === 'creator' || rawRole === 'organizer' || rawRole === 'gate_staff'
            ? rawRole
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
          String(evtInfo?.title ?? 'Events App'),
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
      const { error } = await client
        .from('profiles')
        .update({ plan, updated_at: new Date().toISOString() })
        .eq('id', req.params.userId);
      if (error) return res.status(400).json({ error: error.message });
      return res.json({ ok: true, plan });
    } catch (err) {
      return res.status(500).json({ error: err instanceof Error ? err.message : 'Plan update failed.' });
    }
  });

  router.post('/tenants/:userId/role', async (req: AuthedRequest, res) => {
    const { appRole } = req.body as { appRole?: AppRole };
    if (appRole !== 'creator' && appRole !== 'organizer' && appRole !== 'gate_staff') {
      return res.status(400).json({ error: 'Invalid RBAC role.' });
    }
    if (!isSupabaseConfigured()) {
      try {
        return res.json({ tenant: memoryStore.updateTenantRole(req.params.userId, appRole) });
      } catch (err) {
        return res.status(404).json({ error: err instanceof Error ? err.message : 'Tenant not found.' });
      }
    }
    try {
      const client = createServiceSupabaseClient() ?? req.supabase!;
      const { error } = await client
        .from('profiles')
        .update({ app_role: appRole, updated_at: new Date().toISOString() })
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
          appRole:
            p.app_role === 'creator' || p.app_role === 'organizer' || p.app_role === 'gate_staff'
              ? p.app_role
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

  return router;
}
