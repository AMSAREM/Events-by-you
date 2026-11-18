import { useEffect, useState } from 'react';
import {
  INITIAL_ALERTS,
  INITIAL_ATTENDEES,
  INITIAL_EVENTS,
  INITIAL_PROFILE,
  INITIAL_SCHEDULE,
} from './data/initialData';
import {
  AppRoute,
  Attendee,
  EventItem,
  NavScreen,
  OrganizerProfile,
  ScheduleBlock,
  StudioSubScreen,
  SystemAlert,
} from './types/events';
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
import { EventDetailModal } from './components/EventModals';

function loadStored<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export default function App() {
  const [route, setRoute] = useState<AppRoute>('home');
  const [isSignedIn, setIsSignedIn] = useState<boolean>(() =>
    loadStored('eventsapp_signedin_v4', false)
  );
  const [prefillEmail, setPrefillEmail] = useState<string>('');
  const [authEmail, setAuthEmail] = useState<string>('');

  const [activeScreen, setActiveScreen] = useState<NavScreen>('overview');
  const [events, setEvents] = useState<EventItem[]>(() =>
    loadStored('eventsapp_events_v4', INITIAL_EVENTS)
  );
  const [attendees, setAttendees] = useState<Attendee[]>(() =>
    loadStored('eventsapp_attendees_v4', INITIAL_ATTENDEES)
  );
  const [scheduleBlocks, setScheduleBlocks] = useState<ScheduleBlock[]>(() =>
    loadStored('eventsapp_schedule_v4', INITIAL_SCHEDULE)
  );
  const [alerts, setAlerts] = useState<SystemAlert[]>(() =>
    loadStored('eventsapp_alerts_v4', INITIAL_ALERTS)
  );
  const [profile, setProfile] = useState<OrganizerProfile>(() =>
    loadStored('eventsapp_profile_v4', INITIAL_PROFILE)
  );

  const [overviewSearch, setOverviewSearch] = useState('');
  const [eventsSearch, setEventsSearch] = useState('');
  const [attendeeEventFilter, setAttendeeEventFilter] = useState<string>('all');

  const [studioSubScreen, setStudioSubScreen] = useState<StudioSubScreen>(null);
  const [csvExportEventId, setCsvExportEventId] = useState<string | undefined>(undefined);
  const [checkinEventId, setCheckinEventId] = useState<string | undefined>(undefined);
  const [checkinPrefillCode, setCheckinPrefillCode] = useState<string | undefined>(undefined);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [workspaceEventId, setWorkspaceEventId] = useState<string | null>(null);
  const [publicPreviewEventId, setPublicPreviewEventId] = useState<string | undefined>(undefined);

  useEffect(() => {
    try {
      localStorage.setItem('eventsapp_signedin_v4', JSON.stringify(isSignedIn));
      localStorage.setItem('eventsapp_events_v4', JSON.stringify(events));
      localStorage.setItem('eventsapp_attendees_v4', JSON.stringify(attendees));
      localStorage.setItem('eventsapp_schedule_v4', JSON.stringify(scheduleBlocks));
      localStorage.setItem('eventsapp_alerts_v4', JSON.stringify(alerts));
      localStorage.setItem('eventsapp_profile_v4', JSON.stringify(profile));
    } catch {
      // Ignore storage quota errors
    }
  }, [isSignedIn, events, attendees, scheduleBlocks, alerts, profile]);

  const selectedEvent = selectedEventId
    ? events.find((e) => e.id === selectedEventId) ?? null
    : null;

  const workspaceEvent = workspaceEventId
    ? events.find((e) => e.id === workspaceEventId) ?? null
    : null;

  const handleCreateEventWithBlocks = (newEvt: EventItem, newBlocks: ScheduleBlock[]) => {
    setEvents((prev) => [newEvt, ...prev]);
    if (newBlocks.length > 0) {
      setScheduleBlocks((prev) => [...prev, ...newBlocks]);
    }
    setStudioSubScreen(null);
    setWorkspaceEventId(newEvt.id);
    setActiveScreen('events');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const openCreateWizard = () => {
    setWorkspaceEventId(null);
    setActiveScreen('events');
    setStudioSubScreen('create-event');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const openBillingScreen = () => {
    setWorkspaceEventId(null);
    setStudioSubScreen(null);
    setActiveScreen('billing');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const openCsvExportScreen = (eventId?: string) => {
    setWorkspaceEventId(null);
    setCsvExportEventId(eventId);
    setActiveScreen('attendees');
    setStudioSubScreen('csv-export');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const openQrScanner = (eventId?: string, code?: string) => {
    setIsSignedIn(true);
    setRoute('studio');
    setWorkspaceEventId(null);
    setStudioSubScreen(null);
    setCheckinEventId(eventId);
    setCheckinPrefillCode(code);
    setActiveScreen('checkin');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleUpdateEvent = (updated: EventItem) => {
    setEvents((prev) => prev.map((e) => (e.id === updated.id ? updated : e)));
  };

  const handleDeleteEvent = (id: string) => {
    setEvents((prev) => prev.filter((e) => e.id !== id));
    setScheduleBlocks((prev) => prev.filter((b) => b.eventId !== id));
    if (workspaceEventId === id) {
      setWorkspaceEventId(null);
    }
  };

  const handleRegisterAttendee = (eventId: string, attendee: Attendee) => {
    setAttendees((prev) => [attendee, ...prev]);
    setEvents((prev) =>
      prev.map((evt) =>
        evt.id === eventId
          ? {
              ...evt,
              registered: evt.registered + 1,
              smsDispatched: evt.smsDispatched + 1,
              revenue: evt.revenue + evt.ticketPrice,
            }
          : evt
      )
    );
  };

  const handleToggleCheckIn = (attendeeId: string) => {
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
  };

  const handleRetryPayment = (attendeeId: string) => {
    setAttendees((prev) =>
      prev.map((a) => (a.id === attendeeId ? { ...a, paymentStatus: 'paid' } : a))
    );
    setAlerts((prev) =>
      prev.map((al) => (al.category === 'payment' ? { ...al, resolved: true } : al))
    );
  };

  const handleToggleScheduleBlock = (blockId: string) => {
    setScheduleBlocks((prev) =>
      prev.map((b) => (b.id === blockId ? { ...b, completed: !b.completed } : b))
    );
  };

  const handleAddScheduleBlock = (block: ScheduleBlock) => {
    setScheduleBlocks((prev) => [...prev, block]);
  };

  const handleDeleteScheduleBlock = (blockId: string) => {
    setScheduleBlocks((prev) => prev.filter((b) => b.id !== blockId));
  };

  const handleOpenWorkspace = (evt: EventItem) => {
    setStudioSubScreen(null);
    setWorkspaceEventId(evt.id);
    setActiveScreen('events');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleResolveAlert = (id: string) => {
    setAlerts((prev) => prev.map((a) => (a.id === id ? { ...a, resolved: true } : a)));
  };

  const handleNavigateAttendees = (eventId?: string) => {
    setStudioSubScreen(null);
    setWorkspaceEventId(null);
    setAttendeeEventFilter(eventId ?? 'all');
    setActiveScreen('attendees');
  };

  const handleAuthenticated = (email: string, name?: string) => {
    setIsSignedIn(true);
    setProfile((prev) => ({
      ...prev,
      email,
      name: name ?? prev.name,
      firstName: name ? name.split(' ')[0] : prev.firstName,
    }));
    setRoute('studio');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleSignOut = () => {
    setIsSignedIn(false);
    setWorkspaceEventId(null);
    setSelectedEventId(null);
    setRoute('home');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleResetDemoData = () => {
    setEvents(INITIAL_EVENTS);
    setAttendees(INITIAL_ATTENDEES);
    setScheduleBlocks(INITIAL_SCHEDULE);
    setAlerts(INITIAL_ALERTS);
    setProfile(INITIAL_PROFILE);
    setWorkspaceEventId(null);
    setSelectedEventId(null);
  };

  const unresolvedCount = alerts.filter((a) => !a.resolved).length;
  const featuredEvent = events[0] ?? INITIAL_EVENTS[0];

  if (route === 'home') {
    return (
      <LandingScreen
        featuredEvent={featuredEvent}
        allEvents={events}
        recentAttendees={attendees}
        isSignedIn={isSignedIn}
        onNavigateSignIn={(email) => {
          setPrefillEmail(email ?? '');
          setRoute('signin');
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
        onNavigateSignUp={(email) => {
          setPrefillEmail(email ?? '');
          setRoute('signup');
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
        onNavigateDemoEvent={(eventId) => {
          setPublicPreviewEventId(eventId || featuredEvent.id);
          setRoute('demo-event');
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
        onNavigateStudio={() => {
          setIsSignedIn(true);
          setRoute('studio');
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
        onOpenQrScanner={(eventId) => openQrScanner(eventId || featuredEvent.id)}
        onUpgradePro={() => {
          setIsSignedIn(true);
          setRoute('studio');
          setWorkspaceEventId(null);
          setStudioSubScreen(null);
          setActiveScreen('billing');
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
        onQuickStartEmail={(email) => {
          setPrefillEmail(email);
          setRoute('signup');
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
      />
    );
  }

  if (route === 'signin') {
    return (
      <SignInScreen
        initialEmail={prefillEmail}
        onBackHome={() => {
          setRoute('home');
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
        onNavigateDemoEvent={() => {
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
        onSubmitCredentials={(email) => {
          setAuthEmail(email);
          setRoute('verify-otp');
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
        onAuthenticated={handleAuthenticated}
      />
    );
  }

  if (route === 'signup') {
    return (
      <SignUpScreen
        initialEmail={prefillEmail}
        onBackHome={() => {
          setRoute('home');
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
        onGoSignIn={() => {
          setRoute('signin');
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
        onNavigateDemoEvent={() => {
          setRoute('demo-event');
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
        onAccountCreated={(email, name, org) => {
          setAuthEmail(email);
          setProfile((prev) => ({
            ...prev,
            email,
            name,
            firstName: name.split(' ')[0] || prev.firstName,
            studio: org,
          }));
          setRoute('verify-otp');
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
      />
    );
  }

  if (route === 'reset-password') {
    return (
      <ResetPasswordScreen
        initialEmail={authEmail || prefillEmail || profile.email}
        onBackHome={() => {
          setRoute('home');
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
        onBackSignIn={() => {
          setRoute('signin');
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
        onProceedToOtp={(email) => {
          setAuthEmail(email);
          setRoute('verify-otp');
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
        onNavigateDemoEvent={() => {
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
        onBackHome={() => {
          setRoute('home');
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
        onBackSignIn={() => {
          setRoute('signin');
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
        onVerified={() => handleAuthenticated(authEmail || prefillEmail || profile.email)}
        onNavigateDemoEvent={() => {
          setRoute('demo-event');
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
      />
    );
  }

  if (route === 'demo-event') {
    return (
      <PublicEventScreen
        events={events}
        attendees={attendees}
        initialEventId={publicPreviewEventId}
        onBackHome={() => {
          setRoute('home');
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
        onOpenStudio={() => {
          setIsSignedIn(true);
          setRoute('studio');
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
        onRegisterAttendee={handleRegisterAttendee}
      />
    );
  }

  return (
    <div className="min-h-screen bg-white text-[#0B0B0B]">
      <div className="w-full max-w-[1440px] mx-auto px-3.5 sm:px-6 lg:px-8 pt-3.5 sm:pt-6 pb-[calc(5.75rem+env(safe-area-inset-bottom))] md:pb-10 block md:flex md:gap-6 lg:gap-8 md:items-start overflow-x-clip">
        {/* Left Floating Dark Pill Capsule Navigation */}
        <NavigationRail
          activeScreen={activeScreen}
          onNavigate={(screen) => {
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
          unresolvedAlertCount={unresolvedCount}
        />

        {/* Main Viewport */}
        <main className="flex-1 min-w-0">
          {studioSubScreen === 'create-event' ? (
            <CreateEventWizardScreen
              profile={profile}
              events={events}
              onCancel={() => {
                setStudioSubScreen(null);
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
              onNavigateBilling={openBillingScreen}
              onCreateEvent={handleCreateEventWithBlocks}
            />
          ) : studioSubScreen === 'csv-export' ? (
            <CsvExportScreen
              events={events}
              attendees={attendees}
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
              events={events}
              attendees={attendees}
              scheduleBlocks={scheduleBlocks}
              alerts={alerts}
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
              onRegisterAttendee={handleRegisterAttendee}
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
            />
          ) : (
            <>
              {activeScreen === 'overview' && (
                <OverviewScreen
                  events={events}
                  attendees={attendees}
                  alerts={alerts}
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
                  events={events}
                  attendees={attendees}
                  alerts={alerts}
                  profile={profile}
                  initialEventId={checkinEventId}
                  initialCode={checkinPrefillCode}
                  onToggleCheckIn={handleToggleCheckIn}
                  onRegisterAttendee={handleRegisterAttendee}
                  onManageEvent={handleOpenWorkspace}
                  onNavigateSettings={() => setActiveScreen('settings')}
                  onResolveAlert={handleResolveAlert}
                />
              )}

              {activeScreen === 'events' && (
                <EventsScreen
                  events={events}
                  alerts={alerts}
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
                  events={events}
                  blocks={scheduleBlocks}
                  alerts={alerts}
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
                  attendees={attendees}
                  events={events}
                  alerts={alerts}
                  profile={profile}
                  initialEventFilter={attendeeEventFilter}
                  onToggleCheckIn={handleToggleCheckIn}
                  onRetryPayment={handleRetryPayment}
                  onRegisterAttendee={handleRegisterAttendee}
                  onManageEvent={handleOpenWorkspace}
                  onOpenQrScanner={(evtId, code) => openQrScanner(evtId, code)}
                  onNavigateSettings={() => setActiveScreen('settings')}
                  onResolveAlert={handleResolveAlert}
                  onOpenCsvExport={(evtId) => openCsvExportScreen(evtId)}
                />
              )}

              {activeScreen === 'analytics' && (
                <AnalyticsScreen
                  events={events}
                  attendees={attendees}
                  alerts={alerts}
                  profile={profile}
                  onManageEvent={handleOpenWorkspace}
                  onNavigateSettings={() => setActiveScreen('settings')}
                  onResolveAlert={handleResolveAlert}
                />
              )}

              {activeScreen === 'billing' && (
                <BillingScreen
                  profile={profile}
                  events={events}
                  onUpdateProfile={setProfile}
                />
              )}

              {activeScreen === 'settings' && (
                <SettingsScreen
                  profile={profile}
                  events={events}
                  alerts={alerts}
                  onUpdateProfile={setProfile}
                  onResolveAlert={handleResolveAlert}
                  onOpenPlans={openBillingScreen}
                  onSignOut={handleSignOut}
                  onResetDemoData={handleResetDemoData}
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
          scheduleBlocks={scheduleBlocks}
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
