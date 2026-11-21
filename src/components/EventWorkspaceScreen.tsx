import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Calendar,
  Camera,
  Check,
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
} from 'lucide-react';
import {
  Attendee,
  AttendeeTier,
  EventItem,
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
  buildCameraLinkForOrigin,
  calculateSmsCredits,
  getDefaultMessageConfig,
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
import { resolveEventBrandColor } from '../lib/themeColors';
import { GiftAttendantLinksCard } from './GiftAttendantLinksCard';
import { MonochromePoster, SplineChart } from './MonochromeArtwork';
import { ThemeColorPicker } from './ThemeColorPicker';
import { TopUtilityBar } from './TopUtilityBar';

type WorkspaceTab =
  | 'overview'
  | 'program'
  | 'messages'
  | 'attendees'
  | 'gifts'
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
  onOpenPlans: () => void;
  onPreviewPublicEvent: (focus?: 'top' | 'checkin' | 'gifts') => void;
  onToggleCheckIn: (attendeeId: string) => void;
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
  ) => Promise<{ gift: GiftTableEntry; event: EventItem }> | void;
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
  onToggleScheduleBlock: (blockId: string) => void;
  onAddScheduleBlock: (block: ScheduleBlock) => void;
  onDeleteScheduleBlock?: (blockId: string) => void;
  onToggleQrPassPublished?: (eventId: string, published: boolean) => Promise<void> | void;
  onNavigateSettings: () => void;
  onResolveAlert: (id: string) => void;
  onSelectAlertEvent: (event: EventItem) => void;
  onOpenCsvExport?: (eventId: string) => void;
  onOpenQrScanner?: (eventId: string) => void;
  onOpenDisposableCamera?: (eventId: string) => void;
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
  onOpenPlans,
  onPreviewPublicEvent,
  onToggleCheckIn,
  onRegisterAttendee,
  onBroadcast,
  onRecordGiftEntry,
  onCreateGiftAttendantLink,
  onToggleGiftAttendantLink,
  onDeleteGiftAttendantLink,
  onPreviewDeskLink,
  onToggleScheduleBlock,
  onAddScheduleBlock,
  onDeleteScheduleBlock,
  onToggleQrPassPublished,
  onNavigateSettings,
  onResolveAlert,
  onSelectAlertEvent,
  onOpenCsvExport,
  onOpenQrScanner,
  onOpenDisposableCamera,
}) => {
  const isEventCreator = profile.appRole !== 'gate_staff';
  const isQrPassPublished = event.qrPassPublished !== false;
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('program');
  const [copiedToast, setCopiedToast] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [attendeeFilter, setAttendeeFilter] = useState<'all' | 'checked' | 'pending'>('all');
  const [timeRange, setTimeRange] = useState<TimeRange>('7D');
  const [flyerFailed, setFlyerFailed] = useState(false);
  const [uploadingFlyer, setUploadingFlyer] = useState(false);
  const workspaceFlyerInputRef = useRef<HTMLInputElement | null>(null);

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
    const headers = ['Name', 'Email', 'Phone', 'ValidationCircle', 'Tier', 'TicketCode', 'CheckedIn'];
    const rows = eventAttendees.map((a) => [
      a.name,
      a.email,
      a.phone,
      a.validationGroup || '',
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
      await onRecordGiftEntry(event.id, {
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
      triggerToast('Gift table entry recorded cleanly');
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
          day: 'Sat',
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

  const handleWalkInSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!onRegisterAttendee || !walkInName.trim() || !walkInPhone.trim()) return;
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
          email:
            walkInEmail.trim() ||
            `${guestName.toLowerCase().replace(/\s+/g, '.')}@guest.africa`,
          phone: normalizedPhone,
          organization: 'Gate Walk-In',
          tier: walkInTier,
          ticketCode: code,
          checkedIn: true,
          checkedInAt: nowTime,
          paymentStatus: 'paid',
          smsStatus: 'Arkesel Sent',
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
            <span
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-semibold border ${
                isQrPassPublished
                  ? 'bg-white border-[#E5E5EA] text-[#0B0B0B]'
                  : 'bg-[#0B0B0B]/5 border-[#0B0B0B]/20 text-[#0B0B0B]'
              }`}
            >
              <QrCode className="w-3 h-3" />
              {isQrPassPublished ? 'QR Pass Published' : 'QR Pass Unpublished'}
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
                {isQrPassPublished ? 'Unpublish QR Pass' : 'Publish QR Pass'}
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
            { id: 'program', label: 'Program Builder', icon: LayoutGrid },
            { id: 'messages', label: 'Message Templates' },
            { id: 'attendees', label: 'Attendees', count: totalRegistered },
            { id: 'gifts', label: 'Gift Table', icon: Gift, count: giftEntriesCount },
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
                <form
                  onSubmit={handleWalkInSubmit}
                  className="p-4 rounded-2xl bg-white grid grid-cols-1 sm:grid-cols-2 gap-3"
                >
                  {!isQrPassPublished && (
                    <div className="sm:col-span-2 p-3 rounded-2xl bg-[#F5F5F7] border border-[#E5E5EA] flex flex-wrap items-center justify-between gap-2 text-xs text-[#0B0B0B]">
                      <span>
                        Check-In QR passes are currently unpublished. Publish them as the event creator before issuing guest passes.
                      </span>
                      {onToggleQrPassPublished && (
                        <button
                          type="button"
                          disabled={event.status === 'draft'}
                          onClick={() => void onToggleQrPassPublished(event.id, true)}
                          className="px-3 py-1 rounded-full bg-[#0B0B0B] text-white text-[11px] font-semibold disabled:opacity-40"
                        >
                          Publish QR Pass
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
                      disabled={!isQrPassPublished}
                      className="flex-1 h-10 px-4 rounded-full bg-[#0B0B0B] text-white text-xs font-semibold hover:bg-neutral-800 transition-colors whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed"
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
                              {att.validationGroup && (
                                <span className="px-2 py-0.5 rounded-full bg-[#F5F5F7] border border-[#E5E5EA] text-[#0B0B0B] text-[10px] font-semibold">
                                  {att.validationGroup}
                                </span>
                              )}
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
                  <p className="font-mono break-words">
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
                    onClick={() => onPreviewPublicEvent('top')}
                    className="px-4 py-2 rounded-full bg-[#0B0B0B] text-white text-xs font-semibold"
                  >
                    Open Invite
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
                    Check-In QR Pass Publication (Creator Only)
                  </span>
                  <span className="text-xs text-[#71717A]">
                    {!isEventCreator
                      ? 'Only the event creator can publish or export check-in QR passes.'
                      : isQrPassPublished
                        ? 'Check-in QR passes are published for public RSVP and kiosk badges.'
                        : 'Unpublished — guests cannot claim QR passes until published by the event creator.'}
                  </span>
                </div>
                {isEventCreator && onToggleQrPassPublished && (
                  <button
                    type="button"
                    disabled={event.status === 'draft'}
                    onClick={() => void onToggleQrPassPublished(event.id, !isQrPassPublished)}
                    className="px-4 py-2 rounded-full bg-[#0B0B0B] text-white text-xs font-semibold hover:bg-zinc-800 transition-colors disabled:opacity-40 whitespace-nowrap shrink-0"
                  >
                    {isQrPassPublished ? 'Unpublish Check-In QR' : 'Publish Check-In QR Pass'}
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
                  {entitlements.plan === 'Starter'
                    ? `Your Starter tier limit is capped at ${STARTER_MAX_ATTENDEES_PER_EVENT} attendees per event. Once full, public RSVP pauses automatically.`
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
                const thankYouSegments = calculateSmsCredits(thankYouTemplate);
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
                <div className="p-4 bg-white rounded-2xl shadow-sm flex items-center justify-center border border-[#E5E5EA]">
                  <DeterministicQrSvg
                    value={checkinKioskUrl}
                    size={160}
                    label={`Kiosk QR for ${event.title}`}
                  />
                </div>

                <div className="w-full flex flex-col gap-1">
                  <span className="text-[13px] font-semibold text-[#0B0B0B]">
                    Kiosk &amp; Attendee Entry Pass
                  </span>
                  <p className="text-[11px] text-[#71717A]">
                    Published by event creator for live check-ins and kiosk display
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
              </>
            ) : isEventCreator ? (
              <div className="w-full p-5 rounded-2xl bg-white border border-[#E5E5EA] space-y-3">
                <p className="text-xs font-semibold text-[#0B0B0B]">
                  Check-In QR Pass Unpublished
                </p>
                <p className="text-[11px] text-[#71717A] leading-relaxed">
                  {event.status === 'draft'
                    ? 'Launch this draft event first, then publish the Check-In QR Pass so guests can receive tickets.'
                    : 'Only the event creator can publish check-in QR passes. Publish to enable public RSVPs and kiosk badge exports.'}
                </p>
                {onToggleQrPassPublished && (
                  <button
                    type="button"
                    disabled={event.status === 'draft'}
                    onClick={() => void onToggleQrPassPublished(event.id, true)}
                    className="w-full py-2.5 px-4 rounded-full bg-[#0B0B0B] text-white hover:bg-zinc-800 transition-colors text-xs font-semibold disabled:opacity-40"
                  >
                    Publish Check-In QR Pass
                  </button>
                )}
              </div>
            ) : (
              <div className="w-full p-5 rounded-2xl bg-white border border-[#E5E5EA] space-y-1.5">
                <p className="text-xs font-semibold text-[#0B0B0B]">
                  Creator-Only QR Pass Control
                </p>
                <p className="text-[11px] text-[#71717A] leading-relaxed">
                  Only the event creator can publish or export check-in QR passes. Use the QR Gate Scanner to verify existing passes.
                </p>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
};
