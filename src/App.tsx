import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Clock, Compass, Database, Loader2, LogOut, ShieldCheck, X } from 'lucide-react';
import { INITIAL_PROFILE } from './data/initialData';
import type {
  AppRole,
  AppRoute,
  Attendee,
  CreatorApp,
  CreatorAppEnvironment,
  CreatorAppLog,
  CreatorAppScope,
  CreatorAppStatus,
  CreatorAppType,
  DisposableRollSettings,
  DisposableShot,
  EventItem,
  EventPlanningConfig,
  EventPollStatus,
  GiftTableEntry,
  NavScreen,
  OrganizerProfile,
  ScheduleBlock,
  StudioSubScreen,
  SystemAlert,
  WebhookTriggerEvent,
} from './types/events';
import {
  ApiError,
  api,
  extractSessionFromUrlHash,
  getStoredCreatorToken,
  getStoredSession,
  saveStoredCreatorToken,
  saveStoredSession,
  setCheckInSessionExempt,
  type StoredAuthSession,
} from './lib/api';
import { sanitizePublicExtraDataConfig } from './lib/polls';
import {
  getEventCheckInPolicy,
  getTodayIsoDate,
  sanitizeCheckedInDates,
  sanitizeIsoDate,
} from './lib/eventDates';
import { NOINDEX_ROUTE_SEO } from './lib/seoConfig';
import { NavigationRail } from './components/NavigationRail';
import { LandingScreen } from './components/LandingScreen';
import { LegalScreen } from './components/LegalScreen';
import {
  AboutPage,
  BlogPage,
  ContactPage,
  FaqPage,
  FeaturesPage,
  HowItWorksPage,
  PricingPage,
} from './components/MarketingPages';
import { SeoHead } from './components/SeoHead';
import { SignInScreen } from './components/SignInScreen';
import { SignUpScreen } from './components/SignUpScreen';
import { ResetPasswordScreen } from './components/ResetPasswordScreen';
import { VerifyOtpScreen } from './components/VerifyOtpScreen';
function lazyWithRetry<T extends ComponentType<any>>(
  importer: () => Promise<{ default: T }>
) {
  return lazy(async () => {
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await importer();
      } catch (err) {
        lastError = err;
        if (attempt < 2) {
          await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
        }
      }
    }
    throw lastError;
  });
}

const PublicEventScreen = lazyWithRetry(() =>
  import('./components/PublicEventScreen').then((m) => ({ default: m.PublicEventScreen }))
);
const OverviewScreen = lazyWithRetry(() =>
  import('./components/OverviewScreen').then((m) => ({ default: m.OverviewScreen }))
);
const EventPlanningHubScreen = lazyWithRetry(() =>
  import('./components/EventPlanningHubScreen').then((m) => ({
    default: m.EventPlanningHubScreen,
  }))
);
const EventsScreen = lazyWithRetry(() =>
  import('./components/EventsScreen').then((m) => ({ default: m.EventsScreen }))
);
const EventWorkspaceScreen = lazyWithRetry(() =>
  import('./components/EventWorkspaceScreen').then((m) => ({ default: m.EventWorkspaceScreen }))
);
const ScheduleScreen = lazyWithRetry(() =>
  import('./components/ScheduleScreen').then((m) => ({ default: m.ScheduleScreen }))
);
const AttendeesScreen = lazyWithRetry(() =>
  import('./components/AttendeesScreen').then((m) => ({ default: m.AttendeesScreen }))
);
const AnalyticsScreen = lazyWithRetry(() =>
  import('./components/AnalyticsScreen').then((m) => ({ default: m.AnalyticsScreen }))
);
const BillingScreen = lazyWithRetry(() =>
  import('./components/BillingScreen').then((m) => ({ default: m.BillingScreen }))
);
const CsvExportScreen = lazyWithRetry(() =>
  import('./components/CsvExportScreen').then((m) => ({ default: m.CsvExportScreen }))
);
const CreateEventWizardScreen = lazyWithRetry(() =>
  import('./components/CreateEventWizardScreen').then((m) => ({ default: m.CreateEventWizardScreen }))
);
const SettingsScreen = lazyWithRetry(() =>
  import('./components/SettingsScreen').then((m) => ({ default: m.SettingsScreen }))
);
const QrGateScannerScreen = lazyWithRetry(() =>
  import('./components/QrGateScannerScreen').then((m) => ({ default: m.QrGateScannerScreen }))
);
const DisposableCameraScreen = lazyWithRetry(() =>
  import('./components/DisposableCameraScreen').then((m) => ({ default: m.DisposableCameraScreen }))
);
const GiftTableScreen = lazyWithRetry(() =>
  import('./components/GiftTableScreen').then((m) => ({ default: m.GiftTableScreen }))
);
const AppsCreatorConsoleScreen = lazyWithRetry(() =>
  import('./components/AppsCreatorConsoleScreen').then((m) => ({ default: m.AppsCreatorConsoleScreen }))
);
const EventDetailModal = lazyWithRetry(() =>
  import('./components/EventModals').then((m) => ({ default: m.EventDetailModal }))
);
const OnboardingWalkthroughModal = lazyWithRetry(() =>
  import('./components/OnboardingWalkthroughModal').then((m) => ({ default: m.OnboardingWalkthroughModal }))
);

const SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const SESSION_WARNING_MS = 60 * 1000;
const LAST_ACTIVITY_KEY = 'eventsapp_last_activity_v1';

function getWalkthroughStorageKey(profile?: Pick<OrganizerProfile, 'email' | 'phone' | 'name'> | null): string {
  const userKey =
    profile?.email?.trim().toLowerCase() ||
    profile?.phone?.trim() ||
    profile?.name?.trim().toLowerCase() ||
    'organiser';
  return `eventsapp_walkthrough_done_${userKey}`;
}

function parseInvitationFromValues(pathname: string, search: string): {
  slugOrId?: string;
  focus?: 'top' | 'register' | 'checkin' | 'walkin' | 'camera' | 'gifts' | 'polls';
  guest?: string;
  pass?: string;
  desk?: string;
} {
  const params = new URLSearchParams(search);
  const guest = params.get('guest')?.trim() || undefined;
  const pass = params.get('pass')?.trim() || params.get('code')?.trim() || undefined;
  const desk = params.get('desk')?.trim() || params.get('token')?.trim() || undefined;

  const cameraMatch = pathname.match(/^\/e\/([^/]+)\/camera\/?$/i);
  if (cameraMatch && cameraMatch[1]) {
    return { slugOrId: decodeURIComponent(cameraMatch[1]), focus: 'camera', guest, pass };
  }
  if (pathname.toLowerCase() === '/camera' || pathname.toLowerCase() === '/camera/') {
    const camEvt = params.get('event')?.trim() || params.get('camera')?.trim();
    return { slugOrId: camEvt, focus: 'camera', guest, pass };
  }
  const cameraQuery = params.get('camera')?.trim();
  if (cameraQuery) {
    return { slugOrId: cameraQuery, focus: 'camera', guest, pass };
  }

  const giftsMatch = pathname.match(/^\/e\/([^/]+)\/(?:gifts|gift-desk)\/?$/i);
  if (giftsMatch && giftsMatch[1]) {
    return { slugOrId: decodeURIComponent(giftsMatch[1]), focus: 'gifts', guest, pass, desk };
  }

  const pollsMatch = pathname.match(/^\/e\/([^/]+)\/polls?\/?$/i);
  if (pollsMatch && pollsMatch[1]) {
    return { slugOrId: decodeURIComponent(pollsMatch[1]), focus: 'polls', guest, pass };
  }

  const walkinMatch = pathname.match(/^\/e\/([^/]+)\/walk-?in\/?$/i);
  if (walkinMatch && walkinMatch[1]) {
    return { slugOrId: decodeURIComponent(walkinMatch[1]), focus: 'walkin', guest, pass };
  }

  const checkinMatch = pathname.match(/^\/e\/([^/]+)\/checkin\/?$/i);
  if (checkinMatch && checkinMatch[1]) {
    return { slugOrId: decodeURIComponent(checkinMatch[1]), focus: 'checkin', guest, pass };
  }
  const match = pathname.match(/^\/e\/([^/]+)\/?$/i);
  const tab = (params.get('tab') || '').toLowerCase();
  const focus: 'top' | 'register' | 'checkin' | 'walkin' | 'camera' | 'gifts' | 'polls' =
    tab === 'camera'
      ? 'camera'
      : tab === 'gifts' || tab === 'gift' || Boolean(desk)
        ? 'gifts'
        : tab === 'polls' || tab === 'poll'
          ? 'polls'
          : tab === 'walkin' || tab === 'walk-in'
            ? 'walkin'
            : tab === 'checkin' || tab === 'qr'
              ? 'checkin'
              : tab === 'register'
                ? 'register'
                : 'top';
  if (match && match[1]) {
    return { slugOrId: decodeURIComponent(match[1]), focus, guest, pass, desk };
  }
  const eventQuery = params.get('event')?.trim();
  if (eventQuery) {
    return { slugOrId: eventQuery, focus, guest, pass, desk };
  }
  return {};
}

function normalizePathname(raw: string): string {
  const lowered = raw.toLowerCase();
  if (lowered.length > 1 && lowered.endsWith('/')) {
    return lowered.slice(0, -1);
  }
  return lowered || '/';
}

function resolveRouteFromLocation(pathname: string, search: string): AppRoute {
  const path = normalizePathname(pathname);
  const invite = parseInvitationFromValues(pathname, search);
  if (invite.focus === 'camera') return 'camera';
  if (invite.slugOrId) return 'demo-event';
  if (
    path === '/' ||
    path === '/index.html' ||
    path === '/features' ||
    path === '/pricing' ||
    path === '/how-it-works' ||
    path === '/faq' ||
    path === '/about' ||
    path === '/contact' ||
    path === '/blog'
  ) {
    return 'home';
  }
  if (path === '/terms') return 'terms';
  if (path === '/privacy') return 'privacy';
  if (path === '/signin') return 'signin';
  if (path === '/signup') return 'signup';
  if (path === '/reset-password') return 'reset-password';
  if (path === '/verify-otp') return 'verify-otp';
  if (path === '/studio' || path.startsWith('/studio/')) return 'studio';
  if (path === '/camera') return 'camera';
  return 'not-found';
}

interface PendingModuleTarget {
  route: 'studio' | 'camera';
  screen?: NavScreen;
  eventId?: string;
  prefillCode?: string;
  subScreen?: StudioSubScreen;
  guestName?: string;
  returnRoute?: 'home' | 'demo-event';
  label: string;
}

const EMPTY_PROFILE: OrganizerProfile = {
  ...INITIAL_PROFILE,
  name: 'Organiser',
  firstName: 'Organiser',
  email: '',
  studio: 'Events Studio',
  smsCredits: 0,
};

export default function App() {
  const routerLocation = useLocation();
  const routerNavigate = useNavigate();
  const initialPathname =
    routerLocation.pathname || (typeof window !== 'undefined' ? window.location.pathname : '/');
  const initialSearch =
    routerLocation.search || (typeof window !== 'undefined' ? window.location.search : '');
  const initialInvite = parseInvitationFromValues(initialPathname, initialSearch);
  const normalizedRouterPath = normalizePathname(initialPathname);

  const [route, setRoute] = useState<AppRoute>(() =>
    resolveRouteFromLocation(initialPathname, initialSearch)
  );
  const [isSignedIn, setIsSignedIn] = useState<boolean>(false);
  const [authBootstrapping, setAuthBootstrapping] = useState<boolean>(false);
  const [hasCheckedStoredSession, setHasCheckedStoredSession] = useState<boolean>(false);
  const [studioLoading, setStudioLoading] = useState(false);
  const [showWalkthrough, setShowWalkthrough] = useState(false);
  const [supabaseConfigured, setSupabaseConfigured] = useState<boolean>(true);
  const [inMemoryMode, setInMemoryMode] = useState<boolean>(false);
  const [creatorEmail, setCreatorEmail] = useState<string>('amoakoimml@gmail.com');
  const [creatorPasswordConfigured, setCreatorPasswordConfigured] = useState<boolean>(false);
  const [creatorUnlocked, setCreatorUnlocked] = useState<boolean>(false);
  const [apiBannerError, setApiBannerError] = useState<string | null>(null);
  const [sessionTimeoutNotice, setSessionTimeoutNotice] = useState<string | null>(null);
  const [sessionWarningSecondsLeft, setSessionWarningSecondsLeft] = useState<number | null>(null);
  const [publicCheckinModalOpen, setPublicCheckinModalOpen] = useState(false);
  const [workspaceCheckInActive, setWorkspaceCheckInActive] = useState(false);
  const [attendeesWalkInActive, setAttendeesWalkInActive] = useState(false);
  const lastActivityRef = useRef<number>(0);

  const [prefillEmail, setPrefillEmail] = useState<string>('');
  const [prefillPhone, setPrefillPhone] = useState<string>('');
  const [authEmail, setAuthEmail] = useState<string>('');
  const [authPhone, setAuthPhone] = useState<string>('');
  const [authCountryGateway, setAuthCountryGateway] = useState<string>('GH');
  const [otpType, setOtpType] = useState<'signup' | 'email' | 'recovery' | 'sms'>('sms');
  const [pendingTarget, setPendingTarget] = useState<PendingModuleTarget | null>(null);

  const [activeScreen, setActiveScreen] = useState<NavScreen>('overview');
  const [publicEvents, setPublicEvents] = useState<EventItem[]>([]);
  const [publicScheduleBlocks, setPublicScheduleBlocks] = useState<ScheduleBlock[]>([]);
  const [events, setEvents] = useState<EventItem[]>([]);
  const [attendees, setAttendees] = useState<Attendee[]>([]);
  const [scheduleBlocks, setScheduleBlocks] = useState<ScheduleBlock[]>([]);
  const [alerts, setAlerts] = useState<SystemAlert[]>([]);
  const [profile, setProfile] = useState<OrganizerProfile>(EMPTY_PROFILE);
  const effectiveRole: AppRole =
    profile.email?.toLowerCase() === creatorEmail.toLowerCase()
      ? 'creator'
      : profile.appRole === 'gate_staff'
        ? 'gate_staff'
        : 'organizer';
  const isStudioAuthorized = effectiveRole === 'organizer' || effectiveRole === 'creator';
  const [disposableShots, setDisposableShots] = useState<DisposableShot[]>([]);
  const [rollSettings, setRollSettings] = useState<Record<string, DisposableRollSettings>>({});
  const [creatorApps, setCreatorApps] = useState<CreatorApp[]>([]);
  const [creatorAppLogs, setCreatorAppLogs] = useState<CreatorAppLog[]>([]);

  const [overviewSearch, setOverviewSearch] = useState('');
  const [eventsSearch, setEventsSearch] = useState('');
  const [attendeeEventFilter, setAttendeeEventFilter] = useState<string>('all');

  const [studioSubScreen, setStudioSubScreen] = useState<StudioSubScreen>(null);
  const [csvExportEventId, setCsvExportEventId] = useState<string | undefined>(undefined);
  const [giftTableEventId, setGiftTableEventId] = useState<string | undefined>(undefined);
  const [checkinEventId, setCheckinEventId] = useState<string | undefined>(undefined);
  const [checkinPrefillCode, setCheckinPrefillCode] = useState<string | undefined>(undefined);
  const [cameraEventId, setCameraEventId] = useState<string | undefined>(() =>
    initialInvite.focus === 'camera' ? initialInvite.slugOrId : undefined
  );
  const [cameraGuestName, setCameraGuestName] = useState<string | undefined>(() =>
    initialInvite.focus === 'camera' ? initialInvite.guest : undefined
  );
  const [cameraPassCode, setCameraPassCode] = useState<string | undefined>(() =>
    initialInvite.focus === 'camera' ? initialInvite.pass : undefined
  );
  const [verifiedCameraPass, setVerifiedCameraPass] = useState<{
    attendeeName: string;
    ticketCode: string;
    checkedIn: boolean;
    tier: string;
  } | null>(null);
  const [cameraReturnRoute, setCameraReturnRoute] = useState<'home' | 'demo-event'>('home');
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [workspaceEventId, setWorkspaceEventId] = useState<string | null>(null);
  const [publicPreviewEventId, setPublicPreviewEventId] = useState<string | undefined>(() =>
    initialInvite.focus === 'camera' ? undefined : initialInvite.slugOrId
  );
  const [publicPreviewFocus, setPublicPreviewFocus] = useState<
    'top' | 'register' | 'checkin' | 'walkin' | 'gifts' | 'polls'
  >(() =>
    initialInvite.focus === 'register' ||
    initialInvite.focus === 'checkin' ||
    initialInvite.focus === 'walkin' ||
    initialInvite.focus === 'gifts' ||
    initialInvite.focus === 'polls'
      ? initialInvite.focus
      : 'top'
  );
  const [publicPreviewDeskToken, setPublicPreviewDeskToken] = useState<string | undefined>(
    () => initialInvite.desk
  );
  const [publicPreviewPassCode, setPublicPreviewPassCode] = useState<string | undefined>(
    () => (initialInvite.focus === 'camera' ? undefined : initialInvite.pass)
  );
  const [publicEventsLoading, setPublicEventsLoading] = useState<boolean>(true);
  const [selectedCheckoutBundleId, setSelectedCheckoutBundleId] = useState<string | null>(null);
  const [pendingPaystackRef, setPendingPaystackRef] = useState<string | null>(() => {
    try {
      const params = new URLSearchParams(initialSearch);
      if (params.get('sub_ref')) return null;
      const ref =
        params.get('paystack_ref') || params.get('reference') || params.get('trxref') || null;
      return ref && !ref.startsWith('EBY-SUB-') ? ref : null;
    } catch {
      return null;
    }
  });
  const [pendingSubscriptionRef, setPendingSubscriptionRef] = useState<string | null>(() => {
    try {
      const params = new URLSearchParams(initialSearch);
      const subRef = params.get('sub_ref');
      if (subRef) return subRef;
      const ref = params.get('reference') || params.get('trxref') || null;
      return ref && ref.startsWith('EBY-SUB-') ? ref : null;
    } catch {
      return null;
    }
  });

  const notifyError = useCallback((err: unknown, fallback: string) => {
    const msg = err instanceof Error ? err.message : fallback;
    setApiBannerError(msg);
  }, []);

  const loadPublicEvents = useCallback(async () => {
    setPublicEventsLoading(true);
    try {
      const res = await api.public.getEvents();
      setPublicEvents(Array.isArray(res?.events) ? res.events : []);
      setPublicScheduleBlocks(Array.isArray(res?.scheduleBlocks) ? res.scheduleBlocks : []);
    } catch {
      setPublicEvents([]);
      setPublicScheduleBlocks([]);
    } finally {
      setPublicEventsLoading(false);
    }
  }, []);

  const hydrateStudioWorkspace = useCallback(async () => {
    setStudioLoading(true);
    try {
      const data = await api.studio.bootstrap();
      if (data?.profile) setProfile(data.profile);
      setEvents(Array.isArray(data?.events) ? data.events : []);
      setAttendees(Array.isArray(data?.attendees) ? data.attendees : []);
      setScheduleBlocks(Array.isArray(data?.scheduleBlocks) ? data.scheduleBlocks : []);
      setAlerts(Array.isArray(data?.alerts) ? data.alerts : []);
      setDisposableShots(Array.isArray(data?.disposableShots) ? data.disposableShots : []);
      setRollSettings(
        data?.rollSettings && typeof data.rollSettings === 'object' ? data.rollSettings : {}
      );
      setCreatorApps(Array.isArray(data?.creatorApps) ? data.creatorApps : []);
      setCreatorAppLogs(Array.isArray(data?.creatorAppLogs) ? data.creatorAppLogs : []);
      setIsSignedIn(true);
      setApiBannerError(null);
      try {
        const loadedProfile = data?.profile;
        const loadedEvents = Array.isArray(data?.events) ? data.events : [];
        const wtKey = getWalkthroughStorageKey(loadedProfile);
        if (loadedEvents.length === 0 && !localStorage.getItem(wtKey)) {
          setShowWalkthrough(true);
        }
      } catch {
        // Ignore storage failures
      }
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to load workspace from Supabase.';
      const lower = msg.toLowerCase();
      const isAuthFailure =
        (err instanceof ApiError && (err.status === 401 || err.code === 'INVALID_SESSION_TOKEN')) ||
        lower.includes('session') ||
        lower.includes('authentication') ||
        lower.includes('invalid jwt') ||
        lower.includes('token is malformed') ||
        lower.includes('invalid number of segment') ||
        lower.includes('expired') ||
        lower.includes('timed out') ||
        lower.includes('inactivity');
      const isForbidden =
        (err instanceof ApiError && err.status === 403) ||
        lower.includes('requires one of') ||
        lower.includes('only an organiser') ||
        lower.includes('organiser');
      if (isAuthFailure) {
        if (isCheckInScreenActiveRef.current) {
          return false;
        }
        saveStoredSession(null);
        saveStoredCreatorToken(null);
        setCreatorUnlocked(false);
        setIsSignedIn(false);
        if (lower.includes('timed out') || lower.includes('inactivity')) {
          setSessionTimeoutNotice(
            'Your session timed out after 30 minutes of inactivity. Sign in again to continue.'
          );
          setRoute('signin');
        }
      } else if (isForbidden) {
        setProfile((prev) => ({ ...prev, appRole: 'gate_staff' }));
        setEvents([]);
        setAttendees([]);
        setScheduleBlocks([]);
        setAlerts([]);
        setDisposableShots([]);
        setRollSettings({});
        setCreatorApps([]);
        setCreatorAppLogs([]);
        setApiBannerError('Only event organisers can enter the Studio workspace.');
      } else {
        setApiBannerError(msg);
      }
      return false;
    } finally {
      setStudioLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    const init = async () => {
      const oauthSession = extractSessionFromUrlHash();
      const storedSession = getStoredSession();
      if (getStoredCreatorToken()) {
        setCreatorUnlocked(true);
      }
      if (oauthSession || storedSession) {
        setAuthBootstrapping(true);
      }
      try {
        const health = await api.health();
        if (!cancelled) {
          setSupabaseConfigured(health.supabaseConfigured);
          setInMemoryMode(Boolean(health.inMemoryFallback));
          if (health.creatorEmail) setCreatorEmail(health.creatorEmail);
          setCreatorPasswordConfigured(Boolean(health.creatorPasswordConfigured));
          if (!health.supabaseConfigured && !health.inMemoryFallback) {
            setApiBannerError(
              'Supabase environment variables (SUPABASE_URL, SUPABASE_ANON_KEY) are not configured on the server yet.'
            );
          }
        }
      } catch {
        // Ignore transient health check failure
      }

      await loadPublicEvents();

      const activeSession = oauthSession ?? storedSession;
      if (activeSession) {
        const ok = await hydrateStudioWorkspace();
        if (!cancelled && ok) {
          if (pendingPaystackRef || pendingSubscriptionRef) {
            setActiveScreen('billing');
            setRoute('studio');
            if (typeof window !== 'undefined' && window.location.pathname !== '/studio') {
              window.history.replaceState(null, '', '/studio');
            }
          } else if (oauthSession) {
            setRoute('studio');
            if (typeof window !== 'undefined' && window.location.pathname !== '/studio') {
              window.history.replaceState(null, '', '/studio');
            }
          }
        }
      }
      if (!cancelled) {
        setAuthBootstrapping(false);
        setHasCheckedStoredSession(true);
      }
    };

    void init();

    const handleHashChange = async () => {
      const hashSession = extractSessionFromUrlHash();
      if (hashSession && !cancelled) {
        const ok = await hydrateStudioWorkspace();
        if (ok && !cancelled) {
          setRoute('studio');
          if (typeof window !== 'undefined' && window.location.pathname !== '/studio') {
            window.history.replaceState(null, '', '/studio');
          }
        }
      }
    };
    window.addEventListener('hashchange', handleHashChange);

    return () => {
      cancelled = true;
      window.removeEventListener('hashchange', handleHashChange);
    };
  }, [hydrateStudioWorkspace, loadPublicEvents]);

  const safePublicEvents = Array.isArray(publicEvents) ? publicEvents : [];
  const safePublicScheduleBlocks = Array.isArray(publicScheduleBlocks) ? publicScheduleBlocks : [];
  const safeEvents = Array.isArray(events) ? events : [];
  const safeAttendees = Array.isArray(attendees) ? attendees : [];
  const safeScheduleBlocks = Array.isArray(scheduleBlocks) ? scheduleBlocks : [];
  const mergedPublicScheduleBlocks = useMemo(() => {
    const byId = new Map<string, ScheduleBlock>();
    for (const blk of safePublicScheduleBlocks) {
      byId.set(blk.id, blk);
    }
    for (const blk of safeScheduleBlocks) {
      byId.set(blk.id, blk);
    }
    return Array.from(byId.values());
  }, [safePublicScheduleBlocks, safeScheduleBlocks]);
  const safeAlerts = Array.isArray(alerts) ? alerts : [];
  const safeDisposableShots = Array.isArray(disposableShots) ? disposableShots : [];
  const safeRollSettings =
    rollSettings && typeof rollSettings === 'object' ? rollSettings : {};
  const safeCreatorApps = Array.isArray(creatorApps) ? creatorApps : [];
  const safeCreatorAppLogs = Array.isArray(creatorAppLogs) ? creatorAppLogs : [];

  const isCheckInScreenActive =
    (route === 'studio' && activeScreen === 'checkin' && !workspaceEventId && !studioSubScreen) ||
    (route === 'studio' && Boolean(workspaceEventId) && workspaceCheckInActive) ||
    (route === 'studio' &&
      activeScreen === 'attendees' &&
      !workspaceEventId &&
      !studioSubScreen &&
      attendeesWalkInActive) ||
    (route === 'demo-event' &&
      (publicPreviewFocus === 'checkin' ||
        publicPreviewFocus === 'walkin' ||
        publicCheckinModalOpen));

  const isCheckInScreenActiveRef = useRef(isCheckInScreenActive);
  useEffect(() => {
    isCheckInScreenActiveRef.current = isCheckInScreenActive;
    setCheckInSessionExempt(isCheckInScreenActive);
  }, [isCheckInScreenActive]);

  useEffect(() => {
    if (route !== 'demo-event' || !publicPreviewEventId) return;
    let cancelled = false;
    api.public
      .getEventBySlugOrId(publicPreviewEventId)
      .then((res) => {
        if (cancelled) return;
        const blocks = Array.isArray(res?.scheduleBlocks) ? res.scheduleBlocks : [];
        if (blocks.length > 0) {
          setPublicScheduleBlocks((prev) => {
            const byId = new Map(prev.map((b) => [b.id, b]));
            for (const blk of blocks) byId.set(blk.id, blk);
            return Array.from(byId.values());
          });
        }
      })
      .catch(() => {
        // Keep cached public events / schedule blocks if slug lookup fails
      });
    return () => {
      cancelled = true;
    };
  }, [route, publicPreviewEventId]);

  const activeEvents = isSignedIn ? safeEvents : safePublicEvents;
  const selectedEvent = selectedEventId
    ? safeEvents.find((e) => e.id === selectedEventId) ?? null
    : null;

  const workspaceEvent = workspaceEventId
    ? safeEvents.find((e) => e.id === workspaceEventId) ?? null
    : null;

  const syncBrowserPath = useCallback(
    (nextPath: string, replace = false) => {
      if (typeof window === 'undefined') return;
      const currentFull = `${routerLocation.pathname}${routerLocation.search}`;
      if (currentFull !== nextPath) {
        routerNavigate(nextPath, { replace });
      }
    },
    [routerLocation.pathname, routerLocation.search, routerNavigate]
  );

  const applyModuleTarget = (target: PendingModuleTarget) => {
    setWorkspaceEventId(null);
    setStudioSubScreen(target.subScreen ?? null);
    if (target.route === 'camera') {
      setCameraEventId(target.eventId);
      setCameraGuestName(target.guestName);
      setCameraReturnRoute(target.returnRoute ?? 'home');
      setRoute('camera');
      syncBrowserPath(target.eventId ? `/e/${encodeURIComponent(target.eventId)}/camera` : '/camera');
    } else {
      if (target.screen === 'checkin') {
        setCheckinEventId(target.eventId);
        setCheckinPrefillCode(target.prefillCode);
      } else if (target.screen === 'camera') {
        setCameraEventId(target.eventId);
      }
      setActiveScreen(target.screen ?? 'overview');
      setRoute('studio');
      syncBrowserPath('/studio');
    }
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const requireSignedIn = (target: PendingModuleTarget) => {
    if (!isSignedIn) {
      setPendingTarget(target);
      setRoute('signin');
      syncBrowserPath('/signin');
      if (typeof window !== 'undefined') {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
      return;
    }
    applyModuleTarget(target);
  };

  const openLegalRoute = useCallback(
    (doc: 'terms' | 'privacy') => {
      setRoute(doc);
      syncBrowserPath(doc === 'terms' ? '/terms' : '/privacy');
      if (typeof window !== 'undefined') {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    },
    [syncBrowserPath]
  );

  const navigateHome = useCallback(() => {
    setRoute('home');
    syncBrowserPath('/');
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [syncBrowserPath]);

  const openEventInvitation = useCallback(
    (
      evtOrSlug?: EventItem | string,
      focus: 'top' | 'register' | 'checkin' | 'walkin' | 'gifts' | 'polls' = 'top',
      deskToken?: string
    ) => {
      const slugOrId =
        typeof evtOrSlug === 'string' ? evtOrSlug : evtOrSlug?.slug || evtOrSlug?.id;
      const targetId =
        typeof evtOrSlug === 'string' ? evtOrSlug : evtOrSlug?.id || slugOrId;
      setPublicPreviewEventId(targetId);
      setPublicPreviewFocus(focus);
      setPublicPreviewDeskToken(focus === 'gifts' ? deskToken : undefined);
      setPublicPreviewPassCode(undefined);
      setRoute('demo-event');
      if (slugOrId) {
        const cleanSlug = encodeURIComponent(slugOrId);
        const nextPath =
          focus === 'checkin'
            ? `/e/${cleanSlug}/checkin`
            : focus === 'walkin'
              ? `/e/${cleanSlug}/walkin`
              : focus === 'gifts'
                ? deskToken
                  ? `/e/${cleanSlug}/gifts?desk=${encodeURIComponent(deskToken)}`
                  : `/e/${cleanSlug}/gifts`
                : focus === 'polls'
                  ? `/e/${cleanSlug}/polls`
                  : focus === 'register'
                    ? `/e/${cleanSlug}?tab=register`
                    : `/e/${cleanSlug}`;
        syncBrowserPath(nextPath);
      }
      if (
        (focus === 'top' ||
          focus === 'checkin' ||
          focus === 'walkin' ||
          focus === 'gifts' ||
          focus === 'polls') &&
        typeof window !== 'undefined'
      ) {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    },
    [syncBrowserPath]
  );

  useEffect(() => {
    const pathname = routerLocation.pathname;
    const search = routerLocation.search;
    const nextRoute = resolveRouteFromLocation(pathname, search);
    const invite = parseInvitationFromValues(pathname, search);
    if (invite.focus === 'camera') {
      setCameraEventId(invite.slugOrId);
      setCameraGuestName(invite.guest);
      setCameraPassCode(invite.pass);
      setVerifiedCameraPass(null);
      setRoute('camera');
      return;
    }
    if (invite.slugOrId) {
      setPublicPreviewEventId(invite.slugOrId);
      setPublicPreviewFocus(
        invite.focus === 'register' ||
          invite.focus === 'checkin' ||
          invite.focus === 'walkin' ||
          invite.focus === 'gifts' ||
          invite.focus === 'polls'
          ? invite.focus
          : 'top'
      );
      setPublicPreviewDeskToken(invite.desk);
      setPublicPreviewPassCode(invite.pass);
      setRoute('demo-event');
      return;
    }
    setRoute(nextRoute);
  }, [routerLocation.pathname, routerLocation.search]);

  const handleAuthenticated = async (
    session: StoredAuthSession,
    nextProfile: OrganizerProfile,
    openCreatorConsole = false,
    isNewUser = false
  ) => {
    saveStoredSession(session);
    if (nextProfile) setProfile(nextProfile);
    const now = Date.now();
    lastActivityRef.current = now;
    try {
      localStorage.setItem(LAST_ACTIVITY_KEY, String(now));
    } catch {
      // Ignore storage failures
    }
    setSessionTimeoutNotice(null);
    setSessionWarningSecondsLeft(null);
    setIsSignedIn(true);
    setApiBannerError(null);
    if (getStoredCreatorToken()) {
      setCreatorUnlocked(true);
    }
    await hydrateStudioWorkspace();
    await loadPublicEvents();

    if (!openCreatorConsole) {
      try {
        const wtKey = getWalkthroughStorageKey(nextProfile);
        if (isNewUser || !localStorage.getItem(wtKey)) {
          setShowWalkthrough(true);
        }
      } catch {
        if (isNewUser) setShowWalkthrough(true);
      }
    }

    if (openCreatorConsole) {
      const canAccessConsole =
        nextProfile?.appRole === 'creator' ||
        nextProfile?.email?.toLowerCase() === creatorEmail.toLowerCase();
      setPendingTarget(null);
      setWorkspaceEventId(null);
      setStudioSubScreen(null);
      setActiveScreen(canAccessConsole ? 'console' : 'overview');
      setRoute('studio');
      syncBrowserPath('/studio');
      if (typeof window !== 'undefined') {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
      return;
    }

    if (pendingTarget) {
      const target = pendingTarget;
      setPendingTarget(null);
      applyModuleTarget(target);
      return;
    }
    setRoute('studio');
    syncBrowserPath('/studio');
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const handleSignOut = useCallback(
    async (reason?: unknown) => {
      const isTimeout = reason === 'timeout';
      try {
        await api.auth.signOut();
      } catch {
        // Clear local session regardless
      }
      saveStoredSession(null);
      saveStoredCreatorToken(null);
      try {
        localStorage.removeItem(LAST_ACTIVITY_KEY);
      } catch {
        // Ignore storage errors
      }
      setCreatorUnlocked(false);
      setIsSignedIn(false);
      setShowWalkthrough(false);
      setSessionWarningSecondsLeft(null);
      setSessionTimeoutNotice(
        isTimeout
          ? 'Your session timed out after 30 minutes of inactivity. Sign in again to continue.'
          : null
      );
      setEvents([]);
      setAttendees([]);
      setScheduleBlocks([]);
      setAlerts([]);
      setDisposableShots([]);
      setRollSettings({});
      setCreatorApps([]);
      setCreatorAppLogs([]);
      setProfile(EMPTY_PROFILE);
      setPendingTarget(null);
      setStudioSubScreen(null);
      setWorkspaceEventId(null);
      setSelectedEventId(null);
      setActiveScreen('overview');
      setRoute(isTimeout ? 'signin' : 'home');
      syncBrowserPath(isTimeout ? '/signin' : '/');
      void loadPublicEvents();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },
    [loadPublicEvents, syncBrowserPath]
  );

  const handleDeleteAccount = useCallback(async () => {
    await api.studio.deleteAccount();
    saveStoredSession(null);
    saveStoredCreatorToken(null);
    try {
      localStorage.removeItem(LAST_ACTIVITY_KEY);
    } catch {
      // Ignore storage errors
    }
    setCreatorUnlocked(false);
    setIsSignedIn(false);
    setSessionWarningSecondsLeft(null);
    setSessionTimeoutNotice(null);
    setEvents([]);
    setAttendees([]);
    setScheduleBlocks([]);
    setAlerts([]);
    setDisposableShots([]);
    setRollSettings({});
    setCreatorApps([]);
    setCreatorAppLogs([]);
    setProfile(EMPTY_PROFILE);
    setPendingTarget(null);
    setStudioSubScreen(null);
    setWorkspaceEventId(null);
    setSelectedEventId(null);
    setActiveScreen('overview');
    setRoute('home');
    syncBrowserPath('/');
    void loadPublicEvents();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [loadPublicEvents, syncBrowserPath]);

  const sessionWarningVisibleRef = useRef(false);
  useEffect(() => {
    sessionWarningVisibleRef.current = sessionWarningSecondsLeft !== null;
  }, [sessionWarningSecondsLeft]);

  const staySignedIn = useCallback(() => {
    const now = Date.now();
    lastActivityRef.current = now;
    try {
      localStorage.setItem(LAST_ACTIVITY_KEY, String(now));
    } catch {
      // Ignore storage errors
    }
    setSessionWarningSecondsLeft(null);
    void api.auth.getSession().catch(() => {
      // If server already expired the session, next studio call will handle sign-out cleanly
    });
  }, []);

  useEffect(() => {
    if (!isSignedIn) {
      setSessionWarningSecondsLeft(null);
      return;
    }

    if (isCheckInScreenActive) {
      setSessionWarningSecondsLeft(null);
      const stampActivity = () => {
        const ts = Date.now();
        lastActivityRef.current = ts;
        try {
          localStorage.setItem(LAST_ACTIVITY_KEY, String(ts));
        } catch {
          // Ignore storage errors
        }
      };
      const pingCheckInSession = () => {
        stampActivity();
        void api.auth.getSession().catch(() => {});
      };
      const handleVisibilityOrFocus = () => {
        if (typeof document === 'undefined' || document.visibilityState === 'visible') {
          pingCheckInSession();
        }
      };
      stampActivity();
      const keepAliveTimer = window.setInterval(stampActivity, 60 * 1000);
      const tokenRefreshTimer = window.setInterval(pingCheckInSession, 10 * 60 * 1000);
      window.addEventListener('focus', handleVisibilityOrFocus);
      document.addEventListener('visibilitychange', handleVisibilityOrFocus);
      return () => {
        window.clearInterval(keepAliveTimer);
        window.clearInterval(tokenRefreshTimer);
        window.removeEventListener('focus', handleVisibilityOrFocus);
        document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
      };
    }

    const now = Date.now();
    let initialActivity = now;
    try {
      const storedRaw = localStorage.getItem(LAST_ACTIVITY_KEY);
      const parsed = storedRaw ? Number(storedRaw) : NaN;
      if (Number.isFinite(parsed) && parsed > 0) {
        initialActivity = parsed;
      } else {
        localStorage.setItem(LAST_ACTIVITY_KEY, String(now));
      }
    } catch {
      // Ignore storage errors
    }

    if (now - initialActivity >= SESSION_IDLE_TIMEOUT_MS) {
      void handleSignOut('timeout');
      return;
    }

    lastActivityRef.current = initialActivity;
    let lastStorageWrite = 0;

    const recordActivity = () => {
      if (sessionWarningVisibleRef.current) return;
      const ts = Date.now();
      lastActivityRef.current = ts;
      if (ts - lastStorageWrite >= 4000) {
        lastStorageWrite = ts;
        try {
          localStorage.setItem(LAST_ACTIVITY_KEY, String(ts));
        } catch {
          // Ignore storage errors
        }
      }
    };

    const handleStorageSync = (e: StorageEvent) => {
      if (e.key === LAST_ACTIVITY_KEY) {
        if (!e.newValue) {
          void handleSignOut('manual');
          return;
        }
        const ts = Number(e.newValue);
        if (Number.isFinite(ts) && ts > lastActivityRef.current) {
          lastActivityRef.current = ts;
          setSessionWarningSecondsLeft(null);
        }
      }
    };

    const eventsToWatch = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart', 'click'] as const;
    eventsToWatch.forEach((evtName) => {
      window.addEventListener(evtName, recordActivity, { passive: true });
    });
    window.addEventListener('storage', handleStorageSync);

    const timer = window.setInterval(() => {
      const elapsed = Date.now() - lastActivityRef.current;
      const remaining = SESSION_IDLE_TIMEOUT_MS - elapsed;
      if (remaining <= 0) {
        window.clearInterval(timer);
        void handleSignOut('timeout');
        return;
      }
      if (remaining <= SESSION_WARNING_MS) {
        setSessionWarningSecondsLeft(Math.max(1, Math.ceil(remaining / 1000)));
      } else if (sessionWarningVisibleRef.current) {
        setSessionWarningSecondsLeft(null);
      }
    }, 1000);

    return () => {
      window.clearInterval(timer);
      eventsToWatch.forEach((evtName) => {
        window.removeEventListener(evtName, recordActivity);
      });
      window.removeEventListener('storage', handleStorageSync);
    };
  }, [handleSignOut, isCheckInScreenActive, isSignedIn]);

  const closeWalkthrough = useCallback(
    (markComplete = true) => {
      setShowWalkthrough(false);
      if (markComplete) {
        try {
          localStorage.setItem(getWalkthroughStorageKey(profile), '1');
        } catch {
          // Ignore storage failures
        }
      }
    },
    [profile]
  );

  const handleUpdateProfile = async (nextProfile: OrganizerProfile) => {
    const previous = profile;
    setProfile(nextProfile);
    try {
      const res = await api.studio.updateProfile(nextProfile);
      setProfile(res.profile);
    } catch (err) {
      setProfile(previous);
      notifyError(err, 'Failed to save profile changes to Supabase.');
      throw err;
    }
  };

  const creatingEventRef = useRef(false);

  const handleCreateEventWithBlocks = async (newEvt: EventItem, newBlocks: ScheduleBlock[]) => {
    if (!isSignedIn) {
      openCreateWizard();
      return;
    }
    if (effectiveRole === 'gate_staff') {
      const msg = 'Access denied: Only event creators can create events and publish check-in QR passes.';
      setApiBannerError(msg);
      throw new Error(msg);
    }
    if (creatingEventRef.current) return;
    creatingEventRef.current = true;
    try {
      const res = await api.studio.createEvent(newEvt, newBlocks);
      setEvents((prev) => [res.event, ...prev]);
      if (res.event.status === 'live' || res.event.status === 'upcoming') {
        const publicSafeCreated: EventItem = {
          ...res.event,
          extraDataConfig: sanitizePublicExtraDataConfig(res.event.extraDataConfig),
        };
        setPublicEvents((prev) => [publicSafeCreated, ...prev]);
      }
      if (res.blocks.length > 0) {
        setScheduleBlocks((prev) => [...prev, ...res.blocks]);
      }
      setStudioSubScreen(null);
      setWorkspaceEventId(res.event.id);
      setActiveScreen('events');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      notifyError(err, 'Failed to create event in Supabase.');
      throw err;
    } finally {
      creatingEventRef.current = false;
    }
  };

  const openCreateWizard = () => {
    if (isSignedIn && effectiveRole === 'gate_staff') {
      setApiBannerError(
        'Access denied: Only event creators can create events and publish check-in QR passes.'
      );
      return;
    }
    requireSignedIn({
      route: 'studio',
      screen: 'events',
      subScreen: 'create-event',
      label: 'Create Event Wizard',
    });
  };

  const openBillingScreen = (bundleId?: unknown) => {
    if (typeof bundleId === 'string' && bundleId.trim()) {
      setSelectedCheckoutBundleId(bundleId.trim());
    }
    requireSignedIn({
      route: 'studio',
      screen: 'billing',
      label: 'Plan & Billing',
    });
  };

  const openCsvExportScreen = (eventId?: string) => {
    if (!isSignedIn) {
      requireSignedIn({
        route: 'studio',
        screen: 'attendees',
        subScreen: 'csv-export',
        label: 'CSV Attendee Export',
      });
      return;
    }
    setWorkspaceEventId(null);
    setCsvExportEventId(eventId);
    setActiveScreen('attendees');
    setStudioSubScreen('csv-export');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const openQrScanner = (eventId?: string, code?: string) => {
    requireSignedIn({
      route: 'studio',
      screen: 'checkin',
      eventId,
      prefillCode: code,
      label: 'QR Gate Scanner',
    });
  };

  const openPublicCamera = (
    eventId?: string,
    guestName?: string,
    returnTo: 'home' | 'demo-event' = 'home',
    passCode?: string
  ) => {
    const pool = [...safeEvents, ...safePublicEvents];
    const targetLower = (eventId || '').toLowerCase();
    const matched = targetLower
      ? pool.find((e) => e.id.toLowerCase() === targetLower || e.slug.toLowerCase() === targetLower)
      : pool[0];
    const resolvedId = matched?.id || eventId || pool[0]?.id;
    const resolvedSlug = matched?.slug || resolvedId;

    setCameraEventId(resolvedId);
    setCameraGuestName(guestName);
    setCameraPassCode(passCode);
    setVerifiedCameraPass(null);
    setCameraReturnRoute(returnTo);
    setRoute('camera');
    const search = new URLSearchParams();
    if (passCode?.trim()) search.set('pass', passCode.trim());
    if (guestName?.trim()) search.set('guest', guestName.trim());
    const qs = search.toString();
    syncBrowserPath(
      resolvedSlug
        ? `/e/${encodeURIComponent(resolvedSlug)}/camera${qs ? `?${qs}` : ''}`
        : `/camera${qs ? `?${qs}` : ''}`
    );
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const openStudioCamera = (eventId?: string) => {
    requireSignedIn({
      route: 'studio',
      screen: 'camera',
      eventId,
      label: 'Event Disposable Camera',
    });
  };

  const handleAddShot = async (
    shot: DisposableShot
  ): Promise<{ ok: boolean; error?: string }> => {
    const useStudioApi = isSignedIn && isStudioAuthorized && route === 'studio';
    setDisposableShots((prev) => [shot, ...prev]);
    try {
      const res = useStudioApi
        ? await api.studio.addShot(shot)
        : await api.public.addCameraShot(shot.eventId, shot);
      setDisposableShots((prev) => prev.map((s) => (s.id === shot.id ? res.shot : s)));
      return { ok: true };
    } catch (err) {
      setDisposableShots((prev) => prev.filter((s) => s.id !== shot.id));
      const msg = err instanceof Error ? err.message : 'Failed to save camera shot.';
      notifyError(err, msg);
      return { ok: false, error: msg };
    }
  };

  const handleToggleLikeShot = async (shotId: string) => {
    const useStudioApi = isSignedIn && isStudioAuthorized && route === 'studio';
    const previous = disposableShots;
    setDisposableShots((prev) =>
      prev.map((s) =>
        s.id === shotId
          ? {
              ...s,
              liked: !s.liked,
              likes: s.liked ? Math.max(0, s.likes - 1) : s.likes + 1,
            }
          : s
      )
    );
    try {
      const res = useStudioApi
        ? await api.studio.toggleLikeShot(shotId)
        : await api.public.toggleLikeCameraShot(shotId);
      setDisposableShots((prev) => prev.map((s) => (s.id === shotId ? res.shot : s)));
    } catch (err) {
      setDisposableShots(previous);
      notifyError(err, 'Failed to update shot favorite.');
      throw err;
    }
  };

  const handleDeleteShot = async (shotId: string, shooterKey?: string) => {
    const useStudioApi = isSignedIn && isStudioAuthorized && route === 'studio';
    const previous = disposableShots;
    setDisposableShots((prev) => prev.filter((s) => s.id !== shotId));
    try {
      if (shooterKey || !useStudioApi) {
        await api.public.deleteCameraShot(shotId, shooterKey || '');
      } else {
        await api.studio.deleteShot(shotId);
      }
    } catch (err) {
      setDisposableShots(previous);
      notifyError(err, 'Failed to delete photo.');
      throw err;
    }
  };

  const handleDevelopRoll = async (eventId: string) => {
    const previous = disposableShots;
    setDisposableShots((prev) =>
      prev.map((s) => (s.eventId === eventId ? { ...s, developed: true } : s))
    );
    try {
      await api.studio.developRoll(eventId);
    } catch (err) {
      setDisposableShots(previous);
      notifyError(err, 'Failed to develop roll in Supabase.');
      throw err;
    }
  };

  const handleUpdateRollSettings = async (eventId: string, next: DisposableRollSettings) => {
    const previous = rollSettings;
    setRollSettings((prev) => ({ ...prev, [eventId]: next }));
    try {
      const res = await api.studio.updateRollSettings(eventId, next);
      setRollSettings((prev) => ({ ...prev, [eventId]: res.settings }));
    } catch (err) {
      setRollSettings(previous);
      notifyError(err, 'Failed to save camera roll settings to Supabase.');
      throw err;
    }
  };

  const handleUpdateEvent = async (updated: EventItem) => {
    const previousEvents = events;
    const previousPublicEvents = publicEvents;
    const sanitizedUpdated: EventItem = {
      ...updated,
      extraDataConfig: sanitizePublicExtraDataConfig(updated.extraDataConfig),
    };
    setEvents((prev) => prev.map((e) => (e.id === updated.id ? updated : e)));
    setPublicEvents((prev) => prev.map((e) => (e.id === updated.id ? sanitizedUpdated : e)));
    try {
      const res = await api.studio.updateEvent(updated);
      syncUpdatedEventWithPublicSanitize(res.event);
    } catch (err) {
      setEvents(previousEvents);
      setPublicEvents(previousPublicEvents);
      notifyError(err, 'Failed to update event in Supabase.');
      throw err;
    }
  };

  const handleUpdateEventPlanning = async (
    eventId: string,
    planningConfig: EventPlanningConfig
  ) => {
    const previousEvents = events;
    setEvents((prev) =>
      prev.map((evt) =>
        evt.id === eventId
          ? {
              ...evt,
              extraDataConfig: {
                ...(evt.extraDataConfig ?? { enableGiftTable: false, customFields: [] }),
                planningConfig,
              },
            }
          : evt
      )
    );
    try {
      const res = await api.studio.updateEventPlanning(eventId, planningConfig);
      syncUpdatedEventWithPublicSanitize(res.event);
    } catch (err) {
      setEvents(previousEvents);
      notifyError(err, 'Failed to save event planning in Supabase.');
      throw err;
    }
  };

  const handleToggleQrPassPublished = async (eventId: string, published: boolean) => {
    if (effectiveRole === 'gate_staff') {
      const msg = 'Access denied: Only the event creator can publish or unpublish check-in QR passes.';
      setApiBannerError(msg);
      throw new Error(msg);
    }
    try {
      const res = await api.studio.publishQrPass(eventId, published);
      setEvents((prev) => prev.map((e) => (e.id === eventId ? res.event : e)));
      setPublicEvents((prev) => prev.map((e) => (e.id === eventId ? res.event : e)));
      setApiBannerError(null);
    } catch (err) {
      notifyError(err, 'Only the event creator can publish check-in QR passes.');
      throw err;
    }
  };

  const handleDeleteEvent = async (id: string) => {
    const previousEvents = events;
    const previousPublicEvents = publicEvents;
    const previousBlocks = scheduleBlocks;
    const previousWorkspaceId = workspaceEventId;
    setEvents((prev) => prev.filter((e) => e.id !== id));
    setPublicEvents((prev) => prev.filter((e) => e.id !== id));
    setScheduleBlocks((prev) => prev.filter((b) => b.eventId !== id));
    if (workspaceEventId === id) {
      setWorkspaceEventId(null);
    }
    try {
      await api.studio.deleteEvent(id);
    } catch (err) {
      setEvents(previousEvents);
      setPublicEvents(previousPublicEvents);
      setScheduleBlocks(previousBlocks);
      setWorkspaceEventId(previousWorkspaceId);
      notifyError(err, 'Failed to delete event from Supabase.');
      throw err;
    }
  };

  const handlePublicRegisterAttendee = async (
    eventId: string,
    attendee: Attendee
  ): Promise<Attendee> => {
    const res = await api.public.registerAttendee(eventId, {
      name: attendee.name,
      email: attendee.email,
      phone: attendee.phone,
      organization: attendee.organization,
      tier: attendee.tier,
      ticketCode: attendee.ticketCode,
      validationGroup: attendee.validationGroup,
      inviteCodeUsed: attendee.inviteCodeUsed,
      customResponses: attendee.customResponses,
    });
    setPublicEvents((prev) => prev.map((e) => (e.id === eventId ? res.event : e)));
    if (isSignedIn) {
      setEvents((prev) => prev.map((e) => (e.id === eventId ? res.event : e)));
      setAttendees((prev) => [res.attendee, ...prev]);
    }
    return res.attendee;
  };

  const handlePublicSubmitGiftTableEntry = async (
    eventId: string,
    gift: Omit<GiftTableEntry, 'id' | 'eventId' | 'createdAt' | 'recordedVia'>
  ) => {
    const res = await api.public.submitGiftTableEntry(eventId, gift);
    setPublicEvents((prev) => prev.map((e) => (e.id === eventId ? res.event : e)));
    if (isSignedIn) {
      setEvents((prev) => prev.map((e) => (e.id === eventId ? res.event : e)));
    }
    return res;
  };

  const handleStudioRecordGiftTableEntry = async (
    eventId: string,
    gift: Omit<GiftTableEntry, 'id' | 'eventId' | 'createdAt' | 'recordedVia'>
  ) => {
    const res = await api.studio.recordGiftTableEntry(eventId, gift);
    setEvents((prev) => prev.map((e) => (e.id === eventId ? res.event : e)));
    setPublicEvents((prev) => prev.map((e) => (e.id === eventId ? res.event : e)));
    if (typeof res.smsCredits === 'number') {
      setProfile((prev) => ({ ...prev, smsCredits: res.smsCredits! }));
    }
    return res;
  };

  const handleCreateGiftAttendantLink = async (
    eventId: string,
    payload: { attendantName: string; roleLabel?: string; phone?: string }
  ) => {
    const res = await api.studio.createGiftAttendantLink(eventId, payload);
    setEvents((prev) => prev.map((e) => (e.id === eventId ? res.event : e)));
    return res.link;
  };

  const handleToggleGiftAttendantLink = async (
    eventId: string,
    linkId: string,
    active?: boolean
  ) => {
    const res = await api.studio.toggleGiftAttendantLink(eventId, linkId, active);
    setEvents((prev) => prev.map((e) => (e.id === eventId ? res.event : e)));
  };

  const handleDeleteGiftAttendantLink = async (eventId: string, linkId: string) => {
    const res = await api.studio.deleteGiftAttendantLink(eventId, linkId);
    setEvents((prev) => prev.map((e) => (e.id === eventId ? res.event : e)));
  };

  const syncUpdatedEventWithPublicSanitize = useCallback((studioEvent: EventItem) => {
    setEvents((prev) => prev.map((e) => (e.id === studioEvent.id ? studioEvent : e)));
    const publicSafeEvent: EventItem = {
      ...studioEvent,
      extraDataConfig: sanitizePublicExtraDataConfig(studioEvent.extraDataConfig),
    };
    setPublicEvents((prev) => prev.map((e) => (e.id === studioEvent.id ? publicSafeEvent : e)));
  }, []);

  const handleStudioCreatePoll = async (
    eventId: string,
    payload: {
      question: string;
      description?: string;
      sessionLabel?: string;
      options: string[];
      status?: EventPollStatus;
      allowMultiple?: boolean;
      showResultsToPublic?: boolean;
      requireVerifiedPass?: boolean;
    }
  ) => {
    const res = await api.studio.createPoll(eventId, payload);
    syncUpdatedEventWithPublicSanitize(res.event);
    return res.poll;
  };

  const handleStudioUpdatePoll = async (
    eventId: string,
    pollId: string,
    patch: {
      question?: string;
      description?: string;
      sessionLabel?: string;
      status?: EventPollStatus;
      allowMultiple?: boolean;
      showResultsToPublic?: boolean;
      requireVerifiedPass?: boolean;
    }
  ) => {
    const res = await api.studio.updatePoll(eventId, pollId, patch);
    syncUpdatedEventWithPublicSanitize(res.event);
    return res.poll;
  };

  const handleStudioDeletePoll = async (eventId: string, pollId: string) => {
    const res = await api.studio.deletePoll(eventId, pollId);
    syncUpdatedEventWithPublicSanitize(res.event);
  };

  const handleStudioRegisterAttendee = async (eventId: string, attendee: Attendee) => {
    try {
      const res = await api.studio.registerAttendee(eventId, attendee);
      setAttendees((prev) => [res.attendee, ...prev]);
      setEvents((prev) => prev.map((evt) => (evt.id === eventId ? res.event : evt)));
      setPublicEvents((prev) => prev.map((evt) => (evt.id === eventId ? res.event : evt)));
      if (typeof res.smsCredits === 'number') {
        setProfile((prev) => ({ ...prev, smsCredits: res.smsCredits! }));
      }
      if (res.smsSkippedReason) {
        setApiBannerError(res.smsSkippedReason);
      }
      return {
        checkInMessageSent: res.checkInMessageSent,
        checkInSmsSent: res.checkInSmsSent,
        cameraUrl: res.cameraUrl,
        dispatchedMessage: res.dispatchedMessage,
        smsCreditsUsed: res.smsCreditsUsed,
        smsSkippedReason: res.smsSkippedReason,
      };
    } catch (err) {
      notifyError(err, 'Failed to register attendee in Supabase.');
      throw err;
    }
  };

  const handleBroadcastUpdate = async (payload: {
    eventId?: string;
    attendeeIds: string[];
    message: string;
    channel?: 'email' | 'sms' | 'dual';
  }) => {
    const res = await api.studio.broadcastUpdate(payload);
    if (typeof res.smsCredits === 'number') {
      setProfile((prev) => ({ ...prev, smsCredits: res.smsCredits! }));
    }
    if (Array.isArray(res.events) && res.events.length > 0) {
      const byId = new Map(res.events.map((e) => [e.id, e]));
      setEvents((prev) => prev.map((e) => byId.get(e.id) ?? e));
      setPublicEvents((prev) => prev.map((e) => byId.get(e.id) ?? e));
    }
    return res;
  };

  const handleToggleCheckIn = async (
    attendeeId: string,
    options?: { mode?: 'toggle' | 'checkin' | 'undo'; dateIso?: string }
  ): Promise<{
    checkInMessageSent?: boolean;
    checkInSmsSent?: boolean;
    cameraUrl?: string;
    dispatchedMessage?: string;
    smsCredits?: number;
    smsCreditsUsed?: number;
    smsSkippedReason?: string;
  } | void> => {
    const previousAttendees = attendees;
    const previousEvents = events;
    const target = attendees.find((a) => a.id === attendeeId);
    const targetEvent = target ? events.find((e) => e.id === target.eventId) : undefined;
    const policy = getEventCheckInPolicy(targetEvent);
    const targetDateIso = sanitizeIsoDate(options?.dateIso) ?? getTodayIsoDate();
    const mode = options?.mode ?? 'toggle';
    const wasCheckedIn = Boolean(target?.checkedIn);
    const nowTime = new Date().toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
    });

    let optimisticCheckedIn = !wasCheckedIn;
    let optimisticDates: string[] = [];
    let optimisticCheckedInAt: string | undefined = nowTime;

    if (target) {
      if (policy === 'daily-reentry') {
        const existingDates = sanitizeCheckedInDates(target.checkedInDates) ?? [];
        let nextDates = [...existingDates];
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
        optimisticDates = nextDates;
        optimisticCheckedIn = nextDates.length > 0;
        const addedDay = nextDates.includes(targetDateIso) && !existingDates.includes(targetDateIso);
        optimisticCheckedInAt = optimisticCheckedIn
          ? addedDay
            ? nowTime
            : target.checkedInAt || nowTime
          : undefined;
      } else {
        optimisticCheckedIn =
          mode === 'checkin' ? true : mode === 'undo' ? false : !wasCheckedIn;
        optimisticDates = optimisticCheckedIn ? [targetDateIso] : [];
        optimisticCheckedInAt = optimisticCheckedIn ? nowTime : undefined;
      }
    }

    setAttendees((prev) =>
      prev.map((a) =>
        a.id === attendeeId
          ? {
              ...a,
              checkedIn: optimisticCheckedIn,
              checkedInAt: optimisticCheckedInAt,
              checkedInDates: optimisticDates,
            }
          : a
      )
    );
    if (target) {
      const delta =
        !wasCheckedIn && optimisticCheckedIn ? 1 : wasCheckedIn && !optimisticCheckedIn ? -1 : 0;
      if (delta !== 0) {
        setEvents((prev) =>
          prev.map((e) =>
            e.id === target.eventId ? { ...e, checkedIn: Math.max(0, e.checkedIn + delta) } : e
          )
        );
      }
    }
    try {
      const res = await api.studio.toggleCheckIn(attendeeId, options);
      setAttendees((prev) => prev.map((a) => (a.id === attendeeId ? res.attendee : a)));
      if (target) {
        const expectedDelta =
          !wasCheckedIn && res.attendee.checkedIn
            ? 1
            : wasCheckedIn && !res.attendee.checkedIn
              ? -1
              : 0;
        const optimisticDelta =
          !wasCheckedIn && optimisticCheckedIn ? 1 : wasCheckedIn && !optimisticCheckedIn ? -1 : 0;
        const correction = expectedDelta - optimisticDelta;
        if (correction !== 0) {
          setEvents((prev) =>
            prev.map((e) =>
              e.id === target.eventId ? { ...e, checkedIn: Math.max(0, e.checkedIn + correction) } : e
            )
          );
        }
      }
      if (typeof res.smsCredits === 'number') {
        setProfile((prev) => ({ ...prev, smsCredits: res.smsCredits! }));
      }
      return {
        checkInMessageSent: res.checkInMessageSent,
        checkInSmsSent: res.checkInSmsSent,
        cameraUrl: res.cameraUrl,
        dispatchedMessage: res.dispatchedMessage,
        smsCredits: res.smsCredits,
        smsCreditsUsed: res.smsCreditsUsed,
        smsSkippedReason: res.smsSkippedReason,
      };
    } catch (err) {
      setAttendees(previousAttendees);
      setEvents(previousEvents);
      notifyError(err, 'Failed to update check-in status in Supabase.');
      throw err;
    }
  };

  const handleDeleteAttendee = async (attendeeId: string) => {
    const previousAttendees = attendees;
    const previousEvents = events;
    const previousPublicEvents = publicEvents;
    const target = attendees.find((a) => a.id === attendeeId);

    setAttendees((prev) => prev.filter((a) => a.id !== attendeeId));
    if (target) {
      const targetEvent = events.find((e) => e.id === target.eventId);
      const revenueDelta =
        target.paymentStatus === 'paid' ? Math.max(0, Number(targetEvent?.ticketPrice ?? 0)) : 0;
      const updateEventCounters = (evt: EventItem): EventItem =>
        evt.id === target.eventId
          ? {
              ...evt,
              registered: Math.max(0, evt.registered - 1),
              checkedIn: target.checkedIn ? Math.max(0, evt.checkedIn - 1) : evt.checkedIn,
              revenue: Math.max(0, evt.revenue - revenueDelta),
            }
          : evt;
      setEvents((prev) => prev.map(updateEventCounters));
      setPublicEvents((prev) => prev.map(updateEventCounters));
    }

    try {
      const res = await api.studio.deleteAttendee(attendeeId);
      if (res?.event) {
        syncUpdatedEventWithPublicSanitize(res.event);
      }
    } catch (err) {
      setAttendees(previousAttendees);
      setEvents(previousEvents);
      setPublicEvents(previousPublicEvents);
      notifyError(err, 'Failed to delete attendee in Supabase.');
      throw err;
    }
  };

  const handleRetryPayment = async (attendeeId: string) => {
    const previousAttendees = attendees;
    const previousAlerts = alerts;
    setAttendees((prev) =>
      prev.map((a) => (a.id === attendeeId ? { ...a, paymentStatus: 'paid' } : a))
    );
    setAlerts((prev) =>
      prev.map((al) => (al.category === 'payment' ? { ...al, resolved: true } : al))
    );
    try {
      const res = await api.studio.retryPayment(attendeeId);
      setAttendees((prev) => prev.map((a) => (a.id === attendeeId ? res.attendee : a)));
    } catch (err) {
      setAttendees(previousAttendees);
      setAlerts(previousAlerts);
      notifyError(err, 'Failed to update payment status in Supabase.');
      throw err;
    }
  };

  const handleToggleScheduleBlock = async (blockId: string) => {
    const previous = scheduleBlocks;
    setScheduleBlocks((prev) =>
      prev.map((b) => (b.id === blockId ? { ...b, completed: !b.completed } : b))
    );
    try {
      const res = await api.studio.toggleScheduleBlock(blockId);
      setScheduleBlocks((prev) => prev.map((b) => (b.id === blockId ? res.block : b)));
    } catch (err) {
      setScheduleBlocks(previous);
      notifyError(err, 'Failed to update schedule block in Supabase.');
      throw err;
    }
  };

  const handleAddScheduleBlock = async (block: ScheduleBlock) => {
    setScheduleBlocks((prev) => [...prev, block]);
    try {
      const res = await api.studio.addScheduleBlock(block);
      setScheduleBlocks((prev) => prev.map((b) => (b.id === block.id ? res.block : b)));
    } catch (err) {
      setScheduleBlocks((prev) => prev.filter((b) => b.id !== block.id));
      notifyError(err, 'Failed to add schedule block to Supabase.');
      throw err;
    }
  };

  const handleUpdateScheduleBlock = async (
    blockId: string,
    patch: Partial<ScheduleBlock>
  ) => {
    const previous = scheduleBlocks;
    setScheduleBlocks((prev) =>
      prev.map((b) => (b.id === blockId ? { ...b, ...patch } : b))
    );
    try {
      const res = await api.studio.updateScheduleBlock(blockId, patch);
      setScheduleBlocks((prev) => prev.map((b) => (b.id === blockId ? res.block : b)));
    } catch (err) {
      setScheduleBlocks(previous);
      notifyError(err, 'Failed to update schedule block in Supabase.');
      throw err;
    }
  };

  const handleDeleteScheduleBlock = async (blockId: string) => {
    const previous = scheduleBlocks;
    setScheduleBlocks((prev) => prev.filter((b) => b.id !== blockId));
    try {
      await api.studio.deleteScheduleBlock(blockId);
    } catch (err) {
      setScheduleBlocks(previous);
      notifyError(err, 'Failed to delete schedule block from Supabase.');
      throw err;
    }
  };

  const handleOpenWorkspace = (evt: EventItem) => {
    setStudioSubScreen(null);
    setWorkspaceEventId(evt.id);
    setActiveScreen('events');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleResolveAlert = async (id: string) => {
    const previous = alerts;
    setAlerts((prev) => prev.map((a) => (a.id === id ? { ...a, resolved: true } : a)));
    try {
      await api.studio.resolveAlert(id);
    } catch (err) {
      setAlerts(previous);
      notifyError(err, 'Failed to resolve alert in Supabase.');
      throw err;
    }
  };

  const handleNavigateAttendees = (eventId?: string) => {
    setStudioSubScreen(null);
    setWorkspaceEventId(null);
    setAttendeeEventFilter(eventId ?? 'all');
    setActiveScreen('attendees');
  };

  const handleCreateCreatorApp = async (payload: {
    name: string;
    description: string;
    appType: CreatorAppType;
    environment: CreatorAppEnvironment;
    eventId?: string;
    scopes: CreatorAppScope[];
    webhookUrl?: string;
    webhookEvents?: WebhookTriggerEvent[];
    allowedOrigins?: string[];
  }) => {
    try {
      const res = await api.studio.apps.create(payload);
      setCreatorApps((prev) => [res.app, ...prev]);
      if (res.log) {
        setCreatorAppLogs((prev) => [res.log!, ...prev]);
      }
      setApiBannerError(null);
      return {
        app: res.app,
        rawSecret: res.rawSecret,
        webhookSecret: res.webhookSecret,
      };
    } catch (err) {
      notifyError(err, 'Failed to create app in Supabase.');
      return null;
    }
  };

  const handleUpdateCreatorApp = async (
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
  ) => {
    try {
      const res = await api.studio.apps.update(appId, patch);
      setCreatorApps((prev) => prev.map((a) => (a.id === appId ? res.app : a)));
      setApiBannerError(null);
    } catch (err) {
      notifyError(err, 'Failed to update creator app.');
    }
  };

  const handleRotateCreatorAppSecret = async (appId: string) => {
    try {
      const res = await api.studio.apps.rotateSecret(appId);
      setCreatorApps((prev) => prev.map((a) => (a.id === appId ? res.app : a)));
      if (res.log) {
        setCreatorAppLogs((prev) => [res.log!, ...prev]);
      }
      setApiBannerError(null);
      return {
        app: res.app,
        rawSecret: res.rawSecret,
        webhookSecret: res.webhookSecret,
      };
    } catch (err) {
      notifyError(err, 'Failed to rotate client secret.');
      return null;
    }
  };

  const handleTestCreatorWebhook = async (appId: string, eventType: WebhookTriggerEvent) => {
    try {
      const res = await api.studio.apps.testWebhook(appId, eventType);
      setCreatorApps((prev) => prev.map((a) => (a.id === appId ? res.app : a)));
      setCreatorAppLogs((prev) => [res.log, ...prev]);
      setApiBannerError(null);
      return res.log;
    } catch (err) {
      notifyError(err, 'Failed to dispatch test webhook.');
      return null;
    }
  };

  const handleSimulateEndpointCall = async (
    appId: string,
    endpoint: string,
    method: 'GET' | 'POST'
  ) => {
    try {
      const res = await api.studio.apps.simulateEndpointCall(appId, endpoint, method);
      setCreatorApps((prev) => prev.map((a) => (a.id === appId ? res.app : a)));
      setCreatorAppLogs((prev) => [res.log, ...prev]);
      setApiBannerError(null);
      return { log: res.log, result: res.result };
    } catch (err) {
      notifyError(err, 'Endpoint invocation failed.');
      return null;
    }
  };

  const handleDeleteCreatorApp = async (appId: string) => {
    const prevApps = creatorApps;
    const prevLogs = creatorAppLogs;
    setCreatorApps((prev) => prev.filter((a) => a.id !== appId));
    setCreatorAppLogs((prev) => prev.filter((l) => l.appId !== appId));
    try {
      await api.studio.apps.delete(appId);
    } catch (err) {
      setCreatorApps(prevApps);
      setCreatorAppLogs(prevLogs);
      notifyError(err, 'Failed to delete creator app.');
    }
  };

  const handleUnlockCreatorConsole = async (password: string): Promise<string | null> => {
    try {
      const res = await api.studio.unlockCreatorConsole(password);
      if (res.creatorToken) {
        saveStoredCreatorToken(res.creatorToken);
      }
      setCreatorUnlocked(true);
      setApiBannerError(null);
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : 'Invalid CREATOR_PASSWORD.';
    }
  };

  const hasSetEvent = isSignedIn && isStudioAuthorized && safeEvents.length > 0;
  const unresolvedCount = safeAlerts.filter((a) => !a.resolved).length;
  const landingEvents =
    isSignedIn && safeEvents.length > 0
      ? safeEvents
      : safePublicEvents.length > 0
        ? safePublicEvents
        : safeEvents;
  const featuredEvent: EventItem | null =
    landingEvents.find((e) => e.status !== 'draft' && e.flyerUrl?.startsWith('data:')) ??
    landingEvents[0] ??
    null;

  useEffect(() => {
    if (route !== 'demo-event' || !publicPreviewEventId) return;
    const pool = [...safeEvents, ...safePublicEvents];
    const targetLower = publicPreviewEventId.toLowerCase();
    const matched = pool.find(
      (e) => e.id.toLowerCase() === targetLower || e.slug.toLowerCase() === targetLower
    );
    if (!matched) {
      let cancelled = false;
      api.public
        .getEventBySlugOrId(publicPreviewEventId)
        .then((res) => {
          if (cancelled || !res?.event) return;
          setPublicEvents((prev) =>
            prev.some((e) => e.id === res.event.id) ? prev : [res.event, ...prev]
          );
          setPublicPreviewEventId(res.event.id);
        })
        .catch(() => {
          // Non-fatal fallback handled by PublicEventScreen
        });
      return () => {
        cancelled = true;
      };
    }
  }, [route, publicPreviewEventId, safeEvents, safePublicEvents]);

  useEffect(() => {
    if (route !== 'camera') return;
    const target = cameraEventId || safePublicEvents[0]?.id || safeEvents[0]?.id;
    if (!target) return;
    let cancelled = false;
    api.public
      .getCameraRoll(target, cameraPassCode)
      .then((res) => {
        if (cancelled || !res?.event) return;
        setPublicEvents((prev) =>
          prev.some((e) => e.id === res.event.id)
            ? prev.map((e) => (e.id === res.event.id ? res.event : e))
            : [res.event, ...prev]
        );
        setCameraEventId((prev) => prev || res.event.id);
        setRollSettings((prev) => ({ ...prev, [res.event.id]: res.rollSettings }));
        if (res.verifiedPass) {
          setVerifiedCameraPass(res.verifiedPass);
          setCameraGuestName((prev) => prev || res.verifiedPass?.attendeeName);
        } else {
          setVerifiedCameraPass(null);
        }
        setDisposableShots((prev) => {
          const otherShots = prev.filter((s) => s.eventId !== res.event.id);
          return [...res.shots, ...otherShots];
        });
      })
      .catch(() => {
        // Non-fatal fallback
      });
    return () => {
      cancelled = true;
    };
  }, [route, cameraEventId, cameraPassCode, isSignedIn]);



  const sessionTimeoutModal =
    isSignedIn && !isCheckInScreenActive && sessionWarningSecondsLeft !== null ? (
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="session-timeout-title"
        className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
      >
        <div className="w-full max-w-md rounded-[28px] bg-white border border-[#E5E5EA] shadow-2xl p-6 space-y-5">
          <div className="flex items-start gap-3">
            <div className="w-11 h-11 rounded-2xl bg-[#0B0B0B] text-white flex items-center justify-center shrink-0">
              <Clock className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[#71717A]">
                <ShieldCheck className="w-3.5 h-3.5 text-[#0B0B0B]" />
                <span>Inactivity Security Lock</span>
              </div>
              <h2
                id="session-timeout-title"
                className="font-display text-lg font-bold tracking-tight text-[#0B0B0B] mt-0.5"
              >
                Your session is about to expire
              </h2>
              <p className="text-xs text-[#71717A] leading-relaxed mt-1">
                For workspace protection, inactive sessions sign out automatically after 30 minutes.
              </p>
            </div>
          </div>

          <div className="rounded-2xl bg-[#F5F5F7] border border-[#E5E5EA] px-4 py-3 flex items-center justify-between">
            <span className="text-xs font-medium text-[#71717A]">Signing out automatically in</span>
            <span className="font-mono text-lg font-bold text-[#0B0B0B] tabular-nums">
              {sessionWarningSecondsLeft}s
            </span>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2.5">
            <button
              type="button"
              onClick={() => void handleSignOut('manual')}
              className="px-4 py-2.5 rounded-full bg-[#F5F5F7] border border-[#E5E5EA] hover:border-[#0B0B0B] text-xs font-semibold text-[#0B0B0B] inline-flex items-center gap-1.5 transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Sign Out Now</span>
            </button>
            <button
              type="button"
              onClick={staySignedIn}
              className="px-5 py-2.5 rounded-full bg-[#0B0B0B] hover:bg-neutral-800 text-xs font-semibold text-white transition-colors"
            >
              Stay Signed In
            </button>
          </div>
        </div>
      </div>
    ) : null;

  const routeLoadingFallback = (
    <div className="min-h-dvh w-full bg-[#F5F5F7] text-[#0B0B0B] flex flex-col items-center justify-center gap-3 px-4">
      <Loader2 className="w-6 h-6 animate-spin text-[#0B0B0B]" />
      <p className="text-xs font-medium text-[#71717A]">Loading Events By You...</p>
    </div>
  );

  const studioLoadingFallback = (
    <div className="min-h-[55vh] w-full rounded-[24px] bg-[#F5F5F7] border border-[#E5E5EA] flex flex-col items-center justify-center gap-2.5 px-4">
      <Loader2 className="w-5 h-5 animate-spin text-[#0B0B0B]" />
      <p className="text-xs font-medium text-[#71717A]">Loading view...</p>
    </div>
  );

  if (route === 'terms' || route === 'privacy') {
    return (
      <>
        <LegalScreen
          doc={route}
          isSignedIn={isSignedIn}
          onSwitchDoc={openLegalRoute}
          onBackHome={navigateHome}
          onNavigateSignIn={() => {
            setSessionTimeoutNotice(null);
            setRoute('signin');
            syncBrowserPath('/signin');
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }}
          onNavigateStudio={() =>
            requireSignedIn({
              route: 'studio',
              screen: 'overview',
              label: 'Creator Studio',
            })
          }
        />
        {sessionTimeoutModal}
      </>
    );
  }

  if (route === 'not-found') {
    return (
      <div className="min-h-dvh w-full bg-[#F5F5F7] text-[#0B0B0B] flex items-center justify-center px-4 py-10">
        <SeoHead {...NOINDEX_ROUTE_SEO.notFound} />
        <main className="max-w-md w-full bg-white rounded-[28px] border border-[#E5E5EA] p-6 sm:p-8 shadow-sm text-center space-y-4">
          <p className="text-xs font-mono font-bold uppercase tracking-wider text-[#71717A]">
            404 · Page Not Found
          </p>
          <h1 className="font-display text-2xl font-bold text-[#0B0B0B]">
            This page does not exist
          </h1>
          <p className="text-xs sm:text-sm text-[#71717A] leading-relaxed">
            The link may be outdated or removed. Return to the homepage to explore features, pricing, or event tools.
          </p>
          <div className="flex flex-wrap justify-center gap-2 pt-2">
            <button
              type="button"
              onClick={navigateHome}
              className="px-5 py-2.5 rounded-full bg-[#0B0B0B] text-white text-xs font-semibold hover:bg-neutral-800 transition-colors"
            >
              Back to Home
            </button>
          </div>
        </main>
      </div>
    );
  }

  if (route === 'home') {
    const marketingProps = {
      isSignedIn,
      onNavigateStudio: () =>
        requireSignedIn({
          route: 'studio',
          screen: 'overview',
          label: 'Creator Studio',
        }),
      onSignOut: () => void handleSignOut('manual'),
    };
    if (normalizedRouterPath === '/features') {
      return (
        <>
          <FeaturesPage {...marketingProps} />
          {sessionTimeoutModal}
        </>
      );
    }
    if (normalizedRouterPath === '/pricing') {
      return (
        <>
          <PricingPage {...marketingProps} />
          {sessionTimeoutModal}
        </>
      );
    }
    if (normalizedRouterPath === '/how-it-works') {
      return (
        <>
          <HowItWorksPage {...marketingProps} />
          {sessionTimeoutModal}
        </>
      );
    }
    if (normalizedRouterPath === '/faq') {
      return (
        <>
          <FaqPage {...marketingProps} />
          {sessionTimeoutModal}
        </>
      );
    }
    if (normalizedRouterPath === '/about') {
      return (
        <>
          <AboutPage {...marketingProps} />
          {sessionTimeoutModal}
        </>
      );
    }
    if (normalizedRouterPath === '/contact') {
      return (
        <>
          <ContactPage {...marketingProps} />
          {sessionTimeoutModal}
        </>
      );
    }
    if (normalizedRouterPath === '/blog') {
      return (
        <>
          <BlogPage {...marketingProps} />
          {sessionTimeoutModal}
        </>
      );
    }

    return (
      <>
        <LandingScreen
          featuredEvent={featuredEvent}
          allEvents={landingEvents}
          recentAttendees={safeAttendees}
          isSignedIn={isSignedIn}
          hasSetEvent={hasSetEvent}
          onNavigateSignIn={(email) => {
            setPendingTarget(null);
            setSessionTimeoutNotice(null);
            setPrefillEmail(email ?? '');
            setRoute('signin');
            syncBrowserPath('/signin');
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }}
          onNavigateSignUp={(email) => {
            setPendingTarget({
              route: 'studio',
              screen: 'events',
              subScreen: 'create-event',
              label: 'Create Event Wizard',
            });
            setSessionTimeoutNotice(null);
            setPrefillEmail(email ?? '');
            setRoute('signup');
            syncBrowserPath('/signup');
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }}
          onCreateEvent={() => {
            if (isSignedIn) {
              openCreateWizard();
              return;
            }
            setPendingTarget({
              route: 'studio',
              screen: 'events',
              subScreen: 'create-event',
              label: 'Create Event Wizard',
            });
            setSessionTimeoutNotice(null);
            setPrefillEmail('');
            setRoute('signup');
            syncBrowserPath('/signup');
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }}
          onNavigateDemoEvent={(eventId, focusSection = 'top') => {
            const pool = landingEvents.length > 0 ? landingEvents : safePublicEvents;
            const matched =
              pool.find((e) => e.id === eventId || e.slug === eventId) ?? featuredEvent ?? undefined;
            openEventInvitation(matched, focusSection);
          }}
          onNavigateStudio={() =>
            requireSignedIn({
              route: 'studio',
              screen: 'overview',
              label: 'Creator Studio',
            })
          }
          onSignOut={() => void handleSignOut('manual')}
          onOpenQrScanner={(eventId) => openQrScanner(eventId || featuredEvent?.id)}
          onOpenDisposableCamera={(eventId) =>
            openPublicCamera(eventId || featuredEvent?.id, undefined, 'home')
          }
          onUpgradePro={() =>
            requireSignedIn({
              route: 'studio',
              screen: 'billing',
              label: 'Plan & Billing',
            })
          }
          onQuickStartEmail={(email) => {
            if (isSignedIn) {
              openCreateWizard();
              return;
            }
            setPrefillEmail(email);
            setSessionTimeoutNotice(null);
            setPendingTarget({
              route: 'studio',
              screen: 'events',
              subScreen: 'create-event',
              label: 'Create Event Wizard',
            });
            setRoute('signup');
            syncBrowserPath('/signup');
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }}
          onOpenLegal={openLegalRoute}
        />
        {sessionTimeoutModal}
      </>
    );
  }

  if (route === 'signup') {
    return (
      <Suspense fallback={routeLoadingFallback}>
        <SignUpScreen
        initialEmail={prefillEmail}
        initialPhone={prefillPhone}
        redirectNotice={pendingTarget?.label}
        onBackHome={() => {
          setPendingTarget(null);
          navigateHome();
        }}
        onGoSignIn={() => {
          setSessionTimeoutNotice(null);
          setRoute('signin');
          syncBrowserPath('/signin');
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
        onNavigateDemoEvent={() => {
          setPendingTarget(null);
          setRoute('demo-event');
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
        onOpenLegal={openLegalRoute}
        onRequireOtp={(target) => {
          setAuthPhone(target.phone || '');
          setAuthEmail(target.email || '');
          setAuthCountryGateway(target.countryGateway || 'GH');
          setOtpType(target.otpType);
          setRoute('verify-otp');
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
        onAuthenticated={handleAuthenticated}
      />
      </Suspense>
    );
  }

  if (route === 'reset-password') {
    return (
      <Suspense fallback={routeLoadingFallback}>
        <ResetPasswordScreen
        initialEmail={authEmail || prefillEmail || profile.email}
        initialPhone={authPhone || prefillPhone || profile.phone || ''}
        initialCountryGateway={authCountryGateway}
        onBackHome={() => {
          setPendingTarget(null);
          navigateHome();
        }}
        onBackSignIn={() => {
          setSessionTimeoutNotice(null);
          setRoute('signin');
          syncBrowserPath('/signin');
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
        onProceedToOtp={(target) => {
          setAuthPhone(target.phone || '');
          setAuthEmail(target.email || '');
          setAuthCountryGateway(target.countryGateway || 'GH');
          setOtpType(target.otpType || (target.phone ? 'sms' : 'recovery'));
          setRoute('verify-otp');
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
        onNavigateDemoEvent={() => {
          setPendingTarget(null);
          setRoute('demo-event');
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
        onOpenLegal={openLegalRoute}
      />
      </Suspense>
    );
  }

  if (route === 'verify-otp') {
    return (
      <Suspense fallback={routeLoadingFallback}>
        <VerifyOtpScreen
        phone={authPhone || prefillPhone || profile.phone || ''}
        email={authEmail || prefillEmail || profile.email}
        countryGateway={authCountryGateway}
        otpType={otpType}
        onBackHome={() => {
          setPendingTarget(null);
          navigateHome();
        }}
        onBackSignIn={() => {
          setSessionTimeoutNotice(null);
          setRoute('signin');
          syncBrowserPath('/signin');
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
        onVerified={handleAuthenticated}
        onNavigateDemoEvent={() => {
          setPendingTarget(null);
          setRoute('demo-event');
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
        onOpenLegal={openLegalRoute}
      />
      </Suspense>
    );
  }

  if (route === 'demo-event') {
    const demoEventsPool =
      isSignedIn && safeEvents.length > 0
        ? safeEvents
        : safePublicEvents.length > 0
          ? safePublicEvents
          : safeEvents;
    return (
      <>
        <Suspense fallback={routeLoadingFallback}>
          <PublicEventScreen
          events={demoEventsPool}
          attendees={safeAttendees}
          scheduleBlocks={mergedPublicScheduleBlocks}
          initialEventId={publicPreviewEventId}
          initialFocus={publicPreviewFocus}
          initialDeskToken={publicPreviewDeskToken}
          initialPassCode={publicPreviewPassCode}
          isLoadingEvents={publicEventsLoading}
          isSignedIn={isSignedIn}
          canOpenStudio={isSignedIn && isStudioAuthorized}
          hasSetEvent={hasSetEvent}
          onBackHome={navigateHome}
          onSelectEvent={(evt) => {
            setPublicPreviewEventId(evt.id);
            const cleanSlug = encodeURIComponent(evt.slug || evt.id);
            syncBrowserPath(
              publicPreviewFocus === 'checkin'
                ? `/e/${cleanSlug}/checkin`
                : publicPreviewFocus === 'walkin'
                  ? `/e/${cleanSlug}/walkin`
                  : publicPreviewFocus === 'gifts'
                    ? publicPreviewDeskToken
                      ? `/e/${cleanSlug}/gifts?desk=${encodeURIComponent(publicPreviewDeskToken)}`
                      : `/e/${cleanSlug}/gifts`
                    : publicPreviewFocus === 'polls'
                      ? `/e/${cleanSlug}/polls`
                      : `/e/${cleanSlug}`
            );
          }}
          onFocusModeChange={(mode, evt) => {
            setPublicPreviewFocus(mode);
            if (mode !== 'gifts') {
              setPublicPreviewDeskToken(undefined);
            }
            const cleanSlug = encodeURIComponent(evt.slug || evt.id);
            syncBrowserPath(
              mode === 'checkin'
                ? `/e/${cleanSlug}/checkin`
                : mode === 'walkin'
                  ? `/e/${cleanSlug}/walkin`
                  : mode === 'gifts'
                    ? publicPreviewDeskToken && mode === 'gifts'
                      ? `/e/${cleanSlug}/gifts?desk=${encodeURIComponent(publicPreviewDeskToken)}`
                      : `/e/${cleanSlug}/gifts`
                    : mode === 'polls'
                      ? `/e/${cleanSlug}/polls`
                      : `/e/${cleanSlug}`
            );
          }}
          onGiftEventSync={(updatedEvt) => {
            setPublicEvents((prev) => prev.map((e) => (e.id === updatedEvt.id ? updatedEvt : e)));
            if (isSignedIn) {
              setEvents((prev) =>
                prev.map((e) =>
                  e.id === updatedEvt.id
                    ? {
                        ...updatedEvt,
                        extraDataConfig: e.extraDataConfig
                          ? {
                              ...e.extraDataConfig,
                              ...(updatedEvt.extraDataConfig ?? {}),
                              attendantLinks: e.extraDataConfig.attendantLinks,
                            }
                          : updatedEvt.extraDataConfig,
                      }
                    : e
                )
              );
            }
          }}
          onPollEventSync={(updatedEvt) => {
            setPublicEvents((prev) => prev.map((e) => (e.id === updatedEvt.id ? updatedEvt : e)));
            if (isSignedIn) {
              setEvents((prev) =>
                prev.map((e) => {
                  if (e.id !== updatedEvt.id) return e;
                  const incomingPolls = updatedEvt.extraDataConfig?.polls ?? [];
                  const existingPolls = e.extraDataConfig?.polls ?? [];
                  const byId = new Map(incomingPolls.map((p) => [p.id, p]));
                  const mergedPolls =
                    existingPolls.length > 0
                      ? existingPolls.map((ep) => {
                          const inc = byId.get(ep.id);
                          if (!inc) return ep;
                          return {
                            ...inc,
                            voterKeys: ep.voterKeys,
                          };
                        })
                      : incomingPolls;
                  return {
                    ...updatedEvt,
                    extraDataConfig: e.extraDataConfig
                      ? {
                          ...e.extraDataConfig,
                          ...(updatedEvt.extraDataConfig ?? {}),
                          attendantLinks: e.extraDataConfig.attendantLinks,
                          polls: mergedPolls,
                        }
                      : updatedEvt.extraDataConfig,
                  };
                })
              );
            }
          }}
          onOpenStudio={() =>
            requireSignedIn({
              route: 'studio',
              screen: 'overview',
              label: 'Creator Studio',
            })
          }
          onNavigateSignUp={() => {
            setPendingTarget({
              route: 'studio',
              screen: 'events',
              subScreen: 'create-event',
              label: 'Create Event',
            });
            setSessionTimeoutNotice(null);
            setRoute('signup');
            syncBrowserPath('/signup');
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }}
          onCreateEvent={openCreateWizard}
          onRegisterAttendee={handlePublicRegisterAttendee}
          onSubmitGiftTableEntry={handlePublicSubmitGiftTableEntry}
          onOpenDisposableCamera={(eventId, guestName, passCode) =>
            openPublicCamera(eventId, guestName, 'demo-event', passCode)
          }
          onCheckinModalChange={setPublicCheckinModalOpen}
          onToggleQrPassPublished={
            effectiveRole !== 'gate_staff' ? handleToggleQrPassPublished : undefined
          }
          onOpenLegal={openLegalRoute}
        />
        </Suspense>
        {sessionTimeoutModal}
      </>
    );
  }

  if (route === 'camera') {
    const camPool = activeEvents.length > 0 ? activeEvents : safePublicEvents;
    const camTargetLower = (cameraEventId || '').toLowerCase();
    const resolvedCamEvent =
      camPool.find(
        (e) => e.id.toLowerCase() === camTargetLower || e.slug.toLowerCase() === camTargetLower
      ) ?? camPool[0];
    const scopedCamEvents =
      cameraEventId && resolvedCamEvent ? [resolvedCamEvent] : camPool;
    return (
      <>
        <SeoHead {...NOINDEX_ROUTE_SEO.camera} />
        <Suspense fallback={routeLoadingFallback}>
          <DisposableCameraScreen
          mode="public"
          events={scopedCamEvents}
          shots={safeDisposableShots}
          rollSettings={safeRollSettings}
          alerts={safeAlerts}
          profile={profile}
          initialEventId={resolvedCamEvent?.id}
          initialGuestName={cameraGuestName}
          initialPassCode={cameraPassCode}
          verifiedPass={verifiedCameraPass}
          onAddShot={handleAddShot}
          onToggleLikeShot={handleToggleLikeShot}
          onDeleteShot={handleDeleteShot}
          onDevelopRoll={handleDevelopRoll}
          onUpdateRollSettings={handleUpdateRollSettings}
          onBack={
            cameraReturnRoute === 'demo-event'
              ? () => {
                  setRoute('demo-event');
                  syncBrowserPath(window.location.pathname.replace(/\/camera\/?$/i, '') || '/');
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }
              : undefined
          }
        />
        </Suspense>
        {sessionTimeoutModal}
      </>
    );
  }

  if ((route === 'studio' && !hasCheckedStoredSession) || authBootstrapping) {
    return (
      <div className="min-h-dvh w-full bg-[#F5F5F7] text-[#0B0B0B] flex flex-col items-center justify-center gap-3 px-4">
        <Loader2 className="w-6 h-6 animate-spin text-[#0B0B0B]" />
        <p className="text-xs font-medium text-[#71717A]">
          Syncing your workspace...
        </p>
      </div>
    );
  }

  // Strict Auth Gate: Sign-in is required for Creator Studio and Event Management modules
  if (route === 'signin' || !isSignedIn) {
    return (
      <Suspense fallback={routeLoadingFallback}>
        <SignInScreen
        initialEmail={prefillEmail}
        initialPhone={prefillPhone}
        creatorEmail={creatorEmail}
        sessionTimeoutNotice={sessionTimeoutNotice}
        redirectNotice={
          pendingTarget?.label ??
          (route === 'studio' ? 'Creator Studio' : undefined)
        }
        onBackHome={() => {
          setPendingTarget(null);
          setSessionTimeoutNotice(null);
          navigateHome();
        }}
        onNavigateDemoEvent={() => {
          setPendingTarget(null);
          setSessionTimeoutNotice(null);
          setRoute('demo-event');
          syncBrowserPath('/');
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
        onForgotPassword={(target) => {
          setAuthPhone(target.phone || '');
          setAuthEmail(target.email || '');
          setAuthCountryGateway(target.countryGateway || 'GH');
          setSessionTimeoutNotice(null);
          setRoute('reset-password');
          syncBrowserPath('/reset-password');
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
        onGoSignUp={(email, phone) => {
          setPrefillEmail(email);
          setPrefillPhone(phone || '');
          setSessionTimeoutNotice(null);
          setRoute('signup');
          syncBrowserPath('/signup');
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
        onOpenLegal={openLegalRoute}
        onRequireOtp={(target) => {
          setAuthPhone(target.phone || '');
          setAuthEmail(target.email || '');
          setAuthCountryGateway(target.countryGateway || 'GH');
          setOtpType(target.otpType);
          setSessionTimeoutNotice(null);
          setRoute('verify-otp');
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
        onAuthenticated={handleAuthenticated}
      />
      </Suspense>
    );
  }



  // Hard Studio Role Gate: Only event organisers (and the platform creator) may enter the Studio workspace
  if (!isStudioAuthorized) {
    return (
      <div className="min-h-dvh w-full bg-[#F5F5F7] text-[#0B0B0B] flex items-center justify-center px-4 py-10">
        <SeoHead {...NOINDEX_ROUTE_SEO.studio} />
        <div className="max-w-md w-full bg-white rounded-[28px] border border-[#E5E5EA] p-6 sm:p-8 shadow-sm text-center space-y-4">
          <div className="w-12 h-12 rounded-2xl bg-[#0B0B0B] text-white flex items-center justify-center mx-auto">
            <ShieldCheck className="w-6 h-6" />
          </div>
          <div className="space-y-1.5">
            <h1 className="font-display text-xl font-bold text-[#0B0B0B]">
              Organiser Access Only
            </h1>
            <p className="text-xs sm:text-sm text-[#71717A] leading-relaxed">
              Attendees and gift table personnel do not have access to the Organiser Studio workspace. Only an event organiser can enter the studio.
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-2 pt-2 justify-center">
            <button
              type="button"
              onClick={navigateHome}
              className="px-5 py-2.5 rounded-full bg-[#F5F5F7] hover:bg-[#E8E8EA] text-xs font-semibold text-[#0B0B0B] transition-colors"
            >
              Back to Public Page
            </button>
            <button
              type="button"
              onClick={() => void handleSignOut()}
              className="px-5 py-2.5 rounded-full bg-[#0B0B0B] hover:bg-neutral-800 text-xs font-semibold text-white transition-colors inline-flex items-center justify-center gap-1.5"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Sign Out</span>
            </button>
          </div>
        </div>
        {sessionTimeoutModal}
      </div>
    );
  }

  const isStudioFullscreenCheckIn =
    activeScreen === 'checkin' && !workspaceEvent && !studioSubScreen;

  return (
    <div className="min-h-dvh w-full max-w-full bg-white text-[#0B0B0B] overflow-x-clip">
      <SeoHead {...NOINDEX_ROUTE_SEO.studio} />
      <div
        className={
          isStudioFullscreenCheckIn
            ? 'w-full max-w-none mx-auto pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))] sm:px-5 lg:px-8 pt-[max(0.75rem,env(safe-area-inset-top))] sm:pt-4 pb-6 flex flex-col min-h-dvh min-w-0 overflow-x-clip'
            : 'w-full max-w-[1600px] mx-auto pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))] sm:pl-[max(1.25rem,env(safe-area-inset-left))] sm:pr-[max(1.25rem,env(safe-area-inset-right))] md:px-6 lg:px-8 xl:px-10 pt-[max(0.75rem,env(safe-area-inset-top))] sm:pt-5 lg:pt-6 pb-[calc(6.25rem+env(safe-area-inset-bottom))] md:pb-8 flex flex-col md:flex-row gap-3.5 sm:gap-4 md:gap-5 lg:gap-7 xl:gap-8 md:items-start min-w-0 overflow-x-clip'
        }
      >
        {/* Left Floating Dark Pill Capsule Navigation (hidden in full-screen check-in mode) */}
        {!isStudioFullscreenCheckIn && (
          <NavigationRail
            activeScreen={activeScreen}
            userRole={effectiveRole}
            onCreateEvent={openCreateWizard}
            onNavigate={(screen) => {
              if (screen === 'console' && effectiveRole !== 'creator') {
                setApiBannerError('Access denied: Apps Creator Console requires the creator role.');
                return;
              }
              setWorkspaceEventId(null);
              setStudioSubScreen(null);
              if (screen === 'attendees') {
                setAttendeeEventFilter('all');
              }
              setActiveScreen(screen);
            }}
            onBackToPublicHome={() => {
              setRoute('home');
              syncBrowserPath('/');
              void loadPublicEvents();
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
            onSignOut={handleSignOut}
            unresolvedAlertCount={unresolvedCount}
          />
        )}

        {/* Main Viewport */}
        <main className="flex-1 w-full min-w-0 space-y-3.5 sm:space-y-4 overflow-x-clip">
          {apiBannerError && (
            <div className="rounded-2xl bg-[#0B0B0B] text-white px-4 py-3 flex items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-2 min-w-0">
                <Database className="w-4 h-4 shrink-0 text-zinc-300" />
                <span className="truncate">{apiBannerError}</span>
              </div>
              <button
                type="button"
                onClick={() => setApiBannerError(null)}
                aria-label="Dismiss alert"
                className="p-1 rounded-full hover:bg-white/10 shrink-0"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {(supabaseConfigured || inMemoryMode) &&
            !studioLoading &&
            safeEvents.length === 0 &&
            studioSubScreen !== 'create-event' && (
              <div className="rounded-[24px] bg-[#F5F5F7] border border-[#E5E5EA] p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-2xl bg-[#0B0B0B] text-white flex items-center justify-center shrink-0">
                    <Database className="w-4 h-4" />
                  </div>
                  <div>
                    <h2 className="text-sm font-bold text-[#0B0B0B]">
                      {inMemoryMode ? 'Your workspace is ready' : 'Your Supabase workspace is ready'}
                    </h2>
                    <p className="text-xs text-[#71717A] mt-0.5 leading-relaxed">
                      Create your first event from scratch or open the 5-step Quick Guide to set up
                      your custom SMS Sender ID, QR gate scanner, and standalone Gift Table.
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => setShowWalkthrough(true)}
                    className="px-4 py-2 rounded-full bg-white border border-[#E5E5EA] hover:border-[#0B0B0B] text-xs font-semibold text-[#0B0B0B] inline-flex items-center gap-1.5 transition-colors"
                  >
                    <Compass className="w-3.5 h-3.5" />
                    <span>Quick Guide</span>
                  </button>
                  <button
                    type="button"
                    onClick={openCreateWizard}
                    className="px-4 py-2 rounded-full bg-[#0B0B0B] hover:bg-neutral-800 text-xs font-semibold text-white transition-colors"
                  >
                    + Create Event
                  </button>
                </div>
              </div>
            )}

          <Suspense fallback={studioLoadingFallback}>
          {studioSubScreen === 'create-event' ? (
            <CreateEventWizardScreen
              profile={profile}
              events={safeEvents}
              onCancel={() => {
                setStudioSubScreen(null);
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
              onNavigateBilling={openBillingScreen}
              onCreateEvent={handleCreateEventWithBlocks}
            />
          ) : studioSubScreen === 'csv-export' ? (
            <CsvExportScreen
              events={safeEvents}
              attendees={safeAttendees}
              profile={profile}
              initialEventId={csvExportEventId}
              onBackToAttendees={() => {
                setStudioSubScreen(null);
                if (csvExportEventId) {
                  setAttendeeEventFilter(csvExportEventId);
                }
                setActiveScreen('attendees');
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
              onNavigateBilling={openBillingScreen}
            />
          ) : workspaceEvent ? (
            <EventWorkspaceScreen
              event={workspaceEvent}
              events={safeEvents}
              attendees={safeAttendees}
              scheduleBlocks={safeScheduleBlocks}
              alerts={safeAlerts}
              profile={profile}
              onBackToEvents={() => {
                setWorkspaceEventId(null);
                setActiveScreen('events');
              }}
              onOpenEditModal={(evt) => setSelectedEventId(evt.id)}
              onUpdateEvent={handleUpdateEvent}
              onSavePlanning={handleUpdateEventPlanning}
              onOpenPlans={openBillingScreen}
              onPreviewPublicEvent={(
                focus?: 'top' | 'checkin' | 'walkin' | 'gifts' | 'polls'
              ) => {
                openEventInvitation(workspaceEvent, focus ?? 'top');
              }}
              onToggleCheckIn={handleToggleCheckIn}
              onDeleteAttendee={handleDeleteAttendee}
              onRegisterAttendee={handleStudioRegisterAttendee}
              onBroadcast={handleBroadcastUpdate}
              onRecordGiftEntry={handleStudioRecordGiftTableEntry}
              onCreateGiftAttendantLink={handleCreateGiftAttendantLink}
              onToggleGiftAttendantLink={handleToggleGiftAttendantLink}
              onDeleteGiftAttendantLink={handleDeleteGiftAttendantLink}
              onPreviewDeskLink={(slugOrId, token) =>
                openEventInvitation(slugOrId, 'gifts', token)
              }
              onCreatePoll={handleStudioCreatePoll}
              onUpdatePoll={handleStudioUpdatePoll}
              onDeletePoll={handleStudioDeletePoll}
              onToggleScheduleBlock={handleToggleScheduleBlock}
              onAddScheduleBlock={handleAddScheduleBlock}
              onUpdateScheduleBlock={handleUpdateScheduleBlock}
              onDeleteScheduleBlock={handleDeleteScheduleBlock}
              onToggleQrPassPublished={handleToggleQrPassPublished}
              onNavigateSettings={() => {
                setWorkspaceEventId(null);
                setActiveScreen('settings');
              }}
              onResolveAlert={handleResolveAlert}
              onSelectAlertEvent={(evt) => setWorkspaceEventId(evt.id)}
              onOpenCsvExport={(evtId) => openCsvExportScreen(evtId)}
              onOpenQrScanner={(evtId) => openQrScanner(evtId)}
              onOpenDisposableCamera={(evtId) => openStudioCamera(evtId)}
              onCheckInActivityChange={setWorkspaceCheckInActive}
            />
          ) : (
            <>
              {activeScreen === 'overview' && (
                <OverviewScreen
                  events={safeEvents}
                  attendees={safeAttendees}
                  alerts={safeAlerts}
                  profile={profile}
                  searchQuery={overviewSearch}
                  onSearchChange={setOverviewSearch}
                  onOpenCreateModal={openCreateWizard}
                  onManageEvent={handleOpenWorkspace}
                  onEditEventModal={(evt) => setSelectedEventId(evt.id)}
                  onUpdateEvent={handleUpdateEvent}
                  onNavigateAttendees={handleNavigateAttendees}
                  onOpenQrScanner={(evtId, code) => openQrScanner(evtId, code)}
                  onOpenGiftTable={(evtId) => {
                    setGiftTableEventId(evtId);
                    setWorkspaceEventId(null);
                    setStudioSubScreen(null);
                    setActiveScreen('gifts');
                  }}
                  onNavigateEvents={() => setActiveScreen('events')}
                  onNavigateSettings={() => setActiveScreen('settings')}
                  onOpenPlans={openBillingScreen}
                  onOpenGuide={() => setShowWalkthrough(true)}
                  onResolveAlert={handleResolveAlert}
                />
              )}

              {activeScreen === 'planning' && (
                <EventPlanningHubScreen
                  events={safeEvents}
                  alerts={safeAlerts}
                  profile={profile}
                  onUpdateEvent={handleUpdateEvent}
                  onSavePlanning={handleUpdateEventPlanning}
                  onOpenCreateModal={openCreateWizard}
                  onManageEvent={handleOpenWorkspace}
                  onNavigateSettings={() => setActiveScreen('settings')}
                  onResolveAlert={handleResolveAlert}
                />
              )}

              {activeScreen === 'checkin' && (
                <QrGateScannerScreen
                  events={safeEvents}
                  attendees={safeAttendees}
                  alerts={safeAlerts}
                  profile={profile}
                  initialEventId={checkinEventId}
                  initialCode={checkinPrefillCode}
                  onToggleCheckIn={handleToggleCheckIn}
                  onDeleteAttendee={handleDeleteAttendee}
                  onRegisterAttendee={handleStudioRegisterAttendee}
                  onToggleQrPassPublished={handleToggleQrPassPublished}
                  onManageEvent={handleOpenWorkspace}
                  onBackToStudio={() => setActiveScreen('overview')}
                  onNavigateSettings={() => setActiveScreen('settings')}
                  onResolveAlert={handleResolveAlert}
                />
              )}

              {activeScreen === 'camera' && (
                <DisposableCameraScreen
                  mode="studio"
                  events={safeEvents}
                  shots={safeDisposableShots}
                  rollSettings={safeRollSettings}
                  alerts={safeAlerts}
                  profile={profile}
                  initialEventId={cameraEventId || safeEvents[0]?.id}
                  onAddShot={handleAddShot}
                  onToggleLikeShot={handleToggleLikeShot}
                  onDeleteShot={handleDeleteShot}
                  onDevelopRoll={handleDevelopRoll}
                  onUpdateRollSettings={handleUpdateRollSettings}
                  onManageEvent={handleOpenWorkspace}
                  onNavigateSettings={() => setActiveScreen('settings')}
                  onResolveAlert={handleResolveAlert}
                />
              )}

              {activeScreen === 'gifts' && (
                <GiftTableScreen
                  events={safeEvents}
                  alerts={safeAlerts}
                  profile={profile}
                  initialEventId={giftTableEventId}
                  onOpenCreateModal={openCreateWizard}
                  onEditEventModal={(evt) => setSelectedEventId(evt.id)}
                  onManageEvent={handleOpenWorkspace}
                  onPreviewPublicGiftTable={(evt, deskToken) =>
                    openEventInvitation(evt, 'gifts', deskToken)
                  }
                  onRecordGiftEntry={handleStudioRecordGiftTableEntry}
                  onCreateGiftAttendantLink={handleCreateGiftAttendantLink}
                  onToggleGiftAttendantLink={handleToggleGiftAttendantLink}
                  onDeleteGiftAttendantLink={handleDeleteGiftAttendantLink}
                  onNavigateSettings={() => setActiveScreen('settings')}
                  onResolveAlert={handleResolveAlert}
                />
              )}

              {activeScreen === 'events' && (
                <EventsScreen
                  events={safeEvents}
                  alerts={safeAlerts}
                  profile={profile}
                  searchQuery={eventsSearch}
                  onSearchChange={setEventsSearch}
                  onOpenCreateModal={openCreateWizard}
                  onManageEvent={handleOpenWorkspace}
                  onNavigateAttendees={handleNavigateAttendees}
                  onOpenQrScanner={(evtId) => openQrScanner(evtId)}
                  onOpenInvitation={(evt) => openEventInvitation(evt, 'top')}
                  onNavigateSettings={() => setActiveScreen('settings')}
                  onResolveAlert={handleResolveAlert}
                />
              )}

              {activeScreen === 'schedule' && (
                <ScheduleScreen
                  events={safeEvents}
                  blocks={safeScheduleBlocks}
                  alerts={safeAlerts}
                  profile={profile}
                  onToggleBlock={handleToggleScheduleBlock}
                  onAddBlock={handleAddScheduleBlock}
                  onUpdateBlock={handleUpdateScheduleBlock}
                  onDeleteBlock={handleDeleteScheduleBlock}
                  onManageEvent={handleOpenWorkspace}
                  onNavigateSettings={() => setActiveScreen('settings')}
                  onResolveAlert={handleResolveAlert}
                />
              )}

              {activeScreen === 'attendees' && (
                <AttendeesScreen
                  attendees={safeAttendees}
                  events={safeEvents}
                  alerts={safeAlerts}
                  profile={profile}
                  initialEventFilter={attendeeEventFilter}
                  onToggleCheckIn={handleToggleCheckIn}
                  onDeleteAttendee={handleDeleteAttendee}
                  onRetryPayment={handleRetryPayment}
                  onRegisterAttendee={handleStudioRegisterAttendee}
                  onBroadcast={handleBroadcastUpdate}
                  onOpenPlans={openBillingScreen}
                  onManageEvent={handleOpenWorkspace}
                  onOpenQrScanner={(evtId, code) => openQrScanner(evtId, code)}
                  onNavigateSettings={() => setActiveScreen('settings')}
                  onResolveAlert={handleResolveAlert}
                  onOpenCsvExport={(evtId) => openCsvExportScreen(evtId)}
                  onCheckInActivityChange={setAttendeesWalkInActive}
                />
              )}

              {activeScreen === 'analytics' && (
                <AnalyticsScreen
                  events={safeEvents}
                  attendees={safeAttendees}
                  alerts={safeAlerts}
                  profile={profile}
                  onManageEvent={handleOpenWorkspace}
                  onNavigateSettings={() => setActiveScreen('settings')}
                  onResolveAlert={handleResolveAlert}
                />
              )}

              {activeScreen === 'console' && effectiveRole === 'creator' && (
                <AppsCreatorConsoleScreen
                  apps={safeCreatorApps}
                  logs={safeCreatorAppLogs}
                  events={safeEvents}
                  alerts={safeAlerts}
                  profile={profile}
                  creatorEmail={creatorEmail}
                  creatorPasswordConfigured={creatorPasswordConfigured}
                  creatorUnlocked={creatorUnlocked}
                  onUnlockCreator={handleUnlockCreatorConsole}
                  onCreateApp={handleCreateCreatorApp}
                  onUpdateApp={handleUpdateCreatorApp}
                  onRotateSecret={handleRotateCreatorAppSecret}
                  onTestWebhook={handleTestCreatorWebhook}
                  onSimulateEndpointCall={handleSimulateEndpointCall}
                  onDeleteApp={handleDeleteCreatorApp}
                  onManageEvent={handleOpenWorkspace}
                  onNavigateSettings={() => setActiveScreen('settings')}
                  onSignOut={handleSignOut}
                  onResolveAlert={handleResolveAlert}
                />
              )}

              {activeScreen === 'billing' && (
                <BillingScreen
                  profile={profile}
                  events={safeEvents}
                  onUpdateProfile={handleUpdateProfile}
                  onSyncProfile={setProfile}
                  initialCheckoutBundleId={selectedCheckoutBundleId}
                  onConsumeInitialBundle={() => setSelectedCheckoutBundleId(null)}
                  pendingPaystackRef={pendingPaystackRef}
                  onConsumePaystackRef={() => setPendingPaystackRef(null)}
                  pendingSubscriptionRef={pendingSubscriptionRef}
                  onConsumeSubscriptionRef={() => setPendingSubscriptionRef(null)}
                />
              )}

              {activeScreen === 'settings' && (
                <SettingsScreen
                  profile={profile}
                  events={safeEvents}
                  alerts={safeAlerts}
                  onUpdateProfile={handleUpdateProfile}
                  onSyncProfile={setProfile}
                  onResolveAlert={handleResolveAlert}
                  onOpenPlans={openBillingScreen}
                  onSignOut={handleSignOut}
                  onOpenGuide={() => setShowWalkthrough(true)}
                  onDeleteAccount={handleDeleteAccount}
                />
              )}
            </>
          )}
          </Suspense>
        </main>
      </div>

      {/* Edit Event Modal */}
      {selectedEvent && (
        <Suspense fallback={null}>
          <EventDetailModal
            event={selectedEvent}
            events={safeEvents}
            profile={profile}
            scheduleBlocks={safeScheduleBlocks}
            capacityThreshold={profile.capacityAlertThreshold}
            canPublishQrPass={true}
            onToggleQrPassPublished={handleToggleQrPassPublished}
            onClose={() => setSelectedEventId(null)}
            onUpdateEvent={handleUpdateEvent}
            onDeleteEvent={handleDeleteEvent}
            onOpenAttendees={(id) => handleNavigateAttendees(id)}
            onOpenBilling={() => {
              setSelectedEventId(null);
              openBillingScreen();
            }}
          />
        </Suspense>
      )}

      <Suspense fallback={null}>
        <OnboardingWalkthroughModal
          open={showWalkthrough}
          userName={profile.name || profile.firstName}
          hasEvents={safeEvents.length > 0}
          onClose={closeWalkthrough}
          onCreateEvent={openCreateWizard}
          onGoSettings={() => {
            setWorkspaceEventId(null);
            setStudioSubScreen(null);
            setActiveScreen('settings');
          }}
          onGoScanner={() => {
            setWorkspaceEventId(null);
            setStudioSubScreen(null);
            setActiveScreen('checkin');
          }}
          onGoCamera={() => {
            setWorkspaceEventId(null);
            setStudioSubScreen(null);
            setActiveScreen('camera');
          }}
        />
      </Suspense>

      {sessionTimeoutModal}
    </div>
  );
}
