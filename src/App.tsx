import { useCallback, useEffect, useRef, useState } from 'react';
import { Database, Loader2, Sparkles, X } from 'lucide-react';
import { INITIAL_EVENTS, INITIAL_PROFILE } from './data/initialData';
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
  NavScreen,
  OrganizerProfile,
  ScheduleBlock,
  StudioSubScreen,
  SystemAlert,
  WebhookTriggerEvent,
} from './types/events';
import {
  api,
  extractSessionFromUrlHash,
  getStoredCreatorToken,
  getStoredSession,
  saveStoredCreatorToken,
  saveStoredSession,
  type StoredAuthSession,
} from './lib/api';
import { LandingScreen } from './components/LandingScreen';
import { SignInScreen } from './components/SignInScreen';
import { SignUpScreen } from './components/SignUpScreen';
import { ResetPasswordScreen } from './components/ResetPasswordScreen';
import { VerifyOtpScreen } from './components/VerifyOtpScreen';
import { PublicEventScreen } from './components/PublicEventScreen';
import { NavigationRail } from './components/NavigationRail';
import { OverviewScreen } from './components/OverviewScreen';
import { EventsScreen } from './components/EventsScreen';
import { EventWorkspaceScreen } from './components/EventWorkspaceScreen';
import { ScheduleScreen } from './components/ScheduleScreen';
import { AttendeesScreen } from './components/AttendeesScreen';
import { AnalyticsScreen } from './components/AnalyticsScreen';
import { BillingScreen } from './components/BillingScreen';
import { CsvExportScreen } from './components/CsvExportScreen';
import { CreateEventWizardScreen } from './components/CreateEventWizardScreen';
import { SettingsScreen } from './components/SettingsScreen';
import { QrGateScannerScreen } from './components/QrGateScannerScreen';
import { DisposableCameraScreen } from './components/DisposableCameraScreen';
import { AppsCreatorConsoleScreen } from './components/AppsCreatorConsoleScreen';
import { EventDetailModal } from './components/EventModals';

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
  const [route, setRoute] = useState<AppRoute>('home');
  const [isSignedIn, setIsSignedIn] = useState<boolean>(() => Boolean(getStoredSession()));
  const [authBootstrapping, setAuthBootstrapping] = useState<boolean>(() => Boolean(getStoredSession()));
  const [studioLoading, setStudioLoading] = useState(false);
  const [seedingStarter, setSeedingStarter] = useState(false);
  const [supabaseConfigured, setSupabaseConfigured] = useState<boolean>(true);
  const [inMemoryMode, setInMemoryMode] = useState<boolean>(false);
  const [creatorEmail, setCreatorEmail] = useState<string>('amoakoimml@gmail.com');
  const [creatorPasswordConfigured, setCreatorPasswordConfigured] = useState<boolean>(false);
  const [creatorUnlocked, setCreatorUnlocked] = useState<boolean>(() => Boolean(getStoredCreatorToken()));
  const [apiBannerError, setApiBannerError] = useState<string | null>(null);

  const [prefillEmail, setPrefillEmail] = useState<string>('');
  const [authEmail, setAuthEmail] = useState<string>('');
  const [otpType, setOtpType] = useState<'signup' | 'email' | 'recovery'>('signup');
  const [pendingTarget, setPendingTarget] = useState<PendingModuleTarget | null>(null);

  const [activeScreen, setActiveScreen] = useState<NavScreen>('overview');
  const [publicEvents, setPublicEvents] = useState<EventItem[]>([]);
  const [events, setEvents] = useState<EventItem[]>([]);
  const [attendees, setAttendees] = useState<Attendee[]>([]);
  const [scheduleBlocks, setScheduleBlocks] = useState<ScheduleBlock[]>([]);
  const [alerts, setAlerts] = useState<SystemAlert[]>([]);
  const [profile, setProfile] = useState<OrganizerProfile>(EMPTY_PROFILE);
  const [disposableShots, setDisposableShots] = useState<DisposableShot[]>([]);
  const [rollSettings, setRollSettings] = useState<Record<string, DisposableRollSettings>>({});
  const [creatorApps, setCreatorApps] = useState<CreatorApp[]>([]);
  const [creatorAppLogs, setCreatorAppLogs] = useState<CreatorAppLog[]>([]);

  const [overviewSearch, setOverviewSearch] = useState('');
  const [eventsSearch, setEventsSearch] = useState('');
  const [attendeeEventFilter, setAttendeeEventFilter] = useState<string>('all');

  const [studioSubScreen, setStudioSubScreen] = useState<StudioSubScreen>(null);
  const [csvExportEventId, setCsvExportEventId] = useState<string | undefined>(undefined);
  const [checkinEventId, setCheckinEventId] = useState<string | undefined>(undefined);
  const [checkinPrefillCode, setCheckinPrefillCode] = useState<string | undefined>(undefined);
  const [cameraEventId, setCameraEventId] = useState<string | undefined>(undefined);
  const [cameraGuestName, setCameraGuestName] = useState<string | undefined>(undefined);
  const [cameraReturnRoute, setCameraReturnRoute] = useState<'home' | 'demo-event'>('home');
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [workspaceEventId, setWorkspaceEventId] = useState<string | null>(null);
  const [publicPreviewEventId, setPublicPreviewEventId] = useState<string | undefined>(undefined);

  const notifyError = useCallback((err: unknown, fallback: string) => {
    const msg = err instanceof Error ? err.message : fallback;
    setApiBannerError(msg);
  }, []);

  const loadPublicEvents = useCallback(async () => {
    try {
      const res = await api.public.getEvents();
      setPublicEvents(Array.isArray(res?.events) ? res.events : []);
    } catch {
      setPublicEvents([]);
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
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to load workspace from Supabase.';
      if (msg.toLowerCase().includes('session') || msg.toLowerCase().includes('authentication')) {
        saveStoredSession(null);
        setIsSignedIn(false);
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

      const activeSession = oauthSession ?? getStoredSession();
      if (activeSession) {
        await hydrateStudioWorkspace();
        if (oauthSession && !cancelled) {
          setRoute('studio');
        }
      }
      if (!cancelled) {
        setAuthBootstrapping(false);
      }
    };

    void init();

    return () => {
      cancelled = true;
    };
  }, [hydrateStudioWorkspace, loadPublicEvents]);

  const safePublicEvents = Array.isArray(publicEvents) ? publicEvents : [];
  const safeEvents = Array.isArray(events) ? events : [];
  const safeAttendees = Array.isArray(attendees) ? attendees : [];
  const safeScheduleBlocks = Array.isArray(scheduleBlocks) ? scheduleBlocks : [];
  const safeAlerts = Array.isArray(alerts) ? alerts : [];
  const safeDisposableShots = Array.isArray(disposableShots) ? disposableShots : [];
  const safeRollSettings =
    rollSettings && typeof rollSettings === 'object' ? rollSettings : {};
  const safeCreatorApps = Array.isArray(creatorApps) ? creatorApps : [];
  const safeCreatorAppLogs = Array.isArray(creatorAppLogs) ? creatorAppLogs : [];

  const activeEvents = isSignedIn ? safeEvents : safePublicEvents;
  const selectedEvent = selectedEventId
    ? safeEvents.find((e) => e.id === selectedEventId) ?? null
    : null;

  const workspaceEvent = workspaceEventId
    ? safeEvents.find((e) => e.id === workspaceEventId) ?? null
    : null;

  const applyModuleTarget = (target: PendingModuleTarget) => {
    setWorkspaceEventId(null);
    setStudioSubScreen(target.subScreen ?? null);
    if (target.route === 'camera') {
      setCameraEventId(target.eventId);
      setCameraGuestName(target.guestName);
      setCameraReturnRoute(target.returnRoute ?? 'home');
      setRoute('camera');
    } else {
      if (target.screen === 'checkin') {
        setCheckinEventId(target.eventId);
        setCheckinPrefillCode(target.prefillCode);
      } else if (target.screen === 'camera') {
        setCameraEventId(target.eventId);
      }
      setActiveScreen(target.screen ?? 'overview');
      setRoute('studio');
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const requireSignedIn = (target: PendingModuleTarget) => {
    if (!isSignedIn) {
      setPendingTarget(target);
      setRoute('signin');
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    applyModuleTarget(target);
  };

  const handleAuthenticated = async (
    session: StoredAuthSession,
    nextProfile: OrganizerProfile,
    openCreatorConsole = false
  ) => {
    saveStoredSession(session);
    if (nextProfile) setProfile(nextProfile);
    setIsSignedIn(true);
    setApiBannerError(null);
    if (getStoredCreatorToken()) {
      setCreatorUnlocked(true);
    }
    await hydrateStudioWorkspace();
    await loadPublicEvents();

    if (openCreatorConsole) {
      const canAccessConsole =
        nextProfile?.appRole === 'creator' ||
        nextProfile?.email?.toLowerCase() === creatorEmail.toLowerCase();
      setPendingTarget(null);
      setWorkspaceEventId(null);
      setStudioSubScreen(null);
      setActiveScreen(canAccessConsole ? 'console' : 'overview');
      setRoute('studio');
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    if (pendingTarget) {
      const target = pendingTarget;
      setPendingTarget(null);
      applyModuleTarget(target);
      return;
    }
    setRoute('studio');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleSignOut = async () => {
    try {
      await api.auth.signOut();
    } catch {
      // Clear local session regardless
    }
    saveStoredSession(null);
    saveStoredCreatorToken(null);
    setCreatorUnlocked(false);
    setIsSignedIn(false);
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
    void loadPublicEvents();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleSeedStarterData = async () => {
    if (seedingStarter) return;
    setSeedingStarter(true);
    setApiBannerError(null);
    try {
      const data = await api.studio.seedStarter();
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
      setWorkspaceEventId(null);
      setSelectedEventId(null);
      void loadPublicEvents();
    } catch (err) {
      notifyError(err, 'Failed to seed starter data into Supabase.');
    } finally {
      setSeedingStarter(false);
    }
  };

  const handleUpdateProfile = async (nextProfile: OrganizerProfile) => {
    setProfile(nextProfile);
    try {
      const res = await api.studio.updateProfile(nextProfile);
      setProfile(res.profile);
    } catch (err) {
      notifyError(err, 'Failed to save profile changes to Supabase.');
    }
  };

  const creatingEventRef = useRef(false);

  const handleCreateEventWithBlocks = async (newEvt: EventItem, newBlocks: ScheduleBlock[]) => {
    if (creatingEventRef.current) return;
    creatingEventRef.current = true;
    try {
      const res = await api.studio.createEvent(newEvt, newBlocks);
      setEvents((prev) => [res.event, ...prev]);
      setPublicEvents((prev) => [res.event, ...prev]);
      if (res.blocks.length > 0) {
        setScheduleBlocks((prev) => [...prev, ...res.blocks]);
      }
      setStudioSubScreen(null);
      setWorkspaceEventId(res.event.id);
      setActiveScreen('events');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      notifyError(err, 'Failed to create event in Supabase.');
    } finally {
      creatingEventRef.current = false;
    }
  };

  const openCreateWizard = () => {
    requireSignedIn({
      route: 'studio',
      screen: 'events',
      subScreen: 'create-event',
      label: 'Create Event Wizard',
    });
  };

  const openBillingScreen = () => {
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
    returnTo: 'home' | 'demo-event' = 'home'
  ) => {
    requireSignedIn({
      route: 'camera',
      eventId,
      guestName,
      returnRoute: returnTo,
      label: 'Event Disposable Camera',
    });
  };

  const openStudioCamera = (eventId?: string) => {
    requireSignedIn({
      route: 'studio',
      screen: 'camera',
      eventId,
      label: 'Event Disposable Camera',
    });
  };

  const handleAddShot = async (shot: DisposableShot) => {
    setDisposableShots((prev) => [shot, ...prev]);
    try {
      const res = await api.studio.addShot(shot);
      setDisposableShots((prev) => prev.map((s) => (s.id === shot.id ? res.shot : s)));
    } catch (err) {
      setDisposableShots((prev) => prev.filter((s) => s.id !== shot.id));
      notifyError(err, 'Failed to save camera shot to Supabase.');
    }
  };

  const handleToggleLikeShot = async (shotId: string) => {
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
      const res = await api.studio.toggleLikeShot(shotId);
      setDisposableShots((prev) => prev.map((s) => (s.id === shotId ? res.shot : s)));
    } catch (err) {
      notifyError(err, 'Failed to update shot favorite in Supabase.');
    }
  };

  const handleDeleteShot = async (shotId: string) => {
    const previous = disposableShots;
    setDisposableShots((prev) => prev.filter((s) => s.id !== shotId));
    try {
      await api.studio.deleteShot(shotId);
    } catch (err) {
      setDisposableShots(previous);
      notifyError(err, 'Failed to delete shot from Supabase.');
    }
  };

  const handleDevelopRoll = async (eventId: string) => {
    setDisposableShots((prev) =>
      prev.map((s) => (s.eventId === eventId ? { ...s, developed: true } : s))
    );
    try {
      await api.studio.developRoll(eventId);
    } catch (err) {
      notifyError(err, 'Failed to develop roll in Supabase.');
    }
  };

  const handleUpdateRollSettings = async (eventId: string, next: DisposableRollSettings) => {
    setRollSettings((prev) => ({ ...prev, [eventId]: next }));
    try {
      const res = await api.studio.updateRollSettings(eventId, next);
      setRollSettings((prev) => ({ ...prev, [eventId]: res.settings }));
    } catch (err) {
      notifyError(err, 'Failed to save camera roll settings to Supabase.');
    }
  };

  const handleUpdateEvent = async (updated: EventItem) => {
    setEvents((prev) => prev.map((e) => (e.id === updated.id ? updated : e)));
    setPublicEvents((prev) => prev.map((e) => (e.id === updated.id ? updated : e)));
    try {
      const res = await api.studio.updateEvent(updated);
      setEvents((prev) => prev.map((e) => (e.id === updated.id ? res.event : e)));
      setPublicEvents((prev) => prev.map((e) => (e.id === updated.id ? res.event : e)));
    } catch (err) {
      notifyError(err, 'Failed to update event in Supabase.');
    }
  };

  const handleDeleteEvent = async (id: string) => {
    setEvents((prev) => prev.filter((e) => e.id !== id));
    setPublicEvents((prev) => prev.filter((e) => e.id !== id));
    setScheduleBlocks((prev) => prev.filter((b) => b.eventId !== id));
    if (workspaceEventId === id) {
      setWorkspaceEventId(null);
    }
    try {
      await api.studio.deleteEvent(id);
    } catch (err) {
      notifyError(err, 'Failed to delete event from Supabase.');
      void hydrateStudioWorkspace();
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
    });
    setPublicEvents((prev) => prev.map((e) => (e.id === eventId ? res.event : e)));
    if (isSignedIn) {
      setEvents((prev) => prev.map((e) => (e.id === eventId ? res.event : e)));
      setAttendees((prev) => [res.attendee, ...prev]);
    }
    return res.attendee;
  };

  const handleStudioRegisterAttendee = async (eventId: string, attendee: Attendee) => {
    try {
      const res = await api.studio.registerAttendee(eventId, attendee);
      setAttendees((prev) => [res.attendee, ...prev]);
      setEvents((prev) => prev.map((evt) => (evt.id === eventId ? res.event : evt)));
      setPublicEvents((prev) => prev.map((evt) => (evt.id === eventId ? res.event : evt)));
    } catch (err) {
      notifyError(err, 'Failed to register attendee in Supabase.');
    }
  };

  const handleToggleCheckIn = async (attendeeId: string) => {
    const target = attendees.find((a) => a.id === attendeeId);
    const nowTime = new Date().toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
    });
    setAttendees((prev) =>
      prev.map((a) =>
        a.id === attendeeId
          ? {
              ...a,
              checkedIn: !a.checkedIn,
              checkedInAt: !a.checkedIn ? nowTime : undefined,
            }
          : a
      )
    );
    if (target) {
      const delta = target.checkedIn ? -1 : 1;
      setEvents((prev) =>
        prev.map((e) =>
          e.id === target.eventId ? { ...e, checkedIn: Math.max(0, e.checkedIn + delta) } : e
        )
      );
    }
    try {
      const res = await api.studio.toggleCheckIn(attendeeId);
      setAttendees((prev) => prev.map((a) => (a.id === attendeeId ? res.attendee : a)));
    } catch (err) {
      notifyError(err, 'Failed to update check-in status in Supabase.');
      void hydrateStudioWorkspace();
    }
  };

  const handleRetryPayment = async (attendeeId: string) => {
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
      notifyError(err, 'Failed to update payment status in Supabase.');
    }
  };

  const handleToggleScheduleBlock = async (blockId: string) => {
    setScheduleBlocks((prev) =>
      prev.map((b) => (b.id === blockId ? { ...b, completed: !b.completed } : b))
    );
    try {
      const res = await api.studio.toggleScheduleBlock(blockId);
      setScheduleBlocks((prev) => prev.map((b) => (b.id === blockId ? res.block : b)));
    } catch (err) {
      notifyError(err, 'Failed to update schedule block in Supabase.');
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
    }
  };

  const handleOpenWorkspace = (evt: EventItem) => {
    setStudioSubScreen(null);
    setWorkspaceEventId(evt.id);
    setActiveScreen('events');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleResolveAlert = async (id: string) => {
    setAlerts((prev) => prev.map((a) => (a.id === id ? { ...a, resolved: true } : a)));
    try {
      await api.studio.resolveAlert(id);
    } catch (err) {
      notifyError(err, 'Failed to resolve alert in Supabase.');
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

  const effectiveRole: AppRole =
    profile.appRole ??
    (profile.email?.toLowerCase() === creatorEmail.toLowerCase() ? 'creator' : 'organizer');
  const unresolvedCount = safeAlerts.filter((a) => !a.resolved).length;
  const landingEvents = safePublicEvents.length > 0 ? safePublicEvents : safeEvents;
  const featuredEvent = landingEvents[0] ?? INITIAL_EVENTS[0];

  if (route === 'home') {
    return (
      <LandingScreen
        featuredEvent={featuredEvent}
        allEvents={landingEvents.length > 0 ? landingEvents : [featuredEvent]}
        recentAttendees={safeAttendees}
        isSignedIn={isSignedIn}
        onNavigateSignIn={(email) => {
          setPendingTarget(null);
          setPrefillEmail(email ?? '');
          setRoute('signin');
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
        onNavigateSignUp={(email) => {
          setPendingTarget(null);
          setPrefillEmail(email ?? '');
          setRoute('signup');
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
        onNavigateDemoEvent={(eventId) => {
          setPublicPreviewEventId(eventId || featuredEvent.id);
          setRoute('demo-event');
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
        onNavigateStudio={() =>
          requireSignedIn({
            route: 'studio',
            screen: 'overview',
            label: 'Creator Studio',
          })
        }
        onSignOut={handleSignOut}
        onOpenQrScanner={(eventId) => openQrScanner(eventId || featuredEvent.id)}
        onOpenDisposableCamera={(eventId) =>
          openPublicCamera(eventId || featuredEvent.id, undefined, 'home')
        }
        onUpgradePro={() =>
          requireSignedIn({
            route: 'studio',
            screen: 'billing',
            label: 'Plan & Billing',
          })
        }
        onQuickStartEmail={(email) => {
          setPendingTarget(null);
          setPrefillEmail(email);
          setRoute('signup');
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
      />
    );
  }

  if (route === 'signup') {
    return (
      <SignUpScreen
        initialEmail={prefillEmail}
        redirectNotice={pendingTarget?.label}
        onBackHome={() => {
          setPendingTarget(null);
          setRoute('home');
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
        onGoSignIn={() => {
          setRoute('signin');
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
        onNavigateDemoEvent={() => {
          setPendingTarget(null);
          setRoute('demo-event');
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
        onRequireOtp={(email, nextOtpType) => {
          setAuthEmail(email);
          setOtpType(nextOtpType);
          setRoute('verify-otp');
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
        onAuthenticated={handleAuthenticated}
      />
    );
  }

  if (route === 'reset-password') {
    return (
      <ResetPasswordScreen
        initialEmail={authEmail || prefillEmail || profile.email}
        onBackHome={() => {
          setPendingTarget(null);
          setRoute('home');
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
        onBackSignIn={() => {
          setRoute('signin');
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
        onProceedToOtp={(email) => {
          setAuthEmail(email);
          setOtpType('recovery');
          setRoute('verify-otp');
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
        onNavigateDemoEvent={() => {
          setPendingTarget(null);
          setRoute('demo-event');
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
      />
    );
  }

  if (route === 'verify-otp') {
    return (
      <VerifyOtpScreen
        email={authEmail || prefillEmail || profile.email}
        otpType={otpType}
        onBackHome={() => {
          setPendingTarget(null);
          setRoute('home');
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
        onBackSignIn={() => {
          setRoute('signin');
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
        onVerified={handleAuthenticated}
        onNavigateDemoEvent={() => {
          setPendingTarget(null);
          setRoute('demo-event');
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
      />
    );
  }

  if (route === 'demo-event') {
    return (
      <PublicEventScreen
        events={safePublicEvents.length > 0 ? safePublicEvents : safeEvents}
        attendees={safeAttendees}
        initialEventId={publicPreviewEventId}
        isSignedIn={isSignedIn}
        onBackHome={() => {
          setRoute('home');
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
        onOpenStudio={() =>
          requireSignedIn({
            route: 'studio',
            screen: 'overview',
            label: 'Creator Studio',
          })
        }
        onRegisterAttendee={handlePublicRegisterAttendee}
        onOpenDisposableCamera={(eventId, guestName) =>
          openPublicCamera(eventId, guestName, 'demo-event')
        }
      />
    );
  }

  if (authBootstrapping) {
    return (
      <div className="min-h-screen bg-[#F5F5F7] text-[#0B0B0B] flex flex-col items-center justify-center gap-3">
        <Loader2 className="w-6 h-6 animate-spin text-[#0B0B0B]" />
        <p className="text-xs font-medium text-[#71717A]">
          Syncing your workspace...
        </p>
      </div>
    );
  }

  // Strict Auth Gate: Sign-in is required for Creator Studio, Disposable Camera, and all event modules
  if (route === 'signin' || !isSignedIn) {
    return (
      <SignInScreen
        initialEmail={prefillEmail}
        creatorEmail={creatorEmail}
        redirectNotice={
          pendingTarget?.label ??
          (route === 'camera'
            ? 'Event Disposable Camera'
            : route === 'studio'
              ? 'Creator Studio'
              : undefined)
        }
        onBackHome={() => {
          setPendingTarget(null);
          setRoute('home');
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
        onNavigateDemoEvent={() => {
          setPendingTarget(null);
          setRoute('demo-event');
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
        onForgotPassword={(email) => {
          setAuthEmail(email);
          setRoute('reset-password');
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
        onGoSignUp={(email) => {
          setPrefillEmail(email);
          setRoute('signup');
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
        onRequireOtp={(email, nextOtpType) => {
          setAuthEmail(email);
          setOtpType(nextOtpType);
          setRoute('verify-otp');
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
        onAuthenticated={handleAuthenticated}
      />
    );
  }

  if (route === 'camera') {
    return (
      <DisposableCameraScreen
        mode="public"
        events={activeEvents}
        shots={safeDisposableShots}
        rollSettings={safeRollSettings}
        alerts={safeAlerts}
        profile={profile}
        initialEventId={cameraEventId || activeEvents[0]?.id}
        initialGuestName={cameraGuestName}
        onAddShot={handleAddShot}
        onToggleLikeShot={handleToggleLikeShot}
        onDeleteShot={handleDeleteShot}
        onDevelopRoll={handleDevelopRoll}
        onUpdateRollSettings={handleUpdateRollSettings}
        onBack={() => {
          setRoute(cameraReturnRoute);
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
        onOpenStudio={() => {
          openStudioCamera(cameraEventId || activeEvents[0]?.id);
        }}
      />
    );
  }

  return (
    <div className="min-h-screen bg-white text-[#0B0B0B]">
      <div className="w-full max-w-[1440px] mx-auto px-3.5 sm:px-6 lg:px-8 pt-3.5 sm:pt-6 pb-[calc(5.75rem+env(safe-area-inset-bottom))] md:pb-10 block md:flex md:gap-6 lg:gap-8 md:items-start overflow-x-clip">
        {/* Left Floating Dark Pill Capsule Navigation */}
        <NavigationRail
          activeScreen={activeScreen}
          userRole={effectiveRole}
          onNavigate={(screen) => {
            if (screen === 'console' && effectiveRole !== 'creator') {
              setApiBannerError('Access denied: Apps Creator Console requires the creator role.');
              return;
            }
            if (screen === 'billing' && effectiveRole === 'gate_staff') {
              setApiBannerError('Access denied: Billing & Plans are restricted to organizers.');
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
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }}
          onSignOut={handleSignOut}
          unresolvedAlertCount={unresolvedCount}
        />

        {/* Main Viewport */}
        <main className="flex-1 min-w-0 space-y-4">
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
            effectiveRole !== 'gate_staff' &&
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
                      Create your first event from scratch or populate your workspace with starter
                      events, attendees, and 35mm disposable camera frames.
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <button
                    type="button"
                    disabled={seedingStarter}
                    onClick={handleSeedStarterData}
                    className="px-4 py-2 rounded-full bg-white border border-[#E5E5EA] hover:border-[#0B0B0B] disabled:opacity-60 text-xs font-semibold text-[#0B0B0B] inline-flex items-center gap-1.5 transition-colors"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>{seedingStarter ? 'Loading Starter...' : 'Load Starter Data'}</span>
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
              onOpenPlans={openBillingScreen}
              onPreviewPublicEvent={() => {
                setPublicPreviewEventId(workspaceEvent.id);
                setRoute('demo-event');
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
              onToggleCheckIn={handleToggleCheckIn}
              onRegisterAttendee={handleStudioRegisterAttendee}
              onToggleScheduleBlock={handleToggleScheduleBlock}
              onAddScheduleBlock={handleAddScheduleBlock}
              onDeleteScheduleBlock={handleDeleteScheduleBlock}
              onNavigateSettings={() => {
                setWorkspaceEventId(null);
                setActiveScreen('settings');
              }}
              onResolveAlert={handleResolveAlert}
              onSelectAlertEvent={(evt) => setWorkspaceEventId(evt.id)}
              onOpenCsvExport={(evtId) => openCsvExportScreen(evtId)}
              onOpenQrScanner={(evtId) => openQrScanner(evtId)}
              onOpenDisposableCamera={(evtId) => openStudioCamera(evtId)}
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
                  onNavigateAttendees={handleNavigateAttendees}
                  onOpenQrScanner={(evtId, code) => openQrScanner(evtId, code)}
                  onNavigateEvents={() => setActiveScreen('events')}
                  onNavigateSettings={() => setActiveScreen('settings')}
                  onOpenPlans={openBillingScreen}
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
                  onRegisterAttendee={handleStudioRegisterAttendee}
                  onManageEvent={handleOpenWorkspace}
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
                  onRetryPayment={handleRetryPayment}
                  onRegisterAttendee={handleStudioRegisterAttendee}
                  onManageEvent={handleOpenWorkspace}
                  onOpenQrScanner={(evtId, code) => openQrScanner(evtId, code)}
                  onNavigateSettings={() => setActiveScreen('settings')}
                  onResolveAlert={handleResolveAlert}
                  onOpenCsvExport={(evtId) => openCsvExportScreen(evtId)}
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

              {activeScreen === 'billing' && effectiveRole !== 'gate_staff' && (
                <BillingScreen
                  profile={profile}
                  events={safeEvents}
                  onUpdateProfile={handleUpdateProfile}
                />
              )}

              {activeScreen === 'settings' && (
                <SettingsScreen
                  profile={profile}
                  events={safeEvents}
                  alerts={safeAlerts}
                  onUpdateProfile={handleUpdateProfile}
                  onResolveAlert={handleResolveAlert}
                  onOpenPlans={openBillingScreen}
                  onSignOut={handleSignOut}
                  onResetDemoData={handleSeedStarterData}
                />
              )}
            </>
          )}
        </main>
      </div>

      {/* Edit Event Modal */}
      {selectedEvent && (
        <EventDetailModal
          event={selectedEvent}
          scheduleBlocks={safeScheduleBlocks}
          capacityThreshold={profile.capacityAlertThreshold}
          onClose={() => setSelectedEventId(null)}
          onUpdateEvent={handleUpdateEvent}
          onDeleteEvent={handleDeleteEvent}
          onOpenAttendees={(id) => handleNavigateAttendees(id)}
        />
      )}
    </div>
  );
}
