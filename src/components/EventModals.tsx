import React, { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowUpRight,
  BarChart3,
  Check,
  Copy,
  Download,
  Gift,
  ImagePlus,
  Link2,
  MapPin,
  QrCode,
  Share2,
  ShieldCheck,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import {
  ArtworkVariant,
  DesignTheme,
  EventCheckInPolicy,
  EventItem,
  EventStatus,
  EventValidationConfig,
  OrganizerProfile,
  ScheduleBlock,
} from '../types/events';
import { getCategoryPreset } from '../data/initialData';
import {
  formatEventDateSpan,
  formatEventDurationBadge,
  getEventCheckInPolicy,
  isMultiDayEvent,
  sanitizeIsoDate,
} from '../lib/eventDates';
import { STUDIO_FLYER_PRESETS, compressFlyerImageFile } from '../lib/flyerUpload';
import { appendPoweredByLine } from '../lib/eventMessages';
import { isPollsEnabledForEvent } from '../lib/polls';
import {
  buildEventInvitationUrl,
  buildEventOgImageUrl,
  downloadQrSvg,
} from '../lib/qr';
import {
  getPlanEntitlements,
  isActiveEventStatus,
  STARTER_MAX_ACTIVE_EVENTS,
  STARTER_MAX_ATTENDEES_PER_EVENT,
  SUBSCRIPTION_PLAN_CATALOG,
} from '../lib/subscriptionPlans';
import { GuestCircleValidationEditor } from './GuestCircleValidationEditor';
import { CircularGauge, MonochromePoster } from './MonochromeArtwork';
import { ThemeColorPicker } from './ThemeColorPicker';

interface CreateEventModalProps {
  organizerName?: string;
  profile?: OrganizerProfile;
  events?: EventItem[];
  onOpenBilling?: () => void;
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
  organizerName = 'Organiser',
  profile,
  events = [],
  onOpenBilling,
  onClose,
  onCreate,
}) => {
  const entitlements = getPlanEntitlements(profile);
  const activeEventsCount = events.filter((e) => isActiveEventStatus(e.status)).length;
  const atStarterActiveLimit =
    entitlements.maxActiveEvents !== null && activeEventsCount >= entitlements.maxActiveEvents;

  const [title, setTitle] = useState('');
  const [subtitle, setSubtitle] = useState('');
  const [category, setCategory] = useState('Events');
  const [date, setDate] = useState('2026-12-18');
  const [isMultiDay, setIsMultiDay] = useState(false);
  const [endDate, setEndDate] = useState('2026-12-20');
  const [checkInPolicy, setCheckInPolicy] = useState<EventCheckInPolicy>('single-entry');
  const [policyTouched, setPolicyTouched] = useState(false);
  const [time, setTime] = useState('09:00 GMT');
  const [venue, setVenue] = useState('');
  const [city, setCity] = useState('Accra');
  const [capacity, setCapacity] = useState(
    entitlements.maxAttendeesPerEvent ?? 250
  );
  const [ticketPrice, setTicketPrice] = useState(0);
  const [status, setStatus] = useState<EventStatus>(atStarterActiveLimit ? 'draft' : 'upcoming');
  const [publishQrPass, setPublishQrPass] = useState(true);
  const [artwork, setArtwork] = useState<ArtworkVariant>('architecture');
  const [designTheme, setDesignTheme] = useState<DesignTheme>('obsidian-gold');
  const [brandColor, setBrandColor] = useState<string | undefined>(undefined);
  const [customFlyerUrl, setCustomFlyerUrl] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const createFlyerInputRef = useRef<HTMLInputElement | null>(null);

  const cleanStartIso = sanitizeIsoDate(date) ?? '2026-12-18';
  const cleanEndIso =
    isMultiDay && sanitizeIsoDate(endDate) && endDate > cleanStartIso ? endDate : undefined;
  const formattedSpanPreview = formatEventDateSpan(cleanStartIso, cleanEndIso);
  const durationBadgePreview = formatEventDurationBadge({
    isoDate: cleanStartIso,
    endIsoDate: cleanEndIso,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !venue.trim() || submitting) return;
    setModalError(null);
    setSubmitting(true);

    const formattedDate = formatEventDateSpan(cleanStartIso, cleanEndIso);

    const slug =
      title
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') || `event-${Date.now()}`;

    const clampedCap =
      entitlements.maxAttendeesPerEvent !== null
        ? Math.min(entitlements.maxAttendeesPerEvent, Math.max(10, Number(capacity) || STARTER_MAX_ATTENDEES_PER_EVENT))
        : Math.max(10, Number(capacity) || 100);
    const effectiveStatus: EventStatus =
      atStarterActiveLimit && isActiveEventStatus(status) ? 'draft' : status;
    const initialReg = 0;
    const preset = getCategoryPreset(category);

    const newEvent: EventItem = {
      id: `evt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      slug,
      title: title.trim(),
      subtitle: subtitle.trim() || 'Curated production and live stage gathering.',
      category,
      status: effectiveStatus,
      date: formattedDate,
      isoDate: cleanStartIso,
      ...(cleanEndIso ? { endIsoDate: cleanEndIso } : {}),
      checkInPolicy,
      time,
      venue: venue.trim(),
      city: city.trim() || 'Accra',
      capacity: clampedCap,
      registered: initialReg,
      checkedIn: 0,
      smsDispatched: initialReg,
      ticketPrice: Math.max(0, Number(ticketPrice) || 0),
      revenue: status === 'draft' ? 0 : initialReg * (Number(ticketPrice) || 0),
      organizer: organizerName,
      artwork,
      flyerUrl: customFlyerUrl || preset.flyerUrl,
      designTheme,
      brandColor,
      validationConfig: preset.validationConfig,
      extraDataConfig: {
        ...preset.extraDataConfig,
        ...(cleanEndIso ? { endIsoDate: cleanEndIso } : {}),
        checkInPolicy,
        brandColor,
      },
      qrPassPublished: status === 'draft' ? false : publishQrPass,
    };
    try {
      await Promise.resolve(onCreate(newEvent));
      onClose();
    } catch (err) {
      setModalError(err instanceof Error ? err.message : 'Unable to create event in Supabase.');
    } finally {
      setSubmitting(false);
    }
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
          {modalError && (
            <div className="p-3 rounded-2xl bg-[#EF4444]/10 border border-[#EF4444]/30 text-xs font-medium text-[#0B0B0B]">
              {modalError}
            </div>
          )}
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
              <label className="block text-xs font-semibold text-[#0B0B0B] mb-1.5">Start Date</label>
              <input
                type="date"
                value={date}
                onChange={(e) => {
                  const next = e.target.value;
                  setDate(next);
                  if (isMultiDay && next && (!endDate || endDate <= next)) {
                    const bumped = new Date(Date.parse(`${next}T00:00:00Z`) + 86_400_000)
                      .toISOString()
                      .slice(0, 10);
                    setEndDate(bumped);
                  }
                }}
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
              <label className="block text-xs font-semibold text-[#0B0B0B] mb-1.5">
                Capacity {entitlements.maxAttendeesPerEvent ? `(Max ${entitlements.maxAttendeesPerEvent})` : ''}
              </label>
              <input
                type="number"
                min={10}
                max={entitlements.maxAttendeesPerEvent ?? undefined}
                value={capacity}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  setCapacity(
                    entitlements.maxAttendeesPerEvent !== null
                      ? Math.min(entitlements.maxAttendeesPerEvent, val)
                      : val
                  );
                }}
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

          <div className="p-3.5 rounded-2xl bg-[#F5F5F7] space-y-2.5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold text-[#0B0B0B]">Multi-day event</p>
                <p className="text-[11px] text-[#71717A]">
                  {formattedSpanPreview}
                  {durationBadgePreview ? ` · ${durationBadgePreview}` : ''}
                </p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer shrink-0">
                <input
                  type="checkbox"
                  checked={isMultiDay}
                  onChange={(e) => {
                    const next = e.target.checked;
                    setIsMultiDay(next);
                    if (next && (!endDate || endDate <= date)) {
                      const bumped = new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000)
                        .toISOString()
                        .slice(0, 10);
                      setEndDate(bumped);
                    }
                    if (!policyTouched) {
                      setCheckInPolicy(next ? 'daily-reentry' : 'single-entry');
                    }
                  }}
                  className="sr-only peer"
                />
                <div className="w-10 h-5 bg-[#E5E5EA] rounded-full peer peer-checked:bg-[#0B0B0B] after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-5" />
              </label>
            </div>
            {isMultiDay && (
              <div>
                <label className="block text-[11px] font-semibold text-[#0B0B0B] mb-1">
                  End Date
                </label>
                <input
                  type="date"
                  min={date}
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-full h-10 px-3 rounded-xl bg-white text-xs text-[#0B0B0B] border border-[#E5E5EA] tabular-nums focus:outline-none"
                />
              </div>
            )}
            <div className="grid grid-cols-2 gap-1 p-1 bg-white rounded-xl border border-[#E5E5EA]">
              {(
                [
                  { id: 'single-entry', label: 'One-Time Entry' },
                  { id: 'daily-reentry', label: 'Daily Re-Entry Pass' },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => {
                    setPolicyTouched(true);
                    setCheckInPolicy(opt.id);
                  }}
                  className={`py-1.5 rounded-lg text-[11px] font-semibold transition-colors ${
                    checkInPolicy === opt.id
                      ? 'bg-[#0B0B0B] text-white'
                      : 'text-[#71717A] hover:text-[#0B0B0B]'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-[#0B0B0B] mb-1.5">Category</label>
              <select
                value={category}
                onChange={(e) => {
                  const nextCat = e.target.value;
                  setCategory(nextCat);
                  setDesignTheme(getCategoryPreset(nextCat).designTheme);
                }}
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
                {(['upcoming', 'live', 'draft'] as EventStatus[]).map((st) => {
                  const disabledActive = atStarterActiveLimit && isActiveEventStatus(st);
                  return (
                    <button
                      key={st}
                      type="button"
                      disabled={disabledActive}
                      onClick={() => setStatus(st)}
                      className={`h-9 rounded-full text-xs font-semibold capitalize transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                        status === st
                          ? 'bg-[#0B0B0B] text-white'
                          : 'text-[#71717A] hover:text-[#0B0B0B]'
                      }`}
                    >
                      {st}
                    </button>
                  );
                })}
              </div>
              {atStarterActiveLimit && (
                <p className="text-[11px] text-amber-700 mt-1">
                  Starter allows {STARTER_MAX_ACTIVE_EVENTS} active event. Save as Draft or{' '}
                  {onOpenBilling ? (
                    <button type="button" onClick={onOpenBilling} className="underline font-semibold">
                      Upgrade to Pro
                    </button>
                  ) : (
                    'Upgrade to Pro'
                  )}.
                </p>
              )}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-xs font-semibold text-[#0B0B0B]">
                Event Flyer Banner &amp; Motif
              </label>
              <button
                type="button"
                onClick={() => createFlyerInputRef.current?.click()}
                className="px-3 py-1 rounded-full bg-[#F5F5F7] hover:bg-[#E5E5EA] text-[11px] font-semibold text-[#0B0B0B] inline-flex items-center gap-1.5 transition-colors"
              >
                <ImagePlus className="w-3.5 h-3.5" />
                <span>{customFlyerUrl ? 'Change Picture' : 'Upload Flyer Picture'}</span>
              </button>
              <input
                ref={createFlyerInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (!file) return;
                  const compressed = await compressFlyerImageFile(file);
                  setCustomFlyerUrl(compressed);
                }}
              />
            </div>

            {customFlyerUrl && (
              <div className="mb-3 relative rounded-2xl overflow-hidden border border-[#E5E5EA] aspect-[16/7] bg-[#0B0B0B]">
                <img
                  src={customFlyerUrl}
                  alt="Custom event flyer preview"
                  className="w-full h-full object-cover"
                />
                <button
                  type="button"
                  onClick={() => setCustomFlyerUrl('')}
                  className="absolute top-2 right-2 px-2.5 py-1 rounded-full bg-black/75 text-white text-[10px] font-semibold"
                >
                  Use Preset
                </button>
              </div>
            )}

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

          <div className="p-3.5 rounded-2xl bg-[#F5F5F7]">
            <ThemeColorPicker
              compact
              designTheme={designTheme}
              brandColor={brandColor}
              onChangeTheme={setDesignTheme}
              onChangeBrandColor={setBrandColor}
              title="Event Theme & Brand Colors"
            />
          </div>

          <div className="p-3.5 rounded-2xl bg-[#F5F5F7] flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold text-[#0B0B0B]">
                Publish Check-In QR Pass (Creator Only)
              </p>
              <p className="text-[11px] text-[#71717A] mt-0.5">
                {status === 'draft'
                  ? 'Draft productions keep check-in QR passes unpublished until launched.'
                  : 'Enable guests and walk-in registrations to receive active check-in QR passes.'}
              </p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer shrink-0">
              <input
                type="checkbox"
                disabled={status === 'draft'}
                checked={status !== 'draft' && publishQrPass}
                onChange={(e) => setPublishQrPass(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-[#E5E5EA] peer-disabled:opacity-50 rounded-full peer peer-checked:bg-[#0B0B0B] after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-full" />
            </label>
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
              disabled={submitting}
              className="px-6 py-2.5 rounded-full text-xs font-semibold bg-[#0B0B0B] text-white hover:bg-zinc-800 transition-colors whitespace-nowrap shrink-0 disabled:opacity-60"
            >
              {submitting ? 'Publishing...' : 'Publish Event'}
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
  profile?: OrganizerProfile;
  events?: EventItem[];
  canPublishQrPass?: boolean;
  onToggleQrPassPublished?: (eventId: string, published: boolean) => Promise<void> | void;
  onOpenBilling?: () => void;
  onClose: () => void;
  onUpdateEvent: (updated: EventItem) => void;
  onDeleteEvent: (id: string) => void;
  onOpenAttendees: (eventId: string) => void;
}

export const EventDetailModal: React.FC<EventDetailModalProps> = ({
  event,
  scheduleBlocks,
  capacityThreshold,
  profile,
  events = [],
  canPublishQrPass = true,
  onToggleQrPassPublished,
  onOpenBilling,
  onClose,
  onUpdateEvent,
  onDeleteEvent,
  onOpenAttendees,
}) => {
  const preset = getCategoryPreset(event.category);
  const entitlements = getPlanEntitlements(profile);
  const otherActiveCount = events.filter(
    (e) => e.id !== event.id && isActiveEventStatus(e.status)
  ).length;
  const starterActiveBlocked =
    entitlements.maxActiveEvents !== null &&
    !isActiveEventStatus(event.status) &&
    otherActiveCount >= entitlements.maxActiveEvents;

  const [capacityDraft, setCapacityDraft] = useState(event.capacity);
  const [startIsoDraft, setStartIsoDraft] = useState(sanitizeIsoDate(event.isoDate) ?? '2026-12-18');
  const [multiDayDraft, setMultiDayDraft] = useState(() => isMultiDayEvent(event));
  const [endIsoDraft, setEndIsoDraft] = useState(() => {
    const start = sanitizeIsoDate(event.isoDate) ?? '2026-12-18';
    const existingEnd = sanitizeIsoDate(event.endIsoDate);
    if (existingEnd && existingEnd > start) return existingEnd;
    return new Date(Date.parse(`${start}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  });
  const [policyDraft, setPolicyDraft] = useState<EventCheckInPolicy>(() => getEventCheckInPolicy(event));
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [copiedInvite, setCopiedInvite] = useState(false);
  const [shareFeedback, setShareFeedback] = useState<string | null>(null);
  const [validationDraft, setValidationDraft] = useState<EventValidationConfig>(() => {
    const base = event.validationConfig ?? preset.validationConfig;
    return {
      enabled: base.enabled,
      label: base.label,
      options: [...(base.options ?? preset.validationConfig.options)],
      requireInviteCode: Boolean(base.requireInviteCode),
      inviteCode: base.inviteCode ?? '',
    };
  });
  const [momoDraft, setMomoDraft] = useState(
    event.extraDataConfig?.momoNumber ?? preset.extraDataConfig.momoNumber ?? ''
  );
  const [pollsEnabledDraft, setPollsEnabledDraft] = useState<boolean>(() =>
    isPollsEnabledForEvent(event)
  );
  const [designDraft, setDesignDraft] = useState<DesignTheme>(
    event.designTheme ?? preset.designTheme
  );
  const [brandColorDraft, setBrandColorDraft] = useState<string | undefined>(
    event.brandColor ?? event.extraDataConfig?.brandColor
  );
  const [flyerDraft, setFlyerDraft] = useState<string>(event.flyerUrl || preset.flyerUrl);
  const [flyerSavedToast, setFlyerSavedToast] = useState(false);
  const detailFlyerInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setFlyerDraft(event.flyerUrl || preset.flyerUrl);
    setDesignDraft(event.designTheme ?? preset.designTheme);
    setBrandColorDraft(event.brandColor ?? event.extraDataConfig?.brandColor);
    setCapacityDraft(event.capacity);
    const nextStart = sanitizeIsoDate(event.isoDate) ?? '2026-12-18';
    setStartIsoDraft(nextStart);
    setMultiDayDraft(isMultiDayEvent(event));
    const existingEnd = sanitizeIsoDate(event.endIsoDate);
    setEndIsoDraft(
      existingEnd && existingEnd > nextStart
        ? existingEnd
        : new Date(Date.parse(`${nextStart}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)
    );
    setPolicyDraft(getEventCheckInPolicy(event));
    setPollsEnabledDraft(isPollsEnabledForEvent(event));
    const base = event.validationConfig ?? preset.validationConfig;
    setValidationDraft({
      enabled: base.enabled,
      label: base.label,
      options: [...(base.options ?? preset.validationConfig.options)],
      requireInviteCode: Boolean(base.requireInviteCode),
      inviteCode: base.inviteCode ?? '',
    });
  }, [event, preset.flyerUrl, preset.designTheme, preset.validationConfig]);

  const pct = Math.round((event.registered / Math.max(1, event.capacity)) * 100);
  const isAtCeiling = pct >= capacityThreshold;
  const eventSessions = scheduleBlocks.filter((b) => b.eventId === event.id);
  const inviteUrl = buildEventInvitationUrl(event.slug || event.id);
  const checkinQrUrl = buildEventInvitationUrl(event.slug || event.id, 'checkin');
  const ogUrl = buildEventOgImageUrl(event.slug || event.id);
  const flyerSrc = flyerDraft || preset.flyerUrl;

  const handleStatusChange = async (newStatus: EventStatus) => {
    if (starterActiveBlocked && isActiveEventStatus(newStatus)) return;
    try {
      await Promise.resolve(onUpdateEvent({ ...event, status: newStatus }));
    } catch {
      // Error surfaced cleanly via top-level banner
    }
  };

  const handleCapacitySave = async () => {
    const rawNext = Math.max(event.registered || 10, capacityDraft);
    const nextCap =
      entitlements.maxAttendeesPerEvent !== null
        ? Math.min(entitlements.maxAttendeesPerEvent, Math.max(event.registered || 1, rawNext))
        : rawNext;
    setCapacityDraft(nextCap);
    try {
      await Promise.resolve(onUpdateEvent({ ...event, capacity: nextCap }));
    } catch {
      setCapacityDraft(event.capacity);
    }
  };

  const handleCopyShareLink = async () => {
    let copied = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(inviteUrl);
        copied = true;
      }
    } catch {
      copied = false;
    }

    if (!copied && typeof document !== 'undefined') {
      try {
        const tempInput = document.createElement('input');
        tempInput.value = inviteUrl;
        document.body.appendChild(tempInput);
        tempInput.select();
        document.execCommand('copy');
        document.body.removeChild(tempInput);
        copied = true;
      } catch {
        // Ignore clipboard fallback failures
      }
    }

    setCopiedInvite(true);
    window.setTimeout(() => setCopiedInvite(false), 2000);

    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      const scheduleSnippet =
        eventSessions.length > 0
          ? `\nProgram Schedule: ${eventSessions
              .slice(0, 3)
              .map((s) => `${s.time} ${s.title}`)
              .join(' • ')}`
          : '';
      try {
        await navigator.share({
          title: event.title,
          text: appendPoweredByLine(
            `${event.title} · ${event.date} at ${event.venue}. Register, view program schedule & get your QR pass:${scheduleSnippet}`
          ),
          url: inviteUrl,
        });
        setShareFeedback('Link Copied & Shared!');
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') {
          setShareFeedback('Link Copied!');
        } else {
          setShareFeedback('Share Link Copied!');
        }
      }
    } else {
      setShareFeedback('Share Link Copied!');
    }

    window.setTimeout(() => setShareFeedback(null), 2400);
  };

  const handleApplyFlyer = async (nextFlyerUrl: string) => {
    const prevFlyer = flyerDraft;
    setFlyerDraft(nextFlyerUrl);
    try {
      await Promise.resolve(
        onUpdateEvent({
          ...event,
          designTheme: designDraft,
          brandColor: brandColorDraft,
          flyerUrl: nextFlyerUrl,
          extraDataConfig: {
            ...(event.extraDataConfig ?? preset.extraDataConfig),
            brandColor: brandColorDraft,
          },
        })
      );
      setFlyerSavedToast(true);
      setTimeout(() => setFlyerSavedToast(false), 2200);
    } catch {
      setFlyerDraft(prevFlyer);
    }
  };

  const handleSaveFormsAndTheme = async () => {
    const parsedOptions = validationDraft.options
      .map((s) => s.trim())
      .filter(Boolean);
    const nextStart = sanitizeIsoDate(startIsoDraft) ?? sanitizeIsoDate(event.isoDate) ?? '2026-12-18';
    const nextEnd =
      multiDayDraft && sanitizeIsoDate(endIsoDraft) && endIsoDraft > nextStart
        ? endIsoDraft
        : undefined;
    const nextDateSpan = formatEventDateSpan(nextStart, nextEnd, event.date);
    try {
      await Promise.resolve(
        onUpdateEvent({
          ...event,
          isoDate: nextStart,
          endIsoDate: nextEnd,
          date: nextDateSpan,
          checkInPolicy: policyDraft,
          designTheme: designDraft,
          brandColor: brandColorDraft,
          flyerUrl: flyerSrc,
          validationConfig: {
            enabled: validationDraft.enabled,
            label: validationDraft.label.trim() || preset.validationConfig.label,
            options:
              parsedOptions.length > 0
                ? parsedOptions
                : preset.validationConfig.options,
            requireInviteCode: Boolean(validationDraft.requireInviteCode),
            inviteCode: validationDraft.inviteCode?.trim() || undefined,
          },
          extraDataConfig: {
            ...(event.extraDataConfig ?? preset.extraDataConfig),
            endIsoDate: nextEnd,
            checkInPolicy: policyDraft,
            enablePolls: pollsEnabledDraft,
            momoNumber: momoDraft.trim() || undefined,
            brandColor: brandColorDraft,
          },
        })
      );
      setFlyerSavedToast(true);
      setTimeout(() => setFlyerSavedToast(false), 2200);
    } catch {
      // Error surfaced cleanly via top-level banner
    }
  };

  const formattedEventDate = formatEventDateSpan(event.isoDate, event.endIsoDate, event.date);
  const eventDurationBadge = formatEventDurationBadge(event);

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
            <button
              type="button"
              onClick={() => detailFlyerInputRef.current?.click()}
              title="Click to upload or edit event flyer picture"
              className="relative group w-20 h-16 rounded-2xl overflow-hidden border border-[#E5E5EA] shrink-0 bg-[#0B0B0B]"
            >
              {flyerSrc ? (
                <img
                  src={flyerSrc}
                  alt={event.title}
                  className="w-full h-full object-cover"
                />
              ) : (
                <MonochromePoster variant={event.artwork} className="w-full h-full rounded-2xl" />
              )}
              <span className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white">
                <ImagePlus className="w-4 h-4" />
              </span>
            </button>
            <div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-[#71717A]">
                <span>{event.category}</span>
                <span aria-hidden="true">·</span>
                <span className="capitalize">{event.status}</span>
                <span aria-hidden="true">·</span>
                <span className="tabular-nums">{formattedEventDate}</span>
                {eventDurationBadge && (
                  <span className="px-2 py-0.5 rounded-full bg-[#0B0B0B] text-white text-[10px] font-semibold">
                    {eventDurationBadge}
                  </span>
                )}
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

        {/* Direct Event Flyer Picture Uploader & Preset Switcher */}
        <div className="mt-5 p-4 rounded-2xl bg-[#F5F5F7] border border-[#E5E5EA] space-y-3">
          <input
            ref={detailFlyerInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (!file) return;
              const compressed = await compressFlyerImageFile(file);
              handleApplyFlyer(compressed);
            }}
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-xs font-semibold text-[#0B0B0B] inline-flex items-center gap-1.5">
                <ImagePlus className="w-3.5 h-3.5" />
                Event Flyer &amp; Picture Editor
              </p>
              <p className="text-[11px] text-[#71717A]">
                Uploaded flyers show immediately on Home, Studio, and Invitation links.
              </p>
            </div>
            <div className="flex items-center gap-2">
              {flyerSavedToast && (
                <span className="text-[11px] font-semibold text-emerald-600 inline-flex items-center gap-1">
                  <Check className="w-3.5 h-3.5" />
                  Synced to Home
                </span>
              )}
              <button
                type="button"
                onClick={() => detailFlyerInputRef.current?.click()}
                className="px-3.5 py-2 rounded-full bg-[#0B0B0B] text-white text-xs font-semibold hover:bg-zinc-800 transition-colors inline-flex items-center gap-1.5"
              >
                <ImagePlus className="w-3.5 h-3.5" />
                <span>Upload / Edit Picture</span>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-center">
            <div className="sm:col-span-5 rounded-xl overflow-hidden border border-[#E5E5EA] aspect-[16/10] bg-[#0B0B0B]">
              {flyerSrc ? (
                <img
                  src={flyerSrc}
                  alt={`${event.title} active flyer`}
                  className="w-full h-full object-cover"
                />
              ) : (
                <MonochromePoster variant={event.artwork} className="w-full h-full" />
              )}
            </div>
            <div className="sm:col-span-7 grid grid-cols-3 gap-2">
              {STUDIO_FLYER_PRESETS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleApplyFlyer(item.url)}
                  className={`rounded-xl overflow-hidden border-2 transition-all bg-white ${
                    flyerSrc === item.url
                      ? 'border-[#0B0B0B] ring-1 ring-[#0B0B0B]/20'
                      : 'border-transparent hover:border-[#71717A]'
                  }`}
                >
                  <img
                    src={item.url}
                    alt={item.label}
                    className="w-full h-11 object-cover"
                  />
                  <span className="block text-[10px] font-semibold text-[#0B0B0B] py-0.5 truncate px-1">
                    {item.label}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Invitation Link & OG Social Image Card */}
        <div className="mt-5 p-4 rounded-2xl bg-[#F5F5F7] border border-[#E5E5EA] space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold text-[#71717A] flex items-center gap-1">
                <Link2 className="w-3 h-3 text-[#0B0B0B]" />
                Shareable Invitation Link (with dynamic og:image)
              </p>
              <p className="text-xs font-mono font-semibold text-[#0B0B0B] truncate mt-0.5">
                {inviteUrl}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => void handleCopyShareLink()}
                className="px-4 py-2 rounded-full bg-[#0B0B0B] hover:bg-zinc-800 text-white text-xs font-semibold inline-flex items-center gap-1.5 transition-colors shrink-0"
              >
                {shareFeedback || copiedInvite ? (
                  <Check className="w-3.5 h-3.5" />
                ) : (
                  <Share2 className="w-3.5 h-3.5" />
                )}
                <span>{shareFeedback || 'Copy Share Link'}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  if (navigator.clipboard?.writeText) {
                    navigator.clipboard.writeText(inviteUrl).catch(() => {});
                  }
                  setCopiedInvite(true);
                  window.setTimeout(() => setCopiedInvite(false), 1800);
                }}
                className="px-3.5 py-2 rounded-full bg-white border border-[#E5E5EA] hover:border-[#0B0B0B] text-[#0B0B0B] text-xs font-semibold inline-flex items-center gap-1.5 transition-colors shrink-0"
              >
                {copiedInvite ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedInvite ? 'Copied' : 'Copy Only'}</span>
              </button>
            </div>
          </div>
          <div className="pt-3 border-t border-[#E5E5EA] flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold text-[#71717A] flex items-center gap-1">
                <QrCode className="w-3 h-3 text-[#0B0B0B]" />
                Validate &amp; Check-In Gate QR
              </p>
              <p className="text-[11px] text-[#71717A] mt-0.5">
                Guests scan this QR code to open the pass validation and check-in screen directly.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => downloadQrSvg(checkinQrUrl, `${event.slug || event.id}-checkin-qr.svg`)}
                className="px-3.5 py-2 rounded-full bg-white border border-[#E5E5EA] hover:border-[#0B0B0B] text-[#0B0B0B] text-xs font-semibold inline-flex items-center gap-1.5 transition-colors shrink-0"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download Check-In QR</span>
              </button>
            </div>
          </div>
          <img
            src={ogUrl}
            alt="OG social share preview"
            className="w-full rounded-xl aspect-[1200/630] object-cover border border-[#E5E5EA] bg-[#0B0B0B]"
          />
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
              {(['live', 'upcoming', 'draft', 'past'] as EventStatus[]).map((st) => {
                const blocked = starterActiveBlocked && isActiveEventStatus(st);
                return (
                  <button
                    key={st}
                    type="button"
                    disabled={blocked}
                    onClick={() => handleStatusChange(st)}
                    className={`h-8 rounded-full text-xs font-semibold capitalize transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                      event.status === st
                        ? 'bg-[#0B0B0B] text-white'
                        : 'text-[#71717A] hover:text-[#0B0B0B]'
                    }`}
                  >
                    {st}
                  </button>
                );
              })}
            </div>
            {starterActiveBlocked && (
              <p className="text-[11px] text-amber-700 mt-2">
                Starter limit ({STARTER_MAX_ACTIVE_EVENTS} active event) reached.{' '}
                {onOpenBilling ? (
                  <button type="button" onClick={onOpenBilling} className="underline font-semibold">
                    Upgrade to Pro Organizer
                  </button>
                ) : (
                  'Upgrade to Pro Organizer'
                )}{' '}
                to activate multiple events.
              </p>
            )}
            <div className="mt-3 pt-3 border-t border-[#E5E5EA] flex items-center justify-between gap-2">
              <div>
                <p className="text-[11px] font-semibold text-[#0B0B0B]">Live Gate QR Pass</p>
                <p className="text-[10px] text-[#71717A]">
                  {event.qrPassPublished !== false
                    ? 'Active for gate scans & self check-in'
                    : 'Inactive · creator activation required'}
                </p>
              </div>
              {canPublishQrPass && onToggleQrPassPublished && (
                <button
                  type="button"
                  disabled={event.status === 'draft'}
                  onClick={() =>
                    void onToggleQrPassPublished(event.id, event.qrPassPublished === false)
                  }
                  className={`px-3 py-1.5 rounded-full text-[11px] font-semibold transition-colors disabled:opacity-40 whitespace-nowrap ${
                    event.qrPassPublished !== false
                      ? 'bg-white border border-[#E5E5EA] text-[#0B0B0B] hover:border-[#0B0B0B]'
                      : 'bg-[#0B0B0B] text-white hover:bg-zinc-800'
                  }`}
                >
                  {event.qrPassPublished !== false ? 'Pause Live QR' : 'Activate Live QR'}
                </button>
              )}
            </div>
          </div>

          <div className="p-4 rounded-2xl bg-[#F5F5F7]">
            <p className="text-xs font-semibold text-[#0B0B0B] mb-2">
              Adjust Venue Capacity{' '}
              {entitlements.maxAttendeesPerEvent !== null
                ? `(Starter Cap: ${entitlements.maxAttendeesPerEvent})`
                : ''}
            </p>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={event.registered || 10}
                max={entitlements.maxAttendeesPerEvent ?? undefined}
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
            {entitlements.maxAttendeesPerEvent !== null && (
              <p className="text-[11px] text-[#71717A] mt-2">
                Starter seats cap at {STARTER_MAX_ATTENDEES_PER_EVENT}.{' '}
                {onOpenBilling && (
                  <button type="button" onClick={onOpenBilling} className="underline font-semibold text-[#0B0B0B]">
                    Upgrade for unlimited seats
                  </button>
                )}
              </p>
            )}
          </div>
        </div>

        {/* Poster Theme, Dates, Check-In Policy & Validation Circles */}
        <div className="mt-4 p-4 rounded-2xl bg-[#F5F5F7] space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[#0B0B0B] inline-flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5" />
              Dates, Gate Policy, Theme &amp; Validation Circles
            </span>
            <button
              type="button"
              onClick={handleSaveFormsAndTheme}
              className="px-3.5 py-1.5 rounded-full bg-[#0B0B0B] text-white text-[11px] font-semibold"
            >
              Save Theme &amp; Config
            </button>
          </div>
          <div className="p-3 rounded-xl bg-white border border-[#E5E5EA] space-y-2.5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <div>
                <label className="block text-[10px] font-semibold uppercase tracking-wider text-[#71717A] mb-1">
                  Start Date
                </label>
                <input
                  type="date"
                  value={startIsoDraft}
                  onChange={(e) => {
                    const nextStart = e.target.value;
                    setStartIsoDraft(nextStart);
                    if (multiDayDraft && nextStart && (!endIsoDraft || endIsoDraft <= nextStart)) {
                      const bumped = new Date(Date.parse(`${nextStart}T00:00:00Z`) + 86_400_000)
                        .toISOString()
                        .slice(0, 10);
                      setEndIsoDraft(bumped);
                    }
                  }}
                  className="w-full h-9 px-3 rounded-lg bg-[#F5F5F7] text-xs text-[#0B0B0B] tabular-nums"
                />
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[10px] font-semibold uppercase tracking-wider text-[#71717A]">
                    Multi-Day End Date
                  </label>
                  <label className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-[#0B0B0B] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={multiDayDraft}
                      onChange={(e) => {
                        const next = e.target.checked;
                        setMultiDayDraft(next);
                        if (next && (!endIsoDraft || endIsoDraft <= startIsoDraft)) {
                          const bumped = new Date(Date.parse(`${startIsoDraft}T00:00:00Z`) + 86_400_000)
                            .toISOString()
                            .slice(0, 10);
                          setEndIsoDraft(bumped);
                        }
                      }}
                      className="w-3.5 h-3.5 accent-[#0B0B0B]"
                    />
                    <span>Multi-Day</span>
                  </label>
                </div>
                <input
                  type="date"
                  disabled={!multiDayDraft}
                  min={startIsoDraft}
                  value={multiDayDraft ? endIsoDraft : ''}
                  onChange={(e) => setEndIsoDraft(e.target.value)}
                  className="w-full h-9 px-3 rounded-lg bg-[#F5F5F7] text-xs text-[#0B0B0B] tabular-nums disabled:opacity-45"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-1 p-1 bg-[#F5F5F7] rounded-lg">
              {(
                [
                  { id: 'single-entry', label: 'One-Time Entry' },
                  { id: 'daily-reentry', label: 'Daily Re-Entry (Multi-Day)' },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setPolicyDraft(opt.id)}
                  className={`py-1.5 rounded-md text-[11px] font-semibold transition-colors ${
                    policyDraft === opt.id
                      ? 'bg-white text-[#0B0B0B] shadow-sm'
                      : 'text-[#71717A] hover:text-[#0B0B0B]'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
          <ThemeColorPicker
            compact
            designTheme={designDraft}
            brandColor={brandColorDraft}
            onChangeTheme={setDesignDraft}
            onChangeBrandColor={setBrandColorDraft}
            title="Poster Theme & Brand Accent Color"
          />
          <GuestCircleValidationEditor
            compact
            category={event.category}
            value={validationDraft}
            onChange={setValidationDraft}
          />
          {(event.category === 'Wedding' || event.extraDataConfig?.enableGiftTable) && (
            <div>
              <label className="text-[11px] font-semibold text-[#0B0B0B] mb-1 flex items-center gap-1">
                <Gift className="w-3 h-3" />
                Standalone Gift Table MoMo Receiving Number
              </label>
              <input
                type="text"
                value={momoDraft}
                onChange={(e) => setMomoDraft(e.target.value)}
                placeholder="+233 XX XXX XXXX"
                className="w-full h-9 px-3.5 rounded-xl bg-white border border-[#E5E5EA] text-xs font-mono text-[#0B0B0B]"
              />
            </div>
          )}
          <label className="flex items-center justify-between gap-3 p-3 rounded-xl bg-white border border-[#E5E5EA] cursor-pointer">
            <div className="flex items-center gap-2 min-w-0">
              <BarChart3 className="w-3.5 h-3.5 text-[#0B0B0B] shrink-0" />
              <div className="min-w-0">
                <span className="text-xs font-semibold text-[#0B0B0B] block">
                  Live Polls &amp; Audience Voting (/e/{event.slug}/polls)
                </span>
                <span className="text-[11px] text-[#71717A] block">
                  Enable interactive delegate voting and stage results screen for this event.
                </span>
              </div>
            </div>
            <input
              type="checkbox"
              checked={pollsEnabledDraft}
              onChange={(e) => setPollsEnabledDraft(e.target.checked)}
              className="w-4 h-4 accent-[#0B0B0B] shrink-0"
            />
          </label>
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
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="px-2 py-0.5 rounded-full bg-[#0B0B0B] text-white text-[10px] font-semibold shrink-0">
                      {block.day}
                    </span>
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
                onClick={async () => {
                  try {
                    await Promise.resolve(onDeleteEvent(event.id));
                    onClose();
                  } catch {
                    setConfirmDelete(false);
                  }
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
  onOpenBilling?: () => void;
  onSelectPlan?: (plan: OrganizerProfile['plan']) => void;
  onClose: () => void;
}

export const PlanUpgradeModal: React.FC<PlanUpgradeModalProps> = ({
  currentPlan,
  onOpenBilling,
  onClose,
}) => {
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
              Verified subscription tiers &amp; strict capacity limits per billing cycle.
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
          {SUBSCRIPTION_PLAN_CATALOG.map((tier) => {
            const isCurrent = currentPlan === tier.name;
            return (
              <div
                key={tier.id}
                className={`p-5 rounded-3xl flex flex-col justify-between transition-colors ${
                  isCurrent
                    ? 'bg-[#0B0B0B] text-white'
                    : 'bg-[#F5F5F7] text-[#0B0B0B]'
                }`}
              >
                <div>
                  <p className={`text-xs ${isCurrent ? 'text-zinc-400' : 'text-[#71717A]'}`}>
                    {tier.tagline}
                  </p>
                  <h3 className="text-lg font-bold mt-1">{tier.name}</h3>
                  <p className="text-2xl font-bold tabular-nums mt-3">
                    ${tier.monthlyUsd} {tier.id === 'starter' ? '/ forever' : '/ mo'}
                  </p>
                  {tier.monthlyGhs > 0 && (
                    <p className={`text-xs font-mono mt-0.5 ${isCurrent ? 'text-zinc-300' : 'text-[#71717A]'}`}>
                      GH₵ {tier.monthlyGhs.toLocaleString()} / mo
                    </p>
                  )}
                  <ul className="mt-4 space-y-2">
                    {tier.features.slice(0, 4).map((lim) => (
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
                    onClose();
                    if (!isCurrent) onOpenBilling?.();
                  }}
                  className={`mt-6 w-full py-2.5 rounded-full text-xs font-semibold transition-colors ${
                    isCurrent
                      ? 'bg-white text-[#0B0B0B]'
                      : 'bg-[#0B0B0B] text-white hover:bg-zinc-800'
                  }`}
                >
                  {isCurrent ? 'Current Plan' : `Proceed to Checkout`}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
