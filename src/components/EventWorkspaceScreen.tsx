import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Calendar,
  Check,
  Clock,
  Copy,
  Download,
  Edit3,
  ExternalLink,
  GripVertical,
  LayoutGrid,
  Link2,
  MapPin,
  MessageSquare,
  Plus,
  Printer,
  QrCode,
  Search,
  Send,
  ShieldCheck,
  Trash2,
  UserPlus,
} from 'lucide-react';
import {
  Attendee,
  AttendeeTier,
  EventItem,
  OrganizerProfile,
  ScheduleBlock,
  SystemAlert,
  TimeRange,
} from '../types/events';
import { normalizePhoneE164, VELOCITY_SERIES } from '../data/initialData';
import { SplineChart } from './MonochromeArtwork';
import { TopUtilityBar } from './TopUtilityBar';

type WorkspaceTab =
  | 'overview'
  | 'program'
  | 'messages'
  | 'attendees'
  | 'analytics'
  | 'share';

interface EventWorkspaceScreenProps {
  event: EventItem;
  events: EventItem[];
  attendees: Attendee[];
  scheduleBlocks: ScheduleBlock[];
  alerts: SystemAlert[];
  profile: OrganizerProfile;
  onBackToEvents: () => void;
  onOpenEditModal: (event: EventItem) => void;
  onOpenPlans: () => void;
  onPreviewPublicEvent: () => void;
  onToggleCheckIn: (attendeeId: string) => void;
  onRegisterAttendee?: (eventId: string, attendee: Attendee) => void;
  onToggleScheduleBlock: (blockId: string) => void;
  onAddScheduleBlock: (block: ScheduleBlock) => void;
  onDeleteScheduleBlock?: (blockId: string) => void;
  onNavigateSettings: () => void;
  onResolveAlert: (id: string) => void;
  onSelectAlertEvent: (event: EventItem) => void;
  onOpenCsvExport?: (eventId: string) => void;
  onOpenQrScanner?: (eventId: string) => void;
}

export const EventWorkspaceScreen: React.FC<EventWorkspaceScreenProps> = ({
  event,
  events,
  attendees,
  scheduleBlocks,
  alerts,
  profile,
  onBackToEvents,
  onOpenEditModal,
  onOpenPlans,
  onPreviewPublicEvent,
  onToggleCheckIn,
  onRegisterAttendee,
  onToggleScheduleBlock,
  onAddScheduleBlock,
  onDeleteScheduleBlock,
  onNavigateSettings,
  onResolveAlert,
  onSelectAlertEvent,
  onOpenCsvExport,
  onOpenQrScanner,
}) => {
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('program');
  const [copiedToast, setCopiedToast] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [attendeeFilter, setAttendeeFilter] = useState<'all' | 'checked' | 'pending'>('all');
  const [timeRange, setTimeRange] = useState<TimeRange>('7D');

  // Add Program Block inline state
  const [addingBlock, setAddingBlock] = useState(false);
  const [newBlockTime, setNewBlockTime] = useState('04:00 - 05:00');
  const [newBlockTitle, setNewBlockTitle] = useState('');
  const [newBlockLead, setNewBlockLead] = useState('');
  const [newBlockStage, setNewBlockStage] = useState('Main Auditorium');

  // Walk-in guest inline form state
  const [addingWalkIn, setAddingWalkIn] = useState(false);
  const [walkInName, setWalkInName] = useState('');
  const [walkInPhone, setWalkInPhone] = useState('');
  const [walkInEmail, setWalkInEmail] = useState('');
  const [walkInTier, setWalkInTier] = useState<AttendeeTier>('General');

  // Message automations state
  const [confirmationTemplate, setConfirmationTemplate] = useState(
    `Hi {name}, you're confirmed for ${event.title} on ${event.date} at ${event.venue}!`
  );
  const [reminderTemplate, setReminderTemplate] = useState(
    `Reminder: ${event.title} starts tomorrow at ${event.time}. Show your QR pass at the gate.`
  );
  const [editingReminder, setEditingReminder] = useState(false);
  const [thankYouSent, setThankYouSent] = useState(false);
  const [actionToast, setActionToast] = useState<string | null>(null);

  useEffect(() => {
    setConfirmationTemplate(
      `Hi {name}, you're confirmed for ${event.title} on ${event.date} at ${event.venue}!`
    );
    setReminderTemplate(
      `Reminder: ${event.title} starts tomorrow at ${event.time}. Show your QR pass at the gate.`
    );
    setThankYouSent(false);
  }, [event.id, event.title, event.date, event.venue, event.time]);

  const triggerToast = (msg: string) => {
    setActionToast(msg);
    setTimeout(() => setActionToast(null), 2600);
  };

  const eventBlocks = useMemo(
    () => scheduleBlocks.filter((b) => b.eventId === event.id),
    [scheduleBlocks, event.id]
  );

  const eventAttendees = useMemo(
    () => attendees.filter((a) => a.eventId === event.id),
    [attendees, event.id]
  );

  const checkedInRosterCount = useMemo(
    () => eventAttendees.filter((a) => a.checkedIn).length,
    [eventAttendees]
  );

  // Use event's summary numbers or live roster numbers seamlessly
  const totalRegistered = Math.max(event.registered, eventAttendees.length);
  const totalCheckedIn = Math.max(event.checkedIn, checkedInRosterCount);
  const capacityPct = Math.min(
    100,
    Math.round((totalRegistered / Math.max(1, event.capacity)) * 100)
  );
  const turnoutPct =
    totalRegistered > 0 ? Math.min(100, Math.round((totalCheckedIn / totalRegistered) * 100)) : 0;
  const spotsLeft = Math.max(0, event.capacity - totalRegistered);

  const filteredAttendees = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return eventAttendees.filter((a) => {
      const matchesFilter =
        attendeeFilter === 'all' ||
        (attendeeFilter === 'checked' ? a.checkedIn : !a.checkedIn);
      const matchesSearch =
        !q ||
        a.name.toLowerCase().includes(q) ||
        a.email.toLowerCase().includes(q) ||
        a.phone.toLowerCase().includes(q);
      return matchesFilter && matchesSearch;
    });
  }, [eventAttendees, attendeeFilter, searchQuery]);

  const handleCopyLink = () => {
    const url = `${window.location.origin}/e/${event.slug}`;
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(url).catch(() => {});
    }
    setCopiedToast(true);
    setTimeout(() => setCopiedToast(false), 2000);
  };

  const handleExportCsv = () => {
    const headers = ['Name', 'Email', 'Phone', 'Tier', 'TicketCode', 'CheckedIn'];
    const rows = eventAttendees.map((a) => [
      a.name,
      a.email,
      a.phone,
      a.tier,
      a.ticketCode,
      a.checkedIn ? 'Yes' : 'No',
    ]);
    const csv = [headers.join(','), ...rows.map((r) => r.map((c) => `"${c}"`).join(','))].join(
      '\n'
    );
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${event.slug}-attendees.csv`;
    link.click();
    URL.revokeObjectURL(url);
    triggerToast(`Exported ${eventAttendees.length} attendees to CSV`);
  };

  const handleDownloadQrSvg = () => {
    const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#FFFFFF"/><path d="M10 10 h24 v24 h-24 z M14 14 h16 v16 h-16 z M18 18 h8 v8 h-8 z" fill="#0B0B0B"/><path d="M66 10 h24 v24 h-24 z M70 14 h16 v16 h-16 z M74 18 h8 v8 h-8 z" fill="#0B0B0B"/><path d="M10 66 h24 v24 h-24 z M14 70 h16 v16 h-16 z M18 74 h8 v8 h-8 z" fill="#0B0B0B"/><rect fill="#0B0B0B" height="6" width="6" x="40" y="12"/><rect fill="#0B0B0B" height="6" width="6" x="50" y="12"/><rect fill="#0B0B0B" height="6" width="8" x="44" y="24"/><rect fill="#0B0B0B" height="8" width="6" x="12" y="44"/><rect fill="#0B0B0B" height="6" width="8" x="24" y="42"/><rect fill="#0B0B0B" height="8" width="8" x="40" y="40"/><rect fill="#0B0B0B" height="6" width="6" x="52" y="44"/><rect fill="#0B0B0B" height="6" width="10" x="66" y="40"/><rect fill="#0B0B0B" height="6" width="8" x="80" y="44"/><rect fill="#0B0B0B" height="8" width="6" x="44" y="56"/><rect fill="#0B0B0B" height="6" width="8" x="60" y="54"/><rect fill="#0B0B0B" height="6" width="6" x="74" y="58"/><rect fill="#0B0B0B" height="8" width="6" x="40" y="70"/><rect fill="#0B0B0B" height="6" width="8" x="54" y="72"/><rect fill="#0B0B0B" height="8" width="10" x="68" y="70"/><rect fill="#0B0B0B" height="8" width="6" x="82" y="76"/><rect fill="#0B0B0B" height="6" width="10" x="44" y="84"/><rect fill="#0B0B0B" height="6" width="6" x="60" y="84"/></svg>`;
    const blob = new Blob([svgContent], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${event.slug}-gate-qr.svg`;
    link.click();
    URL.revokeObjectURL(url);
    triggerToast('Gate Check-in SVG QR downloaded');
  };

  const handleAddBlockSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newBlockTitle.trim()) return;
    onAddScheduleBlock({
      id: `sch-${Date.now()}`,
      eventId: event.id,
      time: newBlockTime.trim() || '04:00 - 05:00',
      duration: '60m',
      title: newBlockTitle.trim(),
      stage: newBlockStage.trim() || 'Main Hall',
      lead: newBlockLead.trim() || profile.name,
      completed: false,
      day: 'Sat',
    });
    setNewBlockTitle('');
    setNewBlockLead('');
    setAddingBlock(false);
    triggerToast('Program block added');
  };

  const handleWalkInSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!onRegisterAttendee || !walkInName.trim() || !walkInPhone.trim()) return;
    const normalizedPhone = normalizePhoneE164(walkInPhone);
    const code = `EV-${Math.floor(1000 + Math.random() * 9000)}`;
    const nowTime = new Date().toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
    });
    onRegisterAttendee(event.id, {
      id: `att-${Date.now()}`,
      eventId: event.id,
      name: walkInName.trim(),
      email: walkInEmail.trim() || `${walkInName.trim().toLowerCase().replace(/\s+/g, '.')}@guest.africa`,
      phone: normalizedPhone,
      organization: 'Gate Walk-In',
      tier: walkInTier,
      ticketCode: code,
      checkedIn: true,
      checkedInAt: nowTime,
      paymentStatus: 'paid',
      smsStatus: 'Arkesel Sent',
    });
    setWalkInName('');
    setWalkInPhone('');
    setWalkInEmail('');
    setAddingWalkIn(false);
    triggerToast(`Walk-in checked in (${code})`);
  };

  const smsSegments = Math.max(1, Math.ceil(confirmationTemplate.length / 160));

  return (
    <div className="space-y-6">
      {/* Top Studio Header Row */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBackToEvents}
            className="px-3.5 py-2 rounded-full bg-[#F5F5F7] hover:bg-[#EEEEF0] text-xs font-semibold text-[#0B0B0B] inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            All Productions
          </button>
          <span className="text-xs font-semibold uppercase tracking-wider text-[#71717A]">
            Creator Studio
          </span>
        </div>

        <div className="lg:w-[460px]">
          <TopUtilityBar
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            searchPlaceholder="Search events or attendees..."
            alerts={alerts}
            onResolveAlert={onResolveAlert}
            onInspectAlertEvent={(id) => {
              const found = events.find((e) => e.id === id);
              if (found) onSelectAlertEvent(found);
            }}
            profile={profile}
            onOpenSettings={onNavigateSettings}
          />
        </div>
      </div>

      {actionToast && (
        <div className="fixed bottom-6 right-6 z-50 px-5 py-3 rounded-full bg-[#0B0B0B] text-white text-xs font-semibold shadow-xl">
          {actionToast}
        </div>
      )}

      {/* Event Header & Context Bar */}
      <section className="w-full bg-[#F5F5F7] rounded-[32px] p-6 sm:p-8 relative overflow-hidden">
        {/* Top Action Row */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-6">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#0B0B0B] text-white text-xs font-semibold capitalize">
              <span
                className={`w-2 h-2 rounded-full ${
                  event.status === 'live' ? 'bg-emerald-400' : 'bg-zinc-400'
                }`}
              />
              {event.status === 'live' ? 'Published' : event.status}
            </span>
            <button
              type="button"
              onClick={onPreviewPublicEvent}
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#E8E8EA] text-[#1A1C1D] hover:bg-[#E2E2E4] text-[11px] font-mono tracking-wide transition-colors"
            >
              <Link2 className="w-3.5 h-3.5" />
              /e/{event.slug}
            </button>
            <button
              type="button"
              onClick={handleCopyLink}
              className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-white text-[#0B0B0B] hover:bg-[#E8E8EA] transition-colors text-[11px] font-medium shadow-sm"
            >
              <Copy className="w-3.5 h-3.5" />
              Copy Link
            </button>
            {copiedToast && (
              <span className="text-[11px] font-semibold text-[#0B0B0B]">Copied!</span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {onOpenQrScanner && (
              <button
                type="button"
                onClick={() => onOpenQrScanner(event.id)}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[#0B0B0B] text-white hover:bg-neutral-800 transition-colors text-xs font-semibold shadow-sm whitespace-nowrap shrink-0"
              >
                <QrCode className="w-4 h-4" />
                QR Gate Scanner
              </button>
            )}
            <button
              type="button"
              onClick={handleDownloadQrSvg}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white text-[#0B0B0B] hover:bg-[#E8E8EA] transition-colors text-xs font-semibold shadow-sm whitespace-nowrap shrink-0"
            >
              <QrCode className="w-4 h-4" />
              Badge QR
            </button>
            <button
              type="button"
              onClick={() => onOpenEditModal(event)}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white text-[#0B0B0B] hover:bg-[#E8E8EA] transition-all text-xs font-semibold shadow-sm whitespace-nowrap shrink-0"
            >
              <Edit3 className="w-4 h-4" />
              Edit Event
            </button>
          </div>
        </div>

        {/* Title & Logistics + Quick Metrics Counter Badges */}
        <div className="flex flex-col xl:flex-row xl:items-end justify-between gap-6">
          <div className="max-w-2xl">
            <div className="text-[11px] font-medium uppercase text-[#71717A] tracking-wider mb-1">
              Creator Workspace
            </div>
            <h1 className="font-display text-[28px] sm:text-[36px] leading-tight font-bold text-[#0B0B0B] tracking-[-0.03em] mb-2">
              {event.title}
            </h1>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[13px] text-[#71717A]">
              <span className="inline-flex items-center gap-1.5 tabular-nums">
                <Calendar className="w-4 h-4 text-[#0B0B0B]" />
                {event.date}
              </span>
              <span aria-hidden="true">·</span>
              <span className="inline-flex items-center gap-1.5 tabular-nums">
                <Clock className="w-4 h-4 text-[#0B0B0B]" />
                {event.time}
              </span>
              <span aria-hidden="true">·</span>
              <span className="inline-flex items-center gap-1.5">
                <MapPin className="w-4 h-4 text-[#0B0B0B]" />
                {event.venue}
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <div className="px-4 py-2.5 rounded-full bg-white shadow-sm flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-[#F5F5F7] flex items-center justify-center text-[#0B0B0B] text-xs font-bold tabular-nums">
                {capacityPct}%
              </div>
              <div className="flex flex-col">
                <span className="text-xs font-semibold text-[#0B0B0B] tabular-nums">
                  {totalRegistered} / {event.capacity} Attendees
                </span>
                <span className="text-[11px] text-[#71717A]">{profile.plan} Capacity</span>
              </div>
            </div>

            <div className="px-4 py-2.5 rounded-full bg-white shadow-sm flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-[#0B0B0B] text-white flex items-center justify-center text-xs font-bold tabular-nums">
                {turnoutPct}%
              </div>
              <div className="flex flex-col">
                <span className="text-xs font-semibold text-[#0B0B0B] tabular-nums">
                  {totalCheckedIn} Checked In
                </span>
                <span className="text-[11px] text-[#71717A]">Real-time Turnout</span>
              </div>
            </div>

            <button
              type="button"
              onClick={onOpenPlans}
              className="px-4 py-2.5 rounded-full bg-white shadow-sm flex items-center gap-3 text-left hover:bg-[#E8E8EA] transition-colors"
            >
              <MessageSquare className="w-4.5 h-4.5 text-[#0B0B0B]" />
              <div className="flex flex-col">
                <span className="text-xs font-semibold text-[#0B0B0B] tabular-nums">
                  {profile.smsCredits.toLocaleString()} Credits Left
                </span>
                <span className="text-[11px] text-[#71717A]">SMS Balance · Top Up</span>
              </div>
            </button>
          </div>
        </div>
      </section>

      {/* Workspace Sub-Navigation Tabs */}
      <div className="w-full flex items-center gap-2 overflow-x-auto pb-1">
        {(
          [
            { id: 'overview', label: 'Overview & Details' },
            { id: 'program', label: 'Program Builder', icon: LayoutGrid },
            { id: 'messages', label: 'Message Templates' },
            { id: 'attendees', label: 'Attendees', count: totalRegistered },
            { id: 'analytics', label: 'Analytics Dashboard' },
            { id: 'share', label: 'Share & QR' },
          ] as const
        ).map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`px-5 py-2 rounded-full text-xs font-semibold transition-all whitespace-nowrap shrink-0 flex items-center gap-2 ${
                isActive
                  ? 'bg-[#0B0B0B] text-white shadow-sm'
                  : 'bg-[#F5F5F7] hover:bg-[#E8E8EA] text-[#0B0B0B]'
              }`}
            >
              {'icon' in tab && tab.icon && <tab.icon className="w-3.5 h-3.5" />}
              <span>{tab.label}</span>
              {'count' in tab && tab.count !== undefined && (
                <span
                  className={`px-2 py-0.5 rounded-full text-[11px] tabular-nums ${
                    isActive ? 'bg-white/20 text-white' : 'bg-white text-[#0B0B0B]'
                  }`}
                >
                  {tab.count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Main Multi-Zone Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left / Primary Column (Span 8) */}
        <div className="lg:col-span-8 flex flex-col gap-6 min-w-0">
          {/* Overview Banner when Overview tab active */}
          {activeTab === 'overview' && (
            <section className="bg-[#F5F5F7] rounded-[28px] p-6 sm:p-8 space-y-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h2 className="font-display text-[22px] font-bold text-[#0B0B0B] tracking-[-0.02em]">
                    Event Summary &amp; Landing Page
                  </h2>
                  <p className="text-sm text-[#71717A] mt-1">{event.subtitle}</p>
                </div>
                <button
                  type="button"
                  onClick={onPreviewPublicEvent}
                  className="px-4 py-2 rounded-full bg-[#0B0B0B] text-white text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
                >
                  <span>Open /e/{event.slug}</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
                <div className="p-4 rounded-2xl bg-white">
                  <span className="text-[11px] text-[#71717A] block">Organizer</span>
                  <span className="text-sm font-semibold text-[#0B0B0B]">{event.organizer}</span>
                </div>
                <div className="p-4 rounded-2xl bg-white">
                  <span className="text-[11px] text-[#71717A] block">SMS Dispatched</span>
                  <span className="text-sm font-semibold text-[#0B0B0B] tabular-nums">
                    {event.smsDispatched} passes sent
                  </span>
                </div>
                <div className="p-4 rounded-2xl bg-white">
                  <span className="text-[11px] text-[#71717A] block">Ticket Pricing</span>
                  <span className="text-sm font-semibold text-[#0B0B0B] tabular-nums">
                    {event.ticketPrice === 0 ? 'Free Admission' : `$${event.ticketPrice}`}
                  </span>
                </div>
              </div>
            </section>
          )}

          {/* Analytics Panel when Analytics tab active */}
          {activeTab === 'analytics' && (
            <section className="bg-[#F5F5F7] rounded-[28px] p-6 sm:p-8 space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="font-display text-[22px] font-bold text-[#0B0B0B] tracking-[-0.02em]">
                    Registration &amp; Gate Velocity
                  </h2>
                  <p className="text-[13px] text-[#71717A]">
                    Ticket claim velocity vs. live gate scan arrivals
                  </p>
                </div>
                <div className="flex items-center gap-1 p-1 bg-white rounded-full border border-[#E5E5EA]">
                  {(['7D', '30D', '90D'] as TimeRange[]).map((range) => (
                    <button
                      key={range}
                      type="button"
                      onClick={() => setTimeRange(range)}
                      className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors ${
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
              <div className="bg-white rounded-2xl p-4">
                <SplineChart data={VELOCITY_SERIES[timeRange]} />
              </div>
            </section>
          )}

          {/* Program Builder Panel (Shown on Program, Overview) */}
          {(activeTab === 'program' || activeTab === 'overview') && (
            <section className="bg-[#F5F5F7] rounded-[28px] p-6 sm:p-8 flex flex-col gap-4 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-[#0B0B0B] text-white flex items-center justify-center shrink-0">
                    <Calendar className="w-5 h-5" />
                  </div>
                  <div>
                    <h2 className="font-display text-[22px] leading-7 font-bold text-[#0B0B0B] tracking-[-0.02em]">
                      Program Schedule
                    </h2>
                    <p className="text-[13px] text-[#71717A] tabular-nums">
                      {eventBlocks.length} scheduled production blocks · Total duration: 8h 00m
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setAddingBlock((p) => !p)}
                  className="px-4 py-2 rounded-full bg-[#0B0B0B] text-white hover:opacity-90 text-xs font-semibold flex items-center gap-1.5 transition-all shadow-sm whitespace-nowrap shrink-0"
                >
                  <Plus className="w-4 h-4" />
                  <span>{addingBlock ? 'Close' : 'Add Item'}</span>
                </button>
              </div>

              {addingBlock && (
                <form
                  onSubmit={handleAddBlockSubmit}
                  className="p-4 rounded-2xl bg-white grid grid-cols-1 sm:grid-cols-2 gap-3"
                >
                  <input
                    type="text"
                    required
                    value={newBlockTitle}
                    onChange={(e) => setNewBlockTitle(e.target.value)}
                    placeholder="Session title (e.g. Closing Fireside Chat)"
                    className="sm:col-span-2 h-10 px-4 rounded-full bg-[#F5F5F7] text-xs text-[#0B0B0B] placeholder:text-[#71717A] focus:outline-none focus:ring-1 focus:ring-[#0B0B0B]"
                  />
                  <input
                    type="text"
                    value={newBlockTime}
                    onChange={(e) => setNewBlockTime(e.target.value)}
                    placeholder="04:00 - 05:00"
                    className="h-10 px-4 rounded-full bg-[#F5F5F7] text-xs font-mono text-[#0B0B0B] focus:outline-none focus:ring-1 focus:ring-[#0B0B0B]"
                  />
                  <input
                    type="text"
                    value={newBlockLead}
                    onChange={(e) => setNewBlockLead(e.target.value)}
                    placeholder="Speaker / Host"
                    className="h-10 px-4 rounded-full bg-[#F5F5F7] text-xs text-[#0B0B0B] focus:outline-none focus:ring-1 focus:ring-[#0B0B0B]"
                  />
                  <input
                    type="text"
                    value={newBlockStage}
                    onChange={(e) => setNewBlockStage(e.target.value)}
                    placeholder="Room / Stage"
                    className="h-10 px-4 rounded-full bg-[#F5F5F7] text-xs text-[#0B0B0B] focus:outline-none focus:ring-1 focus:ring-[#0B0B0B]"
                  />
                  <button
                    type="submit"
                    className="h-10 px-5 rounded-full bg-[#0B0B0B] text-white text-xs font-semibold hover:bg-neutral-800 transition-colors"
                  >
                    Save Program Block
                  </button>
                </form>
              )}

              {/* Schedule Items Flow */}
              <div className="flex flex-col gap-2.5 mt-1">
                {eventBlocks.length === 0 ? (
                  <div className="p-6 rounded-2xl bg-white text-center text-xs text-[#71717A]">
                    No sessions scheduled for this event yet. Click &ldquo;Add Item&rdquo; to
                    create the first program block.
                  </div>
                ) : (
                  eventBlocks.map((block) => (
                    <div
                      key={block.id}
                      className="group flex flex-col md:flex-row md:items-center justify-between p-4 rounded-2xl bg-white hover:shadow-md transition-all gap-3"
                    >
                      <div className="flex items-start md:items-center gap-3 min-w-0">
                        <GripVertical className="w-4.5 h-4.5 text-[#71717A] shrink-0 mt-1 md:mt-0" />
                        <div className="px-3 py-1 rounded-full bg-[#F5F5F7] text-xs font-semibold text-[#0B0B0B] shrink-0 tabular-nums font-mono">
                          {block.time}
                        </div>
                        <div className="flex flex-col min-w-0">
                          <span
                            className={`text-sm sm:text-base font-semibold text-[#0B0B0B] ${
                              block.completed ? '' : ''
                            }`}
                          >
                            {block.title}
                          </span>
                          <div className="flex flex-wrap items-center gap-2 mt-0.5">
                            <span className="text-[11px] text-[#0B0B0B] font-semibold">
                              {block.lead}
                            </span>
                            <span className="text-[#71717A] text-[10px]">•</span>
                            <span className="text-[11px] text-[#71717A]">{block.stage}</span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center justify-end gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => onToggleScheduleBlock(block.id)}
                          title={block.completed ? 'Mark upcoming' : 'Mark complete'}
                          className={`px-3 py-1.5 rounded-full text-[11px] font-semibold inline-flex items-center gap-1 transition-colors ${
                            block.completed
                              ? 'bg-[#0B0B0B] text-white'
                              : 'bg-[#F5F5F7] text-[#0B0B0B] hover:bg-[#E8E8EA]'
                          }`}
                        >
                          <Check className="w-3 h-3" />
                          <span>{block.completed ? 'Ready' : 'Confirm'}</span>
                        </button>
                        {onDeleteScheduleBlock && (
                          <button
                            type="button"
                            onClick={() => onDeleteScheduleBlock(block.id)}
                            aria-label="Delete session"
                            className="w-8 h-8 rounded-full bg-[#F5F5F7] flex items-center justify-center hover:bg-[#EF4444]/10 hover:text-[#EF4444] text-[#71717A] transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>
          )}

          {/* Attendees & Real-Time Check-In Module (Shown on Program, Attendees, Overview) */}
          {(activeTab === 'program' ||
            activeTab === 'attendees' ||
            activeTab === 'overview') && (
            <section className="bg-[#F5F5F7] rounded-[28px] p-6 sm:p-8 flex flex-col gap-4 shadow-sm">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h2 className="font-display text-[22px] leading-7 font-bold text-[#0B0B0B] tracking-[-0.02em]">
                    Gate Check-In &amp; Registrations
                  </h2>
                  <p className="text-[13px] text-[#71717A]">
                    Real-time QR pass verification, walk-in registration &amp; live gate toggle
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {onOpenQrScanner && (
                    <button
                      type="button"
                      onClick={() => onOpenQrScanner(event.id)}
                      className="px-4 py-2 rounded-full bg-[#0B0B0B] text-white text-xs font-semibold hover:opacity-90 transition-all inline-flex items-center gap-1.5 whitespace-nowrap"
                    >
                      <QrCode className="w-3.5 h-3.5" />
                      <span>Open QR Scanner</span>
                    </button>
                  )}
                  {onRegisterAttendee && (
                    <button
                      type="button"
                      onClick={() => setAddingWalkIn((p) => !p)}
                      className="px-4 py-2 rounded-full bg-white text-[#0B0B0B] border border-[#E5E5EA] hover:border-[#0B0B0B] text-xs font-semibold transition-all inline-flex items-center gap-1.5 whitespace-nowrap"
                    >
                      <UserPlus className="w-3.5 h-3.5" />
                      <span>{addingWalkIn ? 'Close Form' : 'Check-In Registration'}</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() =>
                      onOpenCsvExport ? onOpenCsvExport(event.id) : handleExportCsv()
                    }
                    className="relative inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-white text-[#0B0B0B] text-xs font-semibold hover:bg-[#E8E8EA] transition-colors shadow-sm whitespace-nowrap"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Export CSV</span>
                    <span className="px-1.5 py-0.5 rounded-full bg-[#0B0B0B] text-white text-[10px] tracking-widest uppercase">
                      Pro
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab('attendees')}
                    className="px-4 py-2 rounded-full bg-[#E8E8EA] text-[#0B0B0B] text-xs font-semibold hover:bg-white transition-colors whitespace-nowrap"
                  >
                    View All {totalRegistered}
                  </button>
                </div>
              </div>

              {addingWalkIn && onRegisterAttendee && (
                <form
                  onSubmit={handleWalkInSubmit}
                  className="p-4 rounded-2xl bg-white grid grid-cols-1 sm:grid-cols-2 gap-3"
                >
                  <input
                    type="text"
                    required
                    value={walkInName}
                    onChange={(e) => setWalkInName(e.target.value)}
                    placeholder="Walk-in guest full name"
                    className="h-10 px-4 rounded-full bg-[#F5F5F7] text-xs text-[#0B0B0B] placeholder:text-[#71717A] focus:outline-none focus:ring-1 focus:ring-[#0B0B0B]"
                  />
                  <input
                    type="tel"
                    required
                    value={walkInPhone}
                    onChange={(e) => setWalkInPhone(e.target.value)}
                    placeholder="Phone (e.g. 024 555 0199)"
                    className="h-10 px-4 rounded-full bg-[#F5F5F7] text-xs font-mono text-[#0B0B0B] placeholder:text-[#71717A] focus:outline-none focus:ring-1 focus:ring-[#0B0B0B]"
                  />
                  <input
                    type="email"
                    value={walkInEmail}
                    onChange={(e) => setWalkInEmail(e.target.value)}
                    placeholder="Email (optional)"
                    className="h-10 px-4 rounded-full bg-[#F5F5F7] text-xs text-[#0B0B0B] placeholder:text-[#71717A] focus:outline-none focus:ring-1 focus:ring-[#0B0B0B]"
                  />
                  <div className="flex items-center gap-2">
                    <select
                      value={walkInTier}
                      onChange={(e) => setWalkInTier(e.target.value as AttendeeTier)}
                      className="h-10 px-3 rounded-full bg-[#F5F5F7] text-xs font-semibold text-[#0B0B0B] focus:outline-none"
                    >
                      <option value="General">General</option>
                      <option value="VIP">VIP</option>
                      <option value="Speaker">Speaker</option>
                      <option value="Press">Press</option>
                    </select>
                    <button
                      type="submit"
                      className="flex-1 h-10 px-4 rounded-full bg-[#0B0B0B] text-white text-xs font-semibold hover:bg-neutral-800 transition-colors whitespace-nowrap"
                    >
                      Register &amp; Check In
                    </button>
                  </div>
                </form>
              )}

              {/* Filter & Search Controls */}
              <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-1">
                <div className="flex items-center gap-1 bg-white p-1 rounded-full w-full sm:w-auto shadow-sm overflow-x-auto">
                  <button
                    type="button"
                    onClick={() => setAttendeeFilter('all')}
                    className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-all whitespace-nowrap ${
                      attendeeFilter === 'all'
                        ? 'bg-[#0B0B0B] text-white'
                        : 'text-[#71717A] hover:text-[#0B0B0B]'
                    }`}
                  >
                    All ({eventAttendees.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setAttendeeFilter('checked')}
                    className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-all whitespace-nowrap ${
                      attendeeFilter === 'checked'
                        ? 'bg-[#0B0B0B] text-white'
                        : 'text-[#71717A] hover:text-[#0B0B0B]'
                    }`}
                  >
                    Checked In ({checkedInRosterCount})
                  </button>
                  <button
                    type="button"
                    onClick={() => setAttendeeFilter('pending')}
                    className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-all whitespace-nowrap ${
                      attendeeFilter === 'pending'
                        ? 'bg-[#0B0B0B] text-white'
                        : 'text-[#71717A] hover:text-[#0B0B0B]'
                    }`}
                  >
                    Pending ({Math.max(0, eventAttendees.length - checkedInRosterCount)})
                  </button>
                </div>

                <div className="relative w-full sm:w-64">
                  <Search className="w-4 h-4 text-[#71717A] absolute left-3.5 top-2.5 pointer-events-none" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search attendee..."
                    className="w-full bg-white rounded-full pl-9 pr-4 py-2 text-[13px] text-[#0B0B0B] placeholder:text-[#71717A] focus:outline-none focus:ring-1 focus:ring-[#0B0B0B] shadow-sm"
                  />
                </div>
              </div>

              {/* Attendee Table Rows */}
              <div className="flex flex-col gap-2 mt-1">
                {filteredAttendees.length === 0 ? (
                  <div className="p-6 rounded-2xl bg-white text-center text-xs text-[#71717A]">
                    No attendees match the current filter for this event.
                  </div>
                ) : (
                  filteredAttendees.map((att) => {
                    const initials = att.name
                      .split(' ')
                      .map((p) => p[0])
                      .join('')
                      .slice(0, 2)
                      .toUpperCase();
                    return (
                      <div
                        key={att.id}
                        className="flex flex-col sm:flex-row sm:items-center justify-between p-4 rounded-2xl bg-white gap-3 hover:shadow-md transition-all"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-10 h-10 rounded-full bg-[#E8E8EA] text-[#0B0B0B] flex items-center justify-center font-semibold text-sm shrink-0">
                            {initials}
                          </div>
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-sm sm:text-base font-semibold text-[#0B0B0B]">
                                {att.name}
                              </span>
                              {att.checkedIn ? (
                                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-[#E8E8EA] text-[#0B0B0B] text-[11px] font-medium tabular-nums">
                                  <span className="w-1.5 h-1.5 rounded-full bg-[#0B0B0B]" />
                                  Checked In {att.checkedInAt || 'Today'}
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-[#E8E8EA] text-[#71717A] text-[11px] font-medium">
                                  Pending Arrival
                                </span>
                              )}
                            </div>
                            <div className="text-[13px] text-[#71717A] truncate font-mono">
                              {att.phone} · {att.email}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
                          <button
                            type="button"
                            onClick={() => onToggleCheckIn(att.id)}
                            className={`px-4 py-1.5 rounded-full text-xs font-semibold flex items-center gap-1.5 transition-all whitespace-nowrap ${
                              att.checkedIn
                                ? 'bg-[#0B0B0B] text-white'
                                : 'bg-[#F5F5F7] hover:bg-[#0B0B0B] hover:text-white text-[#0B0B0B]'
                            }`}
                          >
                            {att.checkedIn ? (
                              <>
                                <Check className="w-3.5 h-3.5" />
                                <span>Checked In</span>
                              </>
                            ) : (
                              <>
                                <QrCode className="w-3.5 h-3.5" />
                                <span>Check In</span>
                              </>
                            )}
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </section>
          )}

          {/* Dedicated Message Editor when Message Templates tab active */}
          {activeTab === 'messages' && (
            <section className="bg-[#F5F5F7] rounded-[28px] p-6 sm:p-8 space-y-4">
              <h2 className="font-display text-[22px] font-bold text-[#0B0B0B] tracking-[-0.02em]">
                Arkesel SMS &amp; Resend Template Studio
              </h2>
              <div className="p-4 rounded-2xl bg-white space-y-3">
                <div className="flex items-center justify-between text-xs font-semibold">
                  <span>Confirmation SMS Template</span>
                  <span className="text-[#71717A] tabular-nums">
                    {smsSegments} SMS segment · {confirmationTemplate.length} / 160 chars
                  </span>
                </div>
                <textarea
                  rows={3}
                  value={confirmationTemplate}
                  onChange={(e) => setConfirmationTemplate(e.target.value)}
                  className="w-full p-3.5 rounded-2xl bg-[#F5F5F7] text-xs text-[#0B0B0B] focus:outline-none focus:ring-1 focus:ring-[#0B0B0B]"
                />
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => triggerToast('SMS Confirmation template saved')}
                    className="px-4 py-2 rounded-full bg-[#0B0B0B] text-white text-xs font-semibold"
                  >
                    Save Template
                  </button>
                </div>
              </div>
            </section>
          )}

          {/* Share & QR expanded view */}
          {activeTab === 'share' && (
            <section className="bg-[#F5F5F7] rounded-[28px] p-6 sm:p-8 space-y-4">
              <h2 className="font-display text-[22px] font-bold text-[#0B0B0B] tracking-[-0.02em]">
                Public RSVP Link &amp; Check-In Kiosk
              </h2>
              <div className="p-4 rounded-2xl bg-white flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <span className="text-xs font-semibold text-[#0B0B0B] block">
                    Live Attendee Registration URL
                  </span>
                  <span className="text-xs font-mono text-[#71717A]">
                    https://eventsapp.africa/e/{event.slug}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleCopyLink}
                    className="px-4 py-2 rounded-full bg-[#F5F5F7] text-xs font-semibold text-[#0B0B0B]"
                  >
                    Copy URL
                  </button>
                  <button
                    type="button"
                    onClick={onPreviewPublicEvent}
                    className="px-4 py-2 rounded-full bg-[#0B0B0B] text-white text-xs font-semibold"
                  >
                    Launch Demo
                  </button>
                </div>
              </div>
            </section>
          )}
        </div>

        {/* Right / Secondary Column (Span 4) */}
        <div className="lg:col-span-4 flex flex-col gap-6">
          {/* Capacity Limit Alert Card */}
          <section className="bg-[#F5F5F7] rounded-[28px] p-6 relative overflow-hidden shadow-sm">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-full bg-[#EF4444]/10 text-[#EF4444] flex items-center justify-center shrink-0">
                <AlertTriangle className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-[#0B0B0B] tabular-nums">
                  {spotsLeft} Spots Remaining
                </h3>
                <p className="text-[13px] text-[#71717A] mt-1 leading-relaxed">
                  {profile.plan === 'Starter'
                    ? 'Your free tier limit is capped at 50 attendees. Once full, attendee registration will pause automatically.'
                    : `Capacity at ${capacityPct}% (${totalRegistered}/${event.capacity}). Upgrade tier for multi-gate unlimited bursts.`}
                </p>
              </div>
            </div>
            <div className="mt-4 pt-3 flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-[#0B0B0B]">
                Upgrade to Pro ($19/mo)
              </span>
              <button
                type="button"
                onClick={onOpenPlans}
                className="px-4 py-1.5 rounded-full bg-[#0B0B0B] text-white text-xs font-semibold hover:opacity-90 transition-all shrink-0"
              >
                Upgrade
              </button>
            </div>
          </section>

          {/* Message Automations Card */}
          <section className="bg-[#F5F5F7] rounded-[28px] p-6 flex flex-col gap-4 shadow-sm">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-[#0B0B0B] text-white flex items-center justify-center">
                  <Send className="w-4 h-4" />
                </div>
                <h2 className="text-base font-semibold text-[#0B0B0B]">Message Automations</h2>
              </div>
              <span className="text-[11px] text-[#71717A] font-medium">SMS &amp; Email</span>
            </div>

            <div className="space-y-3">
              {/* Flow 1: Confirmation SMS */}
              <div className="p-3.5 bg-white rounded-2xl">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-semibold text-[#0B0B0B]">Confirmation SMS</span>
                  <span className="inline-flex items-center gap-1 text-[11px] text-[#0B0B0B] font-semibold">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Active
                  </span>
                </div>
                <p className="text-[11px] text-[#71717A] mb-2 tabular-nums">
                  {smsSegments} SMS segment · {confirmationTemplate.length} / 160 characters
                </p>
                <div className="p-2.5 rounded-xl bg-[#F5F5F7] text-xs text-[#1A1C1D] italic">
                  &ldquo;{confirmationTemplate}&rdquo;
                </div>
              </div>

              {/* Flow 2: 24h Event Reminder */}
              <div className="p-3.5 bg-white rounded-2xl">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-semibold text-[#0B0B0B]">24h Event Reminder</span>
                  <span className="text-[11px] text-[#71717A] tabular-nums">
                    {event.date} · 09:00 AM
                  </span>
                </div>
                <p className="text-[11px] text-[#71717A] mb-1 tabular-nums">
                  Scheduled for {totalRegistered} registered attendees
                </p>
                {editingReminder ? (
                  <div className="mt-2 space-y-2">
                    <textarea
                      rows={2}
                      value={reminderTemplate}
                      onChange={(e) => setReminderTemplate(e.target.value)}
                      className="w-full p-2.5 rounded-xl bg-[#F5F5F7] text-[11px] text-[#0B0B0B] focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        setEditingReminder(false);
                        triggerToast('24h reminder template updated');
                      }}
                      className="px-3 py-1 rounded-full bg-[#0B0B0B] text-white text-[11px] font-semibold"
                    >
                      Save Reminder
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center justify-between text-[#71717A] text-[11px] mt-2">
                    <span>Auto-dispatch queued</span>
                    <button
                      type="button"
                      onClick={() => setEditingReminder(true)}
                      className="text-[#0B0B0B] underline font-semibold"
                    >
                      Edit Template
                    </button>
                  </div>
                )}
              </div>

              {/* Flow 3: Post-Event Thank You */}
              <div className="p-3.5 bg-white rounded-2xl">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-semibold text-[#0B0B0B]">
                    Post-Event Thank You
                  </span>
                  <span className="px-2 py-0.5 rounded-full bg-[#F5F5F7] text-[#0B0B0B] text-[11px] font-medium">
                    Send-once guard
                  </span>
                </div>
                <p className="text-[11px] text-[#71717A] tabular-nums">
                  Target: {totalRegistered} recipients · Cost: {totalRegistered} credits
                </p>
                <div className="mt-3 flex items-center justify-between">
                  <span className="text-[11px] text-[#71717A]">
                    Status: {thankYouSent ? 'Queued via Arkesel' : 'Paused'}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setThankYouSent(true);
                      triggerToast(`Post-event broadcast queued for ${totalRegistered} guests`);
                    }}
                    className="px-3 py-1.5 rounded-full bg-[#0B0B0B] text-white text-xs font-semibold hover:opacity-90"
                  >
                    {thankYouSent ? 'Queued ✓' : 'Setup Broadcast'}
                  </button>
                </div>
              </div>
            </div>
          </section>

          {/* Gate Check-in QR Card */}
          <section className="bg-[#F5F5F7] rounded-[28px] p-6 flex flex-col items-center text-center gap-4 shadow-sm">
            <div className="w-full flex items-center justify-between">
              <h2 className="text-base font-semibold text-[#0B0B0B]">Gate Check-in QR</h2>
              <ShieldCheck className="w-4.5 h-4.5 text-[#71717A]" />
            </div>

            <div className="p-4 bg-white rounded-2xl shadow-sm flex items-center justify-center">
              <svg className="w-40 h-40" fill="currentColor" viewBox="0 0 100 100" aria-hidden="true">
                <path d="M10 10 h24 v24 h-24 z M14 14 h16 v16 h-16 z M18 18 h8 v8 h-8 z" fill="#0B0B0B" />
                <path d="M66 10 h24 v24 h-24 z M70 14 h16 v16 h-16 z M74 18 h8 v8 h-8 z" fill="#0B0B0B" />
                <path d="M10 66 h24 v24 h-24 z M14 70 h16 v16 h-16 z M18 74 h8 v8 h-8 z" fill="#0B0B0B" />
                <rect fill="#0B0B0B" height="6" width="6" x="40" y="12" />
                <rect fill="#0B0B0B" height="6" width="6" x="50" y="12" />
                <rect fill="#0B0B0B" height="6" width="8" x="44" y="24" />
                <rect fill="#0B0B0B" height="8" width="6" x="12" y="44" />
                <rect fill="#0B0B0B" height="6" width="8" x="24" y="42" />
                <rect fill="#0B0B0B" height="8" width="8" x="40" y="40" />
                <rect fill="#0B0B0B" height="6" width="6" x="52" y="44" />
                <rect fill="#0B0B0B" height="6" width="10" x="66" y="40" />
                <rect fill="#0B0B0B" height="6" width="8" x="80" y="44" />
                <rect fill="#0B0B0B" height="8" width="6" x="44" y="56" />
                <rect fill="#0B0B0B" height="6" width="8" x="60" y="54" />
                <rect fill="#0B0B0B" height="6" width="6" x="74" y="58" />
                <rect fill="#0B0B0B" height="8" width="6" x="40" y="70" />
                <rect fill="#0B0B0B" height="6" width="8" x="54" y="72" />
                <rect fill="#0B0B0B" height="8" width="10" x="68" y="70" />
                <rect fill="#0B0B0B" height="8" width="6" x="82" y="76" />
                <rect fill="#0B0B0B" height="6" width="10" x="44" y="84" />
                <rect fill="#0B0B0B" height="6" width="6" x="60" y="84" />
              </svg>
            </div>

            <div className="w-full flex flex-col gap-1">
              <span className="text-[13px] font-semibold text-[#0B0B0B]">
                Kiosk &amp; Attendee Entry Pass
              </span>
              <p className="text-[11px] text-[#71717A]">
                Display at the registration reception for speedy self-scan check-ins
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2 w-full pt-1">
              <button
                type="button"
                onClick={handleDownloadQrSvg}
                className="py-2 px-3 rounded-full bg-white text-[#0B0B0B] hover:bg-[#E8E8EA] transition-colors text-xs font-semibold shadow-sm"
              >
                SVG Vector
              </button>
              <button
                type="button"
                onClick={() => {
                  triggerToast('Badge QR sheet prepared for printing');
                }}
                className="py-2 px-3 rounded-full bg-[#0B0B0B] text-white hover:opacity-90 transition-all text-xs font-semibold shadow-sm inline-flex items-center justify-center gap-1.5"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>Print Badge</span>
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};
