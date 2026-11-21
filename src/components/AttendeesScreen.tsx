import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Check, Download, Plus, QrCode, Send, UserPlus, X } from 'lucide-react';
import {
  Attendee,
  AttendeeTier,
  EventItem,
  OrganizerProfile,
  SystemAlert,
} from '../types/events';
import { getCategoryPreset, normalizePhoneE164 } from '../data/initialData';
import { calculateSmsCredits } from '../lib/eventMessages';
import { CircularGauge } from './MonochromeArtwork';
import { TopUtilityBar } from './TopUtilityBar';

interface AttendeesScreenProps {
  attendees: Attendee[];
  events: EventItem[];
  alerts: SystemAlert[];
  profile: OrganizerProfile;
  initialEventFilter?: string;
  onToggleCheckIn: (
    attendeeId: string
  ) =>
    | Promise<{
        checkInMessageSent?: boolean;
        checkInSmsSent?: boolean;
        cameraUrl?: string;
        dispatchedMessage?: string;
        smsSkippedReason?: string;
      } | void>
    | void;
  onRetryPayment: (attendeeId: string) => void;
  onRegisterAttendee: (eventId: string, attendee: Attendee) => void;
  onBroadcast?: (payload: {
    eventId?: string;
    attendeeIds: string[];
    message: string;
  }) => Promise<{
    ok: boolean;
    recipientCount: number;
    sentCount: number;
    creditsUsed?: number;
    smsCredits?: number;
  }>;
  onOpenPlans?: () => void;
  onManageEvent: (event: EventItem) => void;
  onOpenQrScanner?: (eventId?: string, code?: string) => void;
  onNavigateSettings: () => void;
  onResolveAlert: (id: string) => void;
  onOpenCsvExport?: (eventId?: string) => void;
}

export const AttendeesScreen: React.FC<AttendeesScreenProps> = ({
  attendees,
  events,
  alerts,
  profile,
  initialEventFilter = 'all',
  onToggleCheckIn,
  onRetryPayment,
  onRegisterAttendee,
  onBroadcast,
  onOpenPlans,
  onManageEvent,
  onOpenQrScanner,
  onNavigateSettings,
  onResolveAlert,
  onOpenCsvExport,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [quickScanInput, setQuickScanInput] = useState('');
  const [eventFilter, setEventFilter] = useState<string>(initialEventFilter);
  const [tierFilter, setTierFilter] = useState<'all' | AttendeeTier>('all');
  const [broadcastOpen, setBroadcastOpen] = useState(false);
  const [broadcastMsg, setBroadcastMsg] = useState(
    'Doors open 30 minutes prior to keynote. Keep your pass QR ready at Gate A.'
  );
  const [broadcastStatus, setBroadcastStatus] = useState<string | null>(null);
  const [broadcastError, setBroadcastError] = useState<string | null>(null);
  const [broadcastSending, setBroadcastSending] = useState(false);

  // Walk-in registration modal state
  const [walkInOpen, setWalkInOpen] = useState(false);
  const [walkInName, setWalkInName] = useState('');
  const [walkInPhone, setWalkInPhone] = useState('');
  const [walkInEmail, setWalkInEmail] = useState('');
  const [walkInOrg, setWalkInOrg] = useState('');
  const [walkInEventId, setWalkInEventId] = useState<string>(
    initialEventFilter !== 'all' ? initialEventFilter : events[0]?.id ?? ''
  );
  const [walkInTier, setWalkInTier] = useState<AttendeeTier>('General');
  const [walkInCheckedIn, setWalkInCheckedIn] = useState(true);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  useEffect(() => {
    setEventFilter(initialEventFilter);
    if (initialEventFilter !== 'all') {
      setWalkInEventId(initialEventFilter);
    }
  }, [initialEventFilter]);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 2400);
  };

  const isEventCreator = profile.appRole !== 'gate_staff';

  const eventMap = useMemo(() => {
    const map = new Map<string, EventItem>();
    events.forEach((e) => map.set(e.id, e));
    return map;
  }, [events]);

  const selectedWalkInEvent = eventMap.get(walkInEventId || events[0]?.id || '');
  const walkInCircles = useMemo<string[]>(() => {
    if (!selectedWalkInEvent) return ['Invited Guest'];
    return (
      selectedWalkInEvent.validationConfig?.options ??
      getCategoryPreset(selectedWalkInEvent.category).validationConfig.options
    );
  }, [selectedWalkInEvent]);
  const [walkInValidationGroup, setWalkInValidationGroup] = useState<string>(
    walkInCircles[0] ?? 'Invited Guest'
  );
  useEffect(() => {
    if (walkInCircles.length > 0 && !walkInCircles.includes(walkInValidationGroup)) {
      setWalkInValidationGroup(walkInCircles[0]);
    }
  }, [walkInCircles, walkInValidationGroup]);
  const walkInQrPublished = selectedWalkInEvent ? selectedWalkInEvent.qrPassPublished !== false : false;

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return attendees.filter((att) => {
      const matchesEvent = eventFilter === 'all' || att.eventId === eventFilter;
      const matchesTier = tierFilter === 'all' || att.tier === tierFilter;
      const matchesQuery =
        !q ||
        att.name.toLowerCase().includes(q) ||
        att.email.toLowerCase().includes(q) ||
        att.phone.toLowerCase().includes(q) ||
        att.organization.toLowerCase().includes(q) ||
        att.ticketCode.toLowerCase().includes(q) ||
        (att.validationGroup?.toLowerCase().includes(q) ?? false);
      return matchesEvent && matchesTier && matchesQuery;
    });
  }, [attendees, eventFilter, tierFilter, searchQuery]);

  const checkedCount = filtered.filter((a) => a.checkedIn).length;
  const checkInPct = filtered.length > 0 ? Math.round((checkedCount / filtered.length) * 100) : 0;

  const phoneRecipients = useMemo(
    () => filtered.filter((a) => Boolean(a.phone && a.phone.trim())),
    [filtered]
  );
  const smsPerRecipientCost = calculateSmsCredits(broadcastMsg);
  const totalBroadcastSmsCost = phoneRecipients.length * smsPerRecipientCost;
  const hasEnoughCreditsForBroadcast = profile.smsCredits >= totalBroadcastSmsCost;

  const handleBroadcastSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!broadcastMsg.trim() || filtered.length === 0 || broadcastSending) return;
    if (totalBroadcastSmsCost > 0 && !hasEnoughCreditsForBroadcast) {
      setBroadcastError(
        `You have ${profile.smsCredits.toLocaleString()} SMS credits, but this broadcast requires ${totalBroadcastSmsCost.toLocaleString()} SMS.`
      );
      return;
    }
    setBroadcastSending(true);
    setBroadcastError(null);
    setBroadcastStatus(null);
    try {
      if (onBroadcast) {
        const res = await onBroadcast({
          eventId: eventFilter !== 'all' ? eventFilter : undefined,
          attendeeIds: filtered.map((a) => a.id),
          message: broadcastMsg.trim(),
        });
        setBroadcastStatus(
          `Dispatched to ${res.sentCount} of ${res.recipientCount} guests (${(res.creditsUsed ?? totalBroadcastSmsCost).toLocaleString()} SMS credits used).`
        );
      } else {
        setBroadcastStatus(`Dispatched update to ${filtered.length} attendees.`);
      }
      setTimeout(() => {
        setBroadcastOpen(false);
        setBroadcastStatus(null);
      }, 1500);
    } catch (err) {
      setBroadcastError(err instanceof Error ? err.message : 'Broadcast dispatch failed.');
    } finally {
      setBroadcastSending(false);
    }
  };

  const handleWalkInSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const targetEventId = walkInEventId || events[0]?.id;
    if (!walkInName.trim() || !walkInPhone.trim() || !targetEventId) return;

    const normalizedPhone = normalizePhoneE164(walkInPhone);
    const code = `EV-${Math.floor(1000 + Math.random() * 9000)}`;
    const nowTime = new Date().toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
    });

    onRegisterAttendee(targetEventId, {
      id: `att-${Date.now()}`,
      eventId: targetEventId,
      name: walkInName.trim(),
      email: walkInEmail.trim() || `${walkInName.trim().toLowerCase().replace(/\s+/g, '.')}@guest.africa`,
      phone: normalizedPhone,
      organization: walkInOrg.trim() || 'Gate Walk-In',
      tier: walkInTier,
      ticketCode: code,
      checkedIn: walkInCheckedIn,
      checkedInAt: walkInCheckedIn ? nowTime : undefined,
      paymentStatus: 'paid',
      smsStatus: 'Arkesel Sent',
      validationGroup: walkInValidationGroup || walkInCircles[0],
    });

    setWalkInName('');
    setWalkInPhone('');
    setWalkInEmail('');
    setWalkInOrg('');
    setWalkInOpen(false);
    showToast(`Registered ${walkInName.trim()} (${code})`);
  };

  const handleExportCsv = () => {
    const headers = [
      'Name',
      'Organization',
      'ValidationCircle',
      'Email',
      'Phone',
      'Production',
      'Tier',
      'PassCode',
      'CustomData',
      'CheckedIn',
    ];
    const rows = filtered.map((a) => [
      a.name,
      a.organization,
      a.validationGroup ?? '',
      a.email,
      a.phone,
      eventMap.get(a.eventId)?.title ?? 'Event',
      a.tier,
      a.ticketCode,
      a.customResponses
        ? Object.entries(a.customResponses)
            .map(([k, v]) => `${k}: ${v}`)
            .join('; ')
        : '',
      a.checkedIn ? `Yes (${a.checkedInAt ?? 'Today'})` : 'No',
    ]);
    const csv = [headers.join(','), ...rows.map((r) => r.map((c) => `"${c}"`).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'eventsapp-attendees.csv';
    link.click();
    URL.revokeObjectURL(url);
    showToast(`Exported ${filtered.length} attendees to CSV`);
  };

  return (
    <div className="space-y-6">
      {toastMsg && (
        <div className="fixed bottom-6 right-6 z-50 px-5 py-3 rounded-full bg-[#0B0B0B] text-white text-xs font-semibold shadow-xl">
          {toastMsg}
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-[28px] sm:text-[32px] font-bold tracking-[-0.02em] text-[#0B0B0B]">
            Attendees &amp; Check-In
          </h1>
          <p className="text-sm text-[#71717A] mt-0.5 tabular-nums">
            {checkedCount} of {filtered.length} filtered guests checked in at gate
          </p>
        </div>

        <div className="lg:w-[440px]">
          <TopUtilityBar
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            searchPlaceholder="Search name, phone, pass code..."
            alerts={alerts}
            onResolveAlert={onResolveAlert}
            onInspectAlertEvent={(id) => {
              const found = events.find((e) => e.id === id);
              if (found) onManageEvent(found);
            }}
            profile={profile}
            onOpenSettings={onNavigateSettings}
          />
        </div>
      </div>

      {/* Prominent QR Code Scanner & Check-In Registration Banner */}
      <section className="p-5 sm:p-6 rounded-3xl bg-[#0B0B0B] text-white flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex items-center gap-3.5 min-w-0">
          <div className="w-11 h-11 rounded-2xl bg-white text-[#0B0B0B] flex items-center justify-center shrink-0">
            <QrCode className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-bold tracking-tight">
              Gate QR Scanner &amp; Check-In Registration
            </h2>
            <p className="text-xs text-zinc-300 mt-0.5">
              Scan attendee QR tickets or register walk-in guests with instant SMS pass delivery.
            </p>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 shrink-0">
          {onOpenQrScanner && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                onOpenQrScanner(
                  eventFilter === 'all' ? undefined : eventFilter,
                  quickScanInput.trim() || undefined
                );
                setQuickScanInput('');
              }}
              className="flex items-center gap-2"
            >
              <input
                type="text"
                value={quickScanInput}
                onChange={(e) => setQuickScanInput(e.target.value)}
                placeholder="Pass code (e.g. EV-8801)"
                aria-label="Scan pass code"
                className="h-10 px-4 rounded-full bg-white/10 border border-white/20 text-xs font-mono text-white placeholder:text-zinc-400 focus:bg-white focus:text-[#0B0B0B] focus:outline-none w-44"
              />
              <button
                type="submit"
                className="h-10 px-4 rounded-full bg-white text-[#0B0B0B] text-xs font-bold hover:bg-zinc-200 transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
              >
                <QrCode className="w-3.5 h-3.5" />
                {quickScanInput.trim() ? 'Verify QR' : 'Open QR Scanner'}
              </button>
            </form>
          )}
          {isEventCreator ? (
            <button
              type="button"
              onClick={() => {
                if (eventFilter !== 'all') setWalkInEventId(eventFilter);
                setWalkInOpen(true);
              }}
              className="h-10 px-4 rounded-full bg-white/15 hover:bg-white/25 text-white text-xs font-semibold transition-colors inline-flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0"
            >
              <UserPlus className="w-3.5 h-3.5" />
              Check-In Registration
            </button>
          ) : (
            <span className="h-10 px-4 rounded-full bg-white/10 text-zinc-200 text-xs font-semibold inline-flex items-center justify-center whitespace-nowrap shrink-0">
              Gate Staff · Scan Only
            </span>
          )}
        </div>
      </section>

      {/* Controls & Live Check-in Strip */}
      <div className="p-5 rounded-3xl bg-[#F5F5F7] flex flex-col xl:flex-row xl:items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={eventFilter}
            onChange={(e) => setEventFilter(e.target.value)}
            aria-label="Filter attendees by event"
            className="h-10 px-4 rounded-full bg-white border border-[#E5E5EA] text-xs font-semibold text-[#0B0B0B] focus:border-[#0B0B0B] focus:outline-none"
          >
            <option value="all">All Productions</option>
            {events.map((evt) => (
              <option key={evt.id} value={evt.id}>
                {evt.title}
              </option>
            ))}
          </select>

          <div className="flex items-center gap-1 p-1 bg-white rounded-full border border-[#E5E5EA] overflow-x-auto max-w-full">
            {(['all', 'VIP', 'Speaker', 'General', 'Press'] as const).map((tier) => (
              <button
                key={tier}
                type="button"
                onClick={() => setTierFilter(tier)}
                className={`px-3.5 py-1 rounded-full text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                  tierFilter === tier
                    ? 'bg-[#0B0B0B] text-white'
                    : 'text-[#71717A] hover:text-[#0B0B0B]'
                }`}
              >
                {tier === 'all' ? 'All Tiers' : tier}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between xl:justify-end gap-3">
          <div className="flex items-center gap-2.5 mr-1">
            <CircularGauge value={checkInPct} size={42} strokeWidth={4} alertThreshold={101} />
            <div>
              <p className="text-xs font-semibold text-[#0B0B0B] tabular-nums">
                {checkedCount} / {filtered.length}
              </p>
              <p className="text-[11px] text-[#71717A]">Gate Throughput</p>
            </div>
          </div>

          <button
            type="button"
            onClick={() =>
              onOpenCsvExport
                ? onOpenCsvExport(eventFilter === 'all' ? undefined : eventFilter)
                : handleExportCsv()
            }
            className="px-4 py-2.5 rounded-full bg-white border border-[#E5E5EA] text-[#0B0B0B] text-xs font-semibold hover:border-[#0B0B0B] transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
          >
            <Download className="w-3.5 h-3.5" />
            Export CSV
          </button>

          {isEventCreator && (
            <button
              type="button"
              onClick={() => {
                if (eventFilter !== 'all') setWalkInEventId(eventFilter);
                setWalkInOpen(true);
              }}
              className="px-4 py-2.5 rounded-full bg-white border border-[#E5E5EA] text-[#0B0B0B] text-xs font-semibold hover:border-[#0B0B0B] transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              Walk-In Registration
            </button>
          )}

          <button
            type="button"
            onClick={() => setBroadcastOpen(true)}
            className="px-5 py-2.5 rounded-full bg-[#0B0B0B] text-white text-xs font-semibold hover:bg-zinc-800 transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
          >
            <Send className="w-3.5 h-3.5" />
            Broadcast
          </button>
        </div>
      </div>

      {/* High-Density Attendee Table */}
      <div className="rounded-3xl border border-[#E5E5EA] overflow-hidden bg-white">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-[#E5E5EA] bg-[#F5F5F7]/70 text-[11px] font-semibold text-[#71717A]">
                <th className="py-3.5 px-5">Attendee &amp; Phone</th>
                <th className="py-3.5 px-4">Production</th>
                <th className="py-3.5 px-4">Tier</th>
                <th className="py-3.5 px-4">Pass Code</th>
                <th className="py-3.5 px-4">Status</th>
                <th className="py-3.5 px-5 text-right">Gate Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E5E5EA] text-sm">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-10 text-center text-xs text-[#71717A]">
                    No attendees match your active filters.
                  </td>
                </tr>
              ) : (
                filtered.map((att) => {
                  const evt = eventMap.get(att.eventId);
                  return (
                    <tr
                      key={att.id}
                      className="hover:bg-[#F5F5F7]/60 transition-colors"
                    >
                      <td className="py-3.5 px-5">
                        <p className="text-xs font-semibold text-[#0B0B0B]">{att.name}</p>
                        <p className="text-[11px] text-[#71717A]">
                          {att.organization} · {att.email}
                        </p>
                        <p className="text-[11px] font-mono text-[#0B0B0B] mt-0.5 tabular-nums">
                          {att.phone}
                        </p>
                        {(att.validationGroup || (att.customResponses && Object.keys(att.customResponses).length > 0)) && (
                          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                            {att.validationGroup && (
                              <span className="px-2 py-0.5 rounded-full bg-[#F5F5F7] border border-[#E5E5EA] text-[10px] font-semibold text-[#0B0B0B]">
                                {att.validationGroup}
                              </span>
                            )}
                            {att.customResponses &&
                              Object.entries(att.customResponses)
                                .slice(0, 2)
                                .map(([key, val]) => (
                                  <span
                                    key={key}
                                    className="px-2 py-0.5 rounded-full bg-[#F5F5F7] text-[10px] text-[#444748]"
                                  >
                                    {val}
                                  </span>
                                ))}
                          </div>
                        )}
                      </td>
                      <td className="py-3.5 px-4 text-xs text-[#0B0B0B]">
                        {evt ? (
                          <button
                            type="button"
                            onClick={() => onManageEvent(evt)}
                            className="text-left font-medium hover:underline"
                          >
                            {evt.title}
                          </button>
                        ) : (
                          'Event'
                        )}
                      </td>
                      <td className="py-3.5 px-4 text-xs font-medium text-[#71717A]">
                        {att.tier}
                      </td>
                      <td className="py-3.5 px-4 font-mono text-xs text-[#0B0B0B] tabular-nums">
                        {att.ticketCode}
                      </td>
                      <td className="py-3.5 px-4">
                        {att.paymentStatus === 'failed' ? (
                          <div className="inline-flex items-center gap-2">
                            <span className="text-xs font-semibold text-[#EF4444] inline-flex items-center gap-1">
                              <AlertCircle className="w-3.5 h-3.5" />
                              Declined
                            </span>
                            <button
                              type="button"
                              onClick={() => onRetryPayment(att.id)}
                              className="px-2.5 py-1 rounded-full bg-[#EF4444] text-white text-[11px] font-semibold hover:bg-red-600 transition-colors"
                            >
                              Retry
                            </button>
                          </div>
                        ) : (
                          <div>
                            <span className="text-xs text-[#0B0B0B] font-medium block">Settled</span>
                            <span className="text-[11px] text-emerald-600">{att.smsStatus}</span>
                          </div>
                        )}
                      </td>
                      <td className="py-3.5 px-5 text-right">
                        <button
                          type="button"
                          onClick={async () => {
                            const res = await Promise.resolve(onToggleCheckIn(att.id));
                            if (res && res.checkInSmsSent) {
                              showToast(
                                `Checked in ${att.name} — SMS + Disposable Camera link sent!`
                              );
                            } else if (res && res.smsSkippedReason) {
                              showToast(
                                `Checked in ${att.name}. SMS skipped: ${res.smsSkippedReason}`
                              );
                            } else if (res && res.checkInMessageSent) {
                              showToast(
                                `Checked in ${att.name} — check-in welcome email + camera link sent!`
                              );
                            }
                          }}
                          className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
                            att.checkedIn
                              ? 'bg-[#F5F5F7] text-[#0B0B0B] border border-[#E5E5EA] hover:border-[#0B0B0B]'
                              : 'bg-[#0B0B0B] text-white hover:bg-zinc-800'
                          }`}
                        >
                          {att.checkedIn ? (
                            <>
                              <Check className="w-3.5 h-3.5" />
                              Checked In ({att.checkedInAt})
                            </>
                          ) : (
                            'Check In'
                          )}
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add Walk-In Modal (Creator Only) */}
      {walkInOpen && isEventCreator && (
        <div
          className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px] flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="walkin-modal-title"
        >
          <div className="bg-white w-full max-w-md rounded-3xl border border-[#E5E5EA] p-6 soft-popover-shadow">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 id="walkin-modal-title" className="text-lg font-bold text-[#0B0B0B]">
                  Register Walk-In Guest
                </h2>
                <p className="text-xs text-[#71717A]">
                  Issues a pass code &amp; normalizes phone to E.164 immediately.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setWalkInOpen(false)}
                aria-label="Close walk-in modal"
                className="w-8 h-8 rounded-full border border-[#E5E5EA] flex items-center justify-center text-[#0B0B0B] hover:bg-[#F5F5F7]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleWalkInSubmit} className="space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-[#0B0B0B] mb-1">Full Name</label>
                <input
                  type="text"
                  required
                  value={walkInName}
                  onChange={(e) => setWalkInName(e.target.value)}
                  placeholder="e.g. Efua Boateng"
                  className="w-full h-10 px-4 rounded-2xl bg-[#F5F5F7] text-sm text-[#0B0B0B] focus:bg-white focus:ring-1 focus:ring-[#0B0B0B] focus:outline-none"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-semibold text-[#0B0B0B]">Mobile Number</label>
                  {walkInPhone.trim() && (
                    <span className="text-[11px] font-mono text-emerald-600">
                      {normalizePhoneE164(walkInPhone)}
                    </span>
                  )}
                </div>
                <input
                  type="tel"
                  required
                  value={walkInPhone}
                  onChange={(e) => setWalkInPhone(e.target.value)}
                  placeholder="024 555 0199"
                  className="w-full h-10 px-4 rounded-2xl bg-[#F5F5F7] text-sm font-mono text-[#0B0B0B] focus:bg-white focus:ring-1 focus:ring-[#0B0B0B] focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[#0B0B0B] mb-1">Email</label>
                  <input
                    type="email"
                    value={walkInEmail}
                    onChange={(e) => setWalkInEmail(e.target.value)}
                    placeholder="guest@company.com"
                    className="w-full h-10 px-4 rounded-2xl bg-[#F5F5F7] text-xs text-[#0B0B0B] focus:bg-white focus:ring-1 focus:ring-[#0B0B0B] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#0B0B0B] mb-1">Organization</label>
                  <input
                    type="text"
                    value={walkInOrg}
                    onChange={(e) => setWalkInOrg(e.target.value)}
                    placeholder="Gate Walk-In"
                    className="w-full h-10 px-4 rounded-2xl bg-[#F5F5F7] text-xs text-[#0B0B0B] focus:bg-white focus:ring-1 focus:ring-[#0B0B0B] focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[#0B0B0B] mb-1">Event</label>
                  <select
                    value={walkInEventId}
                    onChange={(e) => setWalkInEventId(e.target.value)}
                    className="w-full h-10 px-3 rounded-2xl bg-[#F5F5F7] text-xs font-semibold text-[#0B0B0B] focus:outline-none"
                  >
                    {events.map((evt) => (
                      <option key={evt.id} value={evt.id}>
                        {evt.title}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#0B0B0B] mb-1">Pass Tier</label>
                  <select
                    value={walkInTier}
                    onChange={(e) => setWalkInTier(e.target.value as AttendeeTier)}
                    className="w-full h-10 px-3 rounded-2xl bg-[#F5F5F7] text-xs font-semibold text-[#0B0B0B] focus:outline-none"
                  >
                    <option value="General">General</option>
                    <option value="VIP">VIP</option>
                    <option value="Speaker">Speaker</option>
                    <option value="Press">Press</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#0B0B0B] mb-1">
                  Validation Circle
                </label>
                <select
                  value={walkInValidationGroup}
                  onChange={(e) => setWalkInValidationGroup(e.target.value)}
                  className="w-full h-10 px-3 rounded-2xl bg-[#F5F5F7] text-xs font-semibold text-[#0B0B0B] focus:outline-none"
                >
                  {walkInCircles.map((circle: string) => (
                    <option key={circle} value={circle}>
                      {circle}
                    </option>
                  ))}
                </select>
              </div>

              <label className="flex items-center gap-2.5 pt-1 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={walkInCheckedIn}
                  onChange={(e) => setWalkInCheckedIn(e.target.checked)}
                  className="accent-[#0B0B0B] w-4 h-4"
                />
                <span className="text-xs font-medium text-[#0B0B0B]">
                  Check guest in immediately at gate
                </span>
              </label>

              {!walkInQrPublished && (
                <div className="p-3 rounded-2xl bg-[#F5F5F7] border border-[#E5E5EA] text-[11px] text-[#0B0B0B]">
                  Check-in QR passes have not been published for this event yet. Publish the Check-In QR Pass in the Event Workspace first.
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setWalkInOpen(false)}
                  className="px-4 py-2 rounded-full border border-[#E5E5EA] text-xs font-semibold text-[#0B0B0B]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!walkInQrPublished}
                  className="px-5 py-2 rounded-full bg-[#0B0B0B] text-white text-xs font-semibold hover:bg-zinc-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Issue Pass
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Broadcast Modal */}
      {broadcastOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px] flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="broadcast-modal-title"
        >
          <div className="bg-white w-full max-w-md rounded-3xl border border-[#E5E5EA] p-6 soft-popover-shadow">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 id="broadcast-modal-title" className="text-lg font-bold text-[#0B0B0B]">
                  Attendee Broadcast
                </h2>
                <p className="text-xs text-[#71717A] tabular-nums">
                  Target audience: {filtered.length} filtered guests
                </p>
              </div>
              <button
                type="button"
                onClick={() => setBroadcastOpen(false)}
                aria-label="Close broadcast modal"
                className="w-8 h-8 rounded-full border border-[#E5E5EA] flex items-center justify-center text-[#0B0B0B] hover:bg-[#F5F5F7]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleBroadcastSubmit} className="space-y-4">
              <div className="p-3.5 rounded-2xl bg-[#F5F5F7] text-xs space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-[#71717A]">SMS cost ({smsPerRecipientCost} SMS × {phoneRecipients.length} phones)</span>
                  <span className="font-bold text-[#0B0B0B] tabular-nums">
                    {totalBroadcastSmsCost.toLocaleString()} credits
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[#71717A]">Your bundle balance</span>
                  <span
                    className={`font-bold tabular-nums ${
                      hasEnoughCreditsForBroadcast ? 'text-emerald-700' : 'text-red-600'
                    }`}
                  >
                    {profile.smsCredits.toLocaleString()} credits
                  </span>
                </div>
              </div>

              <textarea
                rows={4}
                value={broadcastMsg}
                onChange={(e) => {
                  setBroadcastMsg(e.target.value);
                  if (broadcastError) setBroadcastError(null);
                }}
                className="w-full p-4 rounded-2xl bg-[#F5F5F7] text-sm text-[#0B0B0B] border border-transparent focus:bg-white focus:border-[#0B0B0B] focus:outline-none"
              />

              {(!hasEnoughCreditsForBroadcast && totalBroadcastSmsCost > 0) && (
                <div className="p-3 rounded-2xl bg-red-50 border border-red-200 text-xs text-red-700 flex items-center justify-between gap-2">
                  <span>
                    Need {(totalBroadcastSmsCost - profile.smsCredits).toLocaleString()} more SMS credits.
                  </span>
                  {onOpenPlans && (
                    <button
                      type="button"
                      onClick={() => {
                        setBroadcastOpen(false);
                        onOpenPlans();
                      }}
                      className="px-3 py-1 rounded-full bg-[#0B0B0B] text-white text-[11px] font-semibold shrink-0"
                    >
                      Buy SMS Bundle
                    </button>
                  )}
                </div>
              )}

              {broadcastError && (
                <p className="text-xs font-semibold text-red-600">{broadcastError}</p>
              )}
              {broadcastStatus && (
                <p className="text-xs font-semibold text-emerald-700">{broadcastStatus}</p>
              )}
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setBroadcastOpen(false)}
                  className="px-4 py-2 rounded-full border border-[#E5E5EA] text-xs font-semibold text-[#0B0B0B]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={
                    broadcastSending ||
                    filtered.length === 0 ||
                    !broadcastMsg.trim() ||
                    (totalBroadcastSmsCost > 0 && !hasEnoughCreditsForBroadcast)
                  }
                  className="px-5 py-2 rounded-full bg-[#0B0B0B] text-white text-xs font-semibold hover:bg-zinc-800 transition-colors disabled:opacity-45 disabled:cursor-not-allowed"
                >
                  {broadcastSending ? 'Dispatching...' : 'Send Dispatch'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
