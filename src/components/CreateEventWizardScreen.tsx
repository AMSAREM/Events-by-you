import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  BarChart3,
  Calendar,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Gift,
  ImagePlus,
  Link2,
  Lock,
  Mail,
  MapPin,
  MessageSquare,
  Navigation,
  Plus,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react';
import {
  ArtworkVariant,
  CustomFormField,
  DesignTheme,
  EventCheckInPolicy,
  EventItem,
  EventValidationConfig,
  OrganizerProfile,
  ScheduleBlock,
} from '../types/events';
import { EVENT_CATEGORIES, getCategoryPreset } from '../data/initialData';
import {
  compareScheduleBlocksChronological,
  formatEventDateSpan,
  formatEventDurationBadge,
  formatScheduleBlockDateBadge,
  getEventDateSlots,
  getEventDayCount,
  getEventDayOptions,
  getScheduleBlockDayFromIso,
  resolveIsoDateForScheduleDay,
  sanitizeIsoDate,
} from '../lib/eventDates';
import {
  appendPoweredByLine,
  buildCameraLinkForOrigin,
  calculateSmsCredits,
  getDefaultMessageConfig,
  POWERED_BY_LINE,
} from '../lib/eventMessages';
import {
  DEFAULT_SHARED_SENDER_ID,
  getPlanEntitlements,
  isActiveEventStatus,
  STARTER_MAX_ATTENDEES_PER_EVENT,
} from '../lib/subscriptionPlans';
import { buildEventInvitationUrl, buildEventOgImageUrl } from '../lib/qr';
import { createStarterPlanningConfig } from '../lib/planningTemplates';
import { EventFlyerCard } from './EventFlyerCard';
import { GuestCircleValidationEditor } from './GuestCircleValidationEditor';
import { MonochromePoster } from './MonochromeArtwork';
import { ThemeColorPicker } from './ThemeColorPicker';

interface CreateEventWizardScreenProps {
  profile: OrganizerProfile;
  events: EventItem[];
  onCancel: () => void;
  onNavigateBilling: () => void;
  onCreateEvent: (event: EventItem, blocks: ScheduleBlock[]) => Promise<void> | void;
}

const FLYER_GALLERY = [
  { id: 'events', label: 'Conference', url: '/src/assets/images/flyer_tech_summit_1795075791295.jpg' },
  { id: 'wedding', label: 'Wedding', url: '/src/assets/images/flyer_wedding_royal_1795075790983.jpg' },
  { id: 'church', label: 'Church', url: '/src/assets/images/flyer_church_revival_1795075792994.jpg' },
  { id: 'musical', label: 'Musical', url: '/src/assets/images/flyer_musical_live_1795075793134.jpg' },
  { id: 'corporate', label: 'Corporate', url: '/src/assets/images/flyer_corporate_gala_1795075792816.jpg' },
  { id: 'funeral', label: 'Memorial', url: '/src/assets/images/flyer_funeral_memorial_1795075793453.jpg' },
];

const ARTWORK_OPTIONS: { id: ArtworkVariant; label: string }[] = [
  { id: 'architecture', label: 'Architecture' },
  { id: 'forum', label: 'Forum' },
  { id: 'sound', label: 'Sound' },
  { id: 'typography', label: 'Typography' },
  { id: 'hardware', label: 'Hardware' },
  { id: 'spatial', label: 'Spatial' },
];

export const CreateEventWizardScreen: React.FC<CreateEventWizardScreenProps> = ({
  profile,
  events,
  onCancel,
  onNavigateBilling,
  onCreateEvent,
}) => {
  const initialPreset = getCategoryPreset('Events');
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [category, setCategory] = useState<string>('Events');
  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [overview, setOverview] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [newTagInput, setNewTagInput] = useState('');
  const [addingTag, setAddingTag] = useState(false);

  const [venueFormat, setVenueFormat] = useState<'in-person' | 'virtual' | 'hybrid'>('in-person');
  const [startIsoDate, setStartIsoDate] = useState('2026-12-18');
  const [isMultiDay, setIsMultiDay] = useState(false);
  const [endIsoDate, setEndIsoDate] = useState('2026-12-20');
  const [checkInPolicy, setCheckInPolicy] = useState<EventCheckInPolicy>('single-entry');
  const [policyTouched, setPolicyTouched] = useState(false);
  const [timeLabel, setTimeLabel] = useState('09:00 AM - 05:00 PM');
  const [venue, setVenue] = useState('');
  const [city, setCity] = useState('');

  const [flyerUrl, setFlyerUrl] = useState<string>(initialPreset.flyerUrl);
  const [designTheme, setDesignTheme] = useState<DesignTheme>(initialPreset.designTheme);
  const [brandColor, setBrandColor] = useState<string | undefined>(undefined);
  const [flyerFailed, setFlyerFailed] = useState(false);
  const [artwork, setArtwork] = useState<ArtworkVariant>('architecture');

  // Event-specific Validation & Standalone Gift Table / Custom Data config
  const [validationConfig, setValidationConfig] = useState<EventValidationConfig>(() => ({
    ...initialPreset.validationConfig,
    options: [...initialPreset.validationConfig.options],
    requireInviteCode: false,
    inviteCode: '',
  }));

  const [enableGiftTable, setEnableGiftTable] = useState(false);
  const [giftTitle, setGiftTitle] = useState('Event Gift Table & Registry');
  const [momoNumber, setMomoNumber] = useState('');
  const [enablePolls, setEnablePolls] = useState<boolean>(
    Boolean(initialPreset.extraDataConfig.enablePolls)
  );
  const [pollsTitle, setPollsTitle] = useState<string>(
    initialPreset.extraDataConfig.pollsTitle || 'Live Corporate & Delegate Polls'
  );
  const [customFields, setCustomFields] = useState<CustomFormField[]>(
    initialPreset.extraDataConfig.customFields
  );
  const [newCustomLabel, setNewCustomLabel] = useState('');

  // Step 2: Schedule blocks (organiser-defined run of show)
  const [draftBlocks, setDraftBlocks] = useState<
    {
      id: string;
      day: ScheduleBlock['day'];
      date?: string;
      time: string;
      title: string;
      lead: string;
      stage: string;
    }[]
  >([]);
  const [newBlockDay, setNewBlockDay] = useState<ScheduleBlock['day']>('Day 1');
  const [newBlockDate, setNewBlockDate] = useState<string>('2026-12-18');
  const [newBlockTime, setNewBlockTime] = useState('10:00 - 11:00');
  const [newBlockTitle, setNewBlockTitle] = useState('');
  const [newBlockLead, setNewBlockLead] = useState('');
  const [newBlockStage, setNewBlockStage] = useState('Workshop Lab');

  useEffect(() => {
    const cleanStart = sanitizeIsoDate(startIsoDate) ?? '2026-12-18';
    const cleanEnd =
      isMultiDay && sanitizeIsoDate(endIsoDate) && endIsoDate > cleanStart
        ? endIsoDate
        : undefined;
    const resolved =
      resolveIsoDateForScheduleDay(newBlockDay, { isoDate: cleanStart, endIsoDate: cleanEnd }) ||
      cleanStart;
    setNewBlockDate((prev) => {
      const cleanPrev = sanitizeIsoDate(prev);
      if (!cleanPrev) return resolved;
      if (cleanEnd && (cleanPrev < cleanStart || cleanPrev > cleanEnd)) return resolved;
      if (!cleanEnd && !isMultiDay && cleanPrev !== cleanStart) return cleanStart;
      return cleanPrev;
    });
  }, [startIsoDate, endIsoDate, isMultiDay, newBlockDay]);

  // Step 3: Telecom & Capacity
  const entitlements = getPlanEntitlements(profile);
  const isFreePlan = entitlements.maxActiveEvents !== null;
  const maxActiveEvents = entitlements.maxActiveEvents ?? Number.POSITIVE_INFINITY;
  const maxAllowedCapacity = entitlements.maxAttendeesPerEvent ?? 25000;
  const defaultMsgCfg = getDefaultMessageConfig();
  const [senderId, setSenderId] = useState(
    entitlements.allowCustomSenderId
      ? profile.senderId || DEFAULT_SHARED_SENDER_ID
      : DEFAULT_SHARED_SENDER_ID
  );
  const [replyEmail, setReplyEmail] = useState(profile.email);
  const [instantDispatch, setInstantDispatch] = useState(true);
  const [capacity, setCapacity] = useState(
    entitlements.maxAttendeesPerEvent ?? 500
  );
  const [ticketPrice, setTicketPrice] = useState(0);
  const [smsTemplate, setSmsTemplate] = useState(defaultMsgCfg.confirmationMessage);
  const [checkInTemplate, setCheckInTemplate] = useState(defaultMsgCfg.checkInMessage);
  const [includeCameraLink, setIncludeCameraLink] = useState(true);
  const [enforceUniquePhone, setEnforceUniquePhone] = useState(true);
  const [autoCloseCap, setAutoCloseCap] = useState(true);
  const [publishQrPass, setPublishQrPass] = useState(true);
  const [copiedSlug, setCopiedSlug] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const activeEventsCount = events.filter((e) => isActiveEventStatus(e.status)).length;
  const activeEventSample = events.find((e) => isActiveEventStatus(e.status)) ?? events[0];
  const isAtFreeLimit = isFreePlan && activeEventsCount >= maxActiveEvents;

  const handleTitleChange = (val: string) => {
    setTitle(val);
    if (!slugTouched) {
      const nextSlug = val
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)+/g, '');
      if (nextSlug) setSlug(nextSlug);
    }
  };

  const handleCopySlug = () => {
    const full = buildEventInvitationUrl(slug);
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(full).catch(() => {});
    }
    setCopiedSlug(true);
    setTimeout(() => setCopiedSlug(false), 1800);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setFlyerUrl(reader.result);
        setFlyerFailed(false);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleAddTag = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newTagInput.trim();
    if (!trimmed || tags.includes(trimmed)) {
      setAddingTag(false);
      setNewTagInput('');
      return;
    }
    setTags((prev) => [...prev, trimmed]);
    setNewTagInput('');
    setAddingTag(false);
  };

  const handleAddDraftBlock = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newBlockTitle.trim()) return;
    const cleanStart = sanitizeIsoDate(startIsoDate) ?? '2026-12-18';
    const cleanEnd =
      isMultiDay && sanitizeIsoDate(endIsoDate) && endIsoDate > cleanStart
        ? endIsoDate
        : undefined;
    const dateCtx = { isoDate: cleanStart, endIsoDate: cleanEnd };
    const cleanDate =
      sanitizeIsoDate(newBlockDate) || resolveIsoDateForScheduleDay(newBlockDay, dateCtx);
    const resolvedDay = cleanDate
      ? getScheduleBlockDayFromIso(cleanDate, dateCtx, newBlockDay)
      : newBlockDay;
    setDraftBlocks((prev) =>
      [
        ...prev,
        {
          id: `wiz-blk-${Date.now()}`,
          day: resolvedDay,
          ...(cleanDate ? { date: cleanDate } : {}),
          time: newBlockTime.trim() || '14:00 - 15:00',
          title: newBlockTitle.trim(),
          lead: newBlockLead.trim() || profile.name,
          stage: newBlockStage.trim() || 'Main Hall',
        },
      ].sort((a, b) => compareScheduleBlocksChronological(a, b, dateCtx))
    );
    setNewBlockTitle('');
    setNewBlockLead('');
  };

  const applyCategoryPreset = (nextCat: string) => {
    setCategory(nextCat);
    const catPreset = getCategoryPreset(nextCat);
    setFlyerUrl(catPreset.flyerUrl);
    setFlyerFailed(false);
    setDesignTheme(catPreset.designTheme);
    setBrandColor(undefined);
    setValidationConfig({
      enabled: catPreset.validationConfig.enabled,
      label: catPreset.validationConfig.label,
      options: [...catPreset.validationConfig.options],
      requireInviteCode: Boolean(catPreset.validationConfig.requireInviteCode),
      inviteCode: '',
    });
    setEnableGiftTable(Boolean(catPreset.extraDataConfig.enableGiftTable));
    if (catPreset.extraDataConfig.giftTitle) setGiftTitle(catPreset.extraDataConfig.giftTitle);
    setEnablePolls(Boolean(catPreset.extraDataConfig.enablePolls) || nextCat === 'Corporate');
    setPollsTitle(catPreset.extraDataConfig.pollsTitle || 'Live Corporate & Delegate Polls');
    setCustomFields(catPreset.extraDataConfig.customFields);

    const artworkByCategory: Record<string, ArtworkVariant> = {
      Events: 'forum',
      Program: 'typography',
      Wedding: 'spatial',
      Funeral: 'typography',
      Church: 'forum',
      Musical: 'sound',
      Corporate: 'hardware',
      Tech: 'architecture',
    };
    if (artworkByCategory[nextCat]) {
      setArtwork(artworkByCategory[nextCat]);
    }
  };

  const handleFinish = async (publishStatus: 'upcoming' | 'draft') => {
    if (submitting) return;
    if (publishStatus === 'upcoming' && isAtFreeLimit) {
      setPublishError(
        `Starter allows up to ${entitlements.maxActiveEvents ?? 1} active event at a time. Save as Draft or upgrade to Pro Organizer.`
      );
      setStep(4);
      return;
    }
    setPublishError(null);
    setSubmitting(true);
    try {
      const eventId = `evt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      const finalCap = entitlements.maxAttendeesPerEvent
        ? Math.min(entitlements.maxAttendeesPerEvent, Math.max(10, capacity))
        : Math.max(10, capacity);
      const parsedOptions = validationConfig.options
        .map((s) => s.trim())
        .filter(Boolean);
      const preset = getCategoryPreset(category || 'Events');

      const cleanStartIso = sanitizeIsoDate(startIsoDate) ?? '2026-12-18';
      const cleanEndIso =
        isMultiDay && sanitizeIsoDate(endIsoDate) && endIsoDate > cleanStartIso
          ? endIsoDate
          : undefined;
      const formattedSpan = formatEventDateSpan(cleanStartIso, cleanEndIso);

      const createdEvent: EventItem = {
        id: eventId,
        slug: slug.trim() || 'new-event',
        title: title.trim() || 'Untitled Production',
        subtitle: overview.trim(),
        category: category || tags[0] || 'Events',
        status: publishStatus,
        date: formattedSpan,
        isoDate: cleanStartIso,
        ...(cleanEndIso ? { endIsoDate: cleanEndIso } : {}),
        checkInPolicy,
        time: timeLabel.trim() || '09:00 GMT',
        venue: venueFormat === 'virtual' ? 'Livestream Stage' : venue.trim() || 'Main Auditorium',
        city: city.trim() || 'Accra',
        capacity: finalCap,
        registered: 0,
        checkedIn: 0,
        smsDispatched: 0,
        ticketPrice: Math.max(0, ticketPrice),
        revenue: 0,
        organizer: profile.studio || profile.name,
        artwork,
        flyerUrl: flyerUrl || preset.flyerUrl,
        designTheme,
        brandColor,
        validationConfig: {
          enabled: validationConfig.enabled,
          label: validationConfig.label.trim() || preset.validationConfig.label,
          options: parsedOptions.length > 0 ? parsedOptions : preset.validationConfig.options,
          requireInviteCode: Boolean(validationConfig.requireInviteCode),
          inviteCode: validationConfig.inviteCode?.trim() || undefined,
        },
        extraDataConfig: {
          enableGiftTable,
          giftTitle: giftTitle.trim() || preset.extraDataConfig.giftTitle,
          momoNumber: momoNumber.trim() || undefined,
          momoName: profile.studio || profile.name,
          giftRegistryItems: preset.extraDataConfig.giftRegistryItems,
          enablePolls,
          pollsTitle: pollsTitle.trim() || 'Live Corporate & Delegate Polls',
          polls: preset.extraDataConfig.polls ?? [],
          planningConfig: createStarterPlanningConfig(
            category || tags[0] || 'Events',
            profile.name || profile.studio || 'Organiser',
            venueFormat === 'virtual' ? 'Livestream Stage' : venue.trim() || 'Main Auditorium',
            { isoDate: cleanStartIso, endIsoDate: cleanEndIso }
          ),
          ...(cleanEndIso ? { endIsoDate: cleanEndIso } : {}),
          checkInPolicy,
          brandColor,
          customFields,
        },
        venueFormat,
        senderId: entitlements.allowCustomSenderId
          ? senderId
              .trim()
              .toUpperCase()
              .replace(/[^A-Z0-9]/g, '')
              .slice(0, 11) || DEFAULT_SHARED_SENDER_ID
          : DEFAULT_SHARED_SENDER_ID,
        qrPassPublished: publishStatus === 'draft' ? false : publishQrPass,
        messageConfig: entitlements.allowCustomMessages
          ? {
              confirmationMessage: smsTemplate.trim() || defaultMsgCfg.confirmationMessage,
              checkInMessage: checkInTemplate.trim() || defaultMsgCfg.checkInMessage,
              includeCameraLink,
            }
          : {
              confirmationMessage: defaultMsgCfg.confirmationMessage,
              checkInMessage: defaultMsgCfg.checkInMessage,
              includeCameraLink: true,
            },
      };

      const createdBlocks: ScheduleBlock[] = draftBlocks.map((blk, i) => {
        const cleanBlkDate =
          sanitizeIsoDate(blk.date) ||
          resolveIsoDateForScheduleDay(blk.day, { isoDate: cleanStartIso, endIsoDate: cleanEndIso });
        return {
          id: `sch-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}-${i}`,
          eventId,
          time: blk.time,
          duration: '60m',
          title: blk.title,
          stage: blk.stage,
          lead: blk.lead,
          completed: false,
          day: blk.day,
          ...(cleanBlkDate ? { date: cleanBlkDate } : {}),
        };
      });

      await onCreateEvent(createdEvent, createdBlocks);
    } catch (err) {
      setPublishError(
        err instanceof Error ? err.message : 'Unable to save event to Supabase. Please retry.'
      );
      setStep(4);
    } finally {
      setSubmitting(false);
    }
  };

  const effectiveStartIso = sanitizeIsoDate(startIsoDate) ?? '2026-12-18';
  const effectiveEndIso =
    isMultiDay && sanitizeIsoDate(endIsoDate) && endIsoDate > effectiveStartIso
      ? endIsoDate
      : undefined;
  const formattedDatePreview = formatEventDateSpan(effectiveStartIso, effectiveEndIso);
  const durationBadgePreview = formatEventDurationBadge({
    isoDate: effectiveStartIso,
    endIsoDate: effectiveEndIso,
  });
  const wizardDayOptions = getEventDayOptions({
    isoDate: effectiveStartIso,
    endIsoDate: effectiveEndIso,
  });
  const wizardDateSlots = getEventDateSlots({
    isoDate: effectiveStartIso,
    endIsoDate: effectiveEndIso,
  });

  const previewEventDraft: EventItem = {
    id: 'preview-draft',
    slug: slug || 'new-event',
    title: title || 'Untitled Event',
    subtitle: overview,
    category: category || 'Events',
    status: 'upcoming',
    date: formattedDatePreview,
    isoDate: effectiveStartIso,
    ...(effectiveEndIso ? { endIsoDate: effectiveEndIso } : {}),
    checkInPolicy,
    time: timeLabel,
    venue: venue || 'Main Hall',
    city: city || 'Accra',
    capacity,
    registered: 0,
    checkedIn: 0,
    smsDispatched: 0,
    ticketPrice,
    revenue: 0,
    organizer: profile.studio || profile.name,
    artwork,
    flyerUrl,
    designTheme,
    brandColor,
    validationConfig: {
      enabled: validationConfig.enabled,
      label: validationConfig.label,
      options: validationConfig.options.map((s) => s.trim()).filter(Boolean),
      requireInviteCode: validationConfig.requireInviteCode,
      inviteCode: validationConfig.inviteCode,
    },
    extraDataConfig: {
      enableGiftTable,
      ...(effectiveEndIso ? { endIsoDate: effectiveEndIso } : {}),
      checkInPolicy,
      brandColor,
      customFields,
    },
  };

  const steps = [
    { id: 1 as const, title: 'Event Basics & Flyer', sub: 'Core Info & Media' },
    { id: 2 as const, title: 'Program & Schedule', sub: 'Tracks & Sessions' },
    { id: 3 as const, title: 'SMS & Automations', sub: 'Arkesel & Capacity' },
    { id: 4 as const, title: 'Review & Publish', sub: 'Pre-flight Checks' },
  ];

  const resolvedSmsPreview = appendPoweredByLine(
    entitlements.allowCustomMessages ? smsTemplate : defaultMsgCfg.confirmationMessage
  );
  const smsSegments = calculateSmsCredits(resolvedSmsPreview);

  return (
    <div className="space-y-6">
      {/* Top Wizard Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2 text-xs text-[#71717A]">
            <button
              type="button"
              onClick={onCancel}
              className="inline-flex items-center gap-1 hover:text-[#0B0B0B] font-medium"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Events
            </button>
            <span>/</span>
            <span className="text-[#0B0B0B] font-semibold">Create New Event</span>
          </div>
          <h1 className="font-display text-[26px] sm:text-[32px] font-bold tracking-[-0.02em] text-[#0B0B0B]">
            Event Creation Wizard
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 rounded-full text-xs font-semibold text-[#71717A] hover:text-[#0B0B0B] transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => handleFinish('draft')}
            className="px-4 py-2 rounded-full bg-[#F5F5F7] hover:bg-[#EEEEF0] text-[#0B0B0B] text-xs font-semibold transition-colors whitespace-nowrap"
          >
            Save as Draft
          </button>
          <button
            type="button"
            disabled={submitting || isAtFreeLimit}
            onClick={() => handleFinish('upcoming')}
            title={
              isAtFreeLimit
                ? 'Starter active event limit reached — Save as Draft or Upgrade to Pro'
                : undefined
            }
            className="px-5 py-2.5 rounded-full bg-[#0B0B0B] hover:bg-zinc-800 text-white text-xs font-semibold shadow-sm transition-colors inline-flex items-center gap-1.5 whitespace-nowrap disabled:opacity-45 disabled:cursor-not-allowed"
          >
            {isAtFreeLimit && <Lock className="w-3.5 h-3.5" />}
            <span>{isAtFreeLimit ? 'Limit Reached (Save Draft)' : 'Publish Event'}</span>
            {!isAtFreeLimit && <ArrowRight className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* 4-Step Progress Stepper */}
      <div className="bg-[#F5F5F7] rounded-3xl p-2 flex items-center gap-1.5 overflow-x-auto">
        {steps.map((s) => {
          const active = step === s.id;
          const completed = step > s.id;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => setStep(s.id)}
              className={`flex items-center gap-3 px-4 py-2.5 rounded-2xl flex-1 min-w-[175px] text-left transition-all ${
                active
                  ? 'bg-white shadow-sm'
                  : completed
                  ? 'opacity-90 hover:bg-white/60'
                  : 'opacity-60 hover:opacity-90'
              }`}
            >
              <span
                className={`w-6 h-6 rounded-full text-[11px] font-bold flex items-center justify-center shrink-0 ${
                  active || completed
                    ? 'bg-[#0B0B0B] text-white'
                    : 'bg-[#E2E2E4] text-[#444748]'
                }`}
              >
                {completed ? <Check className="w-3.5 h-3.5" /> : s.id}
              </span>
              <span className="min-w-0">
                <span className="text-xs font-semibold text-[#0B0B0B] block truncate">
                  {s.title}
                </span>
                <span className="text-[11px] text-[#71717A] block truncate">{s.sub}</span>
              </span>
            </button>
          );
        })}
      </div>

      {/* Primary Content Grid (8 cols Form / 4 cols Sticky Sidebar) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* LEFT COLUMN */}
        <div className="lg:col-span-8 flex flex-col gap-6 min-w-0">
          {step === 1 && (
            <>
              {/* Card 1: Basic Info */}
              <section className="bg-[#F5F5F7] rounded-3xl p-6 sm:p-8 space-y-5">
                <div className="flex items-center justify-between">
                  <h2 className="font-display text-xl font-bold text-[#0B0B0B]">
                    Basic Event Information
                  </h2>
                  <span className="px-2.5 py-1 rounded-full bg-[#E8E8EA] text-[11px] font-semibold uppercase tracking-wider text-[#71717A]">
                    Step 1.1
                  </span>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#0B0B0B] mb-2">
                    Event Type (Click to load tailored defaults)
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {EVENT_CATEGORIES.map((cat) => (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => applyCategoryPreset(cat)}
                        className={`px-3.5 py-1.5 rounded-full text-xs font-semibold transition-colors whitespace-nowrap ${
                          category === cat
                            ? 'bg-[#0B0B0B] text-white'
                            : 'bg-white text-[#71717A] hover:text-[#0B0B0B] border border-[#E5E5EA]'
                        }`}
                      >
                        {cat}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#0B0B0B] mb-1.5">
                    Event Title
                  </label>
                  <input
                    type="text"
                    value={title}
                    onChange={(e) => handleTitleChange(e.target.value)}
                    placeholder="e.g. Mensah & Boateng Wedding or Tech Summit"
                    className="w-full h-11 px-4 rounded-2xl bg-white text-sm text-[#0B0B0B] shadow-sm focus:outline-none focus:ring-1 focus:ring-[#0B0B0B]"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-semibold text-[#0B0B0B]">Public Event URL</label>
                    <span className="text-[11px] font-medium text-[#0B0B0B]">Slug available</span>
                  </div>
                  <div className="flex items-center bg-white rounded-2xl px-4 h-11 shadow-sm text-xs">
                    <span className="text-[#71717A] select-none">eventsapp.africa/e/</span>
                    <input
                      type="text"
                      value={slug}
                      onChange={(e) => {
                        setSlugTouched(true);
                        setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''));
                      }}
                      className="w-full bg-transparent font-mono font-semibold text-[#0B0B0B] focus:outline-none ml-0.5"
                    />
                    <button
                      type="button"
                      onClick={handleCopySlug}
                      title="Copy preview link"
                      className="ml-2 text-[#71717A] hover:text-[#0B0B0B] shrink-0"
                    >
                      {copiedSlug ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-semibold text-[#0B0B0B]">
                      Event Agenda &amp; Overview
                    </label>
                    <span className="text-[11px] text-[#71717A]">Supports Markdown</span>
                  </div>
                  <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
                    <div className="flex items-center gap-2 px-3 py-2 bg-[#EEEEF0]/70 text-[11px] text-[#71717A]">
                      <button
                        type="button"
                        onClick={() => setOverview((p) => `${p}\n• Keynote: `)}
                        className="px-2 py-0.5 rounded bg-white text-[#0B0B0B] font-semibold hover:bg-[#E2E2E4]"
                      >
                        + Bullet
                      </button>
                      <button
                        type="button"
                        onClick={() => setOverview((p) => `${p}\n**Track Highlight:** `)}
                        className="px-2 py-0.5 rounded bg-white text-[#0B0B0B] font-semibold hover:bg-[#E2E2E4]"
                      >
                        + Bold
                      </button>
                      <span className="ml-auto">Rich Text Mode</span>
                    </div>
                    <textarea
                      rows={4}
                      value={overview}
                      onChange={(e) => setOverview(e.target.value)}
                      className="w-full p-4 bg-transparent text-xs sm:text-sm text-[#0B0B0B] focus:outline-none resize-none leading-relaxed"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#0B0B0B] mb-2">
                    Tags &amp; Industry Classification
                  </label>
                  <div className="flex flex-wrap items-center gap-2">
                    {tags.map((tag) => (
                      <span
                        key={tag}
                        className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#0B0B0B] text-white text-[11px] font-medium"
                      >
                        <span>{tag}</span>
                        <button
                          type="button"
                          onClick={() => setTags((prev) => prev.filter((t) => t !== tag))}
                          aria-label={`Remove ${tag}`}
                          className="hover:opacity-75"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    ))}

                    {addingTag ? (
                      <form onSubmit={handleAddTag} className="inline-flex items-center gap-1.5">
                        <input
                          type="text"
                          autoFocus
                          value={newTagInput}
                          onChange={(e) => setNewTagInput(e.target.value)}
                          placeholder="Tag name"
                          className="h-7 px-3 rounded-full bg-white text-xs text-[#0B0B0B] border border-[#E5E5EA] focus:outline-none w-28"
                        />
                        <button
                          type="submit"
                          className="px-2.5 py-1 rounded-full bg-[#0B0B0B] text-white text-[11px] font-semibold"
                        >
                          Add
                        </button>
                      </form>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setAddingTag(true)}
                        className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-[#E8E8EA] hover:bg-white text-[#0B0B0B] text-[11px] font-semibold transition-colors"
                      >
                        <Plus className="w-3 h-3" />
                        <span>Add Category</span>
                      </button>
                    )}
                  </div>
                </div>
              </section>

              {/* Card 2: Date, Time & Venue */}
              <section className="bg-[#F5F5F7] rounded-3xl p-6 sm:p-8 space-y-5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Clock className="w-4.5 h-4.5 text-[#0B0B0B]" />
                    <h2 className="font-display text-xl font-bold text-[#0B0B0B]">
                      Date, Time &amp; Location
                    </h2>
                  </div>
                  <span className="px-2.5 py-1 rounded-full bg-[#E8E8EA] text-[11px] font-semibold uppercase tracking-wider text-[#71717A]">
                    Step 1.2
                  </span>
                </div>

                <div className="p-1 bg-[#E8E8EA] rounded-2xl flex items-center max-w-md">
                  {(
                    [
                      { id: 'in-person', label: 'In-Person Venue' },
                      { id: 'virtual', label: 'Virtual / Stream' },
                      { id: 'hybrid', label: 'Hybrid Format' },
                    ] as const
                  ).map((mode) => (
                    <button
                      key={mode.id}
                      type="button"
                      onClick={() => setVenueFormat(mode.id)}
                      className={`flex-1 py-2 rounded-xl text-xs font-semibold transition-colors ${
                        venueFormat === mode.id
                          ? 'bg-white text-[#0B0B0B] shadow-sm'
                          : 'text-[#71717A] hover:text-[#0B0B0B]'
                      }`}
                    >
                      {mode.label}
                    </button>
                  ))}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-[#0B0B0B] mb-1.5">
                      Start Date
                    </label>
                    <input
                      type="date"
                      value={startIsoDate}
                      onChange={(e) => {
                        const nextStart = e.target.value;
                        setStartIsoDate(nextStart);
                        if (isMultiDay && nextStart && (!endIsoDate || endIsoDate <= nextStart)) {
                          const bumped = new Date(Date.parse(`${nextStart}T00:00:00Z`) + 86_400_000)
                            .toISOString()
                            .slice(0, 10);
                          setEndIsoDate(bumped);
                        }
                      }}
                      className="w-full h-11 px-4 rounded-2xl bg-white text-xs sm:text-sm text-[#0B0B0B] shadow-sm focus:outline-none tabular-nums"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[#0B0B0B] mb-1.5">
                      Hours &amp; Timezone
                    </label>
                    <input
                      type="text"
                      value={timeLabel}
                      onChange={(e) => setTimeLabel(e.target.value)}
                      className="w-full h-11 px-4 rounded-2xl bg-white text-xs sm:text-sm text-[#0B0B0B] shadow-sm focus:outline-none"
                    />
                  </div>
                </div>

                {/* Multi-Day Event Span & Gate Check-In Policy */}
                <div className="p-4 rounded-2xl bg-white border border-[#E5E5EA] space-y-3.5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-bold text-[#0B0B0B]">
                        Multi-Day Event Span
                      </p>
                      <p className="text-[11px] text-[#71717A]">
                        Enable for conferences, revivals, festivals, or weekend weddings spanning multiple days.
                      </p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer shrink-0">
                      <input
                        type="checkbox"
                        checked={isMultiDay}
                        onChange={(e) => {
                          const next = e.target.checked;
                          setIsMultiDay(next);
                          if (next && (!endIsoDate || endIsoDate <= startIsoDate)) {
                            const bumped = new Date(Date.parse(`${startIsoDate}T00:00:00Z`) + 86_400_000)
                              .toISOString()
                              .slice(0, 10);
                            setEndIsoDate(bumped);
                          }
                          if (!policyTouched) {
                            setCheckInPolicy(next ? 'daily-reentry' : 'single-entry');
                          }
                        }}
                        className="sr-only peer"
                      />
                      <div className="w-11 h-6 bg-[#E5E5EA] rounded-full peer peer-checked:bg-[#0B0B0B] after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-full" />
                    </label>
                  </div>

                  {isMultiDay && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                      <div>
                        <label className="block text-[11px] font-semibold text-[#0B0B0B] mb-1">
                          End Date
                        </label>
                        <input
                          type="date"
                          min={startIsoDate}
                          value={endIsoDate}
                          onChange={(e) => setEndIsoDate(e.target.value)}
                          className="w-full h-10 px-3.5 rounded-xl bg-[#F5F5F7] text-xs text-[#0B0B0B] tabular-nums focus:outline-none"
                        />
                      </div>
                      <div className="flex flex-col justify-center rounded-xl bg-[#F5F5F7] px-3.5 py-2">
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-[#71717A]">
                          Public Date Display
                        </span>
                        <span className="text-xs font-bold text-[#0B0B0B] mt-0.5 tabular-nums">
                          {formattedDatePreview}
                          {durationBadgePreview ? ` · ${durationBadgePreview}` : ''}
                        </span>
                      </div>
                    </div>
                  )}

                  <div className="pt-2 border-t border-[#E5E5EA] space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-semibold text-[#0B0B0B]">
                        Gate QR Check-In Policy
                      </span>
                      <span className="text-[10px] text-[#71717A]">
                        {checkInPolicy === 'daily-reentry'
                          ? 'Same QR re-enters each calendar day (1 scan/day)'
                          : 'QR admits guest once for the entire event'}
                      </span>
                    </div>
                    <div className="p-1 bg-[#F5F5F7] rounded-xl grid grid-cols-2 gap-1">
                      {(
                        [
                          { id: 'single-entry', label: 'One-Time Entry' },
                          { id: 'daily-reentry', label: 'Daily Re-Entry (Multi-Day Pass)' },
                        ] as const
                      ).map((opt) => (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => {
                            setPolicyTouched(true);
                            setCheckInPolicy(opt.id);
                          }}
                          className={`py-2 px-3 rounded-lg text-[11px] font-semibold transition-colors ${
                            checkInPolicy === opt.id
                              ? 'bg-white text-[#0B0B0B] shadow-sm'
                              : 'text-[#71717A] hover:text-[#0B0B0B]'
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-[#0B0B0B] mb-1.5">
                      Venue / Hall Name
                    </label>
                    <input
                      type="text"
                      value={venue}
                      onChange={(e) => setVenue(e.target.value)}
                      className="w-full h-11 px-4 rounded-2xl bg-white text-xs sm:text-sm text-[#0B0B0B] shadow-sm focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[#0B0B0B] mb-1.5">
                      City &amp; Country
                    </label>
                    <input
                      type="text"
                      value={city}
                      onChange={(e) => setCity(e.target.value)}
                      className="w-full h-11 px-4 rounded-2xl bg-white text-xs sm:text-sm text-[#0B0B0B] shadow-sm focus:outline-none"
                    />
                  </div>
                </div>

                {/* Venue Blueprint Visual Preview */}
                <div className="w-full h-28 rounded-2xl bg-white border border-[#E5E5EA] px-5 flex items-center justify-between">
                  <div>
                    <span className="text-[10px] font-mono uppercase tracking-widest text-[#71717A]">
                      Invitation Venue Pin
                    </span>
                    <p className="text-sm font-bold text-[#0B0B0B] mt-0.5">{venue}</p>
                    <p className="text-xs text-[#71717A]">{city} · Google Maps Directions auto-linked</p>
                  </div>
                  <div className="w-10 h-10 rounded-xl bg-[#0B0B0B] text-white flex items-center justify-center shrink-0">
                    <Navigation className="w-4 h-4" />
                  </div>
                </div>
              </section>

              {/* Card 3: Graphic-Designer Flyer Banner & Theme */}
              <section className="bg-[#F5F5F7] rounded-3xl p-6 sm:p-8 space-y-5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <ImagePlus className="w-4.5 h-4.5 text-[#0B0B0B]" />
                    <h2 className="font-display text-xl font-bold text-[#0B0B0B]">
                      Designer Flyer Banner &amp; Poster Theme
                    </h2>
                  </div>
                  <span className="px-2.5 py-1 rounded-full bg-[#E8E8EA] text-[11px] font-semibold uppercase tracking-wider text-[#71717A]">
                    Editorial Media
                  </span>
                </div>

                {/* Editorial Theme & Custom Brand Color Picker */}
                <ThemeColorPicker
                  designTheme={designTheme}
                  brandColor={brandColor}
                  onChangeTheme={setDesignTheme}
                  onChangeBrandColor={setBrandColor}
                  title="Editorial Theme & Brand Color Palette"
                />

                {/* Curated Studio Flyer Presets */}
                <div>
                  <label className="block text-xs font-semibold text-[#0B0B0B] mb-2">
                    Studio Flyer Presets (Or upload custom artwork below)
                  </label>
                  <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                    {FLYER_GALLERY.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => {
                          setFlyerUrl(item.url);
                          setFlyerFailed(false);
                        }}
                        className={`rounded-2xl overflow-hidden border-2 transition-all bg-white ${
                          flyerUrl === item.url
                            ? 'border-[#0B0B0B] ring-2 ring-[#0B0B0B]/15'
                            : 'border-transparent hover:border-[#71717A]'
                        }`}
                      >
                        <img
                          src={item.url}
                          alt={item.label}
                          className="w-full h-14 object-cover"
                        />
                        <span className="block text-[10px] font-semibold text-[#0B0B0B] py-1 truncate px-1">
                          {item.label}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-12 gap-5 items-center">
                  <div className="md:col-span-5 relative group overflow-hidden rounded-2xl bg-white aspect-[4/3] shadow-sm">
                    {flyerUrl && !flyerFailed ? (
                      <img
                        src={flyerUrl}
                        alt="Event flyer banner preview"
                        onError={() => setFlyerFailed(true)}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center p-4">
                        <MonochromePoster variant={artwork} className="w-24 h-24 rounded-2xl" />
                      </div>
                    )}
                    <span className="absolute top-2.5 left-2.5 px-2.5 py-0.5 rounded-full bg-[#0B0B0B]/80 text-white text-[10px] font-semibold">
                      Flyer Banner Active
                    </span>
                  </div>

                  <div className="md:col-span-7 flex flex-col gap-3">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      onChange={handleFileUpload}
                      className="hidden"
                    />
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="p-5 rounded-2xl bg-white border border-dashed border-[#C4C7C7] hover:border-[#0B0B0B] text-center transition-colors flex flex-col items-center gap-1.5"
                    >
                      <ImagePlus className="w-6 h-6 text-[#0B0B0B]" />
                      <span className="text-xs font-semibold text-[#0B0B0B]">
                        Upload custom flyer or banner image
                      </span>
                      <span className="text-[11px] text-[#71717A]">
                        PNG, JPG, or WebP · Attached automatically to Invitation &amp; OG cards
                      </span>
                    </button>

                    <div className="flex flex-wrap items-center justify-between gap-2 px-1">
                      <span className="text-[11px] text-[#71717A]">Fallback Motif:</span>
                      <div className="flex flex-wrap gap-1.5">
                        {ARTWORK_OPTIONS.map((opt) => (
                          <button
                            key={opt.id}
                            type="button"
                            onClick={() => setArtwork(opt.id)}
                            className={`px-2.5 py-1 rounded-full text-[11px] font-semibold transition-colors ${
                              artwork === opt.id
                                ? 'bg-[#0B0B0B] text-white'
                                : 'bg-white text-[#71717A] hover:text-[#0B0B0B]'
                            }`}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </section>

              {/* Card 4: Guest Validation Form & Wedding Gift Table / Extra Data */}
              <section className="bg-[#F5F5F7] rounded-3xl p-6 sm:p-8 space-y-5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="w-4.5 h-4.5 text-[#0B0B0B]" />
                    <h2 className="font-display text-xl font-bold text-[#0B0B0B]">
                      Guest Validation, Gift Table &amp; Extra Data
                    </h2>
                  </div>
                  <span className="px-2.5 py-1 rounded-full bg-[#E8E8EA] text-[11px] font-semibold uppercase tracking-wider text-[#71717A]">
                    RSVP Form Rules
                  </span>
                </div>

                {/* Validation Form */}
                <GuestCircleValidationEditor
                  category={category}
                  value={validationConfig}
                  onChange={setValidationConfig}
                />

                {/* Wedding Gift Table */}
                <div className="p-4 rounded-2xl bg-white space-y-3 border border-[#E5E5EA]">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Gift className="w-4 h-4 text-[#0B0B0B]" />
                      <div>
                        <p className="text-xs font-bold text-[#0B0B0B]">
                          Standalone Gift Table &amp; Cash Envelope Registry
                        </p>
                        <p className="text-[11px] text-[#71717A]">
                          Enables standalone Gift Table page (/e/:slug/gifts) &amp; studio Gift Ledger — separate from RSVP, walk-ins &amp; gate check-in.
                        </p>
                      </div>
                    </div>
                    <input
                      type="checkbox"
                      checked={enableGiftTable}
                      onChange={(e) => setEnableGiftTable(e.target.checked)}
                      className="w-4 h-4 accent-[#0B0B0B]"
                    />
                  </div>
                  {enableGiftTable && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                      <input
                        type="text"
                        value={giftTitle}
                        onChange={(e) => setGiftTitle(e.target.value)}
                        placeholder="Gift table section title"
                        className="h-10 px-3.5 rounded-xl bg-[#F5F5F7] text-xs text-[#0B0B0B]"
                      />
                      <input
                        type="text"
                        value={momoNumber}
                        onChange={(e) => setMomoNumber(e.target.value)}
                        placeholder="MoMo receiving number (e.g. +233 24...)"
                        className="h-10 px-3.5 rounded-xl bg-[#F5F5F7] text-xs font-mono text-[#0B0B0B]"
                      />
                    </div>
                  )}
                </div>

                {/* Live Corporate Polls & Audience Voting */}
                <div className="p-4 rounded-2xl bg-white space-y-3 border border-[#E5E5EA]">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <BarChart3 className="w-4 h-4 text-[#0B0B0B] shrink-0" />
                      <div>
                        <p className="text-xs font-bold text-[#0B0B0B]">
                          Live Corporate Polls &amp; Audience Voting
                        </p>
                        <p className="text-[11px] text-[#71717A]">
                          Launch real-time polls, AGM motions &amp; session votes at /e/:slug/polls — ideal for corporate summits, panels &amp; townhalls.
                        </p>
                      </div>
                    </div>
                    <input
                      type="checkbox"
                      checked={enablePolls}
                      onChange={(e) => setEnablePolls(e.target.checked)}
                      className="w-4 h-4 accent-[#0B0B0B] shrink-0"
                    />
                  </div>
                  {enablePolls && (
                    <div className="pt-1">
                      <label className="block text-[11px] font-semibold text-[#0B0B0B] mb-1">
                        Public Polls Section Title
                      </label>
                      <input
                        type="text"
                        value={pollsTitle}
                        onChange={(e) => setPollsTitle(e.target.value)}
                        placeholder="Live Corporate & Delegate Polls"
                        className="w-full h-10 px-3.5 rounded-xl bg-[#F5F5F7] text-xs text-[#0B0B0B]"
                      />
                    </div>
                  )}
                </div>

                {/* Custom Extra Data Fields */}
                <div className="p-4 rounded-2xl bg-white space-y-3 border border-[#E5E5EA]">
                  <p className="text-xs font-bold text-[#0B0B0B]">
                    Additional Event Data Fields ({customFields.length})
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {customFields.map((fld) => (
                      <span
                        key={fld.id}
                        className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#F5F5F7] text-[11px] font-semibold text-[#0B0B0B]"
                      >
                        <span>{fld.label}</span>
                        <button
                          type="button"
                          onClick={() =>
                            setCustomFields((prev) => prev.filter((item) => item.id !== fld.id))
                          }
                          aria-label={`Remove ${fld.label}`}
                          className="text-[#71717A] hover:text-[#EF4444]"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={newCustomLabel}
                      onChange={(e) => setNewCustomLabel(e.target.value)}
                      placeholder="Add extra data question (e.g. Song Request, Dietary Note)"
                      className="flex-1 h-9 px-3.5 rounded-full bg-[#F5F5F7] text-xs text-[#0B0B0B]"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        if (!newCustomLabel.trim()) return;
                        setCustomFields((prev) => [
                          ...prev,
                          {
                            id: `field_${Date.now().toString(36)}`,
                            label: newCustomLabel.trim(),
                            type: 'text',
                            required: false,
                          },
                        ]);
                        setNewCustomLabel('');
                      }}
                      className="px-4 h-9 rounded-full bg-[#0B0B0B] text-white text-xs font-semibold shrink-0"
                    >
                      + Add Field
                    </button>
                  </div>
                </div>
              </section>
            </>
          )}

          {step === 2 && (
            <section className="bg-[#F5F5F7] rounded-3xl p-6 sm:p-8 space-y-5">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="font-display text-xl font-bold text-[#0B0B0B]">
                    Program &amp; Session Schedule
                  </h2>
                  <p className="text-xs text-[#71717A] mt-0.5">
                    Sessions added here publish directly to your public registration timeline.
                  </p>
                </div>
                <span className="px-3 py-1 rounded-full bg-white text-xs font-semibold text-[#0B0B0B] tabular-nums">
                  {draftBlocks.length} blocks
                </span>
              </div>

              <form onSubmit={handleAddDraftBlock} className="p-4 rounded-2xl bg-white grid grid-cols-1 sm:grid-cols-2 gap-3">
                <input
                  type="text"
                  required
                  value={newBlockTitle}
                  onChange={(e) => setNewBlockTitle(e.target.value)}
                  placeholder="Session Title (e.g. Fireside Chat)"
                  className="sm:col-span-2 h-10 px-4 rounded-full bg-[#F5F5F7] text-xs text-[#0B0B0B] focus:outline-none"
                />
                <div className="grid grid-cols-2 gap-2">
                  <select
                    value={newBlockDay}
                    onChange={(e) => {
                      const nextDay = e.target.value as ScheduleBlock['day'];
                      setNewBlockDay(nextDay);
                      const mappedDate = resolveIsoDateForScheduleDay(nextDay, {
                        isoDate: effectiveStartIso,
                        endIsoDate: effectiveEndIso,
                      });
                      if (mappedDate) setNewBlockDate(mappedDate);
                    }}
                    aria-label="Program day"
                    className="h-10 px-3 rounded-full bg-[#F5F5F7] text-xs font-semibold text-[#0B0B0B] focus:outline-none"
                  >
                    {wizardDayOptions.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                  <input
                    type="date"
                    value={newBlockDate}
                    min={wizardDateSlots.length > 0 ? wizardDateSlots[0].isoDate : undefined}
                    onChange={(e) => {
                      const clean = sanitizeIsoDate(e.target.value);
                      setNewBlockDate(e.target.value);
                      if (clean) {
                        setNewBlockDay(
                          getScheduleBlockDayFromIso(
                            clean,
                            { isoDate: effectiveStartIso, endIsoDate: effectiveEndIso },
                            newBlockDay
                          )
                        );
                      }
                    }}
                    aria-label="Specific calendar date"
                    className="h-10 px-3 rounded-full bg-[#F5F5F7] text-xs font-mono text-[#0B0B0B] focus:outline-none"
                  />
                </div>
                <input
                  type="text"
                  value={newBlockTime}
                  onChange={(e) => setNewBlockTime(e.target.value)}
                  placeholder="13:00 - 14:15"
                  className="h-10 px-4 rounded-full bg-[#F5F5F7] text-xs font-mono text-[#0B0B0B] focus:outline-none"
                />
                <input
                  type="text"
                  value={newBlockLead}
                  onChange={(e) => setNewBlockLead(e.target.value)}
                  placeholder="Speaker / Host"
                  className="h-10 px-4 rounded-full bg-[#F5F5F7] text-xs text-[#0B0B0B] focus:outline-none"
                />
                <input
                  type="text"
                  value={newBlockStage}
                  onChange={(e) => setNewBlockStage(e.target.value)}
                  placeholder="Room / Stage"
                  className="h-10 px-4 rounded-full bg-[#F5F5F7] text-xs text-[#0B0B0B] focus:outline-none"
                />
                <button
                  type="submit"
                  className="sm:col-span-2 h-10 px-5 rounded-full bg-[#0B0B0B] text-white text-xs font-semibold hover:bg-zinc-800 transition-colors"
                >
                  + Add Program Block
                </button>
              </form>

              <div className="space-y-2.5">
                {draftBlocks.map((blk) => (
                  <div
                    key={blk.id}
                    className="p-4 rounded-2xl bg-white flex items-center justify-between gap-3"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="px-2.5 py-1 rounded-full bg-[#0B0B0B] text-white text-[10px] font-semibold shrink-0 whitespace-nowrap">
                        {formatScheduleBlockDateBadge(blk, previewEventDraft)}
                      </span>
                      <span className="px-3 py-1 rounded-full bg-[#F5F5F7] font-mono text-xs font-semibold text-[#0B0B0B] tabular-nums shrink-0">
                        {blk.time}
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-[#0B0B0B] truncate">{blk.title}</p>
                        <p className="text-[11px] text-[#71717A] truncate">
                          {blk.lead} · {blk.stage}
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setDraftBlocks((prev) => prev.filter((item) => item.id !== blk.id))
                      }
                      aria-label="Remove program block"
                      className="w-8 h-8 rounded-full bg-[#F5F5F7] hover:bg-[#EF4444]/10 hover:text-[#EF4444] flex items-center justify-center text-[#71717A] shrink-0"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}

          {step === 3 && (
            <section className="bg-[#F5F5F7] rounded-3xl p-6 sm:p-8 space-y-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <MessageSquare className="w-4.5 h-4.5 text-[#0B0B0B]" />
                  <h2 className="font-display text-xl font-bold text-[#0B0B0B]">
                    Telecom, Ticketing &amp; Messaging
                  </h2>
                </div>
                <span className="px-2.5 py-1 rounded-full bg-[#E8E8EA] text-[11px] font-semibold uppercase tracking-wider text-[#71717A]">
                  Arkesel &amp; Resend
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label
                      htmlFor="wiz-sender-id"
                      className="text-xs font-semibold text-[#0B0B0B] inline-flex items-center gap-1.5"
                    >
                      <span>Arkesel SMS Sender ID</span>
                      {!entitlements.allowCustomSenderId && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-white border border-[#E5E5EA] text-[10px] font-semibold text-[#71717A]">
                          <Lock className="w-2.5 h-2.5" /> Pro+
                        </span>
                      )}
                    </label>
                    <span className="text-[10px] font-mono text-[#71717A] tabular-nums">
                      {(entitlements.allowCustomSenderId ? senderId : DEFAULT_SHARED_SENDER_ID).length}/11 alphanumeric
                    </span>
                  </div>
                  <input
                    id="wiz-sender-id"
                    type="text"
                    maxLength={11}
                    disabled={!entitlements.allowCustomSenderId}
                    value={entitlements.allowCustomSenderId ? senderId : DEFAULT_SHARED_SENDER_ID}
                    onChange={(e) => {
                      if (!entitlements.allowCustomSenderId) return;
                      setSenderId(
                        e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 11)
                      );
                    }}
                    placeholder="e.g. TECHLEADERS"
                    className="w-full h-11 px-4 rounded-2xl bg-white text-xs sm:text-sm font-mono font-bold tracking-wider text-[#0B0B0B] uppercase shadow-sm focus:outline-none disabled:opacity-60 disabled:cursor-not-allowed"
                  />
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    {Array.from(
                      new Set([
                        profile.senderId || DEFAULT_SHARED_SENDER_ID,
                        'TECHLEADERS',
                        DEFAULT_SHARED_SENDER_ID,
                      ])
                    ).map((preset) => {
                      const lockedPreset =
                        !entitlements.allowCustomSenderId && preset !== DEFAULT_SHARED_SENDER_ID;
                      return (
                        <button
                          key={preset}
                          type="button"
                          disabled={lockedPreset}
                          onClick={() => {
                            if (!lockedPreset) setSenderId(preset);
                          }}
                          className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold border transition-colors disabled:opacity-45 disabled:cursor-not-allowed ${
                            (entitlements.allowCustomSenderId
                              ? senderId
                              : DEFAULT_SHARED_SENDER_ID) === preset
                              ? 'bg-[#0B0B0B] text-white border-[#0B0B0B]'
                              : 'bg-white text-[#71717A] border-[#E5E5EA] hover:text-[#0B0B0B]'
                          }`}
                        >
                          {preset}
                        </button>
                      );
                    })}
                    {!entitlements.allowCustomSenderId && (
                      <button
                        type="button"
                        onClick={onNavigateBilling}
                        className="text-[10px] font-semibold text-[#0B0B0B] underline ml-1"
                      >
                        Unlock custom Sender ID
                      </button>
                    )}
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#0B0B0B] mb-1.5">
                    Organizer Reply-To Email
                  </label>
                  <div className="flex items-center bg-white rounded-2xl px-4 h-11 shadow-sm">
                    <Mail className="w-4 h-4 text-[#71717A] mr-2 shrink-0" />
                    <input
                      type="email"
                      value={replyEmail}
                      onChange={(e) => setReplyEmail(e.target.value)}
                      className="w-full bg-transparent text-xs sm:text-sm text-[#0B0B0B] focus:outline-none"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#0B0B0B] mb-1.5">
                    Capacity Ceiling (
                    {entitlements.maxAttendeesPerEvent !== null
                      ? `Max ${entitlements.maxAttendeesPerEvent.toLocaleString()} on ${entitlements.plan}`
                      : `Unlimited on ${entitlements.plan}`}
                    )
                  </label>
                  <input
                    type="number"
                    min={10}
                    max={maxAllowedCapacity}
                    value={Math.min(maxAllowedCapacity, capacity)}
                    onChange={(e) => {
                      const next = Number(e.target.value);
                      setCapacity(
                        entitlements.maxAttendeesPerEvent
                          ? Math.min(entitlements.maxAttendeesPerEvent, next)
                          : next
                      );
                    }}
                    className="w-full h-11 px-4 rounded-2xl bg-white text-xs sm:text-sm text-[#0B0B0B] font-mono shadow-sm focus:outline-none tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#0B0B0B] mb-1.5">
                    Ticket Price ($0 = Free RSVP)
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={ticketPrice}
                    onChange={(e) => setTicketPrice(Number(e.target.value))}
                    className="w-full h-11 px-4 rounded-2xl bg-white text-xs sm:text-sm text-[#0B0B0B] font-mono shadow-sm focus:outline-none tabular-nums"
                  />
                </div>
              </div>

              <div className="p-4 rounded-2xl bg-white flex items-center justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold text-[#0B0B0B]">
                    Instant Multi-Channel Dispatch
                  </p>
                  <p className="text-[11px] text-[#71717A] mt-0.5">
                    Auto-send instant Arkesel SMS ticket with QR hash &amp; Resend email upon RSVP.
                  </p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer shrink-0">
                  <input
                    type="checkbox"
                    checked={instantDispatch}
                    onChange={(e) => setInstantDispatch(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-[#E5E5EA] rounded-full peer peer-checked:bg-[#0B0B0B] after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-full" />
                </label>
              </div>

              {!entitlements.allowCustomMessages && (
                <div className="p-4 rounded-2xl bg-white border border-[#E5E5EA] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-start gap-2.5">
                    <Lock className="w-4 h-4 text-[#0B0B0B] mt-0.5 shrink-0" />
                    <div>
                      <p className="text-xs font-semibold text-[#0B0B0B]">
                        System Default Templates Active on Starter
                      </p>
                      <p className="text-[11px] text-[#71717A]">
                        Starter sends default confirmation and check-in templates. Upgrade to Pro Organizer ($19/mo) to edit SMS &amp; email copy.
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={onNavigateBilling}
                    className="px-4 py-1.5 rounded-full bg-[#0B0B0B] text-white text-xs font-semibold shrink-0 self-start sm:self-center"
                  >
                    Upgrade to Pro
                  </button>
                </div>
              )}

              <div className="p-4 rounded-2xl bg-white flex items-center justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold text-[#0B0B0B]">
                    Include Disposable Camera &amp; Collage Link in Guest SMS
                  </p>
                  <p className="text-[11px] text-[#71717A] mt-0.5">
                    Automatically attaches <span className="font-mono">{buildCameraLinkForOrigin(slug || 'event')}</span> (5 pictures/user + Collage Maker) when <code className="font-mono">{'{cameraLink}'}</code> is enabled.
                  </p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer shrink-0">
                  <input
                    type="checkbox"
                    disabled={!entitlements.allowCustomMessages}
                    checked={entitlements.allowCustomMessages ? includeCameraLink : true}
                    onChange={(e) => setIncludeCameraLink(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-[#E5E5EA] rounded-full peer peer-checked:bg-[#0B0B0B] peer-disabled:opacity-50 after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-full" />
                </label>
              </div>

              <div>
                <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                  <label className="text-xs font-semibold text-[#0B0B0B]">
                    Confirmation SMS Template
                  </label>
                  <span className="text-[11px] font-mono text-[#71717A] tabular-nums">
                    {smsSegments} SMS credit/pass · {smsTemplate.length} chars
                  </span>
                </div>
                <textarea
                  rows={3}
                  readOnly={!entitlements.allowCustomMessages}
                  value={entitlements.allowCustomMessages ? smsTemplate : defaultMsgCfg.confirmationMessage}
                  onChange={(e) => {
                    if (entitlements.allowCustomMessages) setSmsTemplate(e.target.value);
                  }}
                  className={`w-full p-4 rounded-2xl bg-white text-xs font-mono text-[#0B0B0B] shadow-sm focus:outline-none resize-none ${
                    !entitlements.allowCustomMessages ? 'opacity-65 cursor-not-allowed' : ''
                  }`}
                />
              </div>

              <div>
                <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                  <label className="text-xs font-semibold text-[#0B0B0B]">
                    Check-In Welcome SMS Template (Sent at Gate Check-In)
                  </label>
                  <div className="flex flex-wrap gap-1">
                    {['{name}', '{event}', '{code}', '{cameraLink}'].map((tag) => (
                      <button
                        key={tag}
                        type="button"
                        disabled={!entitlements.allowCustomMessages}
                        onClick={() => setCheckInTemplate((prev) => `${prev} ${tag}`.trim())}
                        className="px-2 py-0.5 rounded-full bg-white border border-[#E5E5EA] hover:border-[#0B0B0B] text-[10px] font-mono text-[#0B0B0B] disabled:opacity-45 disabled:cursor-not-allowed"
                      >
                        + {tag}
                      </button>
                    ))}
                  </div>
                </div>
                <textarea
                  rows={3}
                  readOnly={!entitlements.allowCustomMessages}
                  value={
                    entitlements.allowCustomMessages ? checkInTemplate : defaultMsgCfg.checkInMessage
                  }
                  onChange={(e) => {
                    if (entitlements.allowCustomMessages) setCheckInTemplate(e.target.value);
                  }}
                  className={`w-full p-4 rounded-2xl bg-white text-xs font-mono text-[#0B0B0B] shadow-sm focus:outline-none resize-none ${
                    !entitlements.allowCustomMessages ? 'opacity-65 cursor-not-allowed' : ''
                  }`}
                />
                <p className="text-[11px] text-[#71717A] mt-1.5">
                  Preview Camera URL: <span className="font-mono text-[#0B0B0B]">{buildCameraLinkForOrigin(slug || 'event')}</span>
                </p>
                <p className="text-[11px] text-[#71717A] mt-1">
                  Constant footer line appended to every message:{' '}
                  <span className="font-mono text-[#0B0B0B]">{POWERED_BY_LINE}</span>
                </p>
              </div>
            </section>
          )}

          {step === 4 && (
            <section className="bg-[#F5F5F7] rounded-3xl p-6 sm:p-8 space-y-5">
              <div className="flex items-center justify-between">
                <h2 className="font-display text-xl font-bold text-[#0B0B0B]">
                  Pre-Flight Review &amp; Launch
                </h2>
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white text-emerald-700 text-xs font-semibold">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Ready to Publish
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="p-4 rounded-2xl bg-white space-y-1">
                  <span className="text-[11px] text-[#71717A]">Title &amp; URL</span>
                  <p className="text-sm font-bold text-[#0B0B0B]">{title}</p>
                  <p className="text-xs font-mono text-[#71717A]">/e/{slug}</p>
                </div>
                <div className="p-4 rounded-2xl bg-white space-y-1">
                  <span className="text-[11px] text-[#71717A]">Schedule &amp; Venue</span>
                  <p className="text-sm font-bold text-[#0B0B0B]">
                    {formattedDatePreview}
                    {effectiveEndIso ? ` (${getEventDayCount({ isoDate: effectiveStartIso, endIsoDate: effectiveEndIso })} Days)` : ''}
                  </p>
                  <p className="text-xs text-[#71717A]">
                    {venue || 'Main Auditorium'} · {city || 'Accra'} ·{' '}
                    {checkInPolicy === 'daily-reentry' ? 'Daily Re-Entry Pass' : 'One-Time Entry'}
                  </p>
                </div>
                <div className="p-4 rounded-2xl bg-white space-y-1">
                  <span className="text-[11px] text-[#71717A]">Program Blocks</span>
                  <p className="text-sm font-bold text-[#0B0B0B] tabular-nums">
                    {draftBlocks.length} Scheduled Sessions
                  </p>
                  <p className="text-xs text-[#71717A]">First block: {draftBlocks[0]?.time ?? 'None'}</p>
                </div>
                <div className="p-4 rounded-2xl bg-white space-y-1">
                  <span className="text-[11px] text-[#71717A]">Telecom &amp; Quota</span>
                  <p className="text-sm font-bold text-[#0B0B0B] tabular-nums">
                    Sender ID: {senderId} · Cap {capacity}
                  </p>
                  <p className="text-xs text-[#71717A]">
                    {instantDispatch ? 'Auto SMS + Resend active' : 'Manual dispatch only'}
                  </p>
                </div>
              </div>

              <div className="p-4 rounded-2xl bg-white flex items-center justify-between gap-4 border border-[#E5E5EA]">
                <div>
                  <p className="text-xs font-semibold text-[#0B0B0B]">
                    Check-In QR Pass Publishing (Creator Only)
                  </p>
                  <p className="text-[11px] text-[#71717A] mt-0.5">
                    Only the event creator can publish check-in QR passes for public RSVPs and gate scanning. Draft events always keep QR passes unpublished.
                  </p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer shrink-0">
                  <input
                    type="checkbox"
                    checked={publishQrPass}
                    onChange={(e) => setPublishQrPass(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-[#E5E5EA] rounded-full peer peer-checked:bg-[#0B0B0B] after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-full" />
                </label>
              </div>

              {(isAtFreeLimit || publishError) && (
                <div className="p-4 rounded-2xl bg-amber-50 border border-amber-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <p className="text-xs text-amber-900">
                    {publishError ||
                      `Starter accounts allow ${entitlements.maxActiveEvents ?? 1} active event at a time. Save this production as a Draft or upgrade to Pro Organizer ($19/mo) to publish immediately.`}
                  </p>
                  <button
                    type="button"
                    onClick={onNavigateBilling}
                    className="px-4 py-1.5 rounded-full bg-[#0B0B0B] text-white text-xs font-semibold shrink-0 self-start sm:self-center"
                  >
                    Upgrade to Pro
                  </button>
                </div>
              )}

              <div className="flex flex-wrap items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => handleFinish('draft')}
                  className="px-5 py-2.5 rounded-full bg-white text-[#0B0B0B] border border-[#E5E5EA] hover:border-[#0B0B0B] text-xs font-semibold transition-colors disabled:opacity-50"
                >
                  {submitting ? 'Saving...' : 'Save as Draft'}
                </button>
                <button
                  type="button"
                  disabled={submitting || isAtFreeLimit}
                  onClick={() => handleFinish('upcoming')}
                  className="px-6 py-2.5 rounded-full bg-[#0B0B0B] hover:bg-zinc-800 text-white text-xs font-semibold shadow-sm inline-flex items-center gap-2 transition-colors disabled:opacity-45 disabled:cursor-not-allowed"
                >
                  {isAtFreeLimit && <Lock className="w-3.5 h-3.5" />}
                  <span>
                    {submitting
                      ? 'Publishing...'
                      : isAtFreeLimit
                        ? 'Publish Locked (Starter Limit)'
                        : 'Publish Event Live'}
                  </span>
                  {!isAtFreeLimit && <ArrowRight className="w-4 h-4" />}
                </button>
              </div>
            </section>
          )}
        </div>

        {/* RIGHT SIDEBAR COLUMN (4 Cols) */}
        <div className="lg:col-span-4 flex flex-col gap-6 min-w-0">
          {/* Subscription Guardrail Card */}
          <section className="bg-[#F5F5F7] rounded-3xl p-6 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-[#0B0B0B]">Subscription Guardrail</span>
              <span
                className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
                  isAtFreeLimit
                    ? 'bg-[#EF4444]/10 text-[#EF4444]'
                    : 'bg-white text-[#0B0B0B]'
                }`}
              >
                {isAtFreeLimit ? 'Limit Reached' : 'Quota Clear'}
              </span>
            </div>

            <div>
              <div className="flex items-baseline justify-between mb-1.5">
                <span className="text-base font-bold text-[#0B0B0B]">
                  {entitlements.plan === 'Starter' ? 'Starter Free Tier' : entitlements.plan}
                </span>
                <span className="text-xs text-[#71717A] tabular-nums">
                  {isFreePlan
                    ? `${activeEventsCount} of ${entitlements.maxActiveEvents ?? 1} Active Events`
                    : `${activeEventsCount} Active Events (∞)`}
                </span>
              </div>
              <div className="w-full bg-[#E2E2E4] rounded-full h-2 overflow-hidden">
                <div
                  className={`h-2 rounded-full ${isAtFreeLimit ? 'bg-[#EF4444]' : 'bg-[#0B0B0B]'}`}
                  style={{ width: isFreePlan ? `${Math.min(100, (activeEventsCount / (entitlements.maxActiveEvents ?? 1)) * 100)}%` : '28%' }}
                />
              </div>
            </div>

            {isFreePlan && activeEventSample && (
              <div className="p-3.5 bg-white rounded-2xl text-xs text-[#71717A] leading-relaxed">
                <strong className="text-[#0B0B0B]">{activeEventSample.title}</strong> is active.
                Upgrade to Pro for unlimited concurrent events and higher capacities.
              </div>
            )}

            {isFreePlan && (
              <div className="bg-[#0B0B0B] text-white rounded-2xl p-4 flex items-center justify-between gap-3">
                <div>
                  <span className="text-xs font-semibold block">Upgrade to Pro</span>
                  <span className="text-[11px] text-zinc-400">$19 / month · Unlimited events</span>
                </div>
                <button
                  type="button"
                  onClick={onNavigateBilling}
                  className="px-3.5 py-1.5 rounded-full bg-white text-[#0B0B0B] text-xs font-semibold hover:bg-zinc-200 transition-colors shrink-0"
                >
                  Upgrade
                </button>
              </div>
            )}
          </section>

          {/* Live Designer Flyer & OG Share Card Preview */}
          <section className="bg-[#F5F5F7] rounded-3xl p-5 space-y-3.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-[#0B0B0B]">Live Flyer &amp; Invite Card</span>
              <span className="text-[11px] font-mono text-[#71717A] truncate">/e/{slug}</span>
            </div>

            <EventFlyerCard event={previewEventDraft} compact showActions={false} />

            <div className="bg-white rounded-2xl p-3.5 border border-[#E5E5EA] space-y-1.5">
              <div className="flex items-center justify-between text-[11px]">
                <span className="font-semibold text-[#0B0B0B] inline-flex items-center gap-1">
                  <Link2 className="w-3 h-3" />
                  Invitation + Auto OG Image
                </span>
                <button
                  type="button"
                  onClick={handleCopySlug}
                  className="font-semibold text-[#0B0B0B] underline"
                >
                  {copiedSlug ? 'Copied!' : 'Copy URL'}
                </button>
              </div>
              <p className="text-[11px] font-mono text-[#71717A] truncate">
                {buildEventInvitationUrl(slug || 'new-event')}
              </p>
              <p className="text-[10px] font-mono text-[#71717A] truncate">
                og:image → {buildEventOgImageUrl(slug || 'new-event')}
              </p>
            </div>
          </section>

          {/* Registration Safeguards */}
          <section className="bg-[#F5F5F7] rounded-3xl p-6 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-[#0B0B0B]">Registration Safeguards</span>
              <ShieldCheck className="w-4 h-4 text-[#71717A]" />
            </div>

            <label className="flex items-start gap-3 p-3.5 bg-white rounded-2xl cursor-pointer">
              <input
                type="checkbox"
                checked={enforceUniquePhone}
                onChange={(e) => setEnforceUniquePhone(e.target.checked)}
                className="mt-0.5 accent-[#0B0B0B] w-4 h-4 shrink-0"
              />
              <span>
                <span className="text-xs font-semibold text-[#0B0B0B] block">
                  Enforce unique phone number
                </span>
                <span className="text-[11px] text-[#71717A]">
                  Prevents duplicate ticket generation per MSISDN.
                </span>
              </span>
            </label>

            <label className="flex items-start gap-3 p-3.5 bg-white rounded-2xl cursor-pointer">
              <input
                type="checkbox"
                checked={autoCloseCap}
                onChange={(e) => setAutoCloseCap(e.target.checked)}
                className="mt-0.5 accent-[#0B0B0B] w-4 h-4 shrink-0"
              />
              <span>
                <span className="text-xs font-semibold text-[#0B0B0B] block">
                  Auto-close when cap is reached
                </span>
                <span className="text-[11px] text-[#71717A]">
                  Switches public RSVP form to waitlist mode automatically.
                </span>
              </span>
            </label>
          </section>

          {/* Footer Step Navigation */}
          <div className="flex items-center justify-between pt-1">
            <button
              type="button"
              onClick={() => (step > 1 ? setStep((step - 1) as 1 | 2 | 3 | 4) : onCancel())}
              className="px-4 py-2 text-xs font-semibold text-[#71717A] hover:text-[#0B0B0B] transition-colors"
            >
              {step > 1 ? '← Previous Step' : 'Cancel & Discard'}
            </button>
            {step < 4 && (
              <button
                type="button"
                onClick={() => setStep((step + 1) as 1 | 2 | 3 | 4)}
                className="px-5 py-2.5 rounded-full bg-[#0B0B0B] hover:bg-zinc-800 text-white text-xs font-semibold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap"
              >
                <span>
                  {step === 1
                    ? 'Next: Program & Schedule'
                    : step === 2
                    ? 'Next: SMS & Automations'
                    : 'Next: Review & Publish'}
                </span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
