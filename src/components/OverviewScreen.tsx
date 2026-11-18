import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  Plus,
  QrCode,
  UserPlus,
} from 'lucide-react';
import {
  Attendee,
  EventItem,
  EventStatus,
  OrganizerProfile,
  SystemAlert,
  TimeRange,
} from '../types/events';
import { VELOCITY_SERIES } from '../data/initialData';
import { CircularGauge, MonochromePoster, SplineChart } from './MonochromeArtwork';
import { TopUtilityBar } from './TopUtilityBar';

interface OverviewScreenProps {
  events: EventItem[];
  attendees: Attendee[];
  alerts: SystemAlert[];
  profile: OrganizerProfile;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  onOpenCreateModal: () => void;
  onManageEvent: (event: EventItem) => void;
  onNavigateAttendees: (eventId?: string) => void;
  onOpenQrScanner: (eventId?: string, code?: string) => void;
  onNavigateEvents: () => void;
  onNavigateSettings: () => void;
  onOpenPlans: () => void;
  onResolveAlert: (id: string) => void;
}

export const OverviewScreen: React.FC<OverviewScreenProps> = ({
  events,
  attendees,
  alerts,
  profile,
  searchQuery,
  onSearchChange,
  onOpenCreateModal,
  onManageEvent,
  onNavigateAttendees,
  onOpenQrScanner,
  onNavigateEvents,
  onNavigateSettings,
  onOpenPlans,
  onResolveAlert,
}) => {
  const [catalogFilter, setCatalogFilter] = useState<'all' | EventStatus>('all');
  const [highlightIndex, setHighlightIndex] = useState(0);
  const [timeRange, setTimeRange] = useState<TimeRange>('7D');
  const [quickScanCode, setQuickScanCode] = useState('');

  const upcomingPool = useMemo(() => {
    const active = events.filter((e) => e.status === 'upcoming' || e.status === 'live');
    return active.length > 0 ? active : events;
  }, [events]);

  const safeHighlightIdx = upcomingPool.length > 0 ? highlightIndex % upcomingPool.length : 0;
  const featuredEvent = upcomingPool[safeHighlightIdx];

  const filteredCatalog = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return events.filter((evt) => {
      const matchesStatus = catalogFilter === 'all' || evt.status === catalogFilter;
      const matchesSearch =
        !q ||
        evt.title.toLowerCase().includes(q) ||
        evt.venue.toLowerCase().includes(q) ||
        evt.city.toLowerCase().includes(q) ||
        evt.category.toLowerCase().includes(q);
      return matchesStatus && matchesSearch;
    });
  }, [events, catalogFilter, searchQuery]);

  const totalRegistered = useMemo(
    () => events.reduce((acc, evt) => acc + evt.registered, 0),
    [events]
  );
  const totalCapacity = useMemo(
    () => events.reduce((acc, evt) => acc + evt.capacity, 0),
    [events]
  );
  const checkedInCount = useMemo(
    () => attendees.filter((a) => a.checkedIn).length,
    [attendees]
  );
  const pendingCheckInCount = Math.max(0, attendees.length - checkedInCount);
  const checkInRate = attendees.length > 0 ? Math.round((checkedInCount / attendees.length) * 100) : 0;
  const overallOccupancy = totalCapacity > 0 ? Math.round((totalRegistered / totalCapacity) * 100) : 0;
  const unresolvedAlerts = alerts.filter((a) => !a.resolved);

  const featuredPct = featuredEvent
    ? Math.round((featuredEvent.registered / Math.max(1, featuredEvent.capacity)) * 100)
    : 0;
  const featuredAlert = featuredPct >= profile.capacityAlertThreshold;

  const hour = new Date().getHours();
  const greeting =
    hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_356px] gap-6 items-start">
      {/* CENTER COLUMN: Greeting, Prominent QR & Check-In Bar, Upcoming Highlight, Event Catalog */}
      <div className="space-y-6 min-w-0">
        {/* Personalized Greeting Banner */}
        <section className="bg-[#F5F5F7] rounded-3xl p-6 sm:p-8 flex flex-col sm:flex-row sm:items-center justify-between gap-6">
          <div className="max-w-xl">
            <h1 className="font-display text-[28px] sm:text-[36px] leading-[1.15] font-bold tracking-[-0.03em] text-[#0B0B0B] text-balance">
              {greeting}, {profile.firstName}.
            </h1>
            <p className="text-sm text-[#71717A] mt-2 leading-relaxed">
              <span className="tabular-nums font-medium text-[#0B0B0B]">
                {events.filter((e) => e.status === 'live' || e.status === 'upcoming').length}
              </span>{' '}
              active productions scheduled ·{' '}
              <span className="tabular-nums font-medium text-[#0B0B0B]">
                {totalRegistered.toLocaleString()}
              </span>{' '}
              seats allocated
              {unresolvedAlerts.length > 0 && (
                <>
                  {' · '}
                  <span className="text-[#EF4444] font-semibold tabular-nums">
                    {unresolvedAlerts.length} alerts require review
                  </span>
                </>
              )}
            </p>
            <div className="mt-5 flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                onClick={() => onOpenQrScanner(featuredEvent?.id)}
                className="px-5 py-2.5 rounded-full bg-[#0B0B0B] text-white text-xs font-semibold hover:bg-zinc-800 transition-colors inline-flex items-center gap-2 whitespace-nowrap shrink-0"
              >
                <QrCode className="w-4 h-4" />
                Open QR Scanner
              </button>
              <button
                type="button"
                onClick={() => onOpenQrScanner(featuredEvent?.id)}
                className="px-5 py-2.5 rounded-full bg-white border border-[#E5E5EA] text-[#0B0B0B] text-xs font-semibold hover:border-[#0B0B0B] transition-colors inline-flex items-center gap-2 whitespace-nowrap shrink-0"
              >
                <UserPlus className="w-4 h-4" />
                Check-In Registration
              </button>
              <button
                type="button"
                onClick={onOpenCreateModal}
                className="px-4 py-2.5 rounded-full bg-white border border-[#E5E5EA] text-[#0B0B0B] text-xs font-semibold hover:border-[#0B0B0B] transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
              >
                <Plus className="w-3.5 h-3.5" />
                New Event
              </button>
              <button
                type="button"
                onClick={onNavigateEvents}
                className="px-4 py-2.5 rounded-full bg-transparent text-[#71717A] hover:text-[#0B0B0B] text-xs font-semibold transition-colors whitespace-nowrap shrink-0"
              >
                All Productions
              </button>
            </div>
          </div>

          {/* Architectural Geometric Motif */}
          <div className="hidden sm:flex items-center justify-center shrink-0" aria-hidden="true">
            <svg viewBox="0 0 120 120" className="w-28 h-28">
              <circle cx="60" cy="60" r="52" fill="none" stroke="#E5E5EA" strokeWidth="1.5" />
              <circle cx="60" cy="60" r="36" fill="none" stroke="#0B0B0B" strokeWidth="1.5" />
              <path d="M24 60 L96 60" stroke="#0B0B0B" strokeWidth="1.5" />
              <circle cx="60" cy="60" r="8" fill="#0B0B0B" />
              <circle cx="96" cy="60" r="4" fill="#FFFFFF" stroke="#0B0B0B" strokeWidth="2" />
            </svg>
          </div>
        </section>

        {/* PROMINENT GATE CHECK-IN REGISTRATION & QR CODE SCANNER COMMAND STRIP */}
        <section className="bg-[#0B0B0B] text-white rounded-3xl p-6 flex flex-col lg:flex-row lg:items-center justify-between gap-5">
          <div className="flex items-start gap-4 min-w-0">
            <div className="w-12 h-12 rounded-2xl bg-white text-[#0B0B0B] flex items-center justify-center shrink-0">
              <QrCode className="w-6 h-6" />
            </div>
            <div className="min-w-0">
              <h2 className="font-display text-lg font-bold tracking-tight">
                Gate Check-In &amp; QR Code Scanner
              </h2>
              <p className="text-xs text-zinc-300 mt-0.5 tabular-nums">
                {checkedInCount} checked in · {pendingCheckInCount} pending gate arrival — verify
                passes or register walk-in guests instantly.
              </p>
            </div>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              onOpenQrScanner(featuredEvent?.id, quickScanCode.trim() || undefined);
              setQuickScanCode('');
            }}
            className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 shrink-0"
          >
            <input
              type="text"
              value={quickScanCode}
              onChange={(e) => setQuickScanCode(e.target.value)}
              placeholder="Scan pass code (e.g. EV-8801)"
              aria-label="Quick scan pass code"
              className="h-10 px-4 rounded-full bg-white/10 border border-white/20 text-xs font-mono text-white placeholder:text-zinc-400 focus:bg-white focus:text-[#0B0B0B] focus:outline-none sm:w-52"
            />
            <button
              type="submit"
              className="h-10 px-5 rounded-full bg-white text-[#0B0B0B] text-xs font-bold hover:bg-zinc-200 transition-colors inline-flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0"
            >
              <QrCode className="w-3.5 h-3.5" />
              {quickScanCode.trim() ? 'Verify Code' : 'Launch QR Scanner'}
            </button>
          </form>
        </section>

        {/* Upcoming Highlight Card */}
        {featuredEvent && (
          <section className="bg-[#F5F5F7] rounded-3xl p-6">
            <div className="flex items-center justify-between gap-4 mb-4">
              <div className="flex items-center gap-2">
                <h2 className="text-base font-semibold tracking-tight text-[#0B0B0B]">
                  Upcoming Highlight
                </h2>
                <span className="text-xs text-[#71717A] tabular-nums">
                  · {safeHighlightIdx + 1} / {upcomingPool.length}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    setHighlightIndex((prev) => (prev - 1 + upcomingPool.length) % upcomingPool.length)
                  }
                  aria-label="Previous upcoming event"
                  className="w-9 h-9 rounded-full bg-white border border-[#E5E5EA] flex items-center justify-center text-[#0B0B0B] hover:border-[#0B0B0B] transition-colors"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setHighlightIndex((prev) => (prev + 1) % upcomingPool.length)}
                  aria-label="Next upcoming event"
                  className="w-9 h-9 rounded-full bg-white border border-[#E5E5EA] flex items-center justify-center text-[#0B0B0B] hover:border-[#0B0B0B] transition-colors"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-5">
              <div className="flex items-center gap-4 min-w-0">
                <MonochromePoster
                  variant={featuredEvent.artwork}
                  className="w-20 h-20 sm:w-24 sm:h-24 rounded-2xl"
                />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-[#71717A]">
                    <span className="capitalize font-medium text-[#0B0B0B]">
                      {featuredEvent.status}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="tabular-nums">{featuredEvent.date}</span>
                    <span aria-hidden="true">·</span>
                    <span className="tabular-nums">{featuredEvent.time}</span>
                  </div>
                  <h3 className="text-lg sm:text-xl font-bold tracking-tight text-[#0B0B0B] mt-1 truncate">
                    {featuredEvent.title}
                  </h3>
                  <p className="text-xs text-[#71717A] mt-0.5 truncate">
                    {featuredEvent.venue} · {featuredEvent.city}
                  </p>
                  {featuredAlert && (
                    <p className="text-xs font-semibold text-[#EF4444] mt-1.5 inline-flex items-center gap-1.5">
                      <AlertCircle className="w-3.5 h-3.5" />
                      Capacity ceiling ({featuredPct}% filled)
                    </p>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-between sm:justify-end gap-4 shrink-0 pt-3 sm:pt-0 border-t sm:border-t-0 border-[#E5E5EA]">
                <div className="flex items-center gap-3">
                  <CircularGauge
                    value={featuredPct}
                    size={54}
                    alertThreshold={profile.capacityAlertThreshold}
                  />
                  <div className="text-left">
                    <p className="text-xs font-semibold text-[#0B0B0B] tabular-nums">
                      {featuredEvent.registered} / {featuredEvent.capacity}
                    </p>
                    <p className="text-[11px] text-[#71717A]">Registered</p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onOpenQrScanner(featuredEvent.id)}
                    className="px-4 py-2 rounded-full bg-white border border-[#E5E5EA] text-xs font-semibold text-[#0B0B0B] hover:border-[#0B0B0B] transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
                  >
                    <QrCode className="w-3.5 h-3.5" />
                    QR Check-In
                  </button>
                  <button
                    type="button"
                    onClick={() => onManageEvent(featuredEvent)}
                    className="px-5 py-2 rounded-full bg-[#0B0B0B] text-white text-xs font-semibold hover:bg-zinc-800 transition-colors whitespace-nowrap shrink-0"
                  >
                    Manage
                  </button>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* Productions / Event Catalog */}
        <section>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
            <h2 className="text-xl font-bold tracking-tight text-[#0B0B0B]">
              Productions
            </h2>
            <div className="flex items-center gap-1.5 p-1 bg-[#F5F5F7] rounded-full overflow-x-auto">
              {(
                [
                  { id: 'all', label: 'All Events' },
                  { id: 'live', label: 'Live' },
                  { id: 'upcoming', label: 'Upcoming' },
                  { id: 'draft', label: 'Drafts' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setCatalogFilter(tab.id)}
                  className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                    catalogFilter === tab.id
                      ? 'bg-[#0B0B0B] text-white'
                      : 'text-[#71717A] hover:text-[#0B0B0B]'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            {filteredCatalog.length === 0 ? (
              <div className="p-8 rounded-3xl bg-[#F5F5F7] text-center">
                <p className="text-sm font-semibold text-[#0B0B0B]">No matching productions</p>
                <p className="text-xs text-[#71717A] mt-1">
                  Adjust your search query or create a new event.
                </p>
                <button
                  type="button"
                  onClick={onOpenCreateModal}
                  className="mt-4 px-5 py-2 rounded-full bg-[#0B0B0B] text-white text-xs font-semibold hover:bg-zinc-800 transition-colors"
                >
                  Create Event
                </button>
              </div>
            ) : (
              filteredCatalog.map((evt) => {
                const pct = Math.round((evt.registered / Math.max(1, evt.capacity)) * 100);
                const hasCapAlert = pct >= profile.capacityAlertThreshold;
                const hasIssue = hasCapAlert || Boolean(evt.broadcastError);

                return (
                  <div
                    key={evt.id}
                    className="group p-4 rounded-2xl bg-[#F5F5F7] border border-transparent hover:bg-white hover:border-[#E5E5EA] hover:-translate-y-0.5 transition-all duration-150 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                  >
                    <div className="flex items-center gap-3.5 min-w-0">
                      <MonochromePoster variant={evt.artwork} className="w-14 h-14 rounded-xl" />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <h3 className="text-sm font-semibold text-[#0B0B0B] truncate">
                            {evt.title}
                          </h3>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5 text-xs text-[#71717A] mt-1">
                          <span className="font-semibold text-[#0B0B0B]">{evt.category}</span>
                          <span aria-hidden="true">·</span>
                          <span className="capitalize">{evt.status}</span>
                          <span aria-hidden="true">·</span>
                          <span className="tabular-nums">{evt.date}</span>
                          <span aria-hidden="true">·</span>
                          <span>{evt.city}</span>
                          <span aria-hidden="true">·</span>
                          <span className="tabular-nums text-[#0B0B0B] font-medium">
                            {evt.registered}/{evt.capacity}
                          </span>
                          {hasIssue && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="text-[#EF4444] font-semibold tabular-nums">
                                {hasCapAlert ? `${pct}% ceiling` : evt.broadcastError}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0">
                      <div className="text-left sm:text-right">
                        <p className="text-xs font-semibold text-[#0B0B0B] tabular-nums">
                          ${evt.revenue.toLocaleString()}
                        </p>
                        <p className="text-[11px] text-[#71717A] tabular-nums">
                          ${evt.ticketPrice} pass
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => onManageEvent(evt)}
                        className="px-4 py-2 rounded-full bg-[#0B0B0B] text-white text-xs font-semibold hover:bg-zinc-800 transition-colors whitespace-nowrap shrink-0"
                      >
                        Manage
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>
      </div>

      {/* RIGHT RAIL: Utility Search/Profile, Rapid Stats, Spline Chart, Account Upgrade */}
      <aside className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-1 gap-5 xl:sticky xl:top-6">
        <div className="md:col-span-2 xl:col-span-1">
          <TopUtilityBar
            searchQuery={searchQuery}
            onSearchChange={onSearchChange}
            alerts={alerts}
            onResolveAlert={onResolveAlert}
            onInspectAlertEvent={(id) => {
              const match = events.find((e) => e.id === id);
              if (match) onManageEvent(match);
            }}
            profile={profile}
            onOpenSettings={onNavigateSettings}
          />
        </div>

        {/* Rapid Stats 2-Up Grid */}
        <div className="grid grid-cols-2 gap-3.5">
          <div className="p-5 rounded-3xl bg-[#F5F5F7] flex flex-col justify-between gap-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-[#71717A]">Tickets Sold</span>
              <CircularGauge value={overallOccupancy} size={42} strokeWidth={4} />
            </div>
            <div>
              <p className="font-display text-[30px] leading-none font-bold tracking-tight text-[#0B0B0B] tabular-nums">
                {totalRegistered.toLocaleString()}
              </p>
              <p className="text-[11px] text-[#71717A] mt-1.5 tabular-nums">
                of {totalCapacity.toLocaleString()} total capacity
              </p>
            </div>
          </div>

          <div className="p-5 rounded-3xl bg-[#F5F5F7] flex flex-col justify-between gap-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-[#71717A]">Check-In</span>
              <CircularGauge value={checkInRate} size={42} strokeWidth={4} alertThreshold={101} />
            </div>
            <div>
              <p className="font-display text-[30px] leading-none font-bold tracking-tight text-[#0B0B0B] tabular-nums">
                {checkInRate}%
              </p>
              <p className="text-[11px] text-[#71717A] mt-1.5 tabular-nums">
                {checkedInCount} of {attendees.length} guests arrived
              </p>
            </div>
          </div>
        </div>

        {/* Linear SVG Spline Chart Card */}
        <div className="p-5 rounded-3xl bg-[#F5F5F7]">
          <div className="flex items-center justify-between gap-2 mb-4">
            <h2 className="text-sm font-semibold text-[#0B0B0B]">Registration Velocity</h2>
            <div className="flex items-center gap-1 p-0.5 bg-white rounded-full border border-[#E5E5EA]">
              {(['7D', '30D', '90D'] as TimeRange[]).map((range) => (
                <button
                  key={range}
                  type="button"
                  onClick={() => setTimeRange(range)}
                  className={`px-2.5 py-1 rounded-full text-[11px] font-semibold transition-colors ${
                    timeRange === range
                      ? 'bg-[#0B0B0B] text-white'
                      : 'text-[#71717A] hover:text-[#0B0B0B]'
                  }`}
                >
                  {range}
                </button>
              ))}
            </div>
          </div>

          <SplineChart data={VELOCITY_SERIES[timeRange]} />
        </div>

        {/* Plan / Account Upgrade Module */}
        <div className="md:col-span-2 xl:col-span-1 p-6 rounded-3xl bg-[#0B0B0B] text-white">
          <div className="flex items-center justify-between">
            <span className="text-xs text-zinc-400 font-medium">{profile.plan} Workspace</span>
            <ArrowUpRight className="w-4 h-4 text-zinc-400" />
          </div>
          <h3 className="text-lg font-bold tracking-tight mt-2">
            Scale multi-stage gate throughput
          </h3>
          <p className="text-xs text-zinc-400 mt-1.5 leading-relaxed">
            Automated SMS gate alerts, hardware badge sync, and unlimited concurrent venues.
          </p>
          <button
            type="button"
            onClick={onOpenPlans}
            className="mt-4 w-full py-2.5 rounded-full bg-white text-[#0B0B0B] text-xs font-semibold hover:bg-zinc-200 transition-colors"
          >
            Manage Plan
          </button>
        </div>
      </aside>
    </div>
  );
};
