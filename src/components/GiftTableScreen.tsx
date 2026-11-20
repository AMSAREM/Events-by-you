import React, { useEffect, useMemo, useState } from 'react';
import {
  Check,
  Copy,
  Download,
  ExternalLink,
  Gift,
  Plus,
  Search,
  Settings2,
  Wallet,
} from 'lucide-react';
import {
  EventItem,
  GiftTableAttendantLink,
  GiftTableEntry,
  OrganizerProfile,
  SystemAlert,
} from '../types/events';
import { buildEventInvitationUrl, DeterministicQrSvg, downloadQrSvg } from '../lib/qr';
import { TopUtilityBar } from './TopUtilityBar';
import { GiftAttendantLinksCard } from './GiftAttendantLinksCard';

interface GiftTableScreenProps {
  events: EventItem[];
  alerts: SystemAlert[];
  profile: OrganizerProfile;
  initialEventId?: string;
  onOpenCreateModal: () => void;
  onEditEventModal: (event: EventItem) => void;
  onManageEvent: (event: EventItem) => void;
  onPreviewPublicGiftTable: (event: EventItem, deskToken?: string) => void;
  onRecordGiftEntry: (
    eventId: string,
    gift: Omit<GiftTableEntry, 'id' | 'eventId' | 'createdAt' | 'recordedVia'>
  ) => Promise<{ gift: GiftTableEntry; event: EventItem }> | void;
  onCreateGiftAttendantLink: (
    eventId: string,
    payload: { attendantName: string; roleLabel?: string; phone?: string }
  ) => Promise<GiftTableAttendantLink | void>;
  onToggleGiftAttendantLink: (
    eventId: string,
    linkId: string,
    active?: boolean
  ) => Promise<void>;
  onDeleteGiftAttendantLink: (eventId: string, linkId: string) => Promise<void>;
  onNavigateSettings: () => void;
  onResolveAlert: (id: string) => void;
}

export const GiftTableScreen: React.FC<GiftTableScreenProps> = ({
  events,
  alerts,
  profile,
  initialEventId,
  onOpenCreateModal,
  onEditEventModal,
  onManageEvent,
  onPreviewPublicGiftTable,
  onRecordGiftEntry,
  onCreateGiftAttendantLink,
  onToggleGiftAttendantLink,
  onDeleteGiftAttendantLink,
  onNavigateSettings,
  onResolveAlert,
}) => {
  const canManage = profile.appRole !== 'gate_staff';
  const [searchQuery, setSearchQuery] = useState('');
  const [ledgerFilter, setLedgerFilter] = useState<
    'all' | 'cash-momo' | 'registry-item' | 'blessing-only'
  >('all');
  const [toast, setToast] = useState<string | null>(null);

  const defaultEventId = useMemo(() => {
    if (initialEventId && events.some((e) => e.id === initialEventId)) {
      return initialEventId;
    }
    const active = events.find((e) => e.status === 'live' || e.status === 'upcoming');
    return active?.id || events[0]?.id || '';
  }, [events, initialEventId]);

  const [selectedEventId, setSelectedEventId] = useState<string>(defaultEventId);

  useEffect(() => {
    if (initialEventId && events.some((e) => e.id === initialEventId)) {
      setSelectedEventId(initialEventId);
    } else if (!events.some((e) => e.id === selectedEventId)) {
      setSelectedEventId(defaultEventId);
    }
  }, [initialEventId, events, selectedEventId, defaultEventId]);

  const selectedEvent = useMemo(
    () => events.find((e) => e.id === selectedEventId) ?? events[0] ?? null,
    [events, selectedEventId]
  );

  // Venue Desk Gift Entry form state
  const [giverName, setGiverName] = useState('');
  const [giverPhone, setGiverPhone] = useState('');
  const [giftType, setGiftType] = useState<'cash-momo' | 'registry-item' | 'blessing-only'>(
    'cash-momo'
  );
  const [currency, setCurrency] = useState<'GHS' | 'USD'>('GHS');
  const [amount, setAmount] = useState('');
  const [registryItem, setRegistryItem] = useState('');
  const [side, setSide] = useState('');
  const [message, setMessage] = useState('');
  const [savingGift, setSavingGift] = useState(false);

  const triggerToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast((curr) => (curr === msg ? null : curr)), 2600);
  };

  const giftLedger = useMemo(
    () => selectedEvent?.extraDataConfig?.giftLedger ?? [],
    [selectedEvent]
  );

  const attendantLinks = useMemo(
    () => selectedEvent?.extraDataConfig?.attendantLinks ?? [],
    [selectedEvent]
  );

  const totalGhs = useMemo(
    () =>
      giftLedger.reduce(
        (sum, g) =>
          sum +
          (g.giftType === 'cash-momo' && (g.currency || 'GHS') === 'GHS' ? g.amount || 0 : 0),
        0
      ),
    [giftLedger]
  );

  const totalUsd = useMemo(
    () =>
      giftLedger.reduce(
        (sum, g) =>
          sum + (g.giftType === 'cash-momo' && g.currency === 'USD' ? g.amount || 0 : 0),
        0
      ),
    [giftLedger]
  );

  const registryAndWishesCount = useMemo(
    () => giftLedger.filter((g) => g.giftType !== 'cash-momo').length,
    [giftLedger]
  );

  const filteredLedger = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return giftLedger.filter((entry) => {
      const matchesType = ledgerFilter === 'all' || entry.giftType === ledgerFilter;
      const matchesSearch =
        !q ||
        entry.giverName.toLowerCase().includes(q) ||
        (entry.side || '').toLowerCase().includes(q) ||
        (entry.registryItem || '').toLowerCase().includes(q) ||
        (entry.message || '').toLowerCase().includes(q) ||
        (entry.recordedBy || '').toLowerCase().includes(q);
      return matchesType && matchesSearch;
    });
  }, [giftLedger, ledgerFilter, searchQuery]);

  const publicGiftUrl = selectedEvent
    ? buildEventInvitationUrl(selectedEvent.slug || selectedEvent.id, 'gifts')
    : '';

  const handleRecordDeskGift = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedEvent || !giverName.trim() || savingGift) return;
    if (giftType === 'cash-momo' && (!amount || Number(amount) <= 0)) return;
    setSavingGift(true);
    try {
      await onRecordGiftEntry(selectedEvent.id, {
        giverName: giverName.trim(),
        giverPhone: giverPhone.trim() || undefined,
        giftType,
        currency,
        amount: giftType === 'cash-momo' ? Math.max(1, Number(amount) || 0) : undefined,
        registryItem:
          giftType === 'registry-item'
            ? registryItem.trim() ||
              selectedEvent.extraDataConfig?.giftRegistryItems?.[0] ||
              'Gift Box'
            : undefined,
        side: side.trim() || undefined,
        message: message.trim() || undefined,
      });
      setGiverName('');
      setGiverPhone('');
      setAmount('');
      setRegistryItem('');
      setSide('');
      setMessage('');
      triggerToast('Gift entry recorded on standalone ledger');
    } finally {
      setSavingGift(false);
    }
  };

  const handleExportGiftsCsv = () => {
    if (!selectedEvent) return;
    const headers = [
      'GiverName',
      'Phone',
      'GiftType',
      'Amount',
      'Currency',
      'RegistryItem',
      'Side',
      'Message',
      'Source',
      'RecordedBy',
      'CreatedAt',
    ];
    const rows = giftLedger.map((g) => [
      g.giverName,
      g.giverPhone || '',
      g.giftType,
      g.amount !== undefined ? String(g.amount) : '',
      g.currency || 'GHS',
      g.registryItem || '',
      g.side || '',
      (g.message || '').replace(/"/g, '""'),
      g.recordedVia || 'public-table',
      g.recordedBy || '',
      g.createdAt,
    ]);
    const csv = [headers.join(','), ...rows.map((r) => r.map((c) => `"${c}"`).join(','))].join(
      '\n'
    );
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${selectedEvent.slug || selectedEvent.id}-gift-ledger.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
    triggerToast(`Exported ${giftLedger.length} gift entries to CSV`);
  };

  return (
    <div className="space-y-5 lg:space-y-6">
      {toast && (
        <div className="fixed bottom-20 md:bottom-6 right-4 sm:right-6 z-50 px-4 py-2.5 rounded-full bg-[#0B0B0B] text-white text-xs font-semibold shadow-xl flex items-center gap-2">
          <Check className="w-3.5 h-3.5 text-emerald-400" />
          <span>{toast}</span>
        </div>
      )}

      {/* Header + Utility Bar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="min-w-0">
          <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-[#71717A]">
            <Gift className="w-3.5 h-3.5 text-[#0B0B0B]" />
            Standalone Activity · Separate from Walk-Ins &amp; RSVP
          </span>
          <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-[-0.03em] text-[#0B0B0B] mt-0.5">
            Gift Table &amp; Attendant Desk Links
          </h1>
          <p className="text-xs sm:text-sm text-[#71717A] mt-1">
            Appoint attendants to man the physical Gift Table, receive MoMo &amp; envelopes, and monitor real-time pledges.
          </p>
        </div>

        <div className="w-full lg:w-[360px] shrink-0">
          <TopUtilityBar
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            searchPlaceholder="Search givers, attendants, notes..."
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
      </div>

      {!selectedEvent ? (
        <section className="bg-[#F5F5F7] rounded-[32px] p-8 sm:p-12 text-center space-y-4 border border-[#E5E5EA]">
          <div className="w-14 h-14 rounded-2xl bg-[#0B0B0B] text-white flex items-center justify-center mx-auto">
            <Gift className="w-6 h-6" />
          </div>
          <div className="max-w-md mx-auto space-y-1.5">
            <h2 className="font-display text-xl font-bold text-[#0B0B0B]">
              Create an event to activate your Gift Table
            </h2>
            <p className="text-xs text-[#71717A] leading-relaxed">
              Once you have an event, you can generate dedicated links for attendants manning the Gift Table, configure Mobile Money details, and track envelopes independently from registration.
            </p>
          </div>
          {canManage && (
            <button
              type="button"
              onClick={onOpenCreateModal}
              className="px-5 py-2.5 rounded-full bg-[#0B0B0B] text-white text-xs font-semibold hover:bg-neutral-800 inline-flex items-center gap-1.5 transition-colors"
            >
              <Plus className="w-4 h-4" />
              <span>Create First Event</span>
            </button>
          )}
        </section>
      ) : (
        <>
          {/* Event Selector Strip */}
          <section className="bg-[#F5F5F7] rounded-2xl p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2 overflow-x-auto pb-1 sm:pb-0">
              {events.map((evt) => {
                const isSelected = evt.id === selectedEvent.id;
                return (
                  <button
                    key={evt.id}
                    type="button"
                    onClick={() => setSelectedEventId(evt.id)}
                    className={`px-4 py-2 rounded-full text-xs font-semibold whitespace-nowrap shrink-0 transition-colors ${
                      isSelected
                        ? 'bg-[#0B0B0B] text-white'
                        : 'bg-white text-[#52525B] border border-[#E5E5EA] hover:text-[#0B0B0B]'
                    }`}
                  >
                    {evt.title}
                  </button>
                );
              })}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => onManageEvent(selectedEvent)}
                className="px-3.5 py-2 rounded-full bg-white border border-[#E5E5EA] hover:border-[#0B0B0B] text-xs font-semibold text-[#0B0B0B] whitespace-nowrap"
              >
                Open Event Workspace
              </button>
            </div>
          </section>

          {/* 4-Card KPI Strip */}
          <section className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            <div className="p-4 sm:p-5 rounded-3xl bg-[#F5F5F7]">
              <span className="text-[11px] font-medium text-[#71717A] block">
                Total Gift Entries
              </span>
              <p className="font-display text-2xl sm:text-3xl font-bold text-[#0B0B0B] tabular-nums mt-2">
                {giftLedger.length}
              </p>
              <span className="text-[11px] text-[#71717A] mt-1 block">
                Separate from {selectedEvent.registered} seats
              </span>
            </div>

            <div className="p-4 sm:p-5 rounded-3xl bg-[#F5F5F7]">
              <span className="text-[11px] font-medium text-[#71717A] block">
                Cash / MoMo Total
              </span>
              <p className="font-display text-2xl sm:text-3xl font-bold text-[#0B0B0B] tabular-nums mt-2">
                GHS {totalGhs.toLocaleString()}
              </p>
              <span className="text-[11px] text-[#71717A] mt-1 block tabular-nums">
                {totalUsd > 0 ? `+ USD ${totalUsd.toLocaleString()} logged` : 'Physical & MoMo envelopes'}
              </span>
            </div>

            <div className="p-4 sm:p-5 rounded-3xl bg-[#F5F5F7]">
              <span className="text-[11px] font-medium text-[#71717A] block">
                Registry &amp; Wishes
              </span>
              <p className="font-display text-2xl sm:text-3xl font-bold text-[#0B0B0B] tabular-nums mt-2">
                {registryAndWishesCount}
              </p>
              <span className="text-[11px] text-[#71717A] mt-1 block">
                Gift boxes &amp; blessing cards
              </span>
            </div>

            <div className="p-4 sm:p-5 rounded-3xl bg-[#0B0B0B] text-white">
              <span className="text-[11px] font-medium text-zinc-400 block">
                Active Attendant Links
              </span>
              <p className="font-display text-2xl sm:text-3xl font-bold text-white tabular-nums mt-2">
                {attendantLinks.filter((l) => l.active).length}
              </p>
              <span className="text-[11px] text-zinc-400 mt-1 block tabular-nums">
                {attendantLinks.length} total desk links issued
              </span>
            </div>
          </section>

          {/* Main 2-Column Workspace */}
          <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_350px] gap-5 lg:gap-6 items-start">
            <div className="space-y-5 min-w-0">
              {/* Appointed Gift Table Attendant Links */}
              <GiftAttendantLinksCard
                event={selectedEvent}
                canManage={canManage}
                onCreateLink={onCreateGiftAttendantLink}
                onToggleLink={onToggleGiftAttendantLink}
                onDeleteLink={onDeleteGiftAttendantLink}
                onPreviewDeskLink={(_, token) =>
                  onPreviewPublicGiftTable(selectedEvent, token)
                }
                onToast={triggerToast}
              />

              {/* Record Physical Envelope / Venue Gift Entry */}
              <form
                onSubmit={handleRecordDeskGift}
                className="p-5 sm:p-6 rounded-[28px] bg-[#F5F5F7] border border-[#E5E5EA]/70 space-y-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-sm font-bold text-[#0B0B0B]">
                    Record Venue Gift / Envelope Entry (Organiser Desk)
                  </h2>
                  <span className="text-[10px] font-mono text-[#71717A]">
                    Does not modify attendee count
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  <input
                    type="text"
                    required
                    value={giverName}
                    onChange={(e) => setGiverName(e.target.value)}
                    placeholder="Giver / Family name *"
                    className="h-10 px-3.5 rounded-xl bg-white border border-[#E5E5EA] text-xs font-medium text-[#0B0B0B]"
                  />
                  <input
                    type="tel"
                    value={giverPhone}
                    onChange={(e) => setGiverPhone(e.target.value)}
                    placeholder="Phone (optional)"
                    className="h-10 px-3.5 rounded-xl bg-white border border-[#E5E5EA] text-xs font-mono text-[#0B0B0B]"
                  />
                  <select
                    value={giftType}
                    onChange={(e) =>
                      setGiftType(
                        e.target.value as 'cash-momo' | 'registry-item' | 'blessing-only'
                      )
                    }
                    className="h-10 px-3.5 rounded-xl bg-white border border-[#E5E5EA] text-xs font-semibold text-[#0B0B0B]"
                  >
                    <option value="cash-momo">Cash / MoMo Envelope</option>
                    <option value="registry-item">Registry Gift Box</option>
                    <option value="blessing-only">Well-Wishes Card</option>
                  </select>
                </div>

                {giftType === 'cash-momo' && (
                  <div className="grid grid-cols-3 gap-2.5">
                    <select
                      value={currency}
                      onChange={(e) => setCurrency(e.target.value as 'GHS' | 'USD')}
                      className="h-10 px-3.5 rounded-xl bg-white border border-[#E5E5EA] text-xs font-bold text-[#0B0B0B]"
                    >
                      <option value="GHS">GHS</option>
                      <option value="USD">USD</option>
                    </select>
                    <input
                      type="number"
                      min={1}
                      required
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      placeholder="Amount"
                      className="col-span-2 h-10 px-3.5 rounded-xl bg-white border border-[#E5E5EA] text-xs font-mono font-semibold text-[#0B0B0B]"
                    />
                  </div>
                )}

                {giftType === 'registry-item' && (
                  <input
                    type="text"
                    value={registryItem}
                    onChange={(e) => setRegistryItem(e.target.value)}
                    placeholder="Gift item description"
                    className="w-full h-10 px-3.5 rounded-xl bg-white border border-[#E5E5EA] text-xs text-[#0B0B0B]"
                  />
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <input
                    type="text"
                    value={side}
                    onChange={(e) => setSide(e.target.value)}
                    placeholder="Side / Honoring (optional)"
                    className="h-10 px-3.5 rounded-xl bg-white border border-[#E5E5EA] text-xs text-[#0B0B0B]"
                  />
                  <input
                    type="text"
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder="Well-wishes note (optional)"
                    className="h-10 px-3.5 rounded-xl bg-white border border-[#E5E5EA] text-xs text-[#0B0B0B]"
                  />
                </div>

                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={savingGift}
                    className="px-5 py-2 rounded-full bg-[#0B0B0B] text-white text-xs font-semibold hover:bg-neutral-800 disabled:opacity-60"
                  >
                    {savingGift ? 'Recording...' : 'Record Gift Entry'}
                  </button>
                </div>
              </form>

              {/* Searchable Gift Table Ledger */}
              <section className="p-5 sm:p-6 rounded-[28px] bg-[#F5F5F7] space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <h2 className="text-base font-bold text-[#0B0B0B]">
                      Gift Table Ledger ({filteredLedger.length})
                    </h2>
                    <p className="text-[11px] text-[#71717A]">
                      Tracks entries from public guests and each appointed attendant desk link.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={handleExportGiftsCsv}
                      className="px-3.5 py-2 rounded-full bg-white border border-[#E5E5EA] hover:border-[#0B0B0B] text-xs font-semibold text-[#0B0B0B] inline-flex items-center gap-1.5"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Export Gift CSV</span>
                    </button>
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                  <div className="flex items-center gap-1.5 p-1 bg-white rounded-full border border-[#E5E5EA] overflow-x-auto">
                    {(
                      [
                        { id: 'all', label: 'All' },
                        { id: 'cash-momo', label: 'Cash / MoMo' },
                        { id: 'registry-item', label: 'Registry' },
                        { id: 'blessing-only', label: 'Wishes' },
                      ] as const
                    ).map((tab) => (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => setLedgerFilter(tab.id)}
                        className={`px-3 py-1 rounded-full text-[11px] font-semibold whitespace-nowrap ${
                          ledgerFilter === tab.id
                            ? 'bg-[#0B0B0B] text-white'
                            : 'text-[#71717A] hover:text-[#0B0B0B]'
                        }`}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>

                  <div className="relative sm:w-56">
                    <Search className="w-3.5 h-3.5 text-[#71717A] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Filter ledger..."
                      className="w-full h-9 pl-8 pr-3 rounded-full bg-white border border-[#E5E5EA] text-xs text-[#0B0B0B] focus:outline-none focus:border-[#0B0B0B]"
                    />
                  </div>
                </div>

                {filteredLedger.length === 0 ? (
                  <div className="p-8 rounded-2xl bg-white text-center text-xs text-[#71717A]">
                    No matching gift entries yet. Share an attendant desk link or public gift URL to start recording gifts.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {filteredLedger.map((entry) => (
                      <div
                        key={entry.id}
                        className="p-4 rounded-2xl bg-white flex flex-col sm:flex-row sm:items-center justify-between gap-2 border border-[#E5E5EA]/60"
                      >
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-xs font-bold text-[#0B0B0B]">
                              {entry.giverName}
                            </span>
                            {entry.side && (
                              <span className="px-2 py-0.5 rounded-full bg-[#F5F5F7] text-[10px] font-medium text-[#71717A]">
                                {entry.side}
                              </span>
                            )}
                            <span className="px-2 py-0.5 rounded-full bg-[#F5F5F7] text-[10px] font-mono text-[#0B0B0B]">
                              {entry.recordedVia === 'gift-desk'
                                ? entry.recordedBy
                                  ? `Desk · ${entry.recordedBy}`
                                  : 'Venue Desk'
                                : 'Public Table'}
                            </span>
                          </div>
                          {entry.message && (
                            <p className="text-[11px] text-[#444748] mt-1 italic">
                              &ldquo;{entry.message}&rdquo;
                            </p>
                          )}
                        </div>
                        <div className="text-right shrink-0">
                          <span className="text-xs font-bold text-[#0B0B0B] tabular-nums">
                            {entry.giftType === 'cash-momo'
                              ? `${entry.currency || 'GHS'} ${entry.amount?.toLocaleString()}`
                              : entry.giftType === 'registry-item'
                                ? entry.registryItem || 'Registry Gift'
                                : 'Well-Wishes'}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>

            {/* Right Sidebar: Public Guest Gift URL + MoMo Setup */}
            <aside className="space-y-5 xl:sticky xl:top-6">
              <div className="p-5 sm:p-6 rounded-[28px] bg-[#F5F5F7] space-y-4">
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-[#71717A] block">
                    Public Guest Gift Link
                  </span>
                  <h3 className="text-sm font-bold text-[#0B0B0B] mt-0.5">
                    Self-Service Guest Gift Table
                  </h3>
                  <p className="text-[11px] text-[#71717A] mt-1 leading-relaxed">
                    Guests can send MoMo pledges or well-wishes directly using the public standalone URL.
                  </p>
                </div>

                <div className="p-4 rounded-2xl bg-white border border-[#E5E5EA] flex flex-col items-center gap-3">
                  <DeterministicQrSvg
                    value={publicGiftUrl}
                    size={140}
                    label={`Public Gift Table QR for ${selectedEvent.title}`}
                  />
                  <span className="text-[11px] font-mono text-[#52525B] break-all text-center">
                    /e/{selectedEvent.slug || selectedEvent.id}/gifts
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard?.writeText(publicGiftUrl).catch(() => {});
                      triggerToast('Public Gift Table URL copied');
                    }}
                    className="py-2.5 px-3 rounded-full bg-white border border-[#E5E5EA] hover:border-[#0B0B0B] text-xs font-semibold text-[#0B0B0B] inline-flex items-center justify-center gap-1.5"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    <span>Copy URL</span>
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      downloadQrSvg(
                        publicGiftUrl,
                        `${selectedEvent.slug || selectedEvent.id}-gift-table-qr.svg`
                      )
                    }
                    className="py-2.5 px-3 rounded-full bg-white border border-[#E5E5EA] hover:border-[#0B0B0B] text-xs font-semibold text-[#0B0B0B] inline-flex items-center justify-center gap-1.5"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Save QR</span>
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => onPreviewPublicGiftTable(selectedEvent)}
                  className="w-full py-2.5 px-4 rounded-full bg-[#0B0B0B] text-white text-xs font-semibold hover:bg-neutral-800 inline-flex items-center justify-center gap-1.5"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>Open Public Gift Table</span>
                </button>
              </div>

              <div className="p-5 sm:p-6 rounded-[28px] bg-[#F5F5F7] space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Wallet className="w-4 h-4 text-[#0B0B0B]" />
                    <h3 className="text-sm font-bold text-[#0B0B0B]">
                      Receiving MoMo &amp; Registry
                    </h3>
                  </div>
                </div>

                <div className="p-3.5 rounded-2xl bg-white border border-[#E5E5EA] space-y-1.5 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[#71717A]">Title</span>
                    <span className="font-semibold text-[#0B0B0B] truncate max-w-[180px]">
                      {selectedEvent.extraDataConfig?.giftTitle || 'Event Gift Table'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[#71717A]">MoMo Number</span>
                    <span className="font-mono font-bold text-[#0B0B0B]">
                      {selectedEvent.extraDataConfig?.momoNumber || 'Not configured'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[#71717A]">Account Name</span>
                    <span className="font-semibold text-[#0B0B0B] truncate max-w-[180px]">
                      {selectedEvent.extraDataConfig?.momoName || selectedEvent.organizer}
                    </span>
                  </div>
                </div>

                {canManage && (
                  <button
                    type="button"
                    onClick={() => onEditEventModal(selectedEvent)}
                    className="w-full py-2.5 px-4 rounded-full bg-white border border-[#E5E5EA] hover:border-[#0B0B0B] text-xs font-semibold text-[#0B0B0B] inline-flex items-center justify-center gap-1.5 transition-colors"
                  >
                    <Settings2 className="w-3.5 h-3.5" />
                    <span>Configure Gift Table Details</span>
                  </button>
                )}
              </div>
            </aside>
          </div>
        </>
      )}
    </div>
  );
};
