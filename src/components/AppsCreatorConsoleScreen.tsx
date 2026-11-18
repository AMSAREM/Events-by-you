import React, { useEffect, useMemo, useState } from 'react';
import {
  Check,
  Code2,
  Copy,
  KeyRound,
  Lock,
  LogOut,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Send,
  Shield,
  Terminal,
  Trash2,
  Webhook,
  X,
} from 'lucide-react';
import type {
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

  // Tester & Logs state
  const [selectedWebhookTrigger, setSelectedWebhookTrigger] = useState<WebhookTriggerEvent>('attendee.registered');
  const [testingWebhook, setTestingWebhook] = useState(false);
  const [selectedEndpoint, setSelectedEndpoint] = useState<string>('/v1/events');
  const [runningEndpoint, setRunningEndpoint] = useState(false);
  const [playgroundOutput, setPlaygroundOutput] = useState<string | null>(null);
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

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
          <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-[-0.03em] text-[#0B0B0B] text-balance">
            Apps Creator Console
          </h1>
          <div className="flex flex-wrap items-center gap-2 text-xs text-[#71717A] mt-1.5 tabular-nums">
            <span>{apps.length} {apps.length === 1 ? 'registered app' : 'registered apps'}</span>
            <span aria-hidden="true">·</span>
            <span>{totalRequests.toLocaleString()} logged requests</span>
            <span aria-hidden="true">·</span>
            <span>Supabase-backed credentials &amp; HMAC webhooks</span>
          </div>
        </div>
        <div className="flex items-center gap-2 self-start sm:self-auto shrink-0">
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
