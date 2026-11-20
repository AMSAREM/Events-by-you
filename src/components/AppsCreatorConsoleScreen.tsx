import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Ban,
  Check,
  CheckCircle2,
  Code2,
  Copy,
  Database,
  DollarSign,
  Eye,
  KeyRound,
  Lock,
  LogOut,
  Mail,
  Pause,
  Play,
  Plus,
  Power,
  RefreshCw,
  RotateCcw,
  Send,
  Server,
  Shield,
  ShieldAlert,
  Smartphone,
  Terminal,
  Trash2,
  TrendingUp,
  UserCheck,
  Users,
  Webhook,
  X,
  Zap,
} from 'lucide-react';
import type {
  AppRole,
  BuilderConsoleOverview,
  BuilderTenantInspection,
  CreatorApp,
  CreatorAppEnvironment,
  CreatorAppLog,
  CreatorAppScope,
  CreatorAppStatus,
  CreatorAppType,
  EventItem,
  OrganizerProfile,
  SystemAlert,
  WebhookTriggerEvent,
} from '../types/events';
import { api } from '../lib/api';
import { TopUtilityBar } from './TopUtilityBar';

interface AppsCreatorConsoleScreenProps {
  apps: CreatorApp[];
  logs: CreatorAppLog[];
  events: EventItem[];
  alerts: SystemAlert[];
  profile: OrganizerProfile;
  onCreateApp: (payload: {
    name: string;
    description: string;
    appType: CreatorAppType;
    environment: CreatorAppEnvironment;
    eventId?: string;
    scopes: CreatorAppScope[];
    webhookUrl?: string;
    webhookEvents?: WebhookTriggerEvent[];
    allowedOrigins?: string[];
  }) => Promise<{ app: CreatorApp; rawSecret: string; webhookSecret: string } | null>;
  onUpdateApp: (
    appId: string,
    patch: {
      name?: string;
      description?: string;
      appType?: CreatorAppType;
      environment?: CreatorAppEnvironment;
      status?: CreatorAppStatus;
      eventId?: string | null;
      scopes?: CreatorAppScope[];
      webhookUrl?: string | null;
      webhookEvents?: WebhookTriggerEvent[];
      allowedOrigins?: string[];
    }
  ) => Promise<void>;
  onRotateSecret: (
    appId: string
  ) => Promise<{ app: CreatorApp; rawSecret: string; webhookSecret: string } | null>;
  onTestWebhook: (appId: string, eventType: WebhookTriggerEvent) => Promise<CreatorAppLog | null>;
  onSimulateEndpointCall: (
    appId: string,
    endpoint: string,
    method: 'GET' | 'POST'
  ) => Promise<{ log: CreatorAppLog; result: unknown } | null>;
  onDeleteApp: (appId: string) => Promise<void>;
  creatorEmail: string;
  creatorPasswordConfigured: boolean;
  creatorUnlocked: boolean;
  onUnlockCreator: (password: string) => Promise<string | null>;
  onManageEvent: (event: EventItem) => void;
  onNavigateSettings: () => void;
  onSignOut: () => void;
  onResolveAlert: (id: string) => void;
}

const APP_TYPES: { id: CreatorAppType; label: string; summary: string }[] = [
  { id: 'kiosk', label: 'Gate Kiosk', summary: 'Tablet check-in & walk-in QR terminal' },
  { id: 'widget', label: 'Event Widget', summary: 'Embeddable RSVP & schedule card' },
  { id: 'webhook-worker', label: 'Webhook Worker', summary: 'Backend listener for registrations & SMS' },
  { id: 'mobile-app', label: 'Mobile Companion', summary: 'Guest itinerary & 35mm camera client' },
];

const SCOPE_OPTIONS: { id: CreatorAppScope; label: string; detail: string }[] = [
  { id: 'events:read', label: 'events:read', detail: 'Read event metadata, venue, and capacities' },
  { id: 'attendees:read', label: 'attendees:read', detail: 'List ticket holders and SMS pass delivery status' },
  { id: 'checkin:write', label: 'checkin:write', detail: 'Verify QR tokens and mark gate check-ins' },
  { id: 'sms:dispatch', label: 'sms:dispatch', detail: 'Trigger Arkesel SMS ticket reminders' },
  { id: 'camera:read', label: 'camera:read', detail: 'Read 35mm disposable film rolls and frames' },
  { id: 'webhooks:manage', label: 'webhooks:manage', detail: 'Receive signed HTTP event callbacks' },
];

const WEBHOOK_TRIGGERS: { id: WebhookTriggerEvent; label: string; description: string }[] = [
  { id: 'attendee.registered', label: 'attendee.registered', description: 'Fired when a guest registers or receives an SMS pass' },
  { id: 'attendee.checked_in', label: 'attendee.checked_in', description: 'Fired when a QR pass is verified at a gate scanner' },
  { id: 'sms.dispatched', label: 'sms.dispatched', description: 'Fired on Arkesel SMS carrier delivery receipt' },
  { id: 'payment.settled', label: 'payment.settled', description: 'Fired when paid ticket settlement completes' },
  { id: 'camera.shot_captured', label: 'camera.shot_captured', description: 'Fired when a guest exposes a 35mm film frame' },
];

const API_ENDPOINTS: { endpoint: string; method: 'GET' | 'POST'; scope: CreatorAppScope; label: string }[] = [
  { endpoint: '/v1/events', method: 'GET', scope: 'events:read', label: 'List Scoped Events' },
  { endpoint: '/v1/attendees', method: 'GET', scope: 'attendees:read', label: 'Fetch Guest Roster' },
  { endpoint: '/v1/checkin', method: 'POST', scope: 'checkin:write', label: 'Verify Gate QR Pass' },
  { endpoint: '/v1/camera/shots', method: 'GET', scope: 'camera:read', label: 'Read 35mm Film Roll' },
];

type ConsoleSection = 'pulse' | 'tenants' | 'diagnostics' | 'switches' | 'economics' | 'apps';
type ConsoleTab = 'credentials' | 'webhooks' | 'sdk' | 'logs';
type EnvFilter = 'all' | 'production' | 'sandbox' | 'paused';
type SnippetLang = 'typescript' | 'curl' | 'embed';

export const AppsCreatorConsoleScreen: React.FC<AppsCreatorConsoleScreenProps> = ({
  apps,
  logs,
  events,
  alerts,
  profile,
  onCreateApp,
  onUpdateApp,
  onRotateSecret,
  onTestWebhook,
  onSimulateEndpointCall,
  onDeleteApp,
  creatorEmail,
  creatorPasswordConfigured,
  creatorUnlocked,
  onUnlockCreator,
  onManageEvent,
  onNavigateSettings,
  onSignOut,
  onResolveAlert,
}) => {
  const [unlockPassword, setUnlockPassword] = useState('');
  const [unlocking, setUnlocking] = useState(false);
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [envFilter, setEnvFilter] = useState<EnvFilter>('all');
  const [selectedAppId, setSelectedAppId] = useState<string | null>(apps[0]?.id ?? null);
  const [activeTab, setActiveTab] = useState<ConsoleTab>('credentials');
  const [snippetLang, setSnippetLang] = useState<SnippetLang>('typescript');

  // Create Modal state
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newType, setNewType] = useState<CreatorAppType>('kiosk');
  const [newEnv, setNewEnv] = useState<CreatorAppEnvironment>('sandbox');
  const [newEventId, setNewEventId] = useState<string>('all');
  const [newScopes, setNewScopes] = useState<CreatorAppScope[]>(['events:read', 'attendees:read', 'checkin:write']);
  const [newWebhookUrl, setNewWebhookUrl] = useState('');

  // One-time secret reveal
  const [revealedSecret, setRevealedSecret] = useState<{
    appName: string;
    clientId: string;
    rawSecret: string;
    webhookSecret: string;
  } | null>(null);

  // Edit / Workbench form state synced from selected app
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editEnv, setEditEnv] = useState<CreatorAppEnvironment>('sandbox');
  const [editEventId, setEditEventId] = useState<string>('all');
  const [editScopes, setEditScopes] = useState<CreatorAppScope[]>([]);
  const [editOrigins, setEditOrigins] = useState('');
  const [editWebhookUrl, setEditWebhookUrl] = useState('');
  const [editWebhookEvents, setEditWebhookEvents] = useState<WebhookTriggerEvent[]>([]);
  const [savingConfig, setSavingConfig] = useState(false);
  const [rotatingSecret, setRotatingSecret] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Builder Console sections & telemetry state
  const [consoleSection, setConsoleSection] = useState<ConsoleSection>('pulse');
  const [builderOverview, setBuilderOverview] = useState<BuilderConsoleOverview | null>(null);
  const [builderLoading, setBuilderLoading] = useState(false);
  const [builderError, setBuilderError] = useState<string | null>(null);
  const [builderFeedback, setBuilderFeedback] = useState<string | null>(null);
  const [actionBusyId, setActionBusyId] = useState<string | null>(null);
  const [tenantSearch, setTenantSearch] = useState('');
  const [tenantInspection, setTenantInspection] = useState<BuilderTenantInspection | null>(null);
  const [inspectLoading, setInspectLoading] = useState(false);
  const [syncingDlr, setSyncingDlr] = useState(false);
  const [dlrSyncSummary, setDlrSyncSummary] = useState<string | null>(null);
  const [defaultSenderInput, setDefaultSenderInput] = useState('');

  // Tester & Logs state
  const [selectedWebhookTrigger, setSelectedWebhookTrigger] = useState<WebhookTriggerEvent>('attendee.registered');
  const [testingWebhook, setTestingWebhook] = useState(false);
  const [selectedEndpoint, setSelectedEndpoint] = useState<string>('/v1/events');
  const [runningEndpoint, setRunningEndpoint] = useState(false);
  const [playgroundOutput, setPlaygroundOutput] = useState<string | null>(null);
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const isConsoleReady = !creatorPasswordConfigured || creatorUnlocked;

  const refreshBuilderOverview = useCallback(async () => {
    if (!isConsoleReady) return;
    setBuilderLoading(true);
    setBuilderError(null);
    try {
      const overview = await api.builder.overview();
      setBuilderOverview(overview);
    } catch (err) {
      setBuilderError(err instanceof Error ? err.message : 'Unable to load builder telemetry');
    } finally {
      setBuilderLoading(false);
    }
  }, [isConsoleReady]);

  useEffect(() => {
    if (isConsoleReady) {
      refreshBuilderOverview();
    }
  }, [isConsoleReady, refreshBuilderOverview]);

  useEffect(() => {
    if (builderOverview) {
      setDefaultSenderInput(
        builderOverview.flags.arkeselSenderId ||
          builderOverview.smsTelemetry.activeSenderId ||
          'EVENTSAPP'
      );
    }
  }, [builderOverview]);

  const showToast = (msg: string) => {
    setBuilderFeedback(msg);
    setTimeout(() => {
      setBuilderFeedback((prev) => (prev === msg ? null : prev));
    }, 3500);
  };

  const filteredTenants = useMemo(() => {
    if (!builderOverview) return [];
    const q = (tenantSearch || searchQuery).trim().toLowerCase();
    if (!q) return builderOverview.tenants;
    return builderOverview.tenants.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.email.toLowerCase().includes(q) ||
        t.studio.toLowerCase().includes(q) ||
        t.plan.toLowerCase().includes(q) ||
        t.appRole.toLowerCase().includes(q)
    );
  }, [builderOverview, tenantSearch, searchQuery]);

  const handleRetrySms = async (attendeeId?: string) => {
    setActionBusyId(attendeeId ? `sms-${attendeeId}` : 'sms-all');
    setBuilderError(null);
    try {
      const res = await api.builder.retrySms(attendeeId);
      showToast(`Retried ${res.retried} SMS dispatch${res.retried === 1 ? '' : 'es'}.`);
      await refreshBuilderOverview();
    } catch (err) {
      setBuilderError(err instanceof Error ? err.message : 'SMS retry failed');
    } finally {
      setActionBusyId(null);
    }
  };

  const handleClearErrors = async () => {
    setActionBusyId('clear-errors');
    setBuilderError(null);
    try {
      await api.builder.clearErrors();
      showToast('Cleared server error trace buffer.');
      await refreshBuilderOverview();
    } catch (err) {
      setBuilderError(err instanceof Error ? err.message : 'Failed to clear errors');
    } finally {
      setActionBusyId(null);
    }
  };

  const handleTopUp = async (userId: string, amount: number) => {
    setActionBusyId(`topup-${userId}`);
    setBuilderError(null);
    try {
      await api.builder.topUpTenantCredits(userId, amount);
      showToast(`Added +${amount} SMS credits.`);
      await refreshBuilderOverview();
    } catch (err) {
      setBuilderError(err instanceof Error ? err.message : 'Credit top-up failed');
    } finally {
      setActionBusyId(null);
    }
  };

  const handleUpdatePlan = async (userId: string, plan: OrganizerProfile['plan']) => {
    setActionBusyId(`plan-${userId}`);
    setBuilderError(null);
    try {
      await api.builder.updateTenantPlan(userId, plan);
      showToast(`Updated plan to ${plan}.`);
      await refreshBuilderOverview();
    } catch (err) {
      setBuilderError(err instanceof Error ? err.message : 'Plan update failed');
    } finally {
      setActionBusyId(null);
    }
  };

  const handleUpdateRole = async (userId: string, appRole: AppRole) => {
    setActionBusyId(`role-${userId}`);
    setBuilderError(null);
    try {
      await api.builder.updateTenantRole(userId, appRole);
      showToast(`Updated RBAC role to ${appRole}.`);
      await refreshBuilderOverview();
    } catch (err) {
      setBuilderError(err instanceof Error ? err.message : 'Role update failed');
    } finally {
      setActionBusyId(null);
    }
  };

  const handleSuspendTenant = async (userId: string) => {
    setActionBusyId(`suspend-${userId}`);
    setBuilderError(null);
    try {
      await api.builder.suspendTenant(userId);
      showToast('Updated tenant suspension status.');
      await refreshBuilderOverview();
    } catch (err) {
      setBuilderError(err instanceof Error ? err.message : 'Failed to update suspension');
    } finally {
      setActionBusyId(null);
    }
  };

  const handleRevokeSessions = async (userId: string) => {
    setActionBusyId(`revoke-${userId}`);
    setBuilderError(null);
    try {
      const res = await api.builder.revokeTenantSessions(userId);
      showToast(`Revoked ${res.revoked} active session(s).`);
      await refreshBuilderOverview();
    } catch (err) {
      setBuilderError(err instanceof Error ? err.message : 'Session revocation failed');
    } finally {
      setActionBusyId(null);
    }
  };

  const handleInspectTenant = async (userId: string) => {
    setInspectLoading(true);
    setBuilderError(null);
    try {
      const detail = await api.builder.inspectTenant(userId);
      setTenantInspection(detail);
    } catch (err) {
      setBuilderError(err instanceof Error ? err.message : 'Unable to inspect tenant');
    } finally {
      setInspectLoading(false);
    }
  };

  const handleReplayDiagnostic = async (diagId: string) => {
    setActionBusyId(`diag-${diagId}`);
    setBuilderError(null);
    try {
      await api.builder.replayDiagnostic(diagId);
      showToast('Replayed failed diagnostic payload.');
      await refreshBuilderOverview();
    } catch (err) {
      setBuilderError(err instanceof Error ? err.message : 'Diagnostic replay failed');
    } finally {
      setActionBusyId(null);
    }
  };

  const handleToggleEventPause = async (eventId: string, currentlyPaused: boolean) => {
    if (!builderOverview) return;
    setActionBusyId(`evt-pause-${eventId}`);
    setBuilderError(null);
    try {
      const nextPaused = currentlyPaused
        ? builderOverview.flags.pausedEventIds.filter((id) => id !== eventId)
        : [...builderOverview.flags.pausedEventIds, eventId];
      await api.builder.updateFlags({ pausedEventIds: nextPaused });
      showToast(currentlyPaused ? 'Resumed event registrations.' : 'Paused event registrations.');
      await refreshBuilderOverview();
    } catch (err) {
      setBuilderError(err instanceof Error ? err.message : 'Failed to toggle event switch');
    } finally {
      setActionBusyId(null);
    }
  };

  const handleSyncSmsDlr = async () => {
    setSyncingDlr(true);
    setBuilderError(null);
    try {
      const res = await api.builder.syncSmsDlr();
      const parts: string[] = [];
      if (res.balance?.ok && typeof res.balance.balanceCredits === 'number') {
        parts.push(`Arkesel Balance: ${res.balance.balanceCredits.toLocaleString()} credits`);
      } else if (res.balance?.error) {
        parts.push(`Balance err: ${res.balance.error}`);
      }
      if (res.dlr) {
        parts.push(`DLR checked: ${res.dlr.checked} (${res.dlr.updated} updated)`);
      }
      setDlrSyncSummary(parts.join(' · ') || 'Synced Arkesel balance & DLR.');
      showToast('Synced Arkesel balance, DLR & Resend diagnostics.');
      await refreshBuilderOverview();
    } catch (err) {
      setBuilderError(err instanceof Error ? err.message : 'Failed to sync SMS DLR');
    } finally {
      setSyncingDlr(false);
    }
  };

  const handleUpdateFlag = async (
    patch: Partial<{
      publicRegistrationsPaused: boolean;
      smsMode: 'live' | 'sandbox';
      arkeselSenderId: string;
      signupsEnabled: boolean;
      starterSeedingEnabled: boolean;
    }>,
    label: string
  ) => {
    setActionBusyId(`flag-${label}`);
    setBuilderError(null);
    try {
      await api.builder.updateFlags(patch);
      showToast(`Updated ${label}.`);
      await refreshBuilderOverview();
    } catch (err) {
      setBuilderError(err instanceof Error ? err.message : 'Flag update failed');
    } finally {
      setActionBusyId(null);
    }
  };

  const filteredApps = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return apps.filter((app) => {
      const matchesEnv =
        envFilter === 'all' ||
        (envFilter === 'paused' ? app.status === 'paused' : app.environment === envFilter);
      const matchesSearch =
        !q ||
        app.name.toLowerCase().includes(q) ||
        app.clientId.toLowerCase().includes(q) ||
        app.description.toLowerCase().includes(q) ||
        app.appType.toLowerCase().includes(q);
      return matchesEnv && matchesSearch;
    });
  }, [apps, envFilter, searchQuery]);

  useEffect(() => {
    if (apps.length === 0) {
      setSelectedAppId(null);
      return;
    }
    if (!selectedAppId || !apps.some((a) => a.id === selectedAppId)) {
      setSelectedAppId(apps[0].id);
    }
  }, [apps, selectedAppId]);

  const selectedApp = useMemo(
    () => apps.find((a) => a.id === selectedAppId) ?? null,
    [apps, selectedAppId]
  );

  useEffect(() => {
    if (!selectedApp) return;
    setEditName(selectedApp.name);
    setEditDesc(selectedApp.description);
    setEditEnv(selectedApp.environment);
    setEditEventId(selectedApp.eventId ?? 'all');
    setEditScopes(selectedApp.scopes);
    setEditOrigins(selectedApp.allowedOrigins.join(', '));
    setEditWebhookUrl(selectedApp.webhookUrl ?? '');
    setEditWebhookEvents(selectedApp.webhookEvents);
    setConfirmDelete(false);
    setPlaygroundOutput(null);
  }, [selectedApp]);

  const appLogs = useMemo(() => {
    if (!selectedApp) return [];
    return logs.filter((l) => l.appId === selectedApp.id);
  }, [logs, selectedApp]);

  const totalRequests = useMemo(
    () => apps.reduce((sum, a) => sum + (a.requestsCount || 0), 0),
    [apps]
  );

  const handleCopy = (label: string, value: string) => {
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(value).catch(() => {});
    }
    setCopiedKey(label);
    setTimeout(() => setCopiedKey(null), 1800);
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim() || creating) return;
    setCreating(true);
    try {
      const created = await onCreateApp({
        name: newName.trim(),
        description: newDesc.trim(),
        appType: newType,
        environment: newEnv,
        eventId: newEventId === 'all' ? undefined : newEventId,
        scopes: newScopes.length > 0 ? newScopes : ['events:read'],
        webhookUrl: newWebhookUrl.trim() || undefined,
        webhookEvents: newWebhookUrl.trim() ? ['attendee.registered', 'attendee.checked_in'] : [],
        allowedOrigins: [],
      });
      if (created) {
        setSelectedAppId(created.app.id);
        setRevealedSecret({
          appName: created.app.name,
          clientId: created.app.clientId,
          rawSecret: created.rawSecret,
          webhookSecret: created.webhookSecret,
        });
        setCreateOpen(false);
        setNewName('');
        setNewDesc('');
        setNewWebhookUrl('');
      }
    } finally {
      setCreating(false);
    }
  };

  const handleSaveConfig = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!selectedApp || savingConfig) return;
    setSavingConfig(true);
    try {
      const parsedOrigins = editOrigins
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      await onUpdateApp(selectedApp.id, {
        name: editName.trim() || selectedApp.name,
        description: editDesc.trim(),
        environment: editEnv,
        eventId: editEventId === 'all' ? null : editEventId,
        scopes: editScopes,
        webhookUrl: editWebhookUrl.trim() || null,
        webhookEvents: editWebhookEvents,
        allowedOrigins: parsedOrigins,
      });
    } finally {
      setSavingConfig(false);
    }
  };

  const handleRotate = async () => {
    if (!selectedApp || rotatingSecret) return;
    setRotatingSecret(true);
    try {
      const res = await onRotateSecret(selectedApp.id);
      if (res) {
        setRevealedSecret({
          appName: res.app.name,
          clientId: res.app.clientId,
          rawSecret: res.rawSecret,
          webhookSecret: res.webhookSecret,
        });
      }
    } finally {
      setRotatingSecret(false);
    }
  };

  const handleToggleStatus = async () => {
    if (!selectedApp) return;
    await onUpdateApp(selectedApp.id, {
      status: selectedApp.status === 'active' ? 'paused' : 'active',
    });
  };

  const handleDispatchTestWebhook = async () => {
    if (!selectedApp || testingWebhook) return;
    setTestingWebhook(true);
    try {
      const log = await onTestWebhook(selectedApp.id, selectedWebhookTrigger);
      if (log) {
        setPlaygroundOutput(
          JSON.stringify(
            {
              status: log.statusCode,
              latencyMs: log.latencyMs,
              endpoint: log.endpoint,
              summary: log.responseSummary,
            },
            null,
            2
          )
        );
      }
    } finally {
      setTestingWebhook(false);
    }
  };

  const handleRunEndpoint = async () => {
    if (!selectedApp || runningEndpoint) return;
    const def = API_ENDPOINTS.find((e) => e.endpoint === selectedEndpoint) ?? API_ENDPOINTS[0];
    setRunningEndpoint(true);
    try {
      const res = await onSimulateEndpointCall(selectedApp.id, def.endpoint, def.method);
      if (res) {
        setPlaygroundOutput(
          JSON.stringify(
            {
              status: res.log.statusCode,
              latencyMs: res.log.latencyMs,
              result: res.result,
            },
            null,
            2
          )
        );
      }
    } finally {
      setRunningEndpoint(false);
    }
  };

  const toggleScope = (scope: CreatorAppScope) => {
    setEditScopes((prev) =>
      prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope]
    );
  };

  const toggleWebhookTrigger = (trigger: WebhookTriggerEvent) => {
    setEditWebhookEvents((prev) =>
      prev.includes(trigger) ? prev.filter((t) => t !== trigger) : [...prev, trigger]
    );
  };

  const baseOrigin =
    typeof window !== 'undefined' ? window.location.origin : 'https://eventsapp.africa';

  const scopedEventObj = selectedApp?.eventId
    ? events.find((e) => e.id === selectedApp.eventId)
    : events[0];

  const snippetCode = useMemo(() => {
    if (!selectedApp) return '';
    const evtId = scopedEventObj?.id || 'evt-tech-leaders-2026';
    if (snippetLang === 'typescript') {
      return `// Events App SDK — ${selectedApp.name}
const client = {
  clientId: '${selectedApp.clientId}',
  environment: '${selectedApp.environment}',
  baseUrl: '${baseOrigin}/api',
};

const response = await fetch(\`\${client.baseUrl}/public/events/${evtId}/register\`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-EventsApp-Client': client.clientId,
  },
  body: JSON.stringify({
    name: 'Kwame Boateng',
    email: 'kwame@studio.africa',
    phone: '+233248901124',
    tier: 'General',
  }),
});

const { attendee, event } = await response.json();`;
    }
    if (snippetLang === 'curl') {
      return `curl -X GET "${baseOrigin}/api/public/events" \\
  -H "X-EventsApp-Client: ${selectedApp.clientId}" \\
  -H "X-EventsApp-Environment: ${selectedApp.environment}"`;
    }
    return `<script
  src="${baseOrigin}/embed/pass-widget.js"
  data-client-id="${selectedApp.clientId}"
  data-event-id="${evtId}"
  data-theme="monochrome"
  async
></script>`;
  }, [selectedApp, snippetLang, baseOrigin, scopedEventObj]);

  return (
    <div className="space-y-6">
      <TopUtilityBar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        searchPlaceholder="Search creator apps, client IDs, or app types..."
        alerts={alerts}
        onResolveAlert={onResolveAlert}
        onInspectAlertEvent={(eventId) => {
          const evt = events.find((e) => e.id === eventId);
          if (evt) onManageEvent(evt);
        }}
        profile={profile}
        onOpenSettings={onNavigateSettings}
      />

      {/* Creator Password Lock Screen when CREATOR_PASSWORD is enforced on server */}
      {creatorPasswordConfigured && !creatorUnlocked ? (
        <section className="rounded-3xl bg-[#F5F5F7] border border-[#E5E5EA] p-6 sm:p-10 max-w-lg mx-auto space-y-5">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-[#0B0B0B] text-white flex items-center justify-center shrink-0">
              <Lock className="w-5 h-5" />
            </div>
            <div>
              <h1 className="font-display text-xl font-bold text-[#0B0B0B]">
                Apps Creator Verification
              </h1>
              <p className="text-xs text-[#71717A] mt-0.5">
                Restricted to app developer <span className="font-mono text-[#0B0B0B]">{creatorEmail}</span>
              </p>
            </div>
          </div>

          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (!unlockPassword || unlocking) return;
              setUnlocking(true);
              setUnlockError(null);
              const err = await onUnlockCreator(unlockPassword);
              if (err) {
                setUnlockError(err);
              } else {
                setUnlockPassword('');
              }
              setUnlocking(false);
            }}
            className="space-y-4"
          >
            <div>
              <label
                htmlFor="creator-console-password"
                className="block text-xs font-semibold text-[#0B0B0B] mb-1.5"
              >
                CREATOR_PASSWORD
              </label>
              <input
                id="creator-console-password"
                type="password"
                required
                value={unlockPassword}
                onChange={(e) => setUnlockPassword(e.target.value)}
                placeholder="Enter server CREATOR_PASSWORD"
                className="w-full h-11 px-4 rounded-xl border border-[#E5E5EA] bg-white focus:border-[#0B0B0B] focus:outline-none text-sm"
              />
            </div>

            {unlockError && (
              <p className="text-xs font-semibold text-[#DC2626]">{unlockError}</p>
            )}

            <div className="flex flex-col sm:flex-row gap-2.5">
              <button
                type="submit"
                disabled={unlocking || !unlockPassword}
                className="flex-1 h-11 rounded-full bg-[#0B0B0B] text-white text-xs font-semibold hover:bg-neutral-800 disabled:opacity-50 transition-colors"
              >
                {unlocking ? 'Verifying...' : 'Unlock Apps Creator Console'}
              </button>
              <button
                type="button"
                onClick={onSignOut}
                className="h-11 px-4 rounded-full bg-white border border-[#E5E5EA] hover:border-[#0B0B0B] text-[#0B0B0B] text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Log Out</span>
              </button>
            </div>
          </form>
        </section>
      ) : (
        <>
          {!creatorPasswordConfigured && (
            <div className="rounded-2xl bg-[#F5F5F7] border border-[#E5E5EA] px-4 py-3 text-xs text-[#71717A] flex flex-wrap items-center justify-between gap-2">
              <span>
                Developer gate notice: set <span className="font-mono text-[#0B0B0B]">CREATOR_PASSWORD</span> in server environment variables to require a developer password for <span className="font-mono text-[#0B0B0B]">{creatorEmail}</span>.
              </span>
            </div>
          )}

          {/* Console Header */}
      <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 pb-5 border-b border-[#E5E5EA]">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-[-0.03em] text-[#0B0B0B] text-balance">
              Apps Builder Console
            </h1>
            {builderOverview && (
              <span className="px-2.5 py-0.5 rounded-md bg-[#F5F5F7] border border-[#E5E5EA] font-mono text-[11px] font-semibold text-[#0B0B0B] uppercase">
                {builderOverview.storageMode}
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-[#71717A] mt-1.5 tabular-nums">
            <span>{apps.length} {apps.length === 1 ? 'registered app' : 'registered apps'}</span>
            <span aria-hidden="true">·</span>
            <span>{totalRequests.toLocaleString()} logged requests</span>
            {builderOverview && (
              <>
                <span aria-hidden="true">·</span>
                <span>{builderOverview.tenants.length} organisers</span>
                <span aria-hidden="true">·</span>
                <span>DB {builderOverview.dbLatencyMs} ms</span>
                <span aria-hidden="true">·</span>
                <span>SMS {builderOverview.smsTelemetry.mode.toUpperCase()}</span>
              </>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto shrink-0">
          <button
            type="button"
            disabled={builderLoading}
            onClick={refreshBuilderOverview}
            className="px-3.5 py-2 rounded-full border border-[#E5E5EA] bg-white hover:border-[#0B0B0B] disabled:opacity-50 text-[#0B0B0B] text-xs font-semibold transition-colors inline-flex items-center gap-1.5 whitespace-nowrap"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${builderLoading ? 'animate-spin' : ''}`} />
            <span>Refresh Telemetry</span>
          </button>
          <button
            type="button"
            onClick={onSignOut}
            className="px-3.5 py-2 rounded-full border border-[#E5E5EA] bg-white hover:border-[#0B0B0B] text-[#0B0B0B] text-xs font-semibold transition-colors inline-flex items-center gap-1.5 whitespace-nowrap"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Log Out</span>
          </button>
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="px-4 py-2 rounded-full bg-[#0B0B0B] text-white text-xs font-semibold hover:bg-neutral-800 transition-colors inline-flex items-center gap-1.5 whitespace-nowrap"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New App</span>
          </button>
        </div>
      </header>

      {/* Builder Section Switcher */}
      <nav aria-label="Builder Console Sections" className="flex flex-nowrap sm:flex-wrap items-center gap-1 p-1 bg-[#F5F5F7] rounded-xl overflow-x-auto max-w-full">
        {(
          [
            { id: 'pulse', label: 'Platform Pulse', icon: Activity },
            {
              id: 'tenants',
              label: `Organisers & Tenants${builderOverview ? ` (${builderOverview.tenants.length})` : ''}`,
              icon: Users,
            },
            {
              id: 'diagnostics',
              label: `Live Diagnostics${
                builderOverview && builderOverview.diagnosticFailures.filter((d) => !d.replayed).length > 0
                  ? ` (${builderOverview.diagnosticFailures.filter((d) => !d.replayed).length})`
                  : ''
              }`,
              icon: Zap,
            },
            { id: 'switches', label: 'Kill Switches & Env', icon: Power },
            { id: 'economics', label: 'Unit Economics', icon: DollarSign },
            { id: 'apps', label: `App Clients & Webhooks (${apps.length})`, icon: Terminal },
          ] as {
            id: ConsoleSection;
            label: string;
            icon: React.ComponentType<{ className?: string }>;
          }[]
        ).map((sec) => {
          const Icon = sec.icon;
          const active = consoleSection === sec.id;
          return (
            <button
              key={sec.id}
              type="button"
              onClick={() => setConsoleSection(sec.id)}
              className={`px-3.5 py-2 text-xs font-medium rounded-lg transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
                active ? 'bg-white text-[#0B0B0B] shadow-xs' : 'text-[#71717A] hover:text-[#0B0B0B]'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{sec.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Builder Feedback & Error Banners */}
      {builderFeedback && (
        <div className="rounded-2xl bg-[#0B0B0B] text-white px-4 py-3 text-xs font-medium flex items-center justify-between gap-3">
          <span className="inline-flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            {builderFeedback}
          </span>
          <button
            type="button"
            onClick={() => setBuilderFeedback(null)}
            className="text-zinc-300 hover:text-white"
            aria-label="Dismiss notification"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {builderError && (
        <div className="rounded-2xl bg-[#F5F5F7] border border-[#DC2626] text-[#DC2626] px-4 py-3 text-xs font-medium flex items-center justify-between gap-3">
          <span className="inline-flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            {builderError}
          </span>
          <button
            type="button"
            onClick={() => setBuilderError(null)}
            className="text-[#DC2626] hover:opacity-75"
            aria-label="Dismiss error"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* One-Time Client Secret Reveal */}
      {revealedSecret && (
        <section
          aria-label="New Client Credentials"
          className="rounded-3xl bg-[#0B0B0B] text-white p-5 sm:p-6 space-y-4"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="font-display text-base font-bold tracking-tight">
                Copy credentials for {revealedSecret.appName}
              </h2>
              <p className="text-xs text-zinc-300 mt-1">
                Your client secret is hashed before storage in Supabase and will not be shown in full again.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setRevealedSecret(null)}
              aria-label="Dismiss credentials"
              className="p-1.5 rounded-full hover:bg-white/10 text-zinc-300 hover:text-white shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            {[
              { id: 'rev-client', label: 'Client ID', value: revealedSecret.clientId },
              { id: 'rev-secret', label: 'Client Secret', value: revealedSecret.rawSecret },
              { id: 'rev-wh', label: 'Webhook HMAC Secret', value: revealedSecret.webhookSecret },
            ].map((cred) => (
              <div
                key={cred.id}
                className="rounded-2xl bg-white/10 border border-white/15 px-4 py-3 flex items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <p className="text-[11px] font-medium text-zinc-400">{cred.label}</p>
                  <p className="font-mono text-xs text-white truncate mt-0.5 tabular-nums">
                    {cred.value}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => handleCopy(cred.id, cred.value)}
                  className="px-3 py-1.5 rounded-lg bg-white text-[#0B0B0B] text-[11px] font-semibold hover:bg-zinc-200 transition-colors inline-flex items-center gap-1 whitespace-nowrap shrink-0"
                >
                  {copiedKey === cred.id ? (
                    <>
                      <Check className="w-3 h-3" />
                      Copied
                    </>
                  ) : (
                    <>
                      <Copy className="w-3 h-3" />
                      Copy
                    </>
                  )}
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* SECTION A: PLATFORM & GATEWAY HEALTH */}
      {consoleSection === 'pulse' && (
        <div className="space-y-6">
          {!builderOverview ? (
            <section className="rounded-3xl border border-[#E5E5EA] bg-[#F5F5F7] p-8 text-center text-xs text-[#71717A]">
              {builderLoading ? 'Loading platform telemetry...' : 'Telemetry unavailable.'}
            </section>
          ) : (
            <>
              {/* Database & Schema Health */}
              <section className="rounded-3xl border border-[#E5E5EA] bg-white p-5 sm:p-6 space-y-5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-2xl bg-[#F5F5F7] border border-[#E5E5EA] flex items-center justify-center text-[#0B0B0B] shrink-0">
                      <Database className="w-4 h-4" />
                    </div>
                    <div>
                      <h2 className="font-display text-base font-bold text-[#0B0B0B]">
                        Database &amp; RLS Schema Health
                      </h2>
                      <p className="text-xs text-[#71717A]">
                        Live row counts, RLS check, and connection latency across core tables
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs font-mono tabular-nums">
                    <span className="px-2.5 py-1 rounded-md bg-[#F5F5F7] border border-[#E5E5EA] text-[#0B0B0B]">
                      {builderOverview.storageMode === 'supabase' ? 'Supabase Postgres' : 'In-Memory Store'}
                    </span>
                    <span className="px-2.5 py-1 rounded-md bg-[#F5F5F7] border border-[#E5E5EA] text-[#0B0B0B]">
                      Latency {builderOverview.dbLatencyMs} ms
                    </span>
                    <span
                      className={`px-2.5 py-1 rounded-md border font-semibold ${
                        builderOverview.rlsVerified
                          ? 'bg-[#F5F5F7] border-[#E5E5EA] text-[#16A34A]'
                          : 'bg-[#F5F5F7] border-[#D97706] text-[#D97706]'
                      }`}
                    >
                      {builderOverview.rlsVerified ? 'RLS Enforced' : 'RLS Unverified'}
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                  {(
                    [
                      { key: 'profiles', label: 'profiles' },
                      { key: 'events', label: 'events' },
                      { key: 'attendees', label: 'attendees' },
                      { key: 'disposable_shots', label: 'disposable_shots' },
                      { key: 'creator_apps', label: 'creator_apps' },
                    ] as const
                  ).map((tbl) => (
                    <div
                      key={tbl.key}
                      className="rounded-2xl bg-[#F5F5F7] border border-[#E5E5EA] p-4"
                    >
                      <p className="font-mono text-[11px] text-[#71717A]">{tbl.label}</p>
                      <p className="font-display text-2xl font-bold text-[#0B0B0B] mt-1 tabular-nums">
                        {builderOverview.tableCounts[tbl.key].toLocaleString()}
                      </p>
                    </div>
                  ))}
                </div>
              </section>

              {/* SMS & Email Delivery Telemetry */}
              <section className="rounded-3xl border border-[#E5E5EA] bg-white p-5 sm:p-6 space-y-5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-2xl bg-[#F5F5F7] border border-[#E5E5EA] flex items-center justify-center text-[#0B0B0B] shrink-0">
                      <Smartphone className="w-4 h-4" />
                    </div>
                    <div>
                      <h2 className="font-display text-base font-bold text-[#0B0B0B]">
                        Arkesel SMS &amp; Gateway Telemetry
                      </h2>
                      <p className="text-xs text-[#71717A]">
                        Carrier delivery rate, active Sender ID, DLR receipts &amp; retry queue
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="px-2.5 py-1 rounded-md bg-[#F5F5F7] border border-[#E5E5EA] font-mono text-xs font-semibold text-[#0B0B0B]">
                      Sender: {builderOverview.smsTelemetry.activeSenderId || 'EVENTSAPP'}
                    </span>
                    <span className="px-2.5 py-1 rounded-md bg-[#F5F5F7] border border-[#E5E5EA] font-mono text-xs font-semibold text-[#0B0B0B] uppercase">
                      Mode: {builderOverview.smsTelemetry.mode}
                    </span>
                    <button
                      type="button"
                      disabled={syncingDlr}
                      onClick={() => void handleSyncSmsDlr()}
                      className="px-3.5 py-1.5 rounded-full bg-white border border-[#E5E5EA] hover:border-[#0B0B0B] text-xs font-semibold text-[#0B0B0B] inline-flex items-center gap-1.5 disabled:opacity-50"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${syncingDlr ? 'animate-spin' : ''}`} />
                      <span>{syncingDlr ? 'Syncing...' : 'Sync Balance & DLR'}</span>
                    </button>
                    {builderOverview.smsTelemetry.failedQueue.length > 0 && (
                      <button
                        type="button"
                        disabled={actionBusyId === 'sms-all'}
                        onClick={() => handleRetrySms()}
                        className="px-3.5 py-1.5 rounded-full bg-[#0B0B0B] text-white text-xs font-semibold hover:bg-neutral-800 disabled:opacity-50 inline-flex items-center gap-1.5"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span>
                          {actionBusyId === 'sms-all'
                            ? 'Retrying...'
                            : `Retry All (${builderOverview.smsTelemetry.failedQueue.length})`}
                        </span>
                      </button>
                    )}
                  </div>
                </div>

                {builderOverview.smsTelemetry.usingDefaultSenderIdWarning && (
                  <div className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-xs text-amber-950">
                    <strong>Carrier Filter Warning:</strong> Server default Sender ID is unverified (
                    <span className="font-mono">{builderOverview.smsTelemetry.activeSenderId}</span>). Ghana telcos (MTN/Telecel/AT) deduct Arkesel SMS credits on API acceptance but silently drop unregistered Sender IDs. Register an approved Sender ID in Arkesel or override it under Kill Switches.
                  </div>
                )}

                {(dlrSyncSummary || builderOverview.smsTelemetry.gatewayBalanceError) && (
                  <div className="rounded-2xl bg-[#F5F5F7] border border-[#E5E5EA] px-4 py-2.5 text-xs text-[#0B0B0B] flex flex-wrap items-center justify-between gap-2">
                    <span>{dlrSyncSummary || builderOverview.smsTelemetry.gatewayBalanceError}</span>
                    {builderOverview.smsTelemetry.dlrWebhookUrl && (
                      <span className="font-mono text-[11px] text-[#71717A]">
                        DLR Webhook: {builderOverview.smsTelemetry.dlrWebhookUrl}
                      </span>
                    )}
                  </div>
                )}

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="rounded-2xl bg-[#F5F5F7] p-4">
                    <p className="text-xs text-[#71717A]">Delivery Success</p>
                    <p className="font-display text-2xl font-bold text-[#0B0B0B] mt-1 tabular-nums">
                      {builderOverview.smsTelemetry.successRatePct}%
                    </p>
                    <p className="text-[11px] text-[#71717A] mt-0.5 tabular-nums">
                      {builderOverview.smsTelemetry.deliveredCount} / {builderOverview.smsTelemetry.totalDispatched} passes
                    </p>
                  </div>
                  <div className="rounded-2xl bg-[#F5F5F7] p-4">
                    <p className="text-xs text-[#71717A]">Pending / Failed</p>
                    <p className="font-display text-2xl font-bold text-[#0B0B0B] mt-1 tabular-nums">
                      {builderOverview.smsTelemetry.pendingOrFailedCount}
                    </p>
                    <p className="text-[11px] text-[#71717A] mt-0.5">Queued for retry</p>
                  </div>
                  <div className="rounded-2xl bg-[#F5F5F7] p-4">
                    <p className="text-xs text-[#71717A]">Gateway Balance</p>
                    <p className="font-display text-2xl font-bold text-[#0B0B0B] mt-1 tabular-nums">
                      {builderOverview.smsTelemetry.gatewayBalanceCredits.toLocaleString()}
                    </p>
                    <p className="text-[11px] text-[#71717A] mt-0.5">
                      {builderOverview.smsTelemetry.gatewayBalanceLive ? 'Live Arkesel balance' : 'Arkesel pool credits'}
                    </p>
                  </div>
                  <div className="rounded-2xl bg-[#F5F5F7] p-4">
                    <p className="text-xs text-[#71717A]">Tenant Liabilities</p>
                    <p className="font-display text-2xl font-bold text-[#0B0B0B] mt-1 tabular-nums">
                      {builderOverview.smsTelemetry.organizerCreditLiabilities.toLocaleString()}
                    </p>
                    <p className="text-[11px] text-[#71717A] mt-0.5">Allocated to organisers</p>
                  </div>
                </div>

                {builderOverview.smsTelemetry.recentDispatches &&
                  builderOverview.smsTelemetry.recentDispatches.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-xs font-semibold text-[#0B0B0B]">
                        Recent Arkesel Carrier Receipts &amp; DLR Status
                      </p>
                      <div className="rounded-2xl border border-[#E5E5EA] overflow-x-auto">
                        <table className="w-full text-left border-collapse text-xs">
                          <thead>
                            <tr className="border-b border-[#E5E5EA] bg-[#F5F5F7] text-[#71717A] font-semibold">
                              <th className="py-2 px-3">Recipient</th>
                              <th className="py-2 px-3">Sender ID</th>
                              <th className="py-2 px-3">Purpose</th>
                              <th className="py-2 px-3">Gateway</th>
                              <th className="py-2 px-3">DLR</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[#E5E5EA]">
                            {builderOverview.smsTelemetry.recentDispatches.slice(0, 10).map((d) => (
                              <tr key={d.id}>
                                <td className="py-2 px-3 font-mono text-[#0B0B0B]">{d.recipient}</td>
                                <td className="py-2 px-3 font-mono text-[#0B0B0B]">{d.senderId}</td>
                                <td className="py-2 px-3 uppercase text-[11px] text-[#71717A]">{d.purpose}</td>
                                <td className="py-2 px-3 font-mono text-[#0B0B0B]">{d.gatewayStatus}</td>
                                <td className="py-2 px-3 font-mono font-semibold text-[#0B0B0B]">
                                  {d.dlrStatus}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                {builderOverview.smsTelemetry.failedQueue.length === 0 ? (
                  <p className="text-xs text-[#71717A] bg-[#F5F5F7] rounded-2xl px-4 py-3">
                    SMS queue is clear — no failed or unconfirmed carrier receipts.
                  </p>
                ) : (
                  <div className="rounded-2xl border border-[#E5E5EA] overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="border-b border-[#E5E5EA] bg-[#F5F5F7] text-[#71717A] font-semibold">
                          <th className="py-2.5 px-4">Guest</th>
                          <th className="py-2.5 px-4">Phone</th>
                          <th className="py-2.5 px-4">Event</th>
                          <th className="py-2.5 px-4">Status</th>
                          <th className="py-2.5 px-4 text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#E5E5EA]">
                        {builderOverview.smsTelemetry.failedQueue.map((item) => (
                          <tr key={item.attendeeId} className="hover:bg-[#F5F5F7]/60">
                            <td className="py-2.5 px-4 font-semibold text-[#0B0B0B]">
                              {item.attendeeName}
                            </td>
                            <td className="py-2.5 px-4 font-mono text-[#71717A]">
                              {item.phone}
                            </td>
                            <td className="py-2.5 px-4 text-[#0B0B0B] max-w-[220px] truncate">
                              {item.eventTitle}
                            </td>
                            <td className="py-2.5 px-4 font-mono text-[#D97706] font-semibold">
                              {item.smsStatus}
                            </td>
                            <td className="py-2.5 px-4 text-right">
                              <button
                                type="button"
                                disabled={actionBusyId === `sms-${item.attendeeId}`}
                                onClick={() => handleRetrySms(item.attendeeId)}
                                className="px-3 py-1 rounded-full border border-[#E5E5EA] hover:border-[#0B0B0B] text-xs font-semibold text-[#0B0B0B] disabled:opacity-50"
                              >
                                {actionBusyId === `sms-${item.attendeeId}` ? 'Retrying...' : 'Retry'}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              {/* Resend Email Deliverability & Anti-Spam Diagnostics */}
              {builderOverview.emailDiagnostics && (
                <section className="rounded-3xl border border-[#E5E5EA] bg-white p-5 sm:p-6 space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-2xl bg-[#F5F5F7] border border-[#E5E5EA] flex items-center justify-center text-[#0B0B0B] shrink-0">
                        <Mail className="w-4 h-4" />
                      </div>
                      <div>
                        <h2 className="font-display text-base font-bold text-[#0B0B0B]">
                          Resend Email Deliverability &amp; Spam Protection
                        </h2>
                        <p className="text-xs text-[#71717A]">
                          SPF / DKIM domain verification, Reply-To header alignment, and sandbox sender detection
                        </p>
                      </div>
                    </div>
                    <span
                      className={`px-3 py-1 rounded-full font-mono text-xs font-semibold uppercase ${
                        builderOverview.emailDiagnostics.dnsStatus === 'verified'
                          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                          : 'bg-amber-50 text-amber-800 border border-amber-200'
                      }`}
                    >
                      DNS: {builderOverview.emailDiagnostics.dnsStatus}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                    <div className="rounded-2xl bg-[#F5F5F7] p-3.5">
                      <span className="text-[#71717A] block">Active From Identity</span>
                      <span className="font-mono font-semibold text-[#0B0B0B] mt-1 block break-all">
                        {builderOverview.emailDiagnostics.activeFrom}
                      </span>
                    </div>
                    <div className="rounded-2xl bg-[#F5F5F7] p-3.5">
                      <span className="text-[#71717A] block">Sending Domain</span>
                      <span className="font-mono font-semibold text-[#0B0B0B] mt-1 block">
                        {builderOverview.emailDiagnostics.domainName}{' '}
                        {builderOverview.emailDiagnostics.domainVerified ? '(Verified)' : '(Unverified)'}
                      </span>
                    </div>
                    <div className="rounded-2xl bg-[#F5F5F7] p-3.5">
                      <span className="text-[#71717A] block">Verified Resend Domains</span>
                      <span className="font-mono font-semibold text-[#0B0B0B] mt-1 block">
                        {builderOverview.emailDiagnostics.verifiedDomains.length > 0
                          ? builderOverview.emailDiagnostics.verifiedDomains.join(', ')
                          : 'None yet'}
                      </span>
                    </div>
                  </div>

                  <p className="text-xs text-[#0B0B0B] bg-[#F5F5F7] border border-[#E5E5EA] rounded-2xl px-4 py-3 leading-relaxed">
                    {builderOverview.emailDiagnostics.recommendation}
                  </p>
                </section>
              )}

              {/* Recent Server & Constraint Error Stack Traces */}
              <section className="rounded-3xl border border-[#E5E5EA] bg-white p-5 sm:p-6 space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="font-display text-base font-bold text-[#0B0B0B]">
                      Error &amp; Constraint Trace Buffer
                    </h2>
                    <p className="text-xs text-[#71717A]">
                      Database constraint errors, RLS denials, and carrier exceptions captured by API middleware
                    </p>
                  </div>
                  {builderOverview.recentErrors.length > 0 && (
                    <button
                      type="button"
                      disabled={actionBusyId === 'clear-errors'}
                      onClick={handleClearErrors}
                      className="px-3.5 py-1.5 rounded-full border border-[#E5E5EA] hover:border-[#0B0B0B] text-xs font-semibold text-[#0B0B0B]"
                    >
                      Clear Buffer
                    </button>
                  )}
                </div>

                {builderOverview.recentErrors.length === 0 ? (
                  <p className="text-xs text-[#71717A] bg-[#F5F5F7] rounded-2xl px-4 py-3">
                    No unhandled constraint or runtime errors recorded in this session.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {builderOverview.recentErrors.map((err) => (
                      <div
                        key={err.id}
                        className="rounded-2xl bg-[#F5F5F7] border border-[#E5E5EA] p-4 space-y-2"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                          <span className="font-mono font-semibold text-[#DC2626]">{err.source}</span>
                          <span className="font-mono text-[#71717A]">
                            {new Date(err.timestamp).toLocaleString()}
                          </span>
                        </div>
                        <p className="text-xs font-semibold text-[#0B0B0B]">{err.message}</p>
                        {err.stack && (
                          <pre className="rounded-xl bg-[#0B0B0B] text-zinc-200 p-3 font-mono text-[11px] overflow-x-auto">
                            {err.stack}
                          </pre>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </>
          )}
        </div>
      )}

      {/* SECTION B: ORGANISER & TENANT DIRECTORY */}
      {consoleSection === 'tenants' && (
        <section className="rounded-3xl border border-[#E5E5EA] bg-white p-5 sm:p-6 space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-lg font-bold text-[#0B0B0B]">
                Organiser &amp; Tenant Directory
              </h2>
              <p className="text-xs text-[#71717A]">
                Search accounts, adjust RBAC roles, top up SMS credits, grant promo plans, suspend accounts, or inspect tenant data read-only
              </p>
            </div>
            <input
              type="search"
              value={tenantSearch}
              onChange={(e) => setTenantSearch(e.target.value)}
              placeholder="Filter name, email, studio, plan, role..."
              className="w-full sm:w-72 h-10 px-3.5 rounded-xl border border-[#E5E5EA] focus:border-[#0B0B0B] focus:outline-none text-xs"
            />
          </div>

          {!builderOverview ? (
            <p className="text-xs text-[#71717A]">Loading directory...</p>
          ) : filteredTenants.length === 0 ? (
            <p className="text-xs text-[#71717A] bg-[#F5F5F7] rounded-2xl px-4 py-3">
              No organiser accounts match your search filter.
            </p>
          ) : (
            <div className="rounded-2xl border border-[#E5E5EA] overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-[#E5E5EA] bg-[#F5F5F7] text-[#71717A] font-semibold">
                    <th className="py-3 px-4">Organiser / Studio</th>
                    <th className="py-3 px-4">RBAC Role</th>
                    <th className="py-3 px-4">Plan</th>
                    <th className="py-3 px-4">Activity &amp; Storage</th>
                    <th className="py-3 px-4">SMS Credits</th>
                    <th className="py-3 px-4 text-right">Builder Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E5E5EA]">
                  {filteredTenants.map((tenant) => (
                    <tr
                      key={tenant.id}
                      className={tenant.suspended ? 'bg-[#F5F5F7]/80' : 'hover:bg-[#F5F5F7]/40'}
                    >
                      <td className="py-3.5 px-4 align-top">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-[#0B0B0B]">{tenant.name}</span>
                          {tenant.suspended && (
                            <span className="px-2 py-0.5 rounded-md bg-[#0B0B0B] text-white font-mono text-[10px]">
                              SUSPENDED
                            </span>
                          )}
                        </div>
                        <p className="font-mono text-[11px] text-[#71717A] mt-0.5">{tenant.email}</p>
                        <p className="text-[11px] text-[#71717A] mt-0.5">{tenant.studio}</p>
                        <p className="text-[10px] text-[#71717A] mt-1 font-mono tabular-nums">
                          Joined {new Date(tenant.createdAt).toLocaleDateString()} · Last login{' '}
                          {new Date(tenant.lastLoginAt).toLocaleDateString()}
                        </p>
                      </td>
                      <td className="py-3.5 px-4 align-top">
                        <select
                          aria-label={`RBAC role for ${tenant.email}`}
                          value={tenant.appRole}
                          disabled={actionBusyId === `role-${tenant.id}`}
                          onChange={(e) => handleUpdateRole(tenant.id, e.target.value as AppRole)}
                          className="h-8 px-2.5 rounded-lg border border-[#E5E5EA] bg-white font-mono text-xs text-[#0B0B0B]"
                        >
                          <option value="organizer">organizer</option>
                          <option value="gate_staff">gate_staff</option>
                          <option value="creator">creator</option>
                        </select>
                      </td>
                      <td className="py-3.5 px-4 align-top">
                        <select
                          aria-label={`Plan for ${tenant.email}`}
                          value={tenant.plan}
                          disabled={actionBusyId === `plan-${tenant.id}`}
                          onChange={(e) =>
                            handleUpdatePlan(tenant.id, e.target.value as OrganizerProfile['plan'])
                          }
                          className="h-8 px-2.5 rounded-lg border border-[#E5E5EA] bg-white text-xs text-[#0B0B0B]"
                        >
                          <option value="Starter">Starter</option>
                          <option value="Pro Organizer">Pro Organizer</option>
                          <option value="Enterprise">Enterprise</option>
                        </select>
                      </td>
                      <td className="py-3.5 px-4 align-top font-mono tabular-nums text-[11px] text-[#0B0B0B]">
                        <div>{tenant.eventsCount} events · {tenant.attendeesCount} guests</div>
                        <div className="text-[#71717A] mt-0.5">
                          {tenant.shotsCount} shots · {tenant.storageMb} MB
                        </div>
                      </td>
                      <td className="py-3.5 px-4 align-top">
                        <div className="font-mono font-semibold text-[#0B0B0B] tabular-nums">
                          {tenant.smsCredits.toLocaleString()}
                        </div>
                        <div className="flex items-center gap-1 mt-1.5">
                          <button
                            type="button"
                            disabled={actionBusyId === `topup-${tenant.id}`}
                            onClick={() => handleTopUp(tenant.id, 100)}
                            className="px-2 py-0.5 rounded-md border border-[#E5E5EA] hover:border-[#0B0B0B] font-mono text-[10px] font-semibold text-[#0B0B0B]"
                          >
                            +100
                          </button>
                          <button
                            type="button"
                            disabled={actionBusyId === `topup-${tenant.id}`}
                            onClick={() => handleTopUp(tenant.id, 500)}
                            className="px-2 py-0.5 rounded-md border border-[#E5E5EA] hover:border-[#0B0B0B] font-mono text-[10px] font-semibold text-[#0B0B0B]"
                          >
                            +500
                          </button>
                        </div>
                      </td>
                      <td className="py-3.5 px-4 align-top text-right">
                        <div className="flex flex-wrap justify-end gap-1.5">
                          <button
                            type="button"
                            disabled={inspectLoading}
                            onClick={() => handleInspectTenant(tenant.id)}
                            className="px-2.5 py-1.5 rounded-lg border border-[#E5E5EA] hover:border-[#0B0B0B] text-[11px] font-semibold text-[#0B0B0B] inline-flex items-center gap-1"
                          >
                            <Eye className="w-3 h-3" />
                            Inspect
                          </button>
                          <button
                            type="button"
                            disabled={actionBusyId === `revoke-${tenant.id}`}
                            onClick={() => handleRevokeSessions(tenant.id)}
                            className="px-2.5 py-1.5 rounded-lg border border-[#E5E5EA] hover:border-[#0B0B0B] text-[11px] font-semibold text-[#0B0B0B] inline-flex items-center gap-1"
                          >
                            <UserCheck className="w-3 h-3" />
                            Revoke Sessions
                          </button>
                          <button
                            type="button"
                            disabled={actionBusyId === `suspend-${tenant.id}`}
                            onClick={() => handleSuspendTenant(tenant.id)}
                            className={`px-2.5 py-1.5 rounded-lg border text-[11px] font-semibold inline-flex items-center gap-1 ${
                              tenant.suspended
                                ? 'border-[#0B0B0B] bg-[#0B0B0B] text-white'
                                : 'border-[#E5E5EA] hover:border-[#DC2626] hover:text-[#DC2626] text-[#0B0B0B]'
                            }`}
                          >
                            <Ban className="w-3 h-3" />
                            {tenant.suspended ? 'Restore' : 'Suspend'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* SECTION C: LIVE EVENT & CHECK-IN DIAGNOSTICS */}
      {consoleSection === 'diagnostics' && builderOverview && (
        <div className="space-y-6">
          <section className="rounded-3xl border border-[#E5E5EA] bg-white p-5 sm:p-6 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="font-display text-lg font-bold text-[#0B0B0B]">
                  Cross-Event Traffic &amp; 35mm Camera Roll Telemetry
                </h2>
                <p className="text-xs text-[#71717A]">
                  Real-time capacity fill, duplicate-phone blocks ({builderOverview.totalDuplicateBlocks} blocked), and camera roll storage
                </p>
              </div>
            </div>

            <div className="rounded-2xl border border-[#E5E5EA] overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-[#E5E5EA] bg-[#F5F5F7] text-[#71717A] font-semibold">
                    <th className="py-3 px-4">Event</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4">Registered / Cap</th>
                    <th className="py-3 px-4">Checked In</th>
                    <th className="py-3 px-4">Duplicate Blocks</th>
                    <th className="py-3 px-4">35mm Roll</th>
                    <th className="py-3 px-4 text-right">Public Reg Switch</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E5E5EA]">
                  {builderOverview.eventTraffic.map((row) => (
                    <tr key={row.eventId} className="hover:bg-[#F5F5F7]/50">
                      <td className="py-3 px-4">
                        <p className="font-semibold text-[#0B0B0B]">{row.title}</p>
                        <p className="font-mono text-[11px] text-[#71717A]">/{row.slug}</p>
                      </td>
                      <td className="py-3 px-4 font-mono">{row.status}</td>
                      <td className="py-3 px-4 font-mono tabular-nums">
                        {row.registered} / {row.capacity}
                      </td>
                      <td className="py-3 px-4 font-mono tabular-nums">{row.checkedIn}</td>
                      <td className="py-3 px-4 font-mono tabular-nums">{row.duplicateBlocks}</td>
                      <td className="py-3 px-4 font-mono tabular-nums">
                        {row.cameraShots} frames · {row.cameraStorageMb} MB
                      </td>
                      <td className="py-3 px-4 text-right">
                        <button
                          type="button"
                          disabled={actionBusyId === `evt-pause-${row.eventId}`}
                          onClick={() =>
                            handleToggleEventPause(row.eventId, row.registrationPaused)
                          }
                          className={`px-3 py-1 rounded-full text-xs font-semibold border transition-colors ${
                            row.registrationPaused
                              ? 'bg-[#0B0B0B] text-white border-[#0B0B0B]'
                              : 'bg-white text-[#0B0B0B] border-[#E5E5EA] hover:border-[#0B0B0B]'
                          }`}
                        >
                          {row.registrationPaused ? 'Paused (Resume)' : 'Accepting (Pause)'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-3xl border border-[#E5E5EA] bg-white p-5 sm:p-6 space-y-4">
            <div>
              <h2 className="font-display text-lg font-bold text-[#0B0B0B]">
                QR, Client Auth &amp; Webhook Failure Inspector
              </h2>
              <p className="text-xs text-[#71717A]">
                Inspect rejected QR scans, invalid client IDs, and failed webhook payloads with 1-click replay
              </p>
            </div>

            {builderOverview.diagnosticFailures.length === 0 ? (
              <p className="text-xs text-[#71717A] bg-[#F5F5F7] rounded-2xl px-4 py-3">
                No diagnostic failures captured.
              </p>
            ) : (
              <div className="space-y-3">
                {builderOverview.diagnosticFailures.map((item) => (
                  <div
                    key={item.id}
                    className="rounded-2xl border border-[#E5E5EA] bg-[#F5F5F7] p-4 space-y-2.5"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2 text-xs">
                        <span className="px-2 py-0.5 rounded-md bg-white border border-[#E5E5EA] font-mono uppercase text-[10px] font-semibold text-[#0B0B0B]">
                          {item.kind}
                        </span>
                        <span className="font-mono font-semibold text-[#0B0B0B]">{item.target}</span>
                        <span className="font-mono text-[#DC2626] font-semibold">
                          HTTP {item.statusCode}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[11px] text-[#71717A]">
                          {new Date(item.timestamp).toLocaleString()}
                        </span>
                        <button
                          type="button"
                          disabled={item.replayed || actionBusyId === `diag-${item.id}`}
                          onClick={() => handleReplayDiagnostic(item.id)}
                          className="px-3 py-1 rounded-full bg-[#0B0B0B] text-white text-xs font-semibold hover:bg-neutral-800 disabled:opacity-45"
                        >
                          {item.replayed
                            ? 'Replayed'
                            : actionBusyId === `diag-${item.id}`
                            ? 'Replaying...'
                            : 'Replay'}
                        </button>
                      </div>
                    </div>
                    <p className="text-xs text-[#0B0B0B]">{item.reason}</p>
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                      <pre className="rounded-xl bg-[#0B0B0B] text-zinc-200 p-3 font-mono text-[11px] overflow-x-auto">
                        {item.payloadPreview}
                      </pre>
                      {item.expectedDiff && (
                        <pre className="rounded-xl bg-white border border-[#E5E5EA] text-[#0B0B0B] p-3 font-mono text-[11px] overflow-x-auto">
                          {item.expectedDiff}
                        </pre>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      {/* SECTION D: FEATURE KILL SWITCHES & ENV CONTROLS */}
      {consoleSection === 'switches' && builderOverview && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
          <section className="rounded-3xl border border-[#E5E5EA] bg-white p-5 sm:p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-[#F5F5F7] border border-[#E5E5EA] flex items-center justify-center text-[#0B0B0B]">
                <ShieldAlert className="w-4 h-4" />
              </div>
              <div>
                <h2 className="font-display text-base font-bold text-[#0B0B0B]">
                  Runtime Feature Kill Switches
                </h2>
                <p className="text-xs text-[#71717A]">
                  Applied immediately across public &amp; studio APIs without redeploy
                </p>
              </div>
            </div>

            <div className="divide-y divide-[#E5E5EA] rounded-2xl border border-[#E5E5EA]">
              <div className="p-4 flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold text-[#0B0B0B]">
                    Global Public Registrations
                  </p>
                  <p className="text-xs text-[#71717A]">
                    Emergency freeze for all public RSVP checkout endpoints
                  </p>
                </div>
                <button
                  type="button"
                  disabled={actionBusyId === 'flag-Global Registrations'}
                  onClick={() =>
                    handleUpdateFlag(
                      { publicRegistrationsPaused: !builderOverview.flags.publicRegistrationsPaused },
                      'Global Registrations'
                    )
                  }
                  className={`px-3.5 py-1.5 rounded-full text-xs font-semibold border shrink-0 ${
                    builderOverview.flags.publicRegistrationsPaused
                      ? 'bg-[#0B0B0B] text-white border-[#0B0B0B]'
                      : 'bg-white text-[#0B0B0B] border-[#E5E5EA] hover:border-[#0B0B0B]'
                  }`}
                >
                  {builderOverview.flags.publicRegistrationsPaused ? 'Paused (Resume)' : 'Live (Pause All)'}
                </button>
              </div>

              <div className="p-4 flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold text-[#0B0B0B]">Arkesel SMS Dispatch Mode</p>
                  <p className="text-xs text-[#71717A]">
                    Switch between live telecom carrier delivery and dry-run sandbox
                  </p>
                </div>
                <button
                  type="button"
                  disabled={actionBusyId === 'flag-SMS Mode'}
                  onClick={() =>
                    handleUpdateFlag(
                      { smsMode: builderOverview.flags.smsMode === 'live' ? 'sandbox' : 'live' },
                      'SMS Mode'
                    )
                  }
                  className={`px-3.5 py-1.5 rounded-full text-xs font-semibold border shrink-0 font-mono uppercase ${
                    builderOverview.flags.smsMode === 'live'
                      ? 'bg-[#0B0B0B] text-white border-[#0B0B0B]'
                      : 'bg-[#F5F5F7] text-[#0B0B0B] border-[#E5E5EA]'
                  }`}
                >
                  {builderOverview.flags.smsMode === 'live' ? 'LIVE ARKESEL' : 'SANDBOX DRY-RUN'}
                </button>
              </div>

              <div className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold text-[#0B0B0B]">
                    Arkesel Default Sender ID Override
                  </p>
                  <p className="text-xs text-[#71717A]">
                    Platform fallback Sender ID (up to 11 alphanumeric chars) when an organizer/event does not set a custom Sender ID
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <input
                    type="text"
                    maxLength={11}
                    value={defaultSenderInput}
                    onChange={(e) =>
                      setDefaultSenderInput(
                        e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 11)
                      )
                    }
                    placeholder="EVENTSAPP"
                    className="w-36 h-9 px-3 rounded-xl bg-[#F5F5F7] border border-[#E5E5EA] font-mono text-xs font-bold uppercase text-[#0B0B0B] focus:outline-none focus:border-[#0B0B0B]"
                  />
                  <button
                    type="button"
                    disabled={actionBusyId === 'flag-Arkesel Sender ID'}
                    onClick={() =>
                      handleUpdateFlag(
                        { arkeselSenderId: defaultSenderInput || 'EVENTSAPP' },
                        'Arkesel Sender ID'
                      )
                    }
                    className="px-3.5 h-9 rounded-full bg-[#0B0B0B] text-white text-xs font-semibold hover:bg-neutral-800 disabled:opacity-50"
                  >
                    Apply
                  </button>
                </div>
              </div>

              <div className="p-4 flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold text-[#0B0B0B]">New Organiser Signups</p>
                  <p className="text-xs text-[#71717A]">
                    Allow or temporarily pause public account creation
                  </p>
                </div>
                <button
                  type="button"
                  disabled={actionBusyId === 'flag-Organiser Signups'}
                  onClick={() =>
                    handleUpdateFlag(
                      { signupsEnabled: !builderOverview.flags.signupsEnabled },
                      'Organiser Signups'
                    )
                  }
                  className={`px-3.5 py-1.5 rounded-full text-xs font-semibold border shrink-0 ${
                    builderOverview.flags.signupsEnabled
                      ? 'bg-white text-[#0B0B0B] border-[#E5E5EA] hover:border-[#0B0B0B]'
                      : 'bg-[#0B0B0B] text-white border-[#0B0B0B]'
                  }`}
                >
                  {builderOverview.flags.signupsEnabled ? 'Enabled (Disable)' : 'Disabled (Enable)'}
                </button>
              </div>
            </div>
          </section>

          <section className="rounded-3xl border border-[#E5E5EA] bg-white p-5 sm:p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-[#F5F5F7] border border-[#E5E5EA] flex items-center justify-center text-[#0B0B0B]">
                <Server className="w-4 h-4" />
              </div>
              <div>
                <h2 className="font-display text-base font-bold text-[#0B0B0B]">
                  Server Environment Readiness
                </h2>
                <p className="text-xs text-[#71717A]">
                  Presence verification only — secret tokens never leave server memory
                </p>
              </div>
            </div>

            <div className="divide-y divide-[#E5E5EA] rounded-2xl border border-[#E5E5EA]">
              {(
                [
                  { key: 'SUPABASE_URL', configured: builderOverview.envStatus.SUPABASE_URL },
                  { key: 'SUPABASE_ANON_KEY', configured: builderOverview.envStatus.SUPABASE_ANON_KEY },
                  {
                    key: 'SUPABASE_SERVICE_ROLE_KEY',
                    configured: builderOverview.envStatus.SUPABASE_SERVICE_ROLE_KEY,
                  },
                  { key: 'RESEND_API_KEY', configured: builderOverview.envStatus.RESEND_API_KEY },
                  {
                    key: 'RESEND_FROM_EMAIL',
                    configured: builderOverview.envStatus.RESEND_FROM_EMAIL,
                  },
                  { key: 'ARKESEL_API_KEY', configured: builderOverview.envStatus.ARKESEL_API_KEY },
                  { key: 'CREATOR_PASSWORD', configured: builderOverview.envStatus.CREATOR_PASSWORD },
                ] as const
              ).map((envItem) => (
                <div key={envItem.key} className="px-4 py-3 flex items-center justify-between text-xs">
                  <span className="font-mono text-[#0B0B0B] font-medium">{envItem.key}</span>
                  <span
                    className={`px-2.5 py-0.5 rounded-md font-mono font-semibold ${
                      envItem.configured
                        ? 'bg-[#F5F5F7] text-[#16A34A]'
                        : 'bg-[#F5F5F7] text-[#71717A]'
                    }`}
                  >
                    {envItem.configured ? 'Configured' : 'Not Set'}
                  </span>
                </div>
              ))}
              <div className="px-4 py-3 flex items-center justify-between text-xs">
                <span className="font-mono text-[#0B0B0B] font-medium">CREATOR_EMAIL</span>
                <span className="font-mono text-[#0B0B0B]">
                  {builderOverview.envStatus.CREATOR_EMAIL}
                </span>
              </div>
            </div>
          </section>
        </div>
      )}

      {/* SECTION E: REVENUE & UNIT ECONOMICS */}
      {consoleSection === 'economics' && builderOverview && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="rounded-3xl border border-[#E5E5EA] bg-white p-5">
              <div className="flex items-center justify-between text-xs text-[#71717A]">
                <span>Active Plan MRR</span>
                <TrendingUp className="w-4 h-4 text-[#0B0B0B]" />
              </div>
              <p className="font-display text-2xl font-bold text-[#0B0B0B] mt-2 tabular-nums">
                ${builderOverview.unitEconomics.totalMrrUsd.toFixed(2)}
              </p>
              <p className="text-[11px] text-[#71717A] mt-1 tabular-nums">
                {builderOverview.unitEconomics.enterpriseCount} Enterprise ·{' '}
                {builderOverview.unitEconomics.proCount} Pro ·{' '}
                {builderOverview.unitEconomics.starterCount} Starter
              </p>
            </div>

            <div className="rounded-3xl border border-[#E5E5EA] bg-white p-5">
              <p className="text-xs text-[#71717A]">Arkesel SMS Spend</p>
              <p className="font-display text-2xl font-bold text-[#0B0B0B] mt-2 tabular-nums">
                ${builderOverview.unitEconomics.totalSmsCostUsd.toFixed(2)}
              </p>
              <p className="text-[11px] text-[#71717A] mt-1">Carrier pass delivery cost</p>
            </div>

            <div className="rounded-3xl border border-[#E5E5EA] bg-white p-5">
              <p className="text-xs text-[#71717A]">35mm Film Storage Cost</p>
              <p className="font-display text-2xl font-bold text-[#0B0B0B] mt-2 tabular-nums">
                ${builderOverview.unitEconomics.totalStorageCostUsd.toFixed(2)}
              </p>
              <p className="text-[11px] text-[#71717A] mt-1 tabular-nums">
                {builderOverview.unitEconomics.totalStorageMb} MB stored across rolls
              </p>
            </div>

            <div className="rounded-3xl border border-[#E5E5EA] bg-[#0B0B0B] text-white p-5">
              <p className="text-xs text-zinc-400">Net Gross Margin</p>
              <p className="font-display text-2xl font-bold mt-2 tabular-nums">
                ${builderOverview.unitEconomics.grossMarginUsd.toFixed(2)}
              </p>
              <p className="text-[11px] text-zinc-400 mt-1">MRR less SMS &amp; storage COGS</p>
            </div>
          </div>

          <section className="rounded-3xl border border-[#E5E5EA] bg-white p-5 sm:p-6 space-y-4">
            <div>
              <h2 className="font-display text-lg font-bold text-[#0B0B0B]">
                Per-Tenant Unit Economics
              </h2>
              <p className="text-xs text-[#71717A]">
                Identifies heavy SMS &amp; 35mm film storage users whose COGS exceed their plan MRR
              </p>
            </div>

            <div className="rounded-2xl border border-[#E5E5EA] overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-[#E5E5EA] bg-[#F5F5F7] text-[#71717A] font-semibold">
                    <th className="py-3 px-4">Tenant</th>
                    <th className="py-3 px-4">Plan</th>
                    <th className="py-3 px-4">MRR</th>
                    <th className="py-3 px-4">SMS COGS</th>
                    <th className="py-3 px-4">Storage COGS</th>
                    <th className="py-3 px-4 text-right">Net Margin</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E5E5EA]">
                  {builderOverview.unitEconomics.perTenant.map((row) => (
                    <tr key={row.userId} className="hover:bg-[#F5F5F7]/50">
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-[#0B0B0B]">{row.name}</span>
                          {row.unprofitableFlag && (
                            <span className="px-2 py-0.5 rounded-md bg-[#F5F5F7] border border-[#DC2626] text-[#DC2626] font-mono text-[10px] font-semibold">
                              COGS ALERT
                            </span>
                          )}
                        </div>
                        <p className="font-mono text-[11px] text-[#71717A]">{row.email}</p>
                      </td>
                      <td className="py-3 px-4">{row.plan}</td>
                      <td className="py-3 px-4 font-mono tabular-nums">${row.mrrUsd.toFixed(2)}</td>
                      <td className="py-3 px-4 font-mono tabular-nums text-[#71717A]">
                        ${row.smsCostUsd.toFixed(2)} ({row.smsSentCount} SMS)
                      </td>
                      <td className="py-3 px-4 font-mono tabular-nums text-[#71717A]">
                        ${row.storageCostUsd.toFixed(2)} ({row.storageMb} MB)
                      </td>
                      <td
                        className={`py-3 px-4 text-right font-mono tabular-nums font-semibold ${
                          row.netMarginUsd < 0 ? 'text-[#DC2626]' : 'text-[#16A34A]'
                        }`}
                      >
                        ${row.netMarginUsd.toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}

      {/* SECTION F: EXISTING APP CLIENTS & WEBHOOKS WORKBENCH */}
      {consoleSection === 'apps' && (
        <>
      {/* Filter Bar */}
      {apps.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1 p-1 bg-[#F5F5F7] rounded-lg overflow-x-auto max-w-full">
            {(
              [
                { id: 'all', label: 'All Apps' },
                { id: 'production', label: 'Production' },
                { id: 'sandbox', label: 'Sandbox' },
                { id: 'paused', label: 'Paused' },
              ] as { id: EnvFilter; label: string }[]
            ).map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setEnvFilter(f.id)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  envFilter === f.id
                    ? 'bg-white text-[#0B0B0B] shadow-xs'
                    : 'text-[#71717A] hover:text-[#0B0B0B]'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          <span className="text-xs text-[#71717A] tabular-nums">
            Showing {filteredApps.length} of {apps.length}
          </span>
        </div>
      )}

      {/* Empty State */}
      {apps.length === 0 ? (
        <section className="rounded-3xl bg-[#F5F5F7] border border-[#E5E5EA] p-8 sm:p-12 text-center max-w-2xl mx-auto">
          <div className="w-12 h-12 rounded-2xl bg-[#0B0B0B] text-white flex items-center justify-center mx-auto">
            <Terminal className="w-5 h-5" />
          </div>
          <h2 className="font-display text-xl font-bold text-[#0B0B0B] mt-4">
            Register your first companion app
          </h2>
          <p className="text-sm text-[#71717A] mt-2 leading-relaxed max-w-md mx-auto">
            Issue scoped client credentials for gate scanner kiosks, custom RSVP embeds, and Arkesel SMS webhook workers synced to your Supabase studio.
          </p>
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="mt-6 px-5 py-2.5 rounded-full bg-[#0B0B0B] text-white text-xs font-semibold hover:bg-neutral-800 transition-colors inline-flex items-center gap-2 whitespace-nowrap"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Create First App</span>
          </button>
        </section>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-[300px_minmax(0,1fr)] gap-6 items-start">
          {/* Left Rail: App Directory */}
          <aside className="rounded-3xl border border-[#E5E5EA] bg-white overflow-hidden">
            <div className="px-4 py-3.5 border-b border-[#E5E5EA] flex items-center justify-between">
              <span className="text-xs font-semibold text-[#0B0B0B]">Registered Apps</span>
              <span className="text-xs text-[#71717A] tabular-nums">{filteredApps.length}</span>
            </div>

            {filteredApps.length === 0 ? (
              <div className="p-6 text-center text-xs text-[#71717A]">
                No apps match this filter.
              </div>
            ) : (
              <div className="divide-y divide-[#E5E5EA]">
                {filteredApps.map((app) => {
                  const isSelected = app.id === selectedApp?.id;
                  const typeLabel =
                    APP_TYPES.find((t) => t.id === app.appType)?.label ?? app.appType;
                  return (
                    <button
                      key={app.id}
                      type="button"
                      onClick={() => setSelectedAppId(app.id)}
                      className={`w-full text-left px-4 py-3.5 transition-colors flex flex-col gap-1 ${
                        isSelected ? 'bg-[#F5F5F7]' : 'bg-white hover:bg-[#F5F5F7]/60'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold text-[#0B0B0B] truncate">
                          {app.name}
                        </span>
                        <span
                          className={`text-[11px] font-medium shrink-0 ${
                            app.status === 'active' ? 'text-[#16A34A]' : 'text-[#D97706]'
                          }`}
                        >
                          {app.status === 'active' ? 'Active' : 'Paused'}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 text-xs text-[#71717A] truncate">
                        <span>{typeLabel}</span>
                        <span aria-hidden="true">·</span>
                        <span className="capitalize">{app.environment}</span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono tabular-nums">{app.requestsCount} req</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </aside>

          {/* Right Column: App Workbench */}
          {selectedApp && (
            <section className="rounded-3xl border border-[#E5E5EA] bg-white p-5 sm:p-6 space-y-6 min-w-0">
              {/* App Header */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-[#E5E5EA]">
                <div className="min-w-0">
                  <div className="flex items-center gap-2.5">
                    <h2 className="font-display text-xl font-bold text-[#0B0B0B] truncate">
                      {selectedApp.name}
                    </h2>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-[#71717A] mt-1 tabular-nums">
                    <span className="font-mono">{selectedApp.clientId}</span>
                    <span aria-hidden="true">·</span>
                    <span className="capitalize">{selectedApp.environment}</span>
                    <span aria-hidden="true">·</span>
                    <span
                      className={
                        selectedApp.status === 'active' ? 'text-[#16A34A] font-medium' : 'text-[#D97706] font-medium'
                      }
                    >
                      {selectedApp.status === 'active' ? 'Operational' : 'Paused'}
                    </span>
                    {selectedApp.lastUsedAt && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>Last call {selectedApp.lastUsedAt}</span>
                      </>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={handleToggleStatus}
                    className="px-3.5 py-2 rounded-full border border-[#E5E5EA] hover:border-[#0B0B0B] text-xs font-semibold text-[#0B0B0B] inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors"
                  >
                    {selectedApp.status === 'active' ? (
                      <>
                        <Pause className="w-3.5 h-3.5" />
                        Pause App
                      </>
                    ) : (
                      <>
                        <Play className="w-3.5 h-3.5" />
                        Resume App
                      </>
                    )}
                  </button>

                  {!confirmDelete ? (
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(true)}
                      aria-label="Delete app"
                      className="w-9 h-9 rounded-full border border-[#E5E5EA] hover:border-[#DC2626] hover:text-[#DC2626] text-[#71717A] flex items-center justify-center transition-colors shrink-0"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={async () => {
                        await onDeleteApp(selectedApp.id);
                        setConfirmDelete(false);
                      }}
                      className="px-3.5 py-2 rounded-full bg-[#DC2626] text-white text-xs font-semibold hover:bg-red-700 transition-colors whitespace-nowrap shrink-0"
                    >
                      Confirm Delete
                    </button>
                  )}
                </div>
              </div>

              {/* Sub-Navigation Tabs */}
              <div className="flex items-center gap-1 p-1 bg-[#F5F5F7] rounded-lg overflow-x-auto">
                {(
                  [
                    { id: 'credentials', label: 'Credentials & Scopes', icon: KeyRound },
                    { id: 'webhooks', label: 'Webhooks & Tester', icon: Webhook },
                    { id: 'sdk', label: 'SDK & Embed', icon: Code2 },
                    { id: 'logs', label: `Delivery Logs (${appLogs.length})`, icon: Terminal },
                  ] as { id: ConsoleTab; label: string; icon: React.ComponentType<{ className?: string }> }[]
                ).map((tab) => {
                  const Icon = tab.icon;
                  const active = activeTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setActiveTab(tab.id)}
                      className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
                        active
                          ? 'bg-white text-[#0B0B0B] shadow-xs'
                          : 'text-[#71717A] hover:text-[#0B0B0B]'
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5" />
                      <span>{tab.label}</span>
                    </button>
                  );
                })}
              </div>

              {/* Tab 1: Credentials & Scopes */}
              {activeTab === 'credentials' && (
                <form onSubmit={handleSaveConfig} className="space-y-6">
                  {/* Credential Strip */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="rounded-2xl bg-[#F5F5F7] p-4 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-[#71717A]">Client ID</p>
                        <p className="font-mono text-xs text-[#0B0B0B] truncate mt-1 tabular-nums">
                          {selectedApp.clientId}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleCopy('client-id', selectedApp.clientId)}
                        className="px-3 py-1.5 rounded-lg bg-white border border-[#E5E5EA] hover:border-[#0B0B0B] text-xs font-semibold text-[#0B0B0B] inline-flex items-center gap-1 whitespace-nowrap shrink-0"
                      >
                        {copiedKey === 'client-id' ? (
                          <>
                            <Check className="w-3 h-3" />
                            Copied
                          </>
                        ) : (
                          <>
                            <Copy className="w-3 h-3" />
                            Copy
                          </>
                        )}
                      </button>
                    </div>

                    <div className="rounded-2xl bg-[#F5F5F7] p-4 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-[#71717A]">Client Secret (Hashed)</p>
                        <p className="font-mono text-xs text-[#0B0B0B] truncate mt-1 tabular-nums">
                          {selectedApp.secretPrefix}
                        </p>
                      </div>
                      <button
                        type="button"
                        disabled={rotatingSecret}
                        onClick={handleRotate}
                        className="px-3 py-1.5 rounded-lg bg-white border border-[#E5E5EA] hover:border-[#0B0B0B] disabled:opacity-50 text-xs font-semibold text-[#0B0B0B] inline-flex items-center gap-1 whitespace-nowrap shrink-0"
                      >
                        <RefreshCw className={`w-3 h-3 ${rotatingSecret ? 'animate-spin' : ''}`} />
                        {rotatingSecret ? 'Rotating...' : 'Rotate Secret'}
                      </button>
                    </div>
                  </div>

                  {/* Metadata Inputs */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-[#0B0B0B] mb-1.5">
                        App Name
                      </label>
                      <input
                        type="text"
                        required
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="w-full h-10 px-3.5 rounded-xl border border-[#E5E5EA] focus:border-[#0B0B0B] focus:outline-none text-sm text-[#0B0B0B]"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-[#0B0B0B] mb-1.5">
                        Scoped Event
                      </label>
                      <select
                        value={editEventId}
                        onChange={(e) => setEditEventId(e.target.value)}
                        className="w-full h-10 px-3.5 rounded-xl border border-[#E5E5EA] focus:border-[#0B0B0B] focus:outline-none text-sm text-[#0B0B0B] bg-white"
                      >
                        <option value="all">All Organizer Events</option>
                        {events.map((evt) => (
                          <option key={evt.id} value={evt.id}>
                            {evt.title}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-[#0B0B0B] mb-1.5">
                        Environment
                      </label>
                      <div className="flex items-center gap-1 p-1 bg-[#F5F5F7] rounded-xl w-fit">
                        {(['sandbox', 'production'] as CreatorAppEnvironment[]).map((env) => (
                          <button
                            key={env}
                            type="button"
                            onClick={() => setEditEnv(env)}
                            className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg capitalize transition-colors ${
                              editEnv === env
                                ? 'bg-white text-[#0B0B0B] shadow-xs'
                                : 'text-[#71717A] hover:text-[#0B0B0B]'
                            }`}
                          >
                            {env}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-[#0B0B0B] mb-1.5">
                        Allowed CORS Origins (comma separated)
                      </label>
                      <input
                        type="text"
                        value={editOrigins}
                        onChange={(e) => setEditOrigins(e.target.value)}
                        placeholder="https://checkin.accratech.org, http://localhost:3000"
                        className="w-full h-10 px-3.5 rounded-xl border border-[#E5E5EA] focus:border-[#0B0B0B] focus:outline-none text-sm font-mono text-[#0B0B0B]"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-[#0B0B0B] mb-1.5">
                      Description
                    </label>
                    <input
                      type="text"
                      value={editDesc}
                      onChange={(e) => setEditDesc(e.target.value)}
                      placeholder="Describe what this client app or integration does..."
                      className="w-full h-10 px-3.5 rounded-xl border border-[#E5E5EA] focus:border-[#0B0B0B] focus:outline-none text-sm text-[#0B0B0B]"
                    />
                  </div>

                  {/* Permission Scopes */}
                  <div className="space-y-3 pt-2 border-t border-[#E5E5EA]">
                    <div className="flex items-center gap-2">
                      <Shield className="w-4 h-4 text-[#0B0B0B]" />
                      <h3 className="text-sm font-semibold text-[#0B0B0B]">Permission Scopes</h3>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                      {SCOPE_OPTIONS.map((scope) => {
                        const checked = editScopes.includes(scope.id);
                        return (
                          <label
                            key={scope.id}
                            className={`p-3 rounded-xl border cursor-pointer transition-colors flex items-start gap-3 ${
                              checked
                                ? 'border-[#0B0B0B] bg-[#F5F5F7]'
                                : 'border-[#E5E5EA] bg-white hover:border-neutral-400'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleScope(scope.id)}
                              className="mt-0.5 accent-[#0B0B0B]"
                            />
                            <div className="min-w-0">
                              <p className="font-mono text-xs font-semibold text-[#0B0B0B]">
                                {scope.label}
                              </p>
                              <p className="text-xs text-[#71717A] mt-0.5">{scope.detail}</p>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  </div>

                  <div className="flex justify-end pt-2 border-t border-[#E5E5EA]">
                    <button
                      type="submit"
                      disabled={savingConfig}
                      className="px-5 py-2.5 rounded-full bg-[#0B0B0B] text-white text-xs font-semibold hover:bg-neutral-800 disabled:opacity-50 transition-colors whitespace-nowrap"
                    >
                      {savingConfig ? 'Saving...' : 'Save Configuration'}
                    </button>
                  </div>
                </form>
              )}

              {/* Tab 2: Webhooks & Live API Tester */}
              {activeTab === 'webhooks' && (
                <div className="space-y-6">
                  <form onSubmit={handleSaveConfig} className="space-y-4 pb-6 border-b border-[#E5E5EA]">
                    <div>
                      <label className="block text-xs font-semibold text-[#0B0B0B] mb-1.5">
                        Webhook Callback URL
                      </label>
                      <div className="flex flex-col sm:flex-row gap-2.5">
                        <input
                          type="url"
                          value={editWebhookUrl}
                          onChange={(e) => setEditWebhookUrl(e.target.value)}
                          placeholder="https://your-service.africa/webhooks/eventsapp"
                          className="flex-1 h-10 px-3.5 rounded-xl border border-[#E5E5EA] focus:border-[#0B0B0B] focus:outline-none text-sm font-mono text-[#0B0B0B]"
                        />
                        <button
                          type="submit"
                          disabled={savingConfig}
                          className="px-4 py-2 rounded-xl bg-[#0B0B0B] text-white text-xs font-semibold hover:bg-neutral-800 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
                        >
                          {savingConfig ? 'Saving...' : 'Save Webhook'}
                        </button>
                      </div>
                      <p className="text-xs text-[#71717A] mt-1.5">
                        Leave blank to use the built-in local sandbox loopback when testing payloads.
                      </p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                      {WEBHOOK_TRIGGERS.map((trig) => {
                        const checked = editWebhookEvents.includes(trig.id);
                        return (
                          <label
                            key={trig.id}
                            className={`p-3 rounded-xl border cursor-pointer transition-colors flex items-start gap-3 ${
                              checked
                                ? 'border-[#0B0B0B] bg-[#F5F5F7]'
                                : 'border-[#E5E5EA] bg-white hover:border-neutral-400'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleWebhookTrigger(trig.id)}
                              className="mt-0.5 accent-[#0B0B0B]"
                            />
                            <div>
                              <p className="font-mono text-xs font-semibold text-[#0B0B0B]">
                                {trig.label}
                              </p>
                              <p className="text-xs text-[#71717A] mt-0.5">{trig.description}</p>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  </form>

                  {/* Live Dispatcher & API Playground */}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <div className="rounded-2xl bg-[#F5F5F7] p-4 space-y-3">
                      <h3 className="text-sm font-semibold text-[#0B0B0B]">
                        Dispatch Signed Test Webhook
                      </h3>
                      <select
                        value={selectedWebhookTrigger}
                        onChange={(e) =>
                          setSelectedWebhookTrigger(e.target.value as WebhookTriggerEvent)
                        }
                        className="w-full h-10 px-3 rounded-xl border border-[#E5E5EA] bg-white text-xs font-mono text-[#0B0B0B]"
                      >
                        {WEBHOOK_TRIGGERS.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.label}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        disabled={testingWebhook}
                        onClick={handleDispatchTestWebhook}
                        className="w-full h-10 px-4 rounded-xl bg-[#0B0B0B] text-white text-xs font-semibold hover:bg-neutral-800 disabled:opacity-50 transition-colors inline-flex items-center justify-center gap-1.5"
                      >
                        <Send className="w-3.5 h-3.5" />
                        <span>{testingWebhook ? 'Dispatching...' : 'Send Test Event'}</span>
                      </button>
                    </div>

                    <div className="rounded-2xl bg-[#F5F5F7] p-4 space-y-3">
                      <h3 className="text-sm font-semibold text-[#0B0B0B]">
                        Invoke Scoped Endpoint
                      </h3>
                      <select
                        value={selectedEndpoint}
                        onChange={(e) => setSelectedEndpoint(e.target.value)}
                        className="w-full h-10 px-3 rounded-xl border border-[#E5E5EA] bg-white text-xs font-mono text-[#0B0B0B]"
                      >
                        {API_ENDPOINTS.map((ep) => (
                          <option key={ep.endpoint} value={ep.endpoint}>
                            {ep.method} {ep.endpoint} — {ep.label}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        disabled={runningEndpoint}
                        onClick={handleRunEndpoint}
                        className="w-full h-10 px-4 rounded-xl bg-white border border-[#0B0B0B] text-[#0B0B0B] text-xs font-semibold hover:bg-[#0B0B0B] hover:text-white disabled:opacity-50 transition-colors inline-flex items-center justify-center gap-1.5"
                      >
                        <Terminal className="w-3.5 h-3.5" />
                        <span>{runningEndpoint ? 'Executing...' : 'Run Live Request'}</span>
                      </button>
                    </div>
                  </div>

                  {playgroundOutput && (
                    <div className="rounded-2xl bg-[#0B0B0B] text-zinc-100 p-4 overflow-x-auto">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-medium text-zinc-400">Response Payload</span>
                        <button
                          type="button"
                          onClick={() => handleCopy('playground-out', playgroundOutput)}
                          className="text-xs text-zinc-300 hover:text-white inline-flex items-center gap-1"
                        >
                          <Copy className="w-3 h-3" />
                          {copiedKey === 'playground-out' ? 'Copied' : 'Copy'}
                        </button>
                      </div>
                      <pre className="font-mono text-xs leading-relaxed tabular-nums">
                        {playgroundOutput}
                      </pre>
                    </div>
                  )}
                </div>
              )}

              {/* Tab 3: SDK & Embed Snippets */}
              {activeTab === 'sdk' && (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-1 p-1 bg-[#F5F5F7] rounded-lg">
                      {(
                        [
                          { id: 'typescript', label: 'TypeScript SDK' },
                          { id: 'curl', label: 'cURL REST' },
                          { id: 'embed', label: 'HTML Embed' },
                        ] as { id: SnippetLang; label: string }[]
                      ).map((lang) => (
                        <button
                          key={lang.id}
                          type="button"
                          onClick={() => setSnippetLang(lang.id)}
                          className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                            snippetLang === lang.id
                              ? 'bg-white text-[#0B0B0B] shadow-xs'
                              : 'text-[#71717A] hover:text-[#0B0B0B]'
                          }`}
                        >
                          {lang.label}
                        </button>
                      ))}
                    </div>

                    <button
                      type="button"
                      onClick={() => handleCopy('snippet', snippetCode)}
                      className="px-3.5 py-1.5 rounded-lg border border-[#E5E5EA] hover:border-[#0B0B0B] text-xs font-semibold text-[#0B0B0B] inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
                    >
                      {copiedKey === 'snippet' ? (
                        <>
                          <Check className="w-3.5 h-3.5" />
                          Copied Snippet
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" />
                          Copy Code
                        </>
                      )}
                    </button>
                  </div>

                  <div className="rounded-2xl bg-[#0B0B0B] text-zinc-100 p-5 overflow-x-auto">
                    <pre className="font-mono text-xs leading-relaxed">{snippetCode}</pre>
                  </div>
                </div>
              )}

              {/* Tab 4: Delivery & Request Logs */}
              {activeTab === 'logs' && (
                <div className="space-y-4">
                  {appLogs.length === 0 ? (
                    <div className="rounded-2xl bg-[#F5F5F7] p-8 text-center">
                      <p className="text-sm font-semibold text-[#0B0B0B]">No invocations logged yet</p>
                      <p className="text-xs text-[#71717A] mt-1">
                        Send a test webhook or invoke an API endpoint to record deliveries here.
                      </p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto border border-[#E5E5EA] rounded-2xl">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="border-b border-[#E5E5EA] bg-[#F5F5F7] text-xs font-semibold text-[#71717A]">
                            <th className="py-2.5 px-4">Event / Method</th>
                            <th className="py-2.5 px-4">Endpoint</th>
                            <th className="py-2.5 px-4 text-right">Status</th>
                            <th className="py-2.5 px-4 text-right">Latency</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#E5E5EA] text-xs">
                          {appLogs.map((log) => {
                            const isOk = log.statusCode >= 200 && log.statusCode < 300;
                            const isExpanded = expandedLogId === log.id;
                            return (
                              <React.Fragment key={log.id}>
                                <tr
                                  onClick={() =>
                                    setExpandedLogId((prev) => (prev === log.id ? null : log.id))
                                  }
                                  className="hover:bg-[#F5F5F7]/70 cursor-pointer transition-colors"
                                >
                                  <td className="py-3 px-4 font-mono text-[#0B0B0B] whitespace-nowrap">
                                    {log.method} · {log.eventType}
                                  </td>
                                  <td className="py-3 px-4 font-mono text-[#71717A] max-w-[260px] truncate">
                                    {log.endpoint}
                                  </td>
                                  <td
                                    className={`py-3 px-4 text-right font-mono tabular-nums font-semibold ${
                                      isOk ? 'text-[#16A34A]' : 'text-[#DC2626]'
                                    }`}
                                  >
                                    {log.statusCode} {isOk ? 'OK' : 'ERR'}
                                  </td>
                                  <td className="py-3 px-4 text-right font-mono tabular-nums text-[#71717A]">
                                    {log.latencyMs} ms
                                  </td>
                                </tr>
                                {isExpanded && (
                                  <tr className="bg-[#F5F5F7]">
                                    <td colSpan={4} className="px-4 py-3 text-xs space-y-1">
                                      <p className="text-[#0B0B0B] font-medium">
                                        Request: <span className="font-mono font-normal">{log.requestSummary}</span>
                                      </p>
                                      <p className="text-[#71717A]">
                                        Response: <span className="font-mono text-[#0B0B0B]">{log.responseSummary}</span>
                                      </p>
                                    </td>
                                  </tr>
                                )}
                              </React.Fragment>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </section>
          )}
        </div>
      )}
        </>
      )}

      {/* Read-Only Support Tenant Inspection Modal */}
      {tenantInspection && (
        <div
          className="fixed inset-0 z-50 bg-black/45 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="inspect-tenant-title"
        >
          <div className="bg-white rounded-3xl border border-[#E5E5EA] w-full max-w-3xl max-h-[90vh] overflow-y-auto p-6 space-y-5">
            <div className="flex items-start justify-between gap-4 pb-3 border-b border-[#E5E5EA]">
              <div>
                <div className="flex items-center gap-2">
                  <h2 id="inspect-tenant-title" className="font-display text-lg font-bold text-[#0B0B0B]">
                    Read-Only Tenant Support Inspection
                  </h2>
                  <span className="px-2 py-0.5 rounded-md bg-[#F5F5F7] border border-[#E5E5EA] font-mono text-[10px] font-semibold uppercase text-[#0B0B0B]">
                    {tenantInspection.tenant.appRole}
                  </span>
                </div>
                <p className="text-xs text-[#71717A] mt-1 font-mono">
                  {tenantInspection.tenant.name} · {tenantInspection.tenant.email} ·{' '}
                  {tenantInspection.tenant.studio}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setTenantInspection(null)}
                aria-label="Close inspection modal"
                className="w-8 h-8 rounded-full hover:bg-[#F5F5F7] flex items-center justify-center text-[#71717A]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              <h3 className="text-xs font-semibold text-[#0B0B0B] uppercase tracking-wider">
                Tenant Events ({tenantInspection.events.length})
              </h3>
              {tenantInspection.events.length === 0 ? (
                <p className="text-xs text-[#71717A] bg-[#F5F5F7] rounded-2xl px-4 py-3">
                  No events created by this organiser.
                </p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {tenantInspection.events.map((evt) => (
                    <div
                      key={evt.id}
                      className="rounded-2xl border border-[#E5E5EA] bg-[#F5F5F7] p-3.5 text-xs space-y-1"
                    >
                      <p className="font-semibold text-[#0B0B0B]">{evt.title}</p>
                      <p className="text-[#71717A]">
                        {evt.date} · {evt.venue}, {evt.city}
                      </p>
                      <p className="font-mono text-[#0B0B0B] tabular-nums">
                        {evt.registered} / {evt.capacity} registered · {evt.checkedIn} checked in
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-3">
              <h3 className="text-xs font-semibold text-[#0B0B0B] uppercase tracking-wider">
                Tenant Guest Roster ({tenantInspection.attendees.length})
              </h3>
              {tenantInspection.attendees.length === 0 ? (
                <p className="text-xs text-[#71717A] bg-[#F5F5F7] rounded-2xl px-4 py-3">
                  No attendees recorded for this organiser.
                </p>
              ) : (
                <div className="rounded-2xl border border-[#E5E5EA] overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-[#E5E5EA] bg-[#F5F5F7] text-[#71717A] font-semibold">
                        <th className="py-2 px-3">Guest</th>
                        <th className="py-2 px-3">Ticket Code</th>
                        <th className="py-2 px-3">SMS</th>
                        <th className="py-2 px-3">Payment</th>
                        <th className="py-2 px-3">Check-In</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E5E5EA]">
                      {tenantInspection.attendees.slice(0, 25).map((att) => (
                        <tr key={att.id}>
                          <td className="py-2 px-3">
                            <span className="font-semibold text-[#0B0B0B]">{att.name}</span>
                            <span className="block font-mono text-[10px] text-[#71717A]">
                              {att.phone}
                            </span>
                          </td>
                          <td className="py-2 px-3 font-mono">{att.ticketCode}</td>
                          <td className="py-2 px-3 font-mono">{att.smsStatus}</td>
                          <td className="py-2 px-3 font-mono">{att.paymentStatus}</td>
                          <td className="py-2 px-3 font-mono">
                            {att.checkedIn ? 'Checked In' : 'Pending'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Create App Modal */}
      {createOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/45 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="create-app-title"
        >
          <div className="bg-white rounded-3xl border border-[#E5E5EA] w-full max-w-xl max-h-[90vh] overflow-y-auto p-6 space-y-5">
            <div className="flex items-center justify-between pb-3 border-b border-[#E5E5EA]">
              <h2 id="create-app-title" className="font-display text-lg font-bold text-[#0B0B0B]">
                Create Companion App
              </h2>
              <button
                type="button"
                onClick={() => setCreateOpen(false)}
                aria-label="Close modal"
                className="w-8 h-8 rounded-full hover:bg-[#F5F5F7] flex items-center justify-center text-[#71717A]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-[#0B0B0B] mb-1.5">
                  App Name
                </label>
                <input
                  type="text"
                  required
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g. Gate Kiosk iPad Accra"
                  className="w-full h-10 px-3.5 rounded-xl border border-[#E5E5EA] focus:border-[#0B0B0B] focus:outline-none text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#0B0B0B] mb-1.5">
                  App Archetype
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {APP_TYPES.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setNewType(t.id)}
                      className={`p-3 rounded-xl border text-left transition-colors ${
                        newType === t.id
                          ? 'border-[#0B0B0B] bg-[#F5F5F7]'
                          : 'border-[#E5E5EA] hover:border-neutral-400'
                      }`}
                    >
                      <p className="text-xs font-semibold text-[#0B0B0B]">{t.label}</p>
                      <p className="text-[11px] text-[#71717A] mt-0.5">{t.summary}</p>
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-[#0B0B0B] mb-1.5">
                    Environment
                  </label>
                  <select
                    value={newEnv}
                    onChange={(e) => setNewEnv(e.target.value as CreatorAppEnvironment)}
                    className="w-full h-10 px-3.5 rounded-xl border border-[#E5E5EA] bg-white text-sm"
                  >
                    <option value="sandbox">Sandbox</option>
                    <option value="production">Production</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#0B0B0B] mb-1.5">
                    Scope to Event
                  </label>
                  <select
                    value={newEventId}
                    onChange={(e) => setNewEventId(e.target.value)}
                    className="w-full h-10 px-3.5 rounded-xl border border-[#E5E5EA] bg-white text-sm"
                  >
                    <option value="all">All Organizer Events</option>
                    {events.map((evt) => (
                      <option key={evt.id} value={evt.id}>
                        {evt.title}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#0B0B0B] mb-1.5">
                  Initial Scopes
                </label>
                <div className="flex flex-wrap gap-2">
                  {SCOPE_OPTIONS.map((sc) => {
                    const active = newScopes.includes(sc.id);
                    return (
                      <button
                        key={sc.id}
                        type="button"
                        onClick={() =>
                          setNewScopes((prev) =>
                            prev.includes(sc.id)
                              ? prev.filter((s) => s !== sc.id)
                              : [...prev, sc.id]
                          )
                        }
                        className={`px-3 py-1.5 rounded-lg font-mono text-xs border transition-colors ${
                          active
                            ? 'bg-[#0B0B0B] text-white border-[#0B0B0B]'
                            : 'bg-white text-[#71717A] border-[#E5E5EA] hover:border-[#0B0B0B]'
                        }`}
                      >
                        {sc.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#0B0B0B] mb-1.5">
                  Webhook URL (optional)
                </label>
                <input
                  type="url"
                  value={newWebhookUrl}
                  onChange={(e) => setNewWebhookUrl(e.target.value)}
                  placeholder="https://api.example.africa/webhooks/eventsapp"
                  className="w-full h-10 px-3.5 rounded-xl border border-[#E5E5EA] focus:border-[#0B0B0B] focus:outline-none text-sm font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#0B0B0B] mb-1.5">
                  Description (optional)
                </label>
                <input
                  type="text"
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  placeholder="Purpose or deployment notes"
                  className="w-full h-10 px-3.5 rounded-xl border border-[#E5E5EA] focus:border-[#0B0B0B] focus:outline-none text-sm"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#E5E5EA]">
                <button
                  type="button"
                  onClick={() => setCreateOpen(false)}
                  className="px-4 py-2 rounded-full border border-[#E5E5EA] text-xs font-semibold text-[#0B0B0B] hover:border-[#0B0B0B]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creating || !newName.trim()}
                  className="px-5 py-2 rounded-full bg-[#0B0B0B] text-white text-xs font-semibold hover:bg-neutral-800 disabled:opacity-50"
                >
                  {creating ? 'Provisioning...' : 'Provision App'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
        </>
      )}
    </div>
  );
};
