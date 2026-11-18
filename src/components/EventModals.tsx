import React, { useState } from 'react';
import { AlertCircle, ArrowUpRight, Check, MapPin, Trash2, Users, X } from 'lucide-react';
import {
  ArtworkVariant,
  EventItem,
  EventStatus,
  OrganizerProfile,
  ScheduleBlock,
} from '../types/events';
import { CircularGauge, MonochromePoster } from './MonochromeArtwork';

interface CreateEventModalProps {
  organizerName?: string;
  onClose: () => void;
  onCreate: (event: EventItem) => void;
}

const ARTWORK_OPTIONS: { id: ArtworkVariant; label: string }[] = [
  { id: 'forum', label: 'Forum Concentric' },
  { id: 'architecture', label: 'Architectural Mass' },
  { id: 'sound', label: 'Acoustic Bars' },
  { id: 'hardware', label: 'Precision Frame' },
  { id: 'typography', label: 'Editorial Grid' },
  { id: 'spatial', label: 'Spatial Orbit' },
];

export const CreateEventModal: React.FC<CreateEventModalProps> = ({
  organizerName = 'Josh Mensah',
  onClose,
  onCreate,
}) => {
  const [title, setTitle] = useState('');
  const [subtitle, setSubtitle] = useState('');
  const [category, setCategory] = useState('Events');
  const [date, setDate] = useState('2026-12-18');
  const [time, setTime] = useState('09:00 GMT');
  const [venue, setVenue] = useState('');
  const [city, setCity] = useState('Accra');
  const [capacity, setCapacity] = useState(250);
  const [ticketPrice, setTicketPrice] = useState(0);
  const [status, setStatus] = useState<EventStatus>('upcoming');
  const [artwork, setArtwork] = useState<ArtworkVariant>('architecture');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !venue.trim()) return;

    const parsedDate = new Date(date + 'T00:00:00');
    const formattedDate = isNaN(parsedDate.getTime())
      ? date
      : parsedDate.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' });

    const slug =
      title
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') || `event-${Date.now()}`;

    const initialReg = status === 'draft' ? 0 : Math.min(24, Math.max(10, Number(capacity) || 100));

    const newEvent: EventItem = {
      id: `evt-${Date.now()}`,
      slug,
      title: title.trim(),
      subtitle: subtitle.trim() || 'Curated production and live stage gathering.',
      category,
      status,
      date: formattedDate,
      isoDate: date,
      time,
      venue: venue.trim(),
      city: city.trim() || 'Accra',
      capacity: Math.max(10, Number(capacity) || 100),
      registered: initialReg,
      checkedIn: 0,
      smsDispatched: initialReg,
      ticketPrice: Math.max(0, Number(ticketPrice) || 0),
      revenue: status === 'draft' ? 0 : initialReg * (Number(ticketPrice) || 0),
      organizer: organizerName,
      artwork,
    };
    onCreate(newEvent);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-event-title"
    >
      <div className="bg-white w-full max-w-xl rounded-3xl border border-[#E5E5EA] p-6 sm:p-8 max-h-[90vh] overflow-y-auto soft-popover-shadow">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 id="create-event-title" className="text-xl font-bold tracking-tight text-[#0B0B0B]">
              Create Production
            </h2>
            <p className="text-xs text-[#71717A] mt-0.5">
              Configure venue capacity, ticketing, and artwork identity.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="w-9 h-9 rounded-full border border-[#E5E5EA] flex items-center justify-center text-[#0B0B0B] hover:bg-[#F5F5F7] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-[#0B0B0B] mb-1.5">
              Event Title
            </label>
            <input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Accra FinTech Builder Summit"
              className="w-full h-11 px-4 rounded-2xl bg-[#F5F5F7] text-sm text-[#0B0B0B] placeholder:text-[#71717A] border border-transparent focus:bg-white focus:border-[#0B0B0B] focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-[#0B0B0B] mb-1.5">
              Summary Line
            </label>
            <input
              type="text"
              value={subtitle}
              onChange={(e) => setSubtitle(e.target.value)}
              placeholder="Brief editorial description for attendee passes"
              className="w-full h-11 px-4 rounded-2xl bg-[#F5F5F7] text-sm text-[#0B0B0B] placeholder:text-[#71717A] border border-transparent focus:bg-white focus:border-[#0B0B0B] focus:outline-none"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-[#0B0B0B] mb-1.5">
                Venue
              </label>
              <input
                type="text"
                required
                value={venue}
                onChange={(e) => setVenue(e.target.value)}
                placeholder="e.g. Movenpick Grand Ballroom"
                className="w-full h-11 px-4 rounded-2xl bg-[#F5F5F7] text-sm text-[#0B0B0B] placeholder:text-[#71717A] border border-transparent focus:bg-white focus:border-[#0B0B0B] focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#0B0B0B] mb-1.5">
                City
              </label>
              <input
                type="text"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder="Accra"
                className="w-full h-11 px-4 rounded-2xl bg-[#F5F5F7] text-sm text-[#0B0B0B] placeholder:text-[#71717A] border border-transparent focus:bg-white focus:border-[#0B0B0B] focus:outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="col-span-2 sm:col-span-1">
              <label className="block text-xs font-semibold text-[#0B0B0B] mb-1.5">Date</label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full h-11 px-3 rounded-2xl bg-[#F5F5F7] text-xs text-[#0B0B0B] border border-transparent focus:bg-white focus:border-[#0B0B0B] focus:outline-none tabular-nums"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#0B0B0B] mb-1.5">Start Time</label>
              <input
                type="text"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="w-full h-11 px-3 rounded-2xl bg-[#F5F5F7] text-xs text-[#0B0B0B] border border-transparent focus:bg-white focus:border-[#0B0B0B] focus:outline-none tabular-nums"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#0B0B0B] mb-1.5">Capacity</label>
              <input
                type="number"
                min={10}
                value={capacity}
                onChange={(e) => setCapacity(Number(e.target.value))}
                className="w-full h-11 px-3 rounded-2xl bg-[#F5F5F7] text-xs text-[#0B0B0B] border border-transparent focus:bg-white focus:border-[#0B0B0B] focus:outline-none tabular-nums"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#0B0B0B] mb-1.5">Price ($)</label>
              <input
                type="number"
                min={0}
                value={ticketPrice}
                onChange={(e) => setTicketPrice(Number(e.target.value))}
                className="w-full h-11 px-3 rounded-2xl bg-[#F5F5F7] text-xs text-[#0B0B0B] border border-transparent focus:bg-white focus:border-[#0B0B0B] focus:outline-none tabular-nums"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-[#0B0B0B] mb-1.5">Category</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full h-11 px-4 rounded-2xl bg-[#F5F5F7] text-sm text-[#0B0B0B] border border-transparent focus:bg-white focus:border-[#0B0B0B] focus:outline-none"
              >
                <option value="Events">Events &amp; Celebrations</option>
                <option value="Wedding">Wedding</option>
                <option value="Funeral">Funeral &amp; Memorial</option>
                <option value="Church">Church &amp; Ministry</option>
                <option value="Musical">Musical &amp; Concert</option>
                <option value="Corporate">Corporate &amp; Gala</option>
                <option value="Tech">Tech &amp; Conference</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#0B0B0B] mb-1.5">Initial State</label>
              <div className="grid grid-cols-3 gap-1.5 p-1 bg-[#F5F5F7] rounded-full">
                {(['upcoming', 'live', 'draft'] as EventStatus[]).map((st) => (
                  <button
                    key={st}
                    type="button"
                    onClick={() => setStatus(st)}
                    className={`h-9 rounded-full text-xs font-semibold capitalize transition-colors ${
                      status === st
                        ? 'bg-[#0B0B0B] text-white'
                        : 'text-[#71717A] hover:text-[#0B0B0B]'
                    }`}
                  >
                    {st}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-[#0B0B0B] mb-2">
              Monochrome Poster Motif
            </label>
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
              {ARTWORK_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setArtwork(opt.id)}
                  className={`p-1.5 rounded-2xl border transition-all flex flex-col items-center gap-1 ${
                    artwork === opt.id
                      ? 'border-[#0B0B0B] bg-[#F5F5F7]'
                      : 'border-[#E5E5EA] hover:border-[#71717A]'
                  }`}
                >
                  <MonochromePoster variant={opt.id} className="w-11 h-11 rounded-xl" />
                  <span className="text-[10px] font-medium text-[#0B0B0B] truncate w-full text-center">
                    {opt.label.split(' ')[0]}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="pt-3 flex items-center justify-end gap-3 border-t border-[#E5E5EA]">
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2.5 rounded-full text-xs font-semibold border border-[#E5E5EA] text-[#0B0B0B] hover:bg-[#F5F5F7] transition-colors whitespace-nowrap shrink-0"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-6 py-2.5 rounded-full text-xs font-semibold bg-[#0B0B0B] text-white hover:bg-zinc-800 transition-colors whitespace-nowrap shrink-0"
            >
              Publish Event
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

interface EventDetailModalProps {
  event: EventItem;
  scheduleBlocks: ScheduleBlock[];
  capacityThreshold: number;
  onClose: () => void;
  onUpdateEvent: (updated: EventItem) => void;
  onDeleteEvent: (id: string) => void;
  onOpenAttendees: (eventId: string) => void;
}

export const EventDetailModal: React.FC<EventDetailModalProps> = ({
  event,
  scheduleBlocks,
  capacityThreshold,
  onClose,
  onUpdateEvent,
  onDeleteEvent,
  onOpenAttendees,
}) => {
  const [capacityDraft, setCapacityDraft] = useState(event.capacity);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const pct = Math.round((event.registered / Math.max(1, event.capacity)) * 100);
  const isAtCeiling = pct >= capacityThreshold;
  const eventSessions = scheduleBlocks.filter((b) => b.eventId === event.id);

  const handleStatusChange = (newStatus: EventStatus) => {
    onUpdateEvent({ ...event, status: newStatus });
  };

  const handleCapacitySave = () => {
    const nextCap = Math.max(event.registered || 10, capacityDraft);
    setCapacityDraft(nextCap);
    onUpdateEvent({ ...event, capacity: nextCap });
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="event-detail-title"
    >
      <div className="bg-white w-full max-w-2xl rounded-3xl border border-[#E5E5EA] p-6 sm:p-8 max-h-[90vh] overflow-y-auto soft-popover-shadow">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-4">
            <MonochromePoster variant={event.artwork} className="w-16 h-16 rounded-2xl" />
            <div>
              <div className="flex items-center gap-2 text-xs text-[#71717A]">
                <span>{event.category}</span>
                <span aria-hidden="true">·</span>
                <span className="capitalize">{event.status}</span>
                <span aria-hidden="true">·</span>
                <span className="tabular-nums">{event.date}</span>
              </div>
              <h2 id="event-detail-title" className="text-xl sm:text-2xl font-bold tracking-tight text-[#0B0B0B] mt-1">
                {event.title}
              </h2>
              <p className="text-sm text-[#71717A] mt-1">{event.subtitle}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close details"
            className="w-9 h-9 rounded-full border border-[#E5E5EA] flex items-center justify-center text-[#0B0B0B] hover:bg-[#F5F5F7] shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {(isAtCeiling || event.broadcastError) && (
          <div className="mt-5 p-3.5 rounded-2xl bg-[#EF4444]/8 border border-[#EF4444]/25 flex items-center gap-3">
            <AlertCircle className="w-4 h-4 text-[#EF4444] shrink-0" />
            <p className="text-xs font-medium text-[#0B0B0B]">
              {isAtCeiling
                ? `Capacity warning: ${pct}% filled (${event.registered} of ${event.capacity} seats). Increase capacity or enable waitlist.`
                : event.broadcastError}
            </p>
          </div>
        )}

        {/* Key Metrics Strip */}
        <div className="grid grid-cols-3 gap-3 mt-6">
          <div className="p-4 rounded-2xl bg-[#F5F5F7] flex items-center justify-between gap-2">
            <div>
              <p className="text-xs text-[#71717A]">Occupancy</p>
              <p className="text-lg font-bold text-[#0B0B0B] tabular-nums mt-0.5">
                {event.registered} / {event.capacity}
              </p>
            </div>
            <CircularGauge value={pct} size={46} alertThreshold={capacityThreshold} />
          </div>
          <div className="p-4 rounded-2xl bg-[#F5F5F7]">
            <p className="text-xs text-[#71717A]">Gross Revenue</p>
            <p className="text-lg font-bold text-[#0B0B0B] tabular-nums mt-0.5">
              ${event.revenue.toLocaleString()}
            </p>
            <p className="text-[11px] text-[#71717A] tabular-nums mt-0.5">
              ${event.ticketPrice} avg pass
            </p>
          </div>
          <div className="p-4 rounded-2xl bg-[#F5F5F7]">
            <p className="text-xs text-[#71717A]">Location</p>
            <p className="text-sm font-semibold text-[#0B0B0B] mt-1 truncate">{event.venue}</p>
            <p className="text-[11px] text-[#71717A] inline-flex items-center gap-1 mt-0.5">
              <MapPin className="w-3 h-3" />
              {event.city} · {event.time}
            </p>
          </div>
        </div>

        {/* Status & Capacity Controls */}
        <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="p-4 rounded-2xl bg-[#F5F5F7]">
            <p className="text-xs font-semibold text-[#0B0B0B] mb-2">Production State</p>
            <div className="grid grid-cols-4 gap-1 p-1 bg-white rounded-full border border-[#E5E5EA]">
              {(['live', 'upcoming', 'draft', 'past'] as EventStatus[]).map((st) => (
                <button
                  key={st}
                  type="button"
                  onClick={() => handleStatusChange(st)}
                  className={`h-8 rounded-full text-xs font-semibold capitalize transition-colors ${
                    event.status === st
                      ? 'bg-[#0B0B0B] text-white'
                      : 'text-[#71717A] hover:text-[#0B0B0B]'
                  }`}
                >
                  {st}
                </button>
              ))}
            </div>
          </div>

          <div className="p-4 rounded-2xl bg-[#F5F5F7]">
            <p className="text-xs font-semibold text-[#0B0B0B] mb-2">Adjust Venue Capacity</p>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={event.registered || 10}
                value={capacityDraft}
                onChange={(e) => setCapacityDraft(Number(e.target.value))}
                className="flex-1 h-10 px-3.5 rounded-full bg-white border border-[#E5E5EA] text-sm font-medium text-[#0B0B0B] tabular-nums focus:border-[#0B0B0B] focus:outline-none"
              />
              <button
                type="button"
                onClick={handleCapacitySave}
                className="px-4 h-10 rounded-full bg-[#0B0B0B] text-white text-xs font-semibold hover:bg-zinc-800 transition-colors whitespace-nowrap shrink-0"
              >
                Update Cap
              </button>
            </div>
          </div>
        </div>

        {/* Run of Show Preview */}
        <div className="mt-6">
          <div className="flex items-center justify-between mb-2.5">
            <h3 className="text-sm font-semibold text-[#0B0B0B]">Run-of-Show Cues</h3>
            <span className="text-xs text-[#71717A] tabular-nums">{eventSessions.length} blocks</span>
          </div>
          {eventSessions.length === 0 ? (
            <div className="p-4 rounded-2xl bg-[#F5F5F7] text-xs text-[#71717A]">
              No production cues scheduled yet. Add cues in the Schedule tab.
            </div>
          ) : (
            <div className="space-y-2">
              {eventSessions.map((block) => (
                <div
                  key={block.id}
                  className="px-4 py-3 rounded-2xl bg-[#F5F5F7] flex items-center justify-between gap-3"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="font-mono text-xs font-medium text-[#0B0B0B] tabular-nums shrink-0">
                      {block.time}
                    </span>
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-[#0B0B0B] truncate">{block.title}</p>
                      <p className="text-[11px] text-[#71717A] truncate">
                        {block.stage} · {block.lead} · {block.duration}
                      </p>
                    </div>
                  </div>
                  <span className="text-[11px] font-medium text-[#71717A] shrink-0">
                    {block.completed ? 'Ready' : 'Pending'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="mt-6 pt-4 border-t border-[#E5E5EA] flex flex-wrap items-center justify-between gap-3">
          {confirmDelete ? (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  onDeleteEvent(event.id);
                  onClose();
                }}
                className="px-4 py-2 rounded-full text-xs font-semibold bg-[#EF4444] text-white hover:bg-red-600 transition-colors whitespace-nowrap shrink-0"
              >
                Confirm Delete
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="px-3 py-2 rounded-full text-xs font-semibold border border-[#E5E5EA] text-[#0B0B0B] hover:bg-[#F5F5F7] transition-colors whitespace-nowrap shrink-0"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="px-4 py-2 rounded-full text-xs font-semibold text-[#71717A] hover:text-[#EF4444] hover:bg-[#F5F5F7] transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Remove Event
            </button>
          )}
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => {
                onOpenAttendees(event.id);
                onClose();
              }}
              className="px-5 py-2.5 rounded-full text-xs font-semibold border border-[#E5E5EA] text-[#0B0B0B] hover:border-[#0B0B0B] transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
            >
              <Users className="w-3.5 h-3.5" />
              Attendee Roster
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2.5 rounded-full text-xs font-semibold bg-[#0B0B0B] text-white hover:bg-zinc-800 transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
            >
              Done
              <ArrowUpRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

interface PlanUpgradeModalProps {
  currentPlan: OrganizerProfile['plan'];
  onSelectPlan: (plan: OrganizerProfile['plan']) => void;
  onClose: () => void;
}

export const PlanUpgradeModal: React.FC<PlanUpgradeModalProps> = ({
  currentPlan,
  onSelectPlan,
  onClose,
}) => {
  const tiers: {
    name: OrganizerProfile['plan'];
    audience: string;
    price: string;
    limits: string[];
  }[] = [
    {
      name: 'Starter',
      audience: 'For intimate weddings, fellowships & meetups',
      price: '$0 / forever',
      limits: ['1 active event', 'Up to 50 attendees per event', '20 free starter SMS credits'],
    },
    {
      name: 'Pro Organizer',
      audience: 'For concerts, church conventions, corporate & tech',
      price: '$19 / mo',
      limits: ['Unlimited concurrent events', 'Custom Arkesel SMS Sender ID', 'CSV export & offline gate PWA'],
    },
    {
      name: 'Enterprise',
      audience: 'For national funerals, festivals & multi-venue teams',
      price: '$79 / mo',
      limits: ['Dedicated SMPP carrier throughput', 'Custom domain passbooks', 'Priority gate team onboarding'],
    },
  ];

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="plans-modal-title"
    >
      <div className="bg-white w-full max-w-3xl rounded-3xl border border-[#E5E5EA] p-6 sm:p-8 max-h-[90vh] overflow-y-auto soft-popover-shadow">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 id="plans-modal-title" className="text-xl font-bold tracking-tight text-[#0B0B0B]">
              Workspace Capacity Plans
            </h2>
            <p className="text-xs text-[#71717A] mt-0.5">
              Explicit stage limits and gate throughput per billing cycle.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close plans"
            className="w-9 h-9 rounded-full border border-[#E5E5EA] flex items-center justify-center text-[#0B0B0B] hover:bg-[#F5F5F7]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {tiers.map((tier) => {
            const isCurrent = currentPlan === tier.name;
            return (
              <div
                key={tier.name}
                className={`p-5 rounded-3xl flex flex-col justify-between transition-colors ${
                  isCurrent
                    ? 'bg-[#0B0B0B] text-white'
                    : 'bg-[#F5F5F7] text-[#0B0B0B]'
                }`}
              >
                <div>
                  <p className={`text-xs ${isCurrent ? 'text-zinc-400' : 'text-[#71717A]'}`}>
                    {tier.audience}
                  </p>
                  <h3 className="text-lg font-bold mt-1">{tier.name}</h3>
                  <p className="text-2xl font-bold tabular-nums mt-3">{tier.price}</p>
                  <ul className="mt-4 space-y-2">
                    {tier.limits.map((lim) => (
                      <li key={lim} className="text-xs flex items-start gap-2">
                        <Check className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                        <span className={isCurrent ? 'text-zinc-200' : 'text-[#444748]'}>{lim}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    onSelectPlan(tier.name);
                    onClose();
                  }}
                  className={`mt-6 w-full py-2.5 rounded-full text-xs font-semibold transition-colors ${
                    isCurrent
                      ? 'bg-white text-[#0B0B0B]'
                      : 'bg-[#0B0B0B] text-white hover:bg-zinc-800'
                  }`}
                >
                  {isCurrent ? 'Current Plan' : `Switch to ${tier.name}`}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
