import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  BarChart3,
  Calendar,
  Camera,
  Check,
  ClipboardCheck,
  Clock,
  Copy,
  Download,
  Edit3,
  ExternalLink,
  Gift,
  GripVertical,
  ImagePlus,
  LayoutGrid,
  Link2,
  Lock,
  Mail,
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
  X,
} from 'lucide-react';
import {
  Attendee,
  AttendeeTier,
  EventCheckInPolicy,
  EventItem,
  EventPlanningConfig,
  EventPoll,
  EventPollStatus,
  EventValidationConfig,
  GiftTableAttendantLink,
  GiftTableEntry,
  OrganizerProfile,
  ScheduleBlock,
  SystemAlert,
  TimeRange,
} from '../types/events';
import {
  computeVelocitySeries,
  getCategoryPreset,
  normalizePhoneE164,
} from '../data/initialData';
import {
  compareScheduleBlocksChronological,
  formatEventDateSpan,
  formatEventDurationBadge,
  formatIsoDateShort,
  formatScheduleBlockDateBadge,
  getAttendeeCheckedInDaysCount,
  getEventCheckInPolicy,
  getEventDateSlots,
  getEventDayOptions,
  getScheduleBlockDayFromIso,
  getTodayIsoDate,
  isAttendeeCheckedInForDate,
  isMultiDayEvent,
  resolveIsoDateForScheduleDay,
  resolveScheduleBlockDate,
  sanitizeIsoDate,
} from '../lib/eventDates';
import {
  appendPoweredByLine,
  buildCameraLinkForOrigin,
  calculateSmsCredits,
  getDefaultMessageConfig,
  POWERED_BY_LINE,
  resolveEventMessage,
} from '../lib/eventMessages';
import {
  DEFAULT_SHARED_SENDER_ID,
  getPlanEntitlements,
  STARTER_MAX_ATTENDEES_PER_EVENT,
} from '../lib/subscriptionPlans';
import { compressFlyerImageFile } from '../lib/flyerUpload';
import {
  buildEventInvitationUrl,
  buildEventOgImageUrl,
  DeterministicQrSvg,
  downloadQrSvg,
} from '../lib/qr';
import { CheckInFlyerSidePanel } from './CheckInFlyerSidePanel';
import { resolveEventBrandColor } from '../lib/themeColors';
import { GiftAttendantLinksCard } from './GiftAttendantLinksCard';
import { GuestCircleValidationEditor } from './GuestCircleValidationEditor';
import { EventPollsManager } from './EventPollsManager';
import { EventPlanningPanel } from './EventPlanningPanel';
import { computeEventReadiness } from '../lib/planningTemplates';
import { MonochromePoster, SplineChart } from './MonochromeArtwork';
import { ThemeColorPicker } from './ThemeColorPicker';
import { TopUtilityBar } from './TopUtilityBar';

type WorkspaceTab =
  | 'overview'
  | 'planning'
  | 'program'
  | 'messages'
  | 'attendees'
  | 'gifts'
  | 'polls'
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
  onUpdateEvent?: (updated: EventItem) => Promise<void> | void;
  onSavePlanning?: (eventId: string, planningConfig: EventPlanningConfig) => Promise<void> | void;
  onOpenPlans: () => void;
  onPreviewPublicEvent: (focus?: 'top' | 'checkin' | 'walkin' | 'gifts' | 'polls') => void;
  onToggleCheckIn: (
    attendeeId: string,
    options?: { mode?: 'toggle' | 'checkin' | 'undo'; dateIso?: string }
  ) => Promise<unknown> | void;
  onDeleteAttendee?: (attendeeId: string) => Promise<void> | void;
  onRegisterAttendee?: (eventId: string, attendee: Attendee) => void;
  onBroadcast?: (payload: {
    eventId?: string;
    attendeeIds: string[];
    message: string;
    channel?: 'email' | 'sms' | 'dual';
  }) => Promise<{
    ok: boolean;
    recipientCount: number;
    sentCount: number;
    creditsUsed?: number;
    smsCredits?: number;
  }>;
  onRecordGiftEntry?: (
    eventId: string,
    gift: Omit<GiftTableEntry, 'id' | 'eventId' | 'createdAt' | 'recordedVia'>
  ) => Promise<{
    gift: GiftTableEntry;
    event: EventItem;
    giftSmsSent?: boolean;
    smsSkippedReason?: string;
  }> | void;
  onCreateGiftAttendantLink?: (
    eventId: string,
    payload: { attendantName: string; roleLabel?: string; phone?: string }
  ) => Promise<GiftTableAttendantLink | void>;
  onToggleGiftAttendantLink?: (
    eventId: string,
    linkId: string,
    active?: boolean
  ) => Promise<void>;
  onDeleteGiftAttendantLink?: (eventId: string, linkId: string) => Promise<void>;
  onPreviewDeskLink?: (slugOrId: string, token: string) => void;
  onCreatePoll?: (
    eventId: string,
    payload: {
      question: string;
      description?: string;
      sessionLabel?: string;
      options: string[];
      status?: EventPollStatus;
      allowMultiple?: boolean;
      showResultsToPublic?: boolean;
      requireVerifiedPass?: boolean;
    }
  ) => Promise<EventPoll | void>;
  onUpdatePoll?: (
    eventId: string,
    pollId: string,
    patch: {
      question?: string;
      description?: string;
      sessionLabel?: string;
      status?: EventPollStatus;
      allowMultiple?: boolean;
      showResultsToPublic?: boolean;
      requireVerifiedPass?: boolean;
    }
  ) => Promise<EventPoll | void>;
  onDeletePoll?: (eventId: string, pollId: string) => Promise<void>;
  onToggleScheduleBlock: (blockId: string) => void;
  onAddScheduleBlock: (block: ScheduleBlock) => void;
  onUpdateScheduleBlock?: (
    blockId: string,
    patch: Partial<ScheduleBlock>
  ) => Promise<void> | void;
  onDeleteScheduleBlock?: (blockId: string) => void;
  onToggleQrPassPublished?: (eventId: string, published: boolean) => Promise<void> | void;
  onNavigateSettings: () => void;
  onResolveAlert: (id: string) => void;
  onSelectAlertEvent: (event: EventItem) => void;
  onOpenCsvExport?: (eventId: string) => void;
  onOpenQrScanner?: (eventId: string) => void;
  onOpenDisposableCamera?: (eventId: string) => void;
  onCheckInActivityChange?: (active: boolean) => void;
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
  onUpdateEvent,
  onSavePlanning,
  onOpenPlans,
  onPreviewPublicEvent,
  onToggleCheckIn,
  onDeleteAttendee,
  onRegisterAttendee,
  onBroadcast,
  onRecordGiftEntry,
  onCreateGiftAttendantLink,
  onToggleGiftAttendantLink,
  onDeleteGiftAttendantLink,
  onPreviewDeskLink,
  onCreatePoll,
  onUpdatePoll,
  onDeletePoll,
  onToggleScheduleBlock,
  onAddScheduleBlock,
  onUpdateScheduleBlock,
  onDeleteScheduleBlock,
  onToggleQrPassPublished,
  onNavigateSettings,
  onResolveAlert,
  onSelectAlertEvent,
  onOpenCsvExport,
  onOpenQrScanner,
  onOpenDisposableCamera,
  onCheckInActivityChange,
}) => {
  const isEventCreator = profile.appRole !== 'gate_staff';
  const isQrPassPublished = event.qrPassPublished !== false;
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('program');
  const [copiedToast, setCopiedToast] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [attendeeFilter, setAttendeeFilter] = useState<'all' | 'checked' | 'pending'>('all');
  const [circleFilter, setCircleFilter] = useState<string>('all');
  const [editingCircles, setEditingCircles] = useState(false);
  const [savingCircles, setSavingCircles] = useState(false);
  const [circleDraft, setCircleDraft] = useState<EventValidationConfig>(() => {
    const base = event.validationConfig ?? getCategoryPreset(event.category).validationConfig;
    return {
      enabled: base.enabled,
      label: base.label,
      options: [...(base.options ?? [])],
      requireInviteCode: Boolean(base.requireInviteCode),
      inviteCode: base.inviteCode ?? '',
    };
  });
  const [timeRange, setTimeRange] = useState<TimeRange>('7D');
  const [flyerFailed, setFlyerFailed] = useState(false);
  const [uploadingFlyer, setUploadingFlyer] = useState(false);
  const workspaceFlyerInputRef = useRef<HTMLInputElement | null>(null);

  // Add Program Block & Multi-Day Dates inline state
  const [programDayFilter, setProgramDayFilter] = useState<'all' | ScheduleBlock['day']>('all');
  const [programDateFilter, setProgramDateFilter] = useState<'all' | string>('all');
  const [addingBlock, setAddingBlock] = useState(false);
  const [newBlockDay, setNewBlockDay] = useState<ScheduleBlock['day']>(() =>
    isMultiDayEvent(event) ? 'Day 1' : 'Sat'
  );
  const [newBlockDate, setNewBlockDate] = useState<string>(
    () =>
      resolveIsoDateForScheduleDay(
        isMultiDayEvent(event) ? 'Day 1' : 'Sat',
        event
      ) ||
      sanitizeIsoDate(event.isoDate) ||
      getTodayIsoDate()
  );
  const [newBlockTime, setNewBlockTime] = useState('04:00 - 05:00');
  const [newBlockTitle, setNewBlockTitle] = useState('');
  const [newBlockLead, setNewBlockLead] = useState('');
  const [newBlockStage, setNewBlockStage] = useState('Main Auditorium');

  const [editingDatesPolicy, setEditingDatesPolicy] = useState(false);
  const [savingDatesPolicy, setSavingDatesPolicy] = useState(false);
  const [startIsoDraft, setStartIsoDraft] = useState(sanitizeIsoDate(event.isoDate) ?? getTodayIsoDate());
  const [multiDayDraft, setMultiDayDraft] = useState(() => isMultiDayEvent(event));
  const [endIsoDraft, setEndIsoDraft] = useState(() => {
    const start = sanitizeIsoDate(event.isoDate) ?? getTodayIsoDate();
    const existingEnd = sanitizeIsoDate(event.endIsoDate);
    if (existingEnd && existingEnd > start) return existingEnd;
    return new Date(Date.parse(`${start}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  });
  const [policyDraft, setPolicyDraft] = useState<EventCheckInPolicy>(() => getEventCheckInPolicy(event));

  // Walk-in guest inline form state
  const [addingWalkIn, setAddingWalkIn] = useState(false);

  useEffect(() => {
    onCheckInActivityChange?.(addingWalkIn || activeTab === 'attendees');
  }, [addingWalkIn, activeTab, onCheckInActivityChange]);

  useEffect(() => {
    return () => {
      onCheckInActivityChange?.(false);
    };
  }, [onCheckInActivityChange]);
  const [walkInName, setWalkInName] = useState('');
  const [walkInPhone, setWalkInPhone] = useState('');
  const [walkInEmail, setWalkInEmail] = useState('');
  const [walkInTier, setWalkInTier] = useState<AttendeeTier>('General');
  const workspaceCircles = useMemo<string[]>(() => {
    const base = event.validationConfig ?? getCategoryPreset(event.category).validationConfig;
    return Array.isArray(base.options) && base.options.length > 0 ? base.options : [];
  }, [event.validationConfig, event.category]);
  const [walkInValidationGroup, setWalkInValidationGroup] = useState<string>(
    workspaceCircles[0] ?? ''
  );
  useEffect(() => {
    const base = event.validationConfig ?? getCategoryPreset(event.category).validationConfig;
    setCircleDraft({
      enabled: base.enabled,
      label: base.label,
      options: [...(base.options ?? [])],
      requireInviteCode: Boolean(base.requireInviteCode),
      inviteCode: base.inviteCode ?? '',
    });
    setCircleFilter('all');
    setProgramDayFilter('all');
    setProgramDateFilter('all');
    const defaultDay = isMultiDayEvent(event) ? 'Day 1' : 'Sat';
    setNewBlockDay(defaultDay);
    const nextStart = sanitizeIsoDate(event.isoDate) ?? getTodayIsoDate();
    setNewBlockDate(resolveIsoDateForScheduleDay(defaultDay, event) || nextStart);
    setStartIsoDraft(nextStart);
    setMultiDayDraft(isMultiDayEvent(event));
    const existingEnd = sanitizeIsoDate(event.endIsoDate);
    setEndIsoDraft(
      existingEnd && existingEnd > nextStart
        ? existingEnd
        : new Date(Date.parse(`${nextStart}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)
    );
    setPolicyDraft(getEventCheckInPolicy(event));
    setEditingDatesPolicy(false);
  }, [event.id, event.category, event.validationConfig, event.isoDate, event.endIsoDate, event.checkInPolicy]);
  useEffect(() => {
    if (workspaceCircles.length > 0 && !workspaceCircles.includes(walkInValidationGroup)) {
      setWalkInValidationGroup(workspaceCircles[0]);
    }
  }, [workspaceCircles, walkInValidationGroup]);

  // Standalone Gift Table desk entry state
  const [giftGiverName, setGiftGiverName] = useState('');
  const [giftGiverPhone, setGiftGiverPhone] = useState('');
  const [giftDeskType, setGiftDeskType] = useState<'cash-momo' | 'registry-item' | 'blessing-only'>(
    'cash-momo'
  );
  const [giftDeskCurrency, setGiftDeskCurrency] = useState<'GHS' | 'USD'>('GHS');
  const [giftDeskAmount, setGiftDeskAmount] = useState('');
  const [giftDeskItem, setGiftDeskItem] = useState('');
  const [giftDeskSide, setGiftDeskSide] = useState('');
  const [giftDeskMessage, setGiftDeskMessage] = useState('');
  const [savingGiftDesk, setSavingGiftDesk] = useState(false);

  const entitlements = getPlanEntitlements(profile);
  const effectiveSenderId = entitlements.allowCustomSenderId
    ? event.senderId || profile.senderId || DEFAULT_SHARED_SENDER_ID
    : DEFAULT_SHARED_SENDER_ID;

  // Message automations state
  const defaultMsgs = getDefaultMessageConfig(event);
  const [senderIdDraft, setSenderIdDraft] = useState(effectiveSenderId);
  const [confirmationTemplate, setConfirmationTemplate] = useState(defaultMsgs.confirmationMessage);
  const [reminderTemplate, setReminderTemplate] = useState(defaultMsgs.reminderMessage);
  const [checkInTemplate, setCheckInTemplate] = useState(defaultMsgs.checkInMessage);
  const [thankYouTemplate, setThankYouTemplate] = useState(defaultMsgs.thankYouMessage);
  const [includeCameraLink, setIncludeCameraLink] = useState(defaultMsgs.includeCameraLink);
  const [thankYouChannel, setThankYouChannel] = useState<'email' | 'sms' | 'dual'>(() =>
    entitlements.allowSmsBroadcast ? 'dual' : 'email'
  );
  const [savingMessages, setSavingMessages] = useState(false);
  const [editingReminder, setEditingReminder] = useState(false);
  const [thankYouSent, setThankYouSent] = useState(false);
  const [actionToast, setActionToast] = useState<string | null>(null);
  const [confirmDeleteAttendee, setConfirmDeleteAttendee] = useState<Attendee | null>(null);
  const [deletingAttendee, setDeletingAttendee] = useState(false);

  useEffect(() => {
    const cfg = getDefaultMessageConfig(event);
    setSenderIdDraft(
      entitlements.allowCustomSenderId
        ? event.senderId || profile.senderId || DEFAULT_SHARED_SENDER_ID
        : DEFAULT_SHARED_SENDER_ID
    );
    setConfirmationTemplate(cfg.confirmationMessage);
    setReminderTemplate(cfg.reminderMessage);
    setCheckInTemplate(cfg.checkInMessage);
    setThankYouTemplate(cfg.thankYouMessage);
    setIncludeCameraLink(cfg.includeCameraLink);
    setThankYouSent(false);
    setFlyerFailed(false);
  }, [
    event.id,
    event.senderId,
    event.messageConfig,
    event.flyerUrl,
    profile.senderId,
    entitlements.allowCustomSenderId,
  ]);

  useEffect(() => {
    if (!entitlements.allowSmsBroadcast && thankYouChannel !== 'email') {
      setThankYouChannel('email');
    }
  }, [entitlements.allowSmsBroadcast, thankYouChannel]);

  const cameraUrlForEvent = useMemo(
    () => buildCameraLinkForOrigin(event.slug || event.id),
    [event.slug, event.id]
  );

  const handleSaveMessageSettings = async (successToast = 'Event Sender ID & message templates saved') => {
    if (!entitlements.allowCustomSenderId && !entitlements.allowCustomMessages) {
      triggerToast('Upgrade to Pro Organizer ($19/mo) to customize Sender ID & message templates');
      return;
    }
    const cleanSender = entitlements.allowCustomSenderId
      ? senderIdDraft
          .trim()
          .toUpperCase()
          .replace(/[^A-Z0-9]/g, '')
          .slice(0, 11) || DEFAULT_SHARED_SENDER_ID
      : DEFAULT_SHARED_SENDER_ID;
    setSenderIdDraft(cleanSender);
    if (!onUpdateEvent) {
      triggerToast(successToast);
      return;
    }
    setSavingMessages(true);
    try {
      await onUpdateEvent({
        ...event,
        senderId: cleanSender,
        messageConfig: entitlements.allowCustomMessages
          ? {
              confirmationMessage: confirmationTemplate.trim(),
              reminderMessage: reminderTemplate.trim(),
              checkInMessage: checkInTemplate.trim(),
              thankYouMessage: thankYouTemplate.trim(),
              includeCameraLink,
            }
          : event.messageConfig,
      });
      triggerToast(successToast);
    } catch (err) {
      triggerToast(err instanceof Error ? err.message : 'Unable to save message settings.');
    } finally {
      setSavingMessages(false);
    }
  };

  const handleWorkspaceFlyerUpload = async (file: File | undefined) => {
    if (!file || !onUpdateEvent) return;
    setUploadingFlyer(true);
    try {
      const compressed = await compressFlyerImageFile(file);
      setFlyerFailed(false);
      await onUpdateEvent({ ...event, flyerUrl: compressed });
      triggerToast('Event flyer uploaded to workspace & invitation link');
    } catch (err) {
      triggerToast(err instanceof Error ? err.message : 'Unable to upload flyer picture.');
    } finally {
      setUploadingFlyer(false);
    }
  };

  const triggerToast = (msg: string) => {
    setActionToast(msg);
    setTimeout(() => setActionToast(null), 2600);
  };

  const todayIso = getTodayIsoDate();
  const formattedEventDate = formatEventDateSpan(event.isoDate, event.endIsoDate, event.date);
  const eventDurationBadge = formatEventDurationBadge(event);
  const eventCheckInPolicy = getEventCheckInPolicy(event);
  const eventDayOptions = useMemo(() => getEventDayOptions(event), [event]);
  const eventDateSlots = useMemo(() => getEventDateSlots(event), [event]);

  const eventBlocks = useMemo(
    () =>
      scheduleBlocks
        .filter((b) => b.eventId === event.id)
        .sort((a, b) => compareScheduleBlocksChronological(a, b, event)),
    [scheduleBlocks, event]
  );

  const activeProgramDateSlots = useMemo(() => {
    const map = new Map<string, { isoDate: string; label: string }>();
    for (const slot of eventDateSlots) {
      map.set(slot.isoDate, { isoDate: slot.isoDate, label: slot.fullLabel });
    }
    for (const blk of eventBlocks) {
      const resolved = resolveScheduleBlockDate(blk, event);
      if (resolved && !map.has(resolved)) {
        map.set(resolved, {
          isoDate: resolved,
          label: formatIsoDateShort(resolved, true),
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => a.isoDate.localeCompare(b.isoDate));
  }, [eventDateSlots, eventBlocks, event]);

  const activeProgramDays = useMemo(() => {
    const seen = new Set<ScheduleBlock['day']>();
    const list: ScheduleBlock['day'][] = [];
    for (const opt of eventDayOptions) {
      if (isMultiDayEvent(event) && opt.value.startsWith('Day ')) {
        seen.add(opt.value);
        list.push(opt.value);
      }
    }
    for (const blk of eventBlocks) {
      if (!seen.has(blk.day)) {
        seen.add(blk.day);
        list.push(blk.day);
      }
    }
    return list;
  }, [eventBlocks, eventDayOptions, event]);

  const visibleProgramBlocks = useMemo(
    () =>
      eventBlocks.filter((b) => {
        const matchesDay = programDayFilter === 'all' || b.day === programDayFilter;
        const resolved = resolveScheduleBlockDate(b, event);
        const matchesDate = programDateFilter === 'all' || resolved === programDateFilter;
        return matchesDay && matchesDate;
      }),
    [eventBlocks, programDayFilter, programDateFilter, event]
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

  const circleBreakdown = useMemo(() => {
    const counts = new Map<string, { label: string; registered: number; checkedIn: number }>();
    for (const opt of workspaceCircles) {
      counts.set(opt, { label: opt, registered: 0, checkedIn: 0 });
    }
    let unassignedReg = 0;
    let unassignedChecked = 0;
    for (const att of eventAttendees) {
      const grp = att.validationGroup?.trim();
      if (!grp) {
        unassignedReg += 1;
        if (att.checkedIn) unassignedChecked += 1;
        continue;
      }
      const existing = counts.get(grp) ?? { label: grp, registered: 0, checkedIn: 0 };
      existing.registered += 1;
      if (att.checkedIn) existing.checkedIn += 1;
      counts.set(grp, existing);
    }
    const items = Array.from(counts.values());
    if (unassignedReg > 0) {
      items.push({ label: 'Unassigned', registered: unassignedReg, checkedIn: unassignedChecked });
    }
    return items;
  }, [workspaceCircles, eventAttendees]);

  const filteredAttendees = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return eventAttendees.filter((a) => {
      const matchesFilter =
        attendeeFilter === 'all' ||
        (attendeeFilter === 'checked' ? a.checkedIn : !a.checkedIn);
      const grp = a.validationGroup?.trim() || 'Unassigned';
      const matchesCircle = circleFilter === 'all' || grp === circleFilter;
      const matchesSearch =
        !q ||
        a.name.toLowerCase().includes(q) ||
        a.email.toLowerCase().includes(q) ||
        a.phone.toLowerCase().includes(q) ||
        (a.validationGroup?.toLowerCase().includes(q) ?? false);
      return matchesFilter && matchesCircle && matchesSearch;
    });
  }, [eventAttendees, attendeeFilter, circleFilter, searchQuery]);

  const invitationUrl = useMemo(
    () => buildEventInvitationUrl(event.slug || event.id),
    [event.slug, event.id]
  );
  const checkinKioskUrl = useMemo(
    () => buildEventInvitationUrl(event.slug || event.id, 'checkin'),
    [event.slug, event.id]
  );
  const ogImageUrl = useMemo(
    () => buildEventOgImageUrl(event.slug || event.id),
    [event.slug, event.id]
  );
  const flyerSrc = event.flyerUrl || getCategoryPreset(event.category).flyerUrl;

  const giftsStandaloneUrl = useMemo(
    () => buildEventInvitationUrl(event.slug || event.id, 'gifts'),
    [event.slug, event.id]
  );

  const giftLedger = useMemo(
    () => event.extraDataConfig?.giftLedger ?? [],
    [event.extraDataConfig?.giftLedger]
  );

  const giftTotalGhs = useMemo(
    () =>
      giftLedger.reduce(
        (sum, g) =>
          sum +
          (g.giftType === 'cash-momo' && (g.currency || 'GHS') === 'GHS' ? g.amount || 0 : 0),
        0
      ),
    [giftLedger]
  );
  const giftEntriesCount = giftLedger.length;
  const pollsCount = Array.isArray(event.extraDataConfig?.polls)
    ? event.extraDataConfig!.polls!.length
    : 0;
  const planningReadiness = useMemo(() => computeEventReadiness(event), [event]);
  const planningPendingCount = Math.max(
    0,
    planningReadiness.totalTasks - planningReadiness.completedTasks
  );

  const velocitySeries = useMemo(
    () => computeVelocitySeries([event], eventAttendees, timeRange),
    [event, eventAttendees, timeRange]
  );

  const handleCopyLink = () => {
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(invitationUrl).catch(() => {});
    }
    setCopiedToast(true);
    setTimeout(() => setCopiedToast(false), 2000);
  };

  const handleExportCsv = () => {
    const headers = ['Name', 'Email', 'Phone', 'ValidationCircle', 'Tier', 'TicketCode', 'CheckedIn', 'CheckedInDates'];
    const rows = eventAttendees.map((a) => [
      a.name,
      a.email,
      a.phone,
      a.validationGroup || '',
      a.tier,
      a.ticketCode,
      a.checkedIn ? 'Yes' : 'No',
      (a.checkedInDates ?? []).join('; '),
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

  const handleExportGiftsCsv = () => {
    const headers = ['GiverName', 'Phone', 'GiftType', 'Amount', 'Currency', 'RegistryItem', 'Side', 'Message', 'Source', 'RecordedBy', 'CreatedAt'];
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
    const link = document.createElement('a');
    link.href = url;
    link.download = `${event.slug}-gift-ledger.csv`;
    link.click();
    URL.revokeObjectURL(url);
    triggerToast(`Exported ${giftLedger.length} gift table entries to CSV`);
  };

  const handleRecordDeskGift = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!onRecordGiftEntry || !giftGiverName.trim() || savingGiftDesk) return;
    if (giftDeskType === 'cash-momo' && (!giftDeskAmount || Number(giftDeskAmount) <= 0)) {
      triggerToast('Enter a valid gift amount');
      return;
    }
    setSavingGiftDesk(true);
    try {
      const res = await onRecordGiftEntry(event.id, {
        giverName: giftGiverName.trim(),
        giverPhone: giftGiverPhone.trim() ? normalizePhoneE164(giftGiverPhone.trim()) : undefined,
        giftType: giftDeskType,
        currency: giftDeskCurrency,
        amount: giftDeskType === 'cash-momo' ? Math.max(1, Number(giftDeskAmount) || 0) : undefined,
        registryItem:
          giftDeskType === 'registry-item'
            ? giftDeskItem || event.extraDataConfig?.giftRegistryItems?.[0] || 'Registry Gift'
            : undefined,
        side: giftDeskSide.trim() || undefined,
        message: giftDeskMessage.trim() || undefined,
      });
      setGiftGiverName('');
      setGiftGiverPhone('');
      setGiftDeskAmount('');
      setGiftDeskMessage('');
      triggerToast(
        res && res.giftSmsSent
          ? 'Gift recorded & thank-you SMS sent ("We appreciate your gift")'
          : 'Gift table entry recorded cleanly'
      );
    } catch (err) {
      triggerToast(err instanceof Error ? err.message : 'Unable to record gift entry');
    } finally {
      setSavingGiftDesk(false);
    }
  };

  const handleDownloadQrSvg = () => {
    downloadQrSvg(checkinKioskUrl, `${event.slug}-gate-qr.svg`);
    triggerToast('Gate Check-in SVG QR downloaded');
  };

  const handleAddBlockSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newBlockTitle.trim()) return;
    const chosenDate =
      sanitizeIsoDate(newBlockDate) || resolveIsoDateForScheduleDay(newBlockDay, event);
    const chosenDay = chosenDate
      ? getScheduleBlockDayFromIso(chosenDate, event, newBlockDay)
      : newBlockDay;
    try {
      await Promise.resolve(
        onAddScheduleBlock({
          id: `sch-${Date.now()}`,
          eventId: event.id,
          time: newBlockTime.trim() || '04:00 - 05:00',
          duration: '60m',
          title: newBlockTitle.trim(),
          stage: newBlockStage.trim() || 'Main Hall',
          lead: newBlockLead.trim() || profile.name,
          completed: false,
          day: chosenDay,
          ...(chosenDate ? { date: chosenDate } : {}),
        })
      );
      setNewBlockTitle('');
      setNewBlockLead('');
      setAddingBlock(false);
      triggerToast('Program block added');
    } catch (err) {
      triggerToast(err instanceof Error ? err.message : 'Unable to add program block.');
    }
  };

  const handleSaveDatesPolicy = async () => {
    if (!onUpdateEvent || savingDatesPolicy) return;
    const nextStart = sanitizeIsoDate(startIsoDraft) ?? getTodayIsoDate();
    const nextEnd =
      multiDayDraft && sanitizeIsoDate(endIsoDraft) && endIsoDraft > nextStart
        ? endIsoDraft
        : undefined;
    const nextDateSpan = formatEventDateSpan(nextStart, nextEnd, event.date);
    setSavingDatesPolicy(true);
    try {
      await Promise.resolve(
        onUpdateEvent({
          ...event,
          isoDate: nextStart,
          endIsoDate: nextEnd,
          date: nextDateSpan,
          checkInPolicy: policyDraft,
          extraDataConfig: {
            ...(event.extraDataConfig ?? getCategoryPreset(event.category).extraDataConfig),
            endIsoDate: nextEnd,
            checkInPolicy: policyDraft,
          },
        })
      );
      setEditingDatesPolicy(false);
      triggerToast('Event dates & gate check-in policy updated');
    } catch (err) {
      triggerToast(err instanceof Error ? err.message : 'Unable to save dates & policy.');
    } finally {
      setSavingDatesPolicy(false);
    }
  };

  const handleSaveCircleSettings = async () => {
    if (!onUpdateEvent || savingCircles) return;
    const presetCfg = getCategoryPreset(event.category).validationConfig;
    const cleanedOptions = circleDraft.options.map((o) => o.trim()).filter(Boolean);
    setSavingCircles(true);
    try {
      await Promise.resolve(
        onUpdateEvent({
          ...event,
          validationConfig: {
            enabled: circleDraft.enabled,
            label: circleDraft.label.trim() || presetCfg.label,
            options: cleanedOptions.length > 0 ? cleanedOptions : presetCfg.options,
            requireInviteCode: Boolean(circleDraft.requireInviteCode),
            inviteCode: circleDraft.inviteCode?.trim() || undefined,
          },
        })
      );
      setEditingCircles(false);
      triggerToast('Guest circle & table settings saved');
    } catch (err) {
      triggerToast(err instanceof Error ? err.message : 'Unable to save circle validation rules.');
    } finally {
      setSavingCircles(false);
    }
  };

  const handleWalkInSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!onRegisterAttendee || !walkInName.trim() || !walkInPhone.trim()) return;
    const cleanEmail = walkInEmail.trim();
    if (cleanEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      triggerToast('Please enter a valid optional email address, or leave it blank.');
      return;
    }
    const normalizedPhone = normalizePhoneE164(walkInPhone);
    const code = `EV-${Math.floor(1000 + Math.random() * 9000)}`;
    const nowTime = new Date().toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
    });
    const guestName = walkInName.trim();
    try {
      await Promise.resolve(
        onRegisterAttendee(event.id, {
          id: `att-${Date.now()}`,
          eventId: event.id,
          name: guestName,
          email: cleanEmail,
          phone: normalizedPhone,
          organization: 'Gate Walk-In',
          tier: walkInTier,
          ticketCode: code,
          checkedIn: true,
          checkedInAt: nowTime,
          paymentStatus: 'paid',
          smsStatus: 'Arkesel Sent',
          validationGroup: walkInValidationGroup || workspaceCircles[0] || undefined,
        })
      );
      setWalkInName('');
      setWalkInPhone('');
      setWalkInEmail('');
      setAddingWalkIn(false);
      triggerToast(`Walk-in checked in (${code})`);
    } catch (err) {
      triggerToast(err instanceof Error ? err.message : 'Unable to check in walk-in guest.');
    }
  };

  const smsSegments = calculateSmsCredits(appendPoweredByLine(confirmationTemplate));

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
            <span
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-semibold border ${
                isQrPassPublished
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                  : 'bg-[#0B0B0B]/5 border-[#0B0B0B]/20 text-[#0B0B0B]'
              }`}
            >
              <QrCode className="w-3 h-3" />
              {isQrPassPublished ? 'Live QR Active' : 'Live QR Inactive'}
            </span>
            <button
              type="button"
              onClick={() => onPreviewPublicEvent('top')}
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
              Copy Invite Link
            </button>
            {copiedToast && (
              <span className="text-[11px] font-semibold text-[#0B0B0B]">Copied!</span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => onPreviewPublicEvent('checkin')}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white border border-[#E5E5EA] hover:border-[#0B0B0B] text-[#0B0B0B] transition-colors text-xs font-semibold shadow-sm whitespace-nowrap shrink-0"
            >
              <QrCode className="w-4 h-4" />
              Check-In &amp; QR Screen
            </button>
            {onOpenDisposableCamera && (
              <button
                type="button"
                onClick={() => onOpenDisposableCamera(event.id)}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white text-[#0B0B0B] hover:bg-[#E8E8EA] transition-colors text-xs font-semibold shadow-sm whitespace-nowrap shrink-0"
              >
                <Camera className="w-4 h-4" />
                Disposable Camera
              </button>
            )}
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
            {isEventCreator && onToggleQrPassPublished && (
              <button
                type="button"
                disabled={event.status === 'draft'}
                onClick={() => void onToggleQrPassPublished(event.id, !isQrPassPublished)}
                className={`inline-flex items-center gap-2 px-4 py-2 rounded-full transition-colors text-xs font-semibold shadow-sm whitespace-nowrap shrink-0 disabled:opacity-40 ${
                  isQrPassPublished
                    ? 'bg-white text-[#0B0B0B] border border-[#E5E5EA] hover:border-[#0B0B0B]'
                    : 'bg-[#0B0B0B] text-white hover:bg-zinc-800'
                }`}
              >
                <ShieldCheck className="w-4 h-4" />
                {isQrPassPublished ? 'Pause Live QR' : 'Activate Live QR'}
              </button>
            )}
            {isEventCreator && isQrPassPublished && (
              <button
                type="button"
                onClick={handleDownloadQrSvg}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white text-[#0B0B0B] hover:bg-[#E8E8EA] transition-colors text-xs font-semibold shadow-sm whitespace-nowrap shrink-0"
              >
                <QrCode className="w-4 h-4" />
                Badge QR
              </button>
            )}
            {isEventCreator && (
              <button
                type="button"
                onClick={() => onOpenEditModal(event)}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white text-[#0B0B0B] hover:bg-[#E8E8EA] transition-all text-xs font-semibold shadow-sm whitespace-nowrap shrink-0"
              >
                <Edit3 className="w-4 h-4" />
                Edit Event
              </button>
            )}
          </div>
        </div>

        {/* Prominent Organizer Flyer Showcase + Title & Metrics */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
          {/* Prominent Event Flyer / Image Showcase */}
          <div className="lg:col-span-5">
            <input
              ref={workspaceFlyerInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                void handleWorkspaceFlyerUpload(file);
              }}
            />
            <div className="relative group rounded-2xl overflow-hidden border border-[#E5E5EA] bg-[#0B0B0B] aspect-[16/10] shadow-md">
              {flyerSrc && !flyerFailed ? (
                <img
                  src={flyerSrc}
                  alt={`${event.title} uploaded flyer`}
                  onError={() => setFlyerFailed(true)}
                  className="w-full h-full object-cover object-center group-hover:scale-[1.02] transition-transform duration-300"
                />
              ) : (
                <MonochromePoster variant={event.artwork} className="w-full h-full" />
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/15 to-transparent pointer-events-none" />
              <div className="absolute top-3 left-3 right-3 flex items-center justify-between gap-2">
                <span className="px-2.5 py-1 rounded-full bg-black/70 backdrop-blur-md text-white text-[10px] font-semibold tracking-wider uppercase border border-white/15">
                  {event.flyerUrl?.startsWith('data:') ? 'Uploaded Flyer' : 'Event Flyer'}
                </span>
              </div>
              {isEventCreator && (
                <div className="absolute bottom-3 left-3 right-3 flex flex-wrap items-center justify-between gap-2">
                  <button
                    type="button"
                    disabled={uploadingFlyer}
                    onClick={() =>
                      onUpdateEvent ? workspaceFlyerInputRef.current?.click() : onOpenEditModal(event)
                    }
                    className="px-3.5 py-1.5 rounded-full bg-white text-[#0B0B0B] hover:bg-zinc-100 text-[11px] font-bold inline-flex items-center gap-1.5 shadow-sm transition-colors cursor-pointer"
                  >
                    <ImagePlus className="w-3.5 h-3.5" />
                    <span>{uploadingFlyer ? 'Saving...' : 'Upload / Replace Flyer'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onOpenEditModal(event)}
                    className="px-3 py-1.5 rounded-full bg-black/75 hover:bg-black text-white border border-white/20 text-[11px] font-semibold transition-colors"
                  >
                    Edit Theme &amp; Share
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Event Details & Live Workspace Counters */}
          <div className="lg:col-span-7 flex flex-col justify-between gap-5 min-w-0">
            <div>
              <div className="text-[11px] font-medium uppercase text-[#71717A] tracking-wider mb-1 flex items-center gap-2">
                <span>
                  {event.category} · {event.designTheme || getCategoryPreset(event.category).designTheme} Theme
                </span>
                <span
                  className="inline-block w-2.5 h-2.5 rounded-full border border-black/15"
                  style={{ backgroundColor: resolveEventBrandColor(event) }}
                  title={`Brand color ${resolveEventBrandColor(event)}`}
                />
              </div>
              <h1 className="font-display text-[26px] sm:text-[34px] leading-tight font-bold text-[#0B0B0B] tracking-[-0.03em] mb-2">
                {event.title}
              </h1>
              <p className="text-xs sm:text-sm text-[#71717A] leading-relaxed mb-3 line-clamp-2">
                {event.subtitle}
              </p>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[13px] text-[#71717A]">
                <span className="inline-flex items-center gap-1.5 tabular-nums">
                  <Calendar className="w-4 h-4 text-[#0B0B0B]" />
                  {formattedEventDate}
                </span>
                {eventDurationBadge && (
                  <span className="px-2.5 py-0.5 rounded-full bg-[#0B0B0B] text-white text-[11px] font-semibold">
                    {eventDurationBadge}
                  </span>
                )}
                {eventCheckInPolicy === 'daily-reentry' && (
                  <span className="px-2.5 py-0.5 rounded-full bg-white border border-[#E5E5EA] text-[#0B0B0B] text-[11px] font-semibold">
                    Daily Re-Entry Pass
                  </span>
                )}
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

            <div className="flex flex-wrap items-center gap-2.5">
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
        </div>
      </section>

      {/* Workspace Sub-Navigation Tabs */}
      <div className="w-full flex items-center gap-2 overflow-x-auto pb-1">
        {(
          [
            { id: 'overview', label: 'Overview & Details' },
            ...(isEventCreator
              ? [
                  {
                    id: 'planning' as const,
                    label: 'Planning',
                    icon: ClipboardCheck,
                    count: planningPendingCount,
                  },
                ]
              : []),
            { id: 'program', label: 'Program Builder', icon: LayoutGrid },
            { id: 'messages', label: 'Message Templates' },
            { id: 'attendees', label: 'Attendees', count: totalRegistered },
            { id: 'gifts', label: 'Gift Table', icon: Gift, count: giftEntriesCount },
            { id: 'polls', label: 'Polls', icon: BarChart3, count: pollsCount },
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

      {activeTab === 'planning' && isEventCreator ? (
        <EventPlanningPanel
          event={event}
          organizerName={profile.name || profile.studio || 'Organiser'}
          onUpdateEvent={onUpdateEvent}
          onSavePlanning={onSavePlanning}
          canEdit={isEventCreator}
        />
      ) : (
      /* Main Multi-Zone Content Grid */
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left / Primary Column (Span 8) */}
        <div className="lg:col-span-8 flex flex-col gap-6 min-w-0">
          {/* Overview Banner when Overview tab active */}
          {activeTab === 'overview' && (
            <section className="bg-[#F5F5F7] rounded-[28px] p-6 sm:p-8 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h2 className="font-display text-[22px] font-bold text-[#0B0B0B] tracking-[-0.02em]">
                    Event Summary &amp; Landing Page
                  </h2>
                  <p className="text-sm text-[#71717A] mt-1">{event.subtitle}</p>
                </div>
                <button
                  type="button"
                  onClick={() => onPreviewPublicEvent('top')}
                  className="px-4 py-2 rounded-full bg-[#0B0B0B] text-white text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
                >
                  <span>Open /e/{event.slug}</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 pt-2">
                <div className="p-4 rounded-2xl bg-white">
                  <span className="text-[11px] text-[#71717A] block">Organizer</span>
                  <span className="text-sm font-semibold text-[#0B0B0B]">{event.organizer}</span>
                </div>
                <div className="p-4 rounded-2xl bg-white">
                  <span className="text-[11px] text-[#71717A] block">Event Dates</span>
                  <span className="text-sm font-semibold text-[#0B0B0B] tabular-nums">
                    {formattedEventDate}
                  </span>
                  {eventDurationBadge && (
                    <span className="block text-[11px] text-[#71717A] mt-0.5">
                      {eventDurationBadge}
                    </span>
                  )}
                </div>
                <div className="p-4 rounded-2xl bg-white">
                  <span className="text-[11px] text-[#71717A] block">Gate Policy &amp; SMS</span>
                  <span className="text-sm font-semibold text-[#0B0B0B]">
                    {eventCheckInPolicy === 'daily-reentry' ? 'Daily Re-Entry' : 'One-Time Entry'}
                  </span>
                  <span className="block text-[11px] text-[#71717A] tabular-nums mt-0.5">
                    {event.smsDispatched} passes sent
                  </span>
                </div>
                <div className="p-4 rounded-2xl bg-white">
                  <span className="text-[11px] text-[#71717A] block">
                    {event.extraDataConfig?.enableGiftTable ? 'Gift Table Pledges' : 'Ticket Pricing'}
                  </span>
                  <span className="text-sm font-semibold text-[#0B0B0B] tabular-nums">
                    {event.extraDataConfig?.enableGiftTable
                      ? `GHS ${giftTotalGhs.toLocaleString()} (${giftEntriesCount} gifts)`
                      : event.ticketPrice === 0
                        ? 'Free Admission'
                        : `$${event.ticketPrice}`}
                  </span>
                </div>
              </div>

              {isEventCreator && onUpdateEvent && (
                <div className="p-4 rounded-2xl bg-white border border-[#E5E5EA] space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-xs font-bold text-[#0B0B0B]">
                        Multi-Day Schedule &amp; Gate Re-Entry Policy
                      </p>
                      <p className="text-[11px] text-[#71717A]">
                        {formattedEventDate}
                        {eventDurationBadge ? ` · ${eventDurationBadge}` : ' · Single-Day'} ·{' '}
                        {eventCheckInPolicy === 'daily-reentry'
                          ? 'Same QR re-enters once per calendar day'
                          : 'QR validates one-time entry'}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setEditingDatesPolicy((p) => !p)}
                      className="px-3.5 py-1.5 rounded-full bg-[#F5F5F7] hover:bg-[#E8E8EA] text-[11px] font-semibold text-[#0B0B0B] transition-colors"
                    >
                      {editingDatesPolicy ? 'Close' : 'Edit Dates & Gate Policy'}
                    </button>
                  </div>
                  {editingDatesPolicy && (
                    <div className="pt-2 border-t border-[#E5E5EA] space-y-3">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-[11px] font-semibold text-[#0B0B0B] mb-1">
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
                            className="w-full h-10 px-3 rounded-xl bg-[#F5F5F7] text-xs text-[#0B0B0B] tabular-nums"
                          />
                        </div>
                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <label className="text-[11px] font-semibold text-[#0B0B0B]">
                              End Date
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
                              <span>Multi-Day Event</span>
                            </label>
                          </div>
                          <input
                            type="date"
                            disabled={!multiDayDraft}
                            min={startIsoDraft}
                            value={multiDayDraft ? endIsoDraft : ''}
                            onChange={(e) => setEndIsoDraft(e.target.value)}
                            className="w-full h-10 px-3 rounded-xl bg-[#F5F5F7] text-xs text-[#0B0B0B] tabular-nums disabled:opacity-45"
                          />
                        </div>
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
                            onClick={() => setPolicyDraft(opt.id)}
                            className={`py-2 px-3 rounded-lg text-[11px] font-semibold transition-colors ${
                              policyDraft === opt.id
                                ? 'bg-white text-[#0B0B0B] shadow-sm'
                                : 'text-[#71717A] hover:text-[#0B0B0B]'
                            }`}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setEditingDatesPolicy(false)}
                          className="px-4 py-2 rounded-full border border-[#E5E5EA] text-xs font-semibold text-[#0B0B0B]"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          disabled={savingDatesPolicy}
                          onClick={() => void handleSaveDatesPolicy()}
                          className="px-4 py-2 rounded-full bg-[#0B0B0B] text-white text-xs font-semibold disabled:opacity-50"
                        >
                          {savingDatesPolicy ? 'Saving...' : 'Save Dates & Policy'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {isEventCreator && onUpdateEvent && (
                <div className="pt-3 border-t border-[#E5E5EA]">
                  <ThemeColorPicker
                    designTheme={event.designTheme || getCategoryPreset(event.category).designTheme}
                    brandColor={event.brandColor ?? event.extraDataConfig?.brandColor}
                    onChangeTheme={async (nextTheme) => {
                      try {
                        await Promise.resolve(
                          onUpdateEvent({
                            ...event,
                            designTheme: nextTheme,
                          })
                        );
                        triggerToast('Event theme updated');
                      } catch (err) {
                        triggerToast(err instanceof Error ? err.message : 'Unable to save theme.');
                      }
                    }}
                    onChangeBrandColor={async (nextColor) => {
                      const presetCfg = getCategoryPreset(event.category).extraDataConfig;
                      try {
                        await Promise.resolve(
                          onUpdateEvent({
                            ...event,
                            brandColor: nextColor,
                            extraDataConfig: {
                              ...(event.extraDataConfig ?? presetCfg),
                              brandColor: nextColor,
                            },
                          })
                        );
                        triggerToast('Brand color saved');
                      } catch (err) {
                        triggerToast(
                          err instanceof Error ? err.message : 'Unable to save brand color.'
                        );
                      }
                    }}
                    title="Live Event Theme & Brand Color"
                  />
                </div>
              )}
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
                <SplineChart data={velocitySeries} />
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
                      {eventBlocks.length} scheduled run-of-show {eventBlocks.length === 1 ? 'block' : 'blocks'}
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
                  <div className="grid grid-cols-2 gap-2">
                    <select
                      value={newBlockDay}
                      onChange={(e) => {
                        const chosenDay = e.target.value as ScheduleBlock['day'];
                        setNewBlockDay(chosenDay);
                        const mapped = resolveIsoDateForScheduleDay(chosenDay, event);
                        if (mapped) setNewBlockDate(mapped);
                      }}
                      aria-label="Program day"
                      className="h-10 px-3 rounded-full bg-[#F5F5F7] text-xs font-semibold text-[#0B0B0B] focus:outline-none focus:ring-1 focus:ring-[#0B0B0B]"
                    >
                      {eventDayOptions.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                    <input
                      type="date"
                      value={newBlockDate}
                      onChange={(e) => {
                        const val = e.target.value;
                        setNewBlockDate(val);
                        const clean = sanitizeIsoDate(val);
                        if (clean) {
                          setNewBlockDay(getScheduleBlockDayFromIso(clean, event, newBlockDay));
                        }
                      }}
                      aria-label="Specific calendar date"
                      className="h-10 px-3 rounded-full bg-[#F5F5F7] text-xs font-mono text-[#0B0B0B] focus:outline-none focus:ring-1 focus:ring-[#0B0B0B]"
                    />
                  </div>
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
                    className="sm:col-span-2 h-10 px-5 rounded-full bg-[#0B0B0B] text-white text-xs font-semibold hover:bg-neutral-800 transition-colors"
                  >
                    Save Program Block
                  </button>
                </form>
              )}

              {(activeProgramDateSlots.length > 1 || activeProgramDays.length > 1) && (
                <div className="space-y-1.5">
                  {activeProgramDateSlots.length > 1 && (
                    <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
                      <button
                        type="button"
                        onClick={() => {
                          setProgramDateFilter('all');
                          setProgramDayFilter('all');
                        }}
                        className={`px-3.5 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-colors ${
                          programDateFilter === 'all' && programDayFilter === 'all'
                            ? 'bg-[#0B0B0B] text-white'
                            : 'bg-white text-[#71717A] hover:text-[#0B0B0B]'
                        }`}
                      >
                        All Dates ({eventBlocks.length})
                      </button>
                      {activeProgramDateSlots.map((slot) => {
                        const cnt = eventBlocks.filter(
                          (b) => resolveScheduleBlockDate(b, event) === slot.isoDate
                        ).length;
                        return (
                          <button
                            key={slot.isoDate}
                            type="button"
                            onClick={() => {
                              setProgramDateFilter(slot.isoDate);
                              setProgramDayFilter('all');
                            }}
                            className={`px-3.5 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-colors ${
                              programDateFilter === slot.isoDate
                                ? 'bg-[#0B0B0B] text-white'
                                : 'bg-white text-[#71717A] hover:text-[#0B0B0B]'
                            }`}
                          >
                            {slot.label} ({cnt})
                          </button>
                        );
                      })}
                    </div>
                  )}
                  {activeProgramDays.length > 1 && activeProgramDateSlots.length <= 1 && (
                    <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
                      <button
                        type="button"
                        onClick={() => setProgramDayFilter('all')}
                        className={`px-3.5 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-colors ${
                          programDayFilter === 'all'
                            ? 'bg-[#0B0B0B] text-white'
                            : 'bg-white text-[#71717A] hover:text-[#0B0B0B]'
                        }`}
                      >
                        All Days ({eventBlocks.length})
                      </button>
                      {activeProgramDays.map((day) => {
                        const cnt = eventBlocks.filter((b) => b.day === day).length;
                        return (
                          <button
                            key={day}
                            type="button"
                            onClick={() => setProgramDayFilter(day)}
                            className={`px-3.5 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-colors ${
                              programDayFilter === day
                                ? 'bg-[#0B0B0B] text-white'
                                : 'bg-white text-[#71717A] hover:text-[#0B0B0B]'
                            }`}
                          >
                            {day} ({cnt})
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* Schedule Items Flow */}
              <div className="flex flex-col gap-2.5 mt-1">
                {visibleProgramBlocks.length === 0 ? (
                  <div className="p-6 rounded-2xl bg-white text-center text-xs text-[#71717A]">
                    No sessions scheduled for this date filter yet. Click &ldquo;Add Item&rdquo; to
                    create a program block.
                  </div>
                ) : (
                  visibleProgramBlocks.map((block) => {
                    const resolvedBlockIso = resolveScheduleBlockDate(block, event) || '';
                    const dateBadge = formatScheduleBlockDateBadge(block, event);
                    return (
                      <div
                        key={block.id}
                        className="group flex flex-col md:flex-row md:items-center justify-between p-4 rounded-2xl bg-white hover:shadow-md transition-all gap-3"
                      >
                        <div className="flex items-start md:items-center gap-3 min-w-0">
                          <GripVertical className="w-4.5 h-4.5 text-[#71717A] shrink-0 mt-1 md:mt-0" />
                          <span className="px-2.5 py-1 rounded-full bg-[#0B0B0B] text-white text-[10px] font-semibold shrink-0 whitespace-nowrap">
                            {dateBadge}
                          </span>
                          <div className="px-3 py-1 rounded-full bg-[#F5F5F7] text-xs font-semibold text-[#0B0B0B] shrink-0 tabular-nums font-mono">
                            {block.time}
                          </div>
                          <div className="flex flex-col min-w-0">
                            <span className="text-sm sm:text-base font-semibold text-[#0B0B0B]">
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

                        <div className="flex flex-wrap items-center justify-end gap-2 shrink-0">
                          {onUpdateScheduleBlock && (
                            <input
                              type="date"
                              value={resolvedBlockIso}
                              aria-label={`Assign date for ${block.title}`}
                              onChange={(e) => {
                                const clean = sanitizeIsoDate(e.target.value);
                                if (!clean) return;
                                void Promise.resolve(
                                  onUpdateScheduleBlock(block.id, {
                                    date: clean,
                                    day: getScheduleBlockDayFromIso(clean, event, block.day),
                                  })
                                ).catch((err) =>
                                  triggerToast(
                                    err instanceof Error
                                      ? err.message
                                      : 'Unable to update session date.'
                                  )
                                );
                              }}
                              className="h-8 px-2.5 rounded-full bg-[#F5F5F7] border border-[#E5E5EA] text-[11px] font-mono text-[#0B0B0B] focus:bg-white focus:border-[#0B0B0B] focus:outline-none"
                            />
                          )}
                          <button
                            type="button"
                            onClick={() => {
                              void Promise.resolve(onToggleScheduleBlock(block.id)).catch((err) =>
                                triggerToast(
                                  err instanceof Error ? err.message : 'Unable to update schedule block.'
                                )
                              );
                            }}
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
                              onClick={() => {
                                void Promise.resolve(onDeleteScheduleBlock(block.id)).catch((err) =>
                                  triggerToast(
                                    err instanceof Error ? err.message : 'Unable to delete block.'
                                  )
                                );
                              }}
                              aria-label="Delete session"
                              className="w-8 h-8 rounded-full bg-[#F5F5F7] flex items-center justify-center hover:bg-[#EF4444]/10 hover:text-[#EF4444] text-[#71717A] transition-colors"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })
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
                  {isEventCreator && onRegisterAttendee ? (
                    <button
                      type="button"
                      onClick={() => setAddingWalkIn((p) => !p)}
                      className="px-4 py-2 rounded-full bg-white text-[#0B0B0B] border border-[#E5E5EA] hover:border-[#0B0B0B] text-xs font-semibold transition-all inline-flex items-center gap-1.5 whitespace-nowrap"
                    >
                      <UserPlus className="w-3.5 h-3.5" />
                      <span>{addingWalkIn ? 'Close Form' : 'Check-In Registration'}</span>
                    </button>
                  ) : (
                    <span className="px-3.5 py-2 rounded-full bg-white border border-[#E5E5EA] text-[11px] font-semibold text-[#71717A] whitespace-nowrap">
                      Gate Staff · Scan Only
                    </span>
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

              {addingWalkIn && isEventCreator && onRegisterAttendee && (
                <div className="rounded-3xl bg-white border border-[#E5E5EA] grid grid-cols-1 md:grid-cols-12 items-stretch overflow-hidden">
                  <div className="md:col-span-5 flex flex-col bg-white">
                    <CheckInFlyerSidePanel
                      event={event}
                      variant="full"
                      featherEdge="white"
                      featherBreakpoint="md"
                      showFooter={false}
                      heroHeightClass="h-[190px] sm:h-[220px] md:h-auto md:min-h-0 md:flex-1"
                      className="rounded-none border-0 shadow-none flex-1"
                    />
                  </div>
                  <form
                    onSubmit={handleWalkInSubmit}
                    className="md:col-span-7 p-4 sm:p-6 grid grid-cols-1 sm:grid-cols-2 gap-3 content-center bg-white relative z-10"
                  >
                    {!isQrPassPublished && (
                      <div className="sm:col-span-2 p-3 rounded-2xl bg-[#F5F5F7] border border-[#E5E5EA] flex flex-wrap items-center justify-between gap-2 text-xs text-[#0B0B0B]">
                        <span>
                          Live Check-In QR is currently inactive. Activate it as the event creator before issuing live guest passes.
                        </span>
                        {onToggleQrPassPublished && (
                          <button
                            type="button"
                            disabled={event.status === 'draft'}
                            onClick={() => void onToggleQrPassPublished(event.id, true)}
                            className="px-3 py-1 rounded-full bg-[#0B0B0B] text-white text-[11px] font-semibold disabled:opacity-40"
                          >
                            Activate Live QR
                          </button>
                        )}
                      </div>
                    )}
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
                      placeholder="Email (optional — SMS pass still sends)"
                      className="h-10 px-4 rounded-full bg-[#F5F5F7] text-xs text-[#0B0B0B] placeholder:text-[#71717A] focus:outline-none focus:ring-1 focus:ring-[#0B0B0B]"
                    />
                    {workspaceCircles.length > 0 && (
                      <select
                        aria-label="Guest Circle or Table"
                        value={walkInValidationGroup}
                        onChange={(e) => setWalkInValidationGroup(e.target.value)}
                        className="h-10 px-3.5 rounded-full bg-[#F5F5F7] text-xs font-semibold text-[#0B0B0B] focus:outline-none focus:ring-1 focus:ring-[#0B0B0B]"
                      >
                        {workspaceCircles.map((circle) => (
                          <option key={circle} value={circle}>
                            {circle}
                          </option>
                        ))}
                      </select>
                    )}
                    <div className="flex items-center gap-2 sm:col-span-2">
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
                        disabled={!isQrPassPublished}
                        className="flex-1 h-10 px-4 rounded-full bg-[#0B0B0B] text-white text-xs font-semibold hover:bg-neutral-800 transition-colors whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        Register &amp; Check In
                      </button>
                    </div>
                  </form>
                </div>
              )}

              {/* Guest Circle & Table Breakdown + Live Editor */}
              {(circleBreakdown.length > 0 || isEventCreator) && (
                <div className="p-4 rounded-2xl bg-white border border-[#E5E5EA] space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <ShieldCheck className="w-4 h-4 text-[#0B0B0B]" />
                      <span className="text-xs font-bold text-[#0B0B0B]">
                        {event.validationConfig?.label || 'Guest Circles & Tables'}
                      </span>
                    </div>
                    {isEventCreator && onUpdateEvent && (
                      <button
                        type="button"
                        onClick={() => setEditingCircles((p) => !p)}
                        className="px-3 py-1 rounded-full bg-[#F5F5F7] hover:bg-[#E8E8EA] text-[11px] font-semibold text-[#0B0B0B] transition-colors"
                      >
                        {editingCircles ? 'Close Editor' : 'Edit Circles & Tables'}
                      </button>
                    )}
                  </div>

                  {circleBreakdown.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setCircleFilter('all')}
                        className={`px-3 py-1.5 rounded-full text-[11px] font-semibold transition-colors ${
                          circleFilter === 'all'
                            ? 'bg-[#0B0B0B] text-white'
                            : 'bg-[#F5F5F7] text-[#0B0B0B] hover:bg-[#E8E8EA]'
                        }`}
                      >
                        All Circles ({eventAttendees.length})
                      </button>
                      {circleBreakdown.map((item) => {
                        const active = circleFilter === item.label;
                        return (
                          <button
                            key={item.label}
                            type="button"
                            onClick={() => setCircleFilter(active ? 'all' : item.label)}
                            className={`px-3 py-1.5 rounded-full text-[11px] font-semibold transition-colors inline-flex items-center gap-1.5 ${
                              active
                                ? 'bg-[#0B0B0B] text-white'
                                : 'bg-[#F5F5F7] text-[#0B0B0B] hover:bg-[#E8E8EA]'
                            }`}
                          >
                            <span>{item.label}</span>
                            <span
                              className={`font-mono text-[10px] tabular-nums ${
                                active ? 'text-zinc-300' : 'text-[#71717A]'
                              }`}
                            >
                              {item.checkedIn}/{item.registered}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {editingCircles && isEventCreator && onUpdateEvent && (
                    <div className="pt-2 space-y-3 border-t border-[#E5E5EA]">
                      <GuestCircleValidationEditor
                        compact
                        category={event.category}
                        value={circleDraft}
                        onChange={setCircleDraft}
                      />
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setEditingCircles(false)}
                          className="px-4 py-2 rounded-full border border-[#E5E5EA] text-xs font-semibold text-[#0B0B0B] hover:bg-[#F5F5F7]"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          disabled={savingCircles}
                          onClick={() => void handleSaveCircleSettings()}
                          className="px-4 py-2 rounded-full bg-[#0B0B0B] text-white text-xs font-semibold hover:bg-zinc-800 disabled:opacity-50"
                        >
                          {savingCircles ? 'Saving...' : 'Save Circle Settings'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
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
                    const checkedInToday = isAttendeeCheckedInForDate(att, event, todayIso);
                    const daysCount = getAttendeeCheckedInDaysCount(att);
                    const isDailyPolicy = eventCheckInPolicy === 'daily-reentry';
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
                              {att.validationGroup && (
                                <span className="px-2 py-0.5 rounded-full bg-[#F5F5F7] border border-[#E5E5EA] text-[#0B0B0B] text-[10px] font-semibold">
                                  {att.validationGroup}
                                </span>
                              )}
                              {isDailyPolicy ? (
                                checkedInToday ? (
                                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-[#E8E8EA] text-[#0B0B0B] text-[11px] font-medium tabular-nums">
                                    <span className="w-1.5 h-1.5 rounded-full bg-[#0B0B0B]" />
                                    Today {att.checkedInAt || 'Checked'} · {daysCount}{' '}
                                    {daysCount === 1 ? 'day' : 'days'}
                                  </span>
                                ) : daysCount > 0 ? (
                                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-[#F5F5F7] border border-[#E5E5EA] text-[#0B0B0B] text-[11px] font-medium tabular-nums">
                                    {daysCount} {daysCount === 1 ? 'day' : 'days'} prior · Ready today
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-[#E8E8EA] text-[#71717A] text-[11px] font-medium">
                                    Pending Arrival
                                  </span>
                                )
                              ) : att.checkedIn ? (
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
                              {att.phone}
                              {att.email?.trim() ? ` · ${att.email.trim()}` : ''}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
                          <button
                            type="button"
                            onClick={() =>
                              isDailyPolicy
                                ? onToggleCheckIn(att.id, {
                                    mode: checkedInToday ? 'undo' : 'checkin',
                                    dateIso: todayIso,
                                  })
                                : onToggleCheckIn(att.id)
                            }
                            className={`px-4 py-1.5 rounded-full text-xs font-semibold flex items-center gap-1.5 transition-all whitespace-nowrap ${
                              (isDailyPolicy ? checkedInToday : att.checkedIn)
                                ? 'bg-[#0B0B0B] text-white'
                                : 'bg-[#F5F5F7] hover:bg-[#0B0B0B] hover:text-white text-[#0B0B0B]'
                            }`}
                          >
                            {(isDailyPolicy ? checkedInToday : att.checkedIn) ? (
                              <>
                                <Check className="w-3.5 h-3.5" />
                                <span>{isDailyPolicy ? 'Checked In Today' : 'Checked In'}</span>
                              </>
                            ) : (
                              <>
                                <QrCode className="w-3.5 h-3.5" />
                                <span>{isDailyPolicy ? 'Check In Today' : 'Check In'}</span>
                              </>
                            )}
                          </button>
                          {isEventCreator && onDeleteAttendee && (
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteAttendee(att)}
                              title="Delete attendee"
                              aria-label={`Delete ${att.name}`}
                              className="w-8 h-8 rounded-full bg-white border border-[#E5E5EA] hover:border-[#EF4444] hover:bg-red-50 text-[#71717A] hover:text-[#EF4444] transition-colors inline-flex items-center justify-center shrink-0"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
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
            <section className="bg-[#F5F5F7] rounded-[28px] p-6 sm:p-8 space-y-5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h2 className="font-display text-[22px] font-bold text-[#0B0B0B] tracking-[-0.02em]">
                    Arkesel SMS &amp; Check-In Camera Studio
                  </h2>
                  <p className="text-xs text-[#71717A] mt-0.5">
                    Customize your Arkesel Sender ID and every attendee message (up to 5 photos + collage per guest).
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    if (navigator.clipboard?.writeText) {
                      navigator.clipboard.writeText(cameraUrlForEvent).catch(() => {});
                    }
                    triggerToast('Disposable Camera link copied');
                  }}
                  className="px-4 py-2 rounded-full bg-white border border-[#E5E5EA] hover:border-[#0B0B0B] text-xs font-semibold text-[#0B0B0B] inline-flex items-center gap-1.5 self-start shrink-0"
                >
                  <Copy className="w-3.5 h-3.5" />
                  Copy Camera Link
                </button>
              </div>

              {(!entitlements.allowCustomSenderId || !entitlements.allowCustomMessages) && (
                <div className="p-4 rounded-2xl bg-white border border-[#E5E5EA] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-start gap-2.5">
                    <Lock className="w-4 h-4 text-[#0B0B0B] mt-0.5 shrink-0" />
                    <div>
                      <p className="text-xs font-semibold text-[#0B0B0B]">
                        Starter Uses Shared Sender ID ({DEFAULT_SHARED_SENDER_ID}) &amp; Default Templates
                      </p>
                      <p className="text-[11px] text-[#71717A]">
                        Upgrade to Pro Organizer ($19/mo) to register custom Arkesel Sender IDs and personalize confirmation &amp; check-in templates.
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={onOpenPlans}
                    className="px-4 py-1.5 rounded-full bg-[#0B0B0B] text-white text-xs font-semibold shrink-0 self-start sm:self-center"
                  >
                    Upgrade to Pro
                  </button>
                </div>
              )}

              {/* Event Arkesel Sender ID + Auto Camera Link Toggle */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-4 rounded-2xl bg-white space-y-2 border border-[#E5E5EA]/70">
                  <div className="flex items-center justify-between text-xs font-semibold">
                    <label htmlFor="ws-sender-id" className="inline-flex items-center gap-1.5">
                      <span>Event Arkesel Sender ID</span>
                      {!entitlements.allowCustomSenderId && (
                        <Lock className="w-3 h-3 text-[#71717A]" />
                      )}
                    </label>
                    <span className="font-mono text-[#71717A]">
                      {(entitlements.allowCustomSenderId ? senderIdDraft : DEFAULT_SHARED_SENDER_ID).length}/11
                    </span>
                  </div>
                  <input
                    id="ws-sender-id"
                    type="text"
                    maxLength={11}
                    disabled={!entitlements.allowCustomSenderId}
                    value={entitlements.allowCustomSenderId ? senderIdDraft : DEFAULT_SHARED_SENDER_ID}
                    onChange={(e) => {
                      if (!entitlements.allowCustomSenderId) return;
                      setSenderIdDraft(
                        e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 11)
                      );
                    }}
                    className="w-full h-10 px-3.5 rounded-xl bg-[#F5F5F7] text-xs font-mono font-bold tracking-wider uppercase text-[#0B0B0B] focus:outline-none focus:ring-1 focus:ring-[#0B0B0B] disabled:opacity-60 disabled:cursor-not-allowed"
                  />
                </div>

                <div className="p-4 rounded-2xl bg-white flex items-center justify-between gap-3 border border-[#E5E5EA]/70">
                  <div>
                    <p className="text-xs font-semibold text-[#0B0B0B]">
                      Attach Disposable Camera Link
                    </p>
                    <p className="text-[11px] text-[#71717A] mt-0.5">
                      Include <code className="font-mono">{'{cameraLink}'}</code> in SMS &amp; email
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
              </div>

              {/* Confirmation SMS */}
              <div className="p-4 rounded-2xl bg-white space-y-3 border border-[#E5E5EA]/70">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-semibold">
                  <span>Registration Confirmation SMS</span>
                  <span className="text-[#71717A] font-mono tabular-nums">
                    {smsSegments} SMS segment · {confirmationTemplate.length} chars
                  </span>
                </div>
                <textarea
                  rows={3}
                  readOnly={!entitlements.allowCustomMessages}
                  value={confirmationTemplate}
                  onChange={(e) => {
                    if (entitlements.allowCustomMessages) setConfirmationTemplate(e.target.value);
                  }}
                  className={`w-full p-3.5 rounded-2xl bg-[#F5F5F7] text-xs font-mono text-[#0B0B0B] focus:outline-none focus:ring-1 focus:ring-[#0B0B0B] ${
                    !entitlements.allowCustomMessages ? 'opacity-65 cursor-not-allowed' : ''
                  }`}
                />
              </div>

              {/* Check-In Welcome SMS */}
              <div className="p-4 rounded-2xl bg-white space-y-3 border border-[#E5E5EA]/70">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-semibold">
                  <span>Check-In Welcome SMS (Dispatched When Guest Checks In)</span>
                  <div className="flex flex-wrap gap-1">
                    {['{name}', '{event}', '{code}', '{cameraLink}'].map((tag) => (
                      <button
                        key={tag}
                        type="button"
                        disabled={!entitlements.allowCustomMessages}
                        onClick={() => setCheckInTemplate((prev) => `${prev} ${tag}`.trim())}
                        className="px-2 py-0.5 rounded-full bg-[#F5F5F7] hover:bg-[#E5E5EA] text-[10px] font-mono text-[#0B0B0B] disabled:opacity-45 disabled:cursor-not-allowed"
                      >
                        + {tag}
                      </button>
                    ))}
                  </div>
                </div>
                <textarea
                  rows={3}
                  readOnly={!entitlements.allowCustomMessages}
                  value={checkInTemplate}
                  onChange={(e) => {
                    if (entitlements.allowCustomMessages) setCheckInTemplate(e.target.value);
                  }}
                  className={`w-full p-3.5 rounded-2xl bg-[#F5F5F7] text-xs font-mono text-[#0B0B0B] focus:outline-none focus:ring-1 focus:ring-[#0B0B0B] ${
                    !entitlements.allowCustomMessages ? 'opacity-65 cursor-not-allowed' : ''
                  }`}
                />
                <div className="p-3 rounded-xl bg-[#F5F5F7] text-[11px] text-[#0B0B0B]">
                  <span className="font-semibold text-[#71717A] block mb-1">
                    Live Gate Check-In Preview (5 Photos + Collage):
                  </span>
                  <p className="font-mono break-words whitespace-pre-line">
                    {
                      resolveEventMessage({
                        type: 'checkin',
                        template: checkInTemplate,
                        event: {
                          ...event,
                          messageConfig: { includeCameraLink },
                        },
                        attendeeName: 'Guest Name',
                        ticketCode: 'PASS-0001',
                      }).text
                    }
                  </p>
                </div>
                <p className="text-[11px] text-[#71717A]">
                  Constant line appended to every SMS &amp; email:{' '}
                  <span className="font-mono text-[#0B0B0B]">{POWERED_BY_LINE}</span>
                </p>
              </div>

              <div className="flex justify-end">
                {entitlements.allowCustomSenderId || entitlements.allowCustomMessages ? (
                  <button
                    type="button"
                    disabled={savingMessages}
                    onClick={() => void handleSaveMessageSettings()}
                    className="px-5 py-2.5 rounded-full bg-[#0B0B0B] text-white text-xs font-semibold hover:bg-zinc-800 transition-colors disabled:opacity-60"
                  >
                    {savingMessages ? 'Saving...' : 'Save All Message Templates & Sender ID'}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={onOpenPlans}
                    className="px-5 py-2.5 rounded-full bg-[#0B0B0B] text-white text-xs font-semibold hover:bg-zinc-800 transition-colors inline-flex items-center gap-1.5"
                  >
                    <Lock className="w-3.5 h-3.5" />
                    Upgrade to Customize Messages &amp; Sender ID
                  </button>
                )}
              </div>
            </section>
          )}

          {/* Standalone Gift Table Ledger Tab */}
          {activeTab === 'gifts' && (
            <section className="bg-[#F5F5F7] rounded-[28px] p-6 sm:p-8 space-y-5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <span className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-[#71717A]">
                    <Gift className="w-3.5 h-3.5 text-[#0B0B0B]" />
                    Standalone Activity · Separate from Walk-Ins &amp; RSVP
                  </span>
                  <h2 className="font-display text-[22px] font-bold text-[#0B0B0B] tracking-[-0.02em] mt-0.5">
                    {event.extraDataConfig?.giftTitle || 'Event Gift Table & Ledger'}
                  </h2>
                  <p className="text-xs text-[#71717A] mt-0.5">
                    Public URL: <span className="font-mono text-[#0B0B0B]">/e/{event.slug}/gifts</span>
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard?.writeText(giftsStandaloneUrl).catch(() => {});
                      triggerToast('Standalone Gift Table URL copied');
                    }}
                    className="px-3.5 py-2 rounded-full bg-white border border-[#E5E5EA] hover:border-[#0B0B0B] text-xs font-semibold text-[#0B0B0B] inline-flex items-center gap-1.5"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    Copy Gift URL
                  </button>
                  <button
                    type="button"
                    onClick={() => onPreviewPublicEvent('gifts')}
                    className="px-4 py-2 rounded-full bg-[#0B0B0B] text-white text-xs font-semibold inline-flex items-center gap-1.5"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    Open Public Gift Table
                  </button>
                  <button
                    type="button"
                    onClick={handleExportGiftsCsv}
                    className="px-3.5 py-2 rounded-full bg-white border border-[#E5E5EA] hover:border-[#0B0B0B] text-xs font-semibold text-[#0B0B0B] inline-flex items-center gap-1.5"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Gift CSV
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="p-4 rounded-2xl bg-white">
                  <span className="text-[11px] text-[#71717A] block">Recorded Entries</span>
                  <span className="text-lg font-bold text-[#0B0B0B] tabular-nums">
                    {giftEntriesCount}
                  </span>
                </div>
                <div className="p-4 rounded-2xl bg-white">
                  <span className="text-[11px] text-[#71717A] block">GHS Cash / MoMo Total</span>
                  <span className="text-lg font-bold text-[#0B0B0B] tabular-nums">
                    GHS {giftTotalGhs.toLocaleString()}
                  </span>
                </div>
                <div className="p-4 rounded-2xl bg-white">
                  <span className="text-[11px] text-[#71717A] block">MoMo Account</span>
                  <span className="text-xs font-mono font-bold text-[#0B0B0B] truncate block mt-1">
                    {event.extraDataConfig?.momoNumber || 'Configured in Edit Event'}
                  </span>
                </div>
              </div>

              {onCreateGiftAttendantLink && onToggleGiftAttendantLink && onDeleteGiftAttendantLink && (
                <GiftAttendantLinksCard
                  event={event}
                  canManage={isEventCreator}
                  onCreateLink={onCreateGiftAttendantLink}
                  onToggleLink={onToggleGiftAttendantLink}
                  onDeleteLink={onDeleteGiftAttendantLink}
                  onPreviewDeskLink={onPreviewDeskLink}
                  onToast={triggerToast}
                />
              )}

              {onRecordGiftEntry && (
                <form
                  onSubmit={handleRecordDeskGift}
                  className="p-5 rounded-2xl bg-white border border-[#E5E5EA]/70 space-y-3"
                >
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-bold text-[#0B0B0B]">
                      Record Physical Envelope / Venue Gift Desk Entry
                    </h3>
                    <span className="text-[10px] font-mono text-[#71717A]">
                      Does not modify attendee capacity
                    </span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                    <input
                      type="text"
                      required
                      value={giftGiverName}
                      onChange={(e) => setGiftGiverName(e.target.value)}
                      placeholder="Giver / Family name *"
                      className="h-10 px-3.5 rounded-xl bg-[#F5F5F7] text-xs font-medium text-[#0B0B0B]"
                    />
                    <input
                      type="tel"
                      value={giftGiverPhone}
                      onChange={(e) => setGiftGiverPhone(e.target.value)}
                      placeholder="Phone (optional)"
                      className="h-10 px-3.5 rounded-xl bg-[#F5F5F7] text-xs font-mono text-[#0B0B0B]"
                    />
                    <select
                      value={giftDeskType}
                      onChange={(e) =>
                        setGiftDeskType(
                          e.target.value as 'cash-momo' | 'registry-item' | 'blessing-only'
                        )
                      }
                      className="h-10 px-3.5 rounded-xl bg-[#F5F5F7] text-xs font-semibold text-[#0B0B0B]"
                    >
                      <option value="cash-momo">Cash / MoMo Envelope</option>
                      <option value="registry-item">Registry Gift Box</option>
                      <option value="blessing-only">Well-Wishes Card</option>
                    </select>
                  </div>

                  {giftDeskType === 'cash-momo' && (
                    <div className="grid grid-cols-3 gap-2.5">
                      <select
                        value={giftDeskCurrency}
                        onChange={(e) => setGiftDeskCurrency(e.target.value as 'GHS' | 'USD')}
                        className="h-10 px-3.5 rounded-xl bg-[#F5F5F7] text-xs font-bold text-[#0B0B0B]"
                      >
                        <option value="GHS">GHS</option>
                        <option value="USD">USD</option>
                      </select>
                      <input
                        type="number"
                        min={1}
                        required
                        value={giftDeskAmount}
                        onChange={(e) => setGiftDeskAmount(e.target.value)}
                        placeholder="Amount"
                        className="col-span-2 h-10 px-3.5 rounded-xl bg-[#F5F5F7] text-xs font-mono font-semibold text-[#0B0B0B]"
                      />
                    </div>
                  )}

                  {giftDeskType === 'registry-item' && (
                    <input
                      type="text"
                      value={giftDeskItem}
                      onChange={(e) => setGiftDeskItem(e.target.value)}
                      placeholder="Gift item description"
                      className="w-full h-10 px-3.5 rounded-xl bg-[#F5F5F7] text-xs text-[#0B0B0B]"
                    />
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <input
                      type="text"
                      value={giftDeskSide}
                      onChange={(e) => setGiftDeskSide(e.target.value)}
                      placeholder="Side / Honoring (optional)"
                      className="h-10 px-3.5 rounded-xl bg-[#F5F5F7] text-xs text-[#0B0B0B]"
                    />
                    <input
                      type="text"
                      value={giftDeskMessage}
                      onChange={(e) => setGiftDeskMessage(e.target.value)}
                      placeholder="Well-wishes note (optional)"
                      className="h-10 px-3.5 rounded-xl bg-[#F5F5F7] text-xs text-[#0B0B0B]"
                    />
                  </div>

                  <div className="flex justify-end">
                    <button
                      type="submit"
                      disabled={savingGiftDesk}
                      className="px-5 py-2 rounded-full bg-[#0B0B0B] text-white text-xs font-semibold hover:bg-neutral-800 disabled:opacity-60"
                    >
                      {savingGiftDesk ? 'Recording...' : 'Record Desk Gift'}
                    </button>
                  </div>
                </form>
              )}

              <div className="space-y-2">
                {giftLedger.length === 0 ? (
                  <div className="p-8 rounded-2xl bg-white text-center text-xs text-[#71717A]">
                    No gift table entries yet. Share <span className="font-mono text-[#0B0B0B]">/e/{event.slug}/gifts</span> or record venue desk gifts above.
                  </div>
                ) : (
                  giftLedger.map((entry) => (
                    <div
                      key={entry.id}
                      className="p-4 rounded-2xl bg-white flex flex-col sm:flex-row sm:items-center justify-between gap-2"
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
                  ))
                )}
              </div>
            </section>
          )}

          {/* Live Corporate Polls Manager */}
          {activeTab === 'polls' && (
            <EventPollsManager
              event={event}
              totalRegistered={totalRegistered}
              canManage={isEventCreator}
              onTogglePollsEnabled={
                onUpdateEvent
                  ? async (enabled) => {
                      await onUpdateEvent({
                        ...event,
                        extraDataConfig: {
                          ...(event.extraDataConfig ?? {
                            enableGiftTable: false,
                            customFields: [],
                          }),
                          enablePolls: enabled,
                        },
                      });
                    }
                  : undefined
              }
              onCreatePoll={onCreatePoll}
              onUpdatePoll={onUpdatePoll}
              onDeletePoll={onDeletePoll}
              onOpenPublicPolls={() => onPreviewPublicEvent('polls')}
              onToast={triggerToast}
            />
          )}

          {/* Share & QR expanded view */}
          {activeTab === 'share' && (
            <section className="bg-[#F5F5F7] rounded-[28px] p-6 sm:p-8 space-y-4">
              <h2 className="font-display text-[22px] font-bold text-[#0B0B0B] tracking-[-0.02em]">
                Invitation Link, OG Card &amp; Check-In Kiosk
              </h2>
              <div className="p-4 rounded-2xl bg-white flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="min-w-0">
                  <span className="text-xs font-semibold text-[#0B0B0B] block">
                    Live Attendee Invitation URL
                  </span>
                  <span className="text-xs font-mono text-[#71717A] break-all">
                    {invitationUrl}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={handleCopyLink}
                    className="px-4 py-2 rounded-full bg-[#F5F5F7] text-xs font-semibold text-[#0B0B0B]"
                  >
                    Copy URL
                  </button>
                  <button
                    type="button"
                    onClick={() => onPreviewPublicEvent('checkin')}
                    className="px-4 py-2 rounded-full bg-[#F5F5F7] text-xs font-semibold text-[#0B0B0B] inline-flex items-center gap-1"
                  >
                    <QrCode className="w-3.5 h-3.5" />
                    Check-In QR
                  </button>
                  <button
                    type="button"
                    onClick={() => onPreviewPublicEvent('polls')}
                    className="px-4 py-2 rounded-full bg-[#F5F5F7] text-xs font-semibold text-[#0B0B0B] inline-flex items-center gap-1"
                  >
                    <BarChart3 className="w-3.5 h-3.5" />
                    Live Polls
                  </button>
                  <button
                    type="button"
                    onClick={() => onPreviewPublicEvent('top')}
                    className="px-4 py-2 rounded-full bg-[#0B0B0B] text-white text-xs font-semibold"
                  >
                    Open Invite
                  </button>
                </div>
              </div>

              <div className="p-4 rounded-2xl bg-white flex flex-col sm:flex-row sm:items-center justify-between gap-4 border border-[#E5E5EA]">
                <div className="flex items-center gap-4 min-w-0">
                  <div className="p-2 rounded-xl bg-[#F5F5F7] border border-[#E5E5EA] shrink-0">
                    <DeterministicQrSvg
                      value={checkinKioskUrl}
                      size={72}
                      label={`Validate & check-in QR for ${event.title}`}
                    />
                  </div>
                  <div className="min-w-0">
                    <span className="text-xs font-semibold text-[#0B0B0B] block">
                      Validate &amp; Check-In Gate QR Code
                    </span>
                    <span className="text-[11px] text-[#71717A] block mt-1">
                      Guests scan this QR code to open the pass validation and check-in QR screen directly.
                    </span>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={handleDownloadQrSvg}
                    className="px-4 py-2 rounded-full bg-[#F5F5F7] text-xs font-semibold text-[#0B0B0B] inline-flex items-center gap-1"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Download QR SVG
                  </button>
                  <button
                    type="button"
                    onClick={() => onPreviewPublicEvent('checkin')}
                    className="px-4 py-2 rounded-full bg-[#0B0B0B] text-white text-xs font-semibold inline-flex items-center gap-1"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    Preview Validate Screen
                  </button>
                </div>
              </div>

              <div className="p-4 rounded-2xl bg-white border border-[#E5E5EA] space-y-2">
                <span className="text-xs font-semibold text-[#0B0B0B] block">
                  OpenGraph Social Share Image (/api/og/event/{event.slug})
                </span>
                <img
                  src={ogImageUrl}
                  alt={`${event.title} OG card`}
                  className="w-full rounded-xl aspect-[1200/630] object-cover border border-[#E5E5EA] bg-[#0B0B0B]"
                />
              </div>

              <div className="p-4 rounded-2xl bg-white flex flex-col sm:flex-row sm:items-center justify-between gap-3 border border-[#E5E5EA]">
                <div>
                  <span className="text-xs font-semibold text-[#0B0B0B] block">
                    Live Check-In QR Activation (Creator Only)
                  </span>
                  <span className="text-xs text-[#71717A]">
                    {!isEventCreator
                      ? 'Only the event creator can activate or export live check-in QR passes.'
                      : isQrPassPublished
                        ? 'Live Check-In QR is active for gate scanning and guest QR pass validation.'
                        : 'Inactive — activate live QR so guests can receive passes and scan into the venue.'}
                  </span>
                </div>
                {isEventCreator && onToggleQrPassPublished && (
                  <button
                    type="button"
                    disabled={event.status === 'draft'}
                    onClick={() => void onToggleQrPassPublished(event.id, !isQrPassPublished)}
                    className="px-4 py-2 rounded-full bg-[#0B0B0B] text-white text-xs font-semibold hover:bg-zinc-800 transition-colors disabled:opacity-40 whitespace-nowrap shrink-0"
                  >
                    {isQrPassPublished ? 'Pause Live Check-In QR' : 'Activate Live Check-In QR'}
                  </button>
                )}
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
                  {entitlements.maxAttendeesPerEvent !== null
                    ? `Your ${entitlements.plan} plan attendee cap is ${entitlements.maxAttendeesPerEvent.toLocaleString()} attendees per event. Once full, public RSVP pauses automatically.`
                    : `Capacity at ${capacityPct}% (${totalRegistered}/${event.capacity}) on ${entitlements.plan}.`}
                </p>
              </div>
            </div>
            <div className="mt-4 pt-3 flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-[#0B0B0B]">
                {entitlements.plan === 'Starter'
                  ? 'Upgrade to Pro ($19/mo)'
                  : entitlements.plan === 'Pro Organizer'
                    ? 'Pro Organizer Active'
                    : 'Enterprise Active'}
              </span>
              <button
                type="button"
                onClick={onOpenPlans}
                className="px-4 py-1.5 rounded-full bg-[#0B0B0B] text-white text-xs font-semibold hover:opacity-90 transition-all shrink-0"
              >
                {entitlements.plan === 'Starter' ? 'Upgrade' : 'Manage Plan'}
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
              {/* Flow 1: Confirmation & Check-In SMS */}
              <div className="p-3.5 bg-white rounded-2xl space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-[#0B0B0B]">
                    Check-In Welcome + Camera Link
                  </span>
                  <span className="inline-flex items-center gap-1 text-[11px] text-[#0B0B0B] font-semibold">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> {senderIdDraft}
                  </span>
                </div>
                <p className="text-[11px] text-[#71717A] tabular-nums">
                  Includes disposable camera link (5 shots + collage)
                </p>
                <div className="p-2.5 rounded-xl bg-[#F5F5F7] text-[11px] text-[#1A1C1D] italic line-clamp-3">
                  &ldquo;{checkInTemplate}&rdquo;
                </div>
                <div className="flex items-center justify-between pt-0.5">
                  <button
                    type="button"
                    onClick={() => setActiveTab('messages')}
                    className="text-[11px] text-[#0B0B0B] underline font-semibold"
                  >
                    Customize Messages
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (navigator.clipboard?.writeText) {
                        navigator.clipboard.writeText(cameraUrlForEvent).catch(() => {});
                      }
                      triggerToast('Disposable Camera URL copied');
                    }}
                    className="text-[11px] font-mono text-[#71717A] hover:text-[#0B0B0B] inline-flex items-center gap-1"
                  >
                    <Copy className="w-3 h-3" />
                    Camera URL
                  </button>
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
                {editingReminder && entitlements.allowCustomMessages ? (
                  <div className="mt-2 space-y-2">
                    <textarea
                      rows={2}
                      value={reminderTemplate}
                      onChange={(e) => setReminderTemplate(e.target.value)}
                      className="w-full p-2.5 rounded-xl bg-[#F5F5F7] text-[11px] text-[#0B0B0B] focus:outline-none"
                    />
                    <button
                      type="button"
                      disabled={savingMessages}
                      onClick={() => {
                        setEditingReminder(false);
                        void handleSaveMessageSettings('24h reminder template saved');
                      }}
                      className="px-3 py-1 rounded-full bg-[#0B0B0B] text-white text-[11px] font-semibold"
                    >
                      Save Reminder
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center justify-between text-[#71717A] text-[11px] mt-2">
                    <span>Auto-dispatch queued</span>
                    {entitlements.allowCustomMessages ? (
                      <button
                        type="button"
                        onClick={() => setEditingReminder(true)}
                        className="text-[#0B0B0B] underline font-semibold"
                      >
                        Edit Template
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={onOpenPlans}
                        className="text-[#0B0B0B] underline font-semibold inline-flex items-center gap-1"
                      >
                        <Lock className="w-3 h-3" />
                        Pro to Edit
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Flow 3: Post-Event Thank You */}
              {(() => {
                const effectiveChannel = entitlements.allowSmsBroadcast ? thankYouChannel : 'email';
                const phoneRecipients = eventAttendees.filter((a) => Boolean(a.phone?.trim()));
                const emailRecipients = eventAttendees.filter((a) => Boolean(a.email?.trim()));
                const thankYouSegments = calculateSmsCredits(appendPoweredByLine(thankYouTemplate));
                const thankYouCost =
                  effectiveChannel === 'email'
                    ? 0
                    : phoneRecipients.length * Math.max(1, thankYouSegments);
                const hasThankYouCredits =
                  effectiveChannel === 'email' || profile.smsCredits >= thankYouCost;
                const activeRecipientCount =
                  effectiveChannel === 'email' ? emailRecipients.length : phoneRecipients.length;
                return (
                  <div className="p-3.5 bg-white rounded-2xl space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-[#0B0B0B]">
                        Post-Event Thank You
                      </span>
                      <span className="px-2 py-0.5 rounded-full bg-[#F5F5F7] text-[#0B0B0B] text-[11px] font-medium tabular-nums">
                        {profile.smsCredits.toLocaleString()} credits left
                      </span>
                    </div>

                    <div className="flex flex-wrap gap-1.5">
                      {(
                        [
                          { id: 'email', label: 'Email Only', locked: false },
                          {
                            id: 'dual',
                            label: 'SMS + Email',
                            locked: !entitlements.allowSmsBroadcast,
                          },
                          {
                            id: 'sms',
                            label: 'SMS Only',
                            locked: !entitlements.allowSmsBroadcast,
                          },
                        ] as const
                      ).map((opt) => (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => {
                            if (opt.locked) {
                              onOpenPlans();
                              return;
                            }
                            setThankYouChannel(opt.id);
                          }}
                          className={`px-2.5 py-1 rounded-full text-[10px] font-semibold inline-flex items-center gap-1 transition-colors ${
                            effectiveChannel === opt.id
                              ? 'bg-[#0B0B0B] text-white'
                              : opt.locked
                                ? 'bg-[#F5F5F7] text-[#71717A] opacity-75'
                                : 'bg-[#F5F5F7] text-[#0B0B0B]'
                          }`}
                        >
                          {opt.locked ? (
                            <Lock className="w-2.5 h-2.5" />
                          ) : opt.id === 'email' ? (
                            <Mail className="w-2.5 h-2.5" />
                          ) : null}
                          {opt.label}
                        </button>
                      ))}
                    </div>

                    <p className="text-[11px] text-[#71717A] tabular-nums">
                      {effectiveChannel === 'email'
                        ? `Target: ${emailRecipients.length} email guests · 0 SMS credits (Resend)`
                        : `Target: ${phoneRecipients.length} phone recipients · Cost: ${thankYouCost.toLocaleString()} SMS credits`}
                    </p>
                    <div className="pt-0.5 flex items-center justify-between gap-2">
                      <span className="text-[11px] text-[#71717A]">
                        Status:{' '}
                        {thankYouSent
                          ? 'Dispatched'
                          : activeRecipientCount === 0
                            ? 'No recipients yet'
                            : hasThankYouCredits
                              ? 'Ready to send'
                              : 'Insufficient credits'}
                      </span>
                      {!hasThankYouCredits && thankYouCost > 0 ? (
                        <button
                          type="button"
                          onClick={onOpenPlans}
                          className="px-3 py-1.5 rounded-full bg-[#0B0B0B] text-white text-xs font-semibold hover:opacity-90"
                        >
                          Buy SMS Bundle
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled={savingMessages || thankYouSent || activeRecipientCount === 0}
                          onClick={async () => {
                            if (activeRecipientCount === 0) return;
                            try {
                              if (entitlements.allowCustomMessages) {
                                await handleSaveMessageSettings('Message templates saved');
                              }
                              if (onBroadcast) {
                                const res = await onBroadcast({
                                  eventId: event.id,
                                  attendeeIds: eventAttendees.map((a) => a.id),
                                  message: thankYouTemplate,
                                  channel: effectiveChannel,
                                });
                                setThankYouSent(true);
                                triggerToast(
                                  effectiveChannel === 'email'
                                    ? `Thank-you email sent to ${res.sentCount} guests (0 SMS credits spent)`
                                    : `Thank-you broadcast sent to ${res.sentCount} guests (${(res.creditsUsed ?? thankYouCost).toLocaleString()} SMS credits deducted)`
                                );
                              } else {
                                triggerToast('Thank-you template saved');
                              }
                            } catch (err) {
                              triggerToast(
                                err instanceof Error ? err.message : 'Unable to send thank-you broadcast'
                              );
                            }
                          }}
                          className="px-3 py-1.5 rounded-full bg-[#0B0B0B] text-white text-xs font-semibold hover:opacity-90 disabled:opacity-45 disabled:cursor-not-allowed"
                        >
                          {thankYouSent
                            ? 'Dispatched ✓'
                            : effectiveChannel === 'email'
                              ? 'Send Email'
                              : 'Send Broadcast'}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })()}
            </div>
          </section>

          {/* Gate Check-in QR Card */}
          <section className="bg-[#F5F5F7] rounded-[28px] p-6 flex flex-col items-center text-center gap-4 shadow-sm">
            <div className="w-full flex items-center justify-between">
              <h2 className="text-base font-semibold text-[#0B0B0B]">Gate Check-in QR</h2>
              <ShieldCheck className="w-4.5 h-4.5 text-[#71717A]" />
            </div>

            {isEventCreator && isQrPassPublished ? (
              <>
                <div className="p-3.5 sm:p-4 bg-white rounded-2xl shadow-sm flex items-center justify-center border border-[#E5E5EA] w-[min(50vw,184px)] sm:w-[184px] aspect-square">
                  <DeterministicQrSvg
                    value={checkinKioskUrl}
                    size={220}
                    className="w-full h-full block"
                    label={`Kiosk QR for ${event.title}`}
                  />
                </div>

                <div className="w-full flex flex-col gap-1">
                  <span className="text-[13px] font-semibold text-[#0B0B0B]">
                    Live Kiosk &amp; Entry QR Active
                  </span>
                  <p className="text-[11px] text-[#71717A]">
                    Guests scan this QR code to open guest validation &amp; check-in QR passes directly
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full pt-1">
                  <button
                    type="button"
                    onClick={handleDownloadQrSvg}
                    className="min-h-[40px] py-2 px-3 rounded-full bg-white text-[#0B0B0B] hover:bg-[#E8E8EA] transition-colors text-xs font-semibold shadow-sm inline-flex items-center justify-center gap-1.5"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Download QR SVG</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onPreviewPublicEvent('checkin')}
                    className="min-h-[40px] py-2 px-3 rounded-full bg-[#0B0B0B] text-white hover:opacity-90 transition-all text-xs font-semibold shadow-sm inline-flex items-center justify-center gap-1.5"
                  >
                    <QrCode className="w-3.5 h-3.5" />
                    <span>Open Validate Screen</span>
                  </button>
                </div>
              </>
            ) : isEventCreator ? (
              <div className="w-full p-5 rounded-2xl bg-white border border-[#E5E5EA] space-y-3">
                <p className="text-xs font-semibold text-[#0B0B0B]">
                  Live Check-In QR Inactive
                </p>
                <p className="text-[11px] text-[#71717A] leading-relaxed">
                  {event.status === 'draft'
                    ? 'Launch this draft event first, then activate Live Check-In QR so guests receive scannable tickets.'
                    : 'Activate Live Check-In QR to enable public QR passes, pass validation, and gate camera scanning.'}
                </p>
                {onToggleQrPassPublished && (
                  <button
                    type="button"
                    disabled={event.status === 'draft'}
                    onClick={() => void onToggleQrPassPublished(event.id, true)}
                    className="w-full py-2.5 px-4 rounded-full bg-[#0B0B0B] text-white hover:bg-zinc-800 transition-colors text-xs font-semibold disabled:opacity-40"
                  >
                    Activate Live Check-In QR
                  </button>
                )}
              </div>
            ) : (
              <div className="w-full p-5 rounded-2xl bg-white border border-[#E5E5EA] space-y-1.5">
                <p className="text-xs font-semibold text-[#0B0B0B]">
                  Creator-Only QR Pass Control
                </p>
                <p className="text-[11px] text-[#71717A] leading-relaxed">
                  Only the event creator can activate or export live check-in QR passes. Use the QR Gate Scanner to verify existing passes.
                </p>
              </div>
            )}
          </section>
        </div>
      </div>
      )}

      {/* Delete Attendee Confirmation Modal */}
      {confirmDeleteAttendee && (
        <div
          className="fixed inset-0 z-50 bg-black/50 backdrop-blur-[2px] flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="workspace-delete-attendee-title"
        >
          <div className="bg-white w-full max-w-sm rounded-3xl p-5 sm:p-6 border border-[#E5E5EA] soft-popover-shadow space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <h3
                  id="workspace-delete-attendee-title"
                  className="text-base font-bold text-[#0B0B0B]"
                >
                  Delete attendee?
                </h3>
                <p className="text-xs text-[#71717A] leading-relaxed">
                  Remove{' '}
                  <span className="font-semibold text-[#0B0B0B]">
                    {confirmDeleteAttendee.name}
                  </span>{' '}
                  ({confirmDeleteAttendee.ticketCode}) from{' '}
                  <span className="font-semibold text-[#0B0B0B]">{event.title}</span>
                  {confirmDeleteAttendee.checkedIn ? ', including their check-in record' : ''}? This
                  action cannot be undone.
                </p>
              </div>
              <button
                type="button"
                onClick={() => !deletingAttendee && setConfirmDeleteAttendee(null)}
                disabled={deletingAttendee}
                aria-label="Cancel delete attendee"
                className="w-8 h-8 rounded-full border border-[#E5E5EA] flex items-center justify-center text-[#0B0B0B] hover:bg-[#F5F5F7] shrink-0 disabled:opacity-40"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setConfirmDeleteAttendee(null)}
                disabled={deletingAttendee}
                className="px-4 h-10 rounded-full border border-[#E5E5EA] text-xs font-semibold text-[#0B0B0B] hover:bg-[#F5F5F7] disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deletingAttendee}
                onClick={async () => {
                  if (!onDeleteAttendee || deletingAttendee) return;
                  const target = confirmDeleteAttendee;
                  setDeletingAttendee(true);
                  try {
                    await onDeleteAttendee(target.id);
                    setConfirmDeleteAttendee(null);
                    triggerToast(`Removed ${target.name}`);
                  } catch (err) {
                    setConfirmDeleteAttendee(null);
                    triggerToast(
                      err instanceof Error ? err.message : `Unable to delete ${target.name}.`
                    );
                  } finally {
                    setDeletingAttendee(false);
                  }
                }}
                className="px-4 h-10 rounded-full bg-[#EF4444] text-white text-xs font-semibold hover:bg-red-600 transition-colors disabled:opacity-50"
              >
                {deletingAttendee ? 'Deleting...' : 'Delete Attendee'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
