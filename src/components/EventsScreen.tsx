import React, { useMemo, useState } from 'react';
import { Check, Copy, ExternalLink, LayoutGrid, List, Plus, QrCode } from 'lucide-react';
import { EventItem, EventStatus, OrganizerProfile, SystemAlert } from '../types/events';
import { EVENT_CATEGORIES, getCategoryPreset } from '../data/initialData';
import { formatEventDateSpan, formatEventDurationBadge } from '../lib/eventDates';
import { buildEventInvitationUrl } from '../lib/qr';
import { EventFlyerCard } from './EventFlyerCard';
import { MonochromePoster } from './MonochromeArtwork';
import { TopUtilityBar } from './TopUtilityBar';

interface EventsScreenProps {
  events: EventItem[];
  alerts: SystemAlert[];
  profile: OrganizerProfile;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  onOpenCreateModal: () => void;
  onManageEvent: (event: EventItem) => void;
  onNavigateAttendees: (eventId: string) => void;
  onOpenQrScanner?: (eventId: string) => void;
  onOpenInvitation?: (event: EventItem) => void;
  onNavigateSettings: () => void;
  onResolveAlert: (id: string) => void;
}

export const EventsScreen: React.FC<EventsScreenProps> = ({
  events,
  alerts,
  profile,
  searchQuery,
  onSearchChange,
  onOpenCreateModal,
  onManageEvent,
  onNavigateAttendees,
  onOpenQrScanner,
  onOpenInvitation,
  onNavigateSettings,
  onResolveAlert,
}) => {
  const isEventCreator = profile.appRole !== 'gate_staff';
  const [statusFilter, setStatusFilter] = useState<'all' | EventStatus>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return events.filter((evt) => {
      const matchesStatus = statusFilter === 'all' || evt.status === statusFilter;
      const matchesCategory =
        categoryFilter === 'all' || evt.category.toLowerCase() === categoryFilter.toLowerCase();
      const matchesQuery =
        !q ||
        evt.title.toLowerCase().includes(q) ||
        evt.venue.toLowerCase().includes(q) ||
        evt.city.toLowerCase().includes(q) ||
        evt.category.toLowerCase().includes(q);
      return matchesStatus && matchesCategory && matchesQuery;
    });
  }, [events, statusFilter, categoryFilter, searchQuery]);

  return (
    <div className="space-y-6">
      {/* Header Row */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-[28px] sm:text-[32px] font-bold tracking-[-0.02em] text-[#0B0B0B]">
            Event Productions
          </h1>
          <p className="text-sm text-[#71717A] mt-0.5 tabular-nums">
            {events.length} productions across weddings, church, musical, corporate, funeral &amp; tech events
          </p>
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 lg:w-[440px]">
          <TopUtilityBar
            searchQuery={searchQuery}
            onSearchChange={onSearchChange}
            searchPlaceholder="Filter events or cities..."
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

      {/* Filter & Actions Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 p-1 bg-[#F5F5F7] rounded-full overflow-x-auto">
          {(
            [
              { id: 'all', label: 'All' },
              { id: 'live', label: 'Live' },
              { id: 'upcoming', label: 'Upcoming' },
              { id: 'draft', label: 'Drafts' },
              { id: 'past', label: 'Past' },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setStatusFilter(tab.id)}
              className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                statusFilter === tab.id
                  ? 'bg-[#0B0B0B] text-white'
                  : 'text-[#71717A] hover:text-[#0B0B0B]'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2.5">
          <div className="flex items-center gap-1 p-1 bg-[#F5F5F7] rounded-full">
            <button
              type="button"
              onClick={() => setViewMode('grid')}
              aria-label="Grid view"
              className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors ${
                viewMode === 'grid' ? 'bg-[#0B0B0B] text-white' : 'text-[#71717A] hover:text-[#0B0B0B]'
              }`}
            >
              <LayoutGrid className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setViewMode('list')}
              aria-label="List view"
              className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors ${
                viewMode === 'list' ? 'bg-[#0B0B0B] text-white' : 'text-[#71717A] hover:text-[#0B0B0B]'
              }`}
            >
              <List className="w-3.5 h-3.5" />
            </button>
          </div>

          {isEventCreator && (
            <button
              type="button"
              onClick={onOpenCreateModal}
              className="px-5 py-2.5 rounded-full bg-[#0B0B0B] text-white text-xs font-semibold hover:bg-zinc-800 transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
            >
              <Plus className="w-4 h-4" />
              Create Event
            </button>
          )}
        </div>
      </div>

      {/* Category Filter Strip */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
        <button
          type="button"
          onClick={() => setCategoryFilter('all')}
          className={`px-3.5 py-1.5 rounded-full text-xs font-semibold border transition-colors whitespace-nowrap shrink-0 ${
            categoryFilter === 'all'
              ? 'bg-[#0B0B0B] text-white border-[#0B0B0B]'
              : 'bg-white text-[#71717A] border-[#E5E5EA] hover:text-[#0B0B0B]'
          }`}
        >
          All Types
        </button>
        {EVENT_CATEGORIES.map((cat) => (
          <button
            key={cat}
            type="button"
            onClick={() => setCategoryFilter(cat)}
            className={`px-3.5 py-1.5 rounded-full text-xs font-semibold border transition-colors whitespace-nowrap shrink-0 ${
              categoryFilter === cat
                ? 'bg-[#0B0B0B] text-white border-[#0B0B0B]'
                : 'bg-white text-[#71717A] border-[#E5E5EA] hover:text-[#0B0B0B]'
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Empty State */}
      {filtered.length === 0 ? (
        <div className="p-12 rounded-3xl bg-[#F5F5F7] text-center">
          <p className="text-base font-semibold text-[#0B0B0B]">No productions match this filter</p>
          <p className="text-xs text-[#71717A] mt-1">
            Clear your active filters or publish a new event.
          </p>
          {isEventCreator && (
            <button
              type="button"
              onClick={onOpenCreateModal}
              className="mt-4 px-5 py-2.5 rounded-full bg-[#0B0B0B] text-white text-xs font-semibold hover:bg-zinc-800 transition-colors"
            >
              Create Event
            </button>
          )}
        </div>
      ) : viewMode === 'grid' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {filtered.map((evt) => (
            <div key={evt.id} className="flex flex-col gap-2">
              <EventFlyerCard
                event={evt}
                onOpenInvite={onOpenInvitation}
                onOpenCheckIn={onOpenQrScanner ? () => onOpenQrScanner(evt.id) : undefined}
                onManage={onManageEvent}
              />
              <div className="px-2 flex items-center justify-between text-[11px] text-[#71717A]">
                <span className="font-mono tabular-nums">
                  {evt.registered}/{evt.capacity} seats · ${evt.revenue.toLocaleString()} gross
                </span>
                <button
                  type="button"
                  onClick={() => onNavigateAttendees(evt.id)}
                  className="font-semibold text-[#0B0B0B] hover:underline"
                >
                  Guest Roster →
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((evt) => {
            const pct = Math.round((evt.registered / Math.max(1, evt.capacity)) * 100);
            const isCeiling = pct >= profile.capacityAlertThreshold;
            const flyerSrc = evt.flyerUrl || getCategoryPreset(evt.category).flyerUrl;
            const inviteUrl = buildEventInvitationUrl(evt.slug || evt.id);
            const formattedDate = formatEventDateSpan(evt.isoDate, evt.endIsoDate, evt.date);
            const durationBadge = formatEventDurationBadge(evt);
            return (
              <div
                key={evt.id}
                className="p-4 rounded-2xl bg-[#F5F5F7] border border-transparent hover:bg-white hover:border-[#E5E5EA] transition-all flex flex-col md:flex-row md:items-center justify-between gap-4"
              >
                <div className="flex items-center gap-4 min-w-0">
                  {flyerSrc ? (
                    <img
                      src={flyerSrc}
                      alt={evt.title}
                      className="w-20 h-14 rounded-xl object-cover shrink-0 border border-[#E5E5EA]"
                    />
                  ) : (
                    <MonochromePoster variant={evt.artwork} className="w-14 h-14 rounded-xl" />
                  )}
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-sm font-bold text-[#0B0B0B] truncate">{evt.title}</h2>
                      {durationBadge && (
                        <span className="px-2 py-0.5 rounded-full bg-[#0B0B0B] text-white text-[10px] font-semibold whitespace-nowrap">
                          {durationBadge}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-[#71717A] mt-0.5 truncate">
                      <span className="capitalize text-[#0B0B0B] font-medium">{evt.status}</span> ·{' '}
                      {evt.category} · {formattedDate} · {evt.venue}, {evt.city}
                    </p>
                  </div>
                </div>

                <div className="flex items-center justify-between md:justify-end gap-4 shrink-0">
                  <div className="w-28">
                    <div className="flex justify-between text-[11px] tabular-nums mb-1">
                      <span className={isCeiling ? 'text-[#EF4444] font-semibold' : 'text-[#71717A]'}>
                        {pct}% filled
                      </span>
                      <span className="text-[#0B0B0B] font-medium">
                        {evt.registered}/{evt.capacity}
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full bg-[#E5E5EA] overflow-hidden">
                      <div
                        className={`h-full rounded-full ${
                          isCeiling ? 'bg-[#EF4444]' : 'bg-[#0B0B0B]'
                        }`}
                        style={{ width: `${Math.min(100, pct)}%` }}
                      />
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => {
                        if (navigator.clipboard?.writeText) {
                          navigator.clipboard.writeText(inviteUrl).catch(() => {});
                        }
                        setCopiedId(evt.id);
                        setTimeout(() => setCopiedId(null), 1800);
                      }}
                      className="px-3 py-2 rounded-full bg-white border border-[#E5E5EA] text-[#0B0B0B] text-xs font-semibold hover:border-[#0B0B0B] transition-colors inline-flex items-center gap-1.5 whitespace-nowrap"
                    >
                      {copiedId === evt.id ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-emerald-600" />
                          <span>Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" />
                          <span>Invite</span>
                        </>
                      )}
                    </button>
                    {onOpenInvitation && (
                      <button
                        type="button"
                        onClick={() => onOpenInvitation(evt)}
                        className="px-3 py-2 rounded-full bg-white border border-[#E5E5EA] text-[#0B0B0B] text-xs font-semibold hover:border-[#0B0B0B] transition-colors inline-flex items-center gap-1 whitespace-nowrap"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        Open
                      </button>
                    )}
                    {onOpenQrScanner && (
                      <button
                        type="button"
                        onClick={() => onOpenQrScanner(evt.id)}
                        className="px-3 py-2 rounded-full bg-white border border-[#E5E5EA] text-[#0B0B0B] text-xs font-semibold hover:border-[#0B0B0B] transition-colors inline-flex items-center gap-1 whitespace-nowrap"
                      >
                        <QrCode className="w-3.5 h-3.5" />
                        QR
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => onManageEvent(evt)}
                      className="px-4 py-2 rounded-full bg-[#0B0B0B] text-white text-xs font-semibold hover:bg-zinc-800 transition-colors whitespace-nowrap shrink-0"
                    >
                      Manage
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
