import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Bolt,
  Calendar,
  CalendarDays,
  Camera,
  Check,
  ChevronDown,
  Copy,
  Download,
  ExternalLink,
  Gift,
  Info,
  Link2,
  Loader2,
  Lock,
  Mail,
  MapPin,
  MessageSquare,
  Navigation,
  QrCode,
  Share2,
  ShieldCheck,
  Sparkles,
  User,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import {
  Attendee,
  DesignTheme,
  EventItem,
  GiftTableEntry,
  ScheduleBlock,
} from '../types/events';
import { getCategoryPreset, normalizePhoneE164 } from '../data/initialData';
import {
  buildEventInvitationUrl,
  buildEventOgImageUrl,
  DeterministicQrSvg,
  downloadQrSvg,
} from '../lib/qr';

interface PublicEventScreenProps {
  events: EventItem[];
  attendees: Attendee[];
  scheduleBlocks?: ScheduleBlock[];
  initialEventId?: string;
  initialFocus?: 'top' | 'register' | 'checkin' | 'gifts';
  isLoadingEvents?: boolean;
  isSignedIn?: boolean;
  hasSetEvent?: boolean;
  onBackHome: () => void;
  onSelectEvent?: (event: EventItem) => void;
  onOpenStudio: () => void;
  onNavigateSignUp?: () => void;
  onCreateEvent?: () => void;
  onFocusModeChange?: (mode: 'top' | 'checkin' | 'gifts', event: EventItem) => void;
  onRegisterAttendee: (eventId: string, attendee: Attendee) => Promise<Attendee | void> | void;
  onSubmitGiftTableEntry?: (
    eventId: string,
    gift: Omit<GiftTableEntry, 'id' | 'eventId' | 'createdAt' | 'recordedVia'>
  ) => Promise<{ gift: GiftTableEntry; event: EventItem }> | void;
  onOpenDisposableCamera?: (eventId: string, guestName?: string, passCode?: string) => void;
  onOpenLegal?: (doc: 'terms' | 'privacy') => void;
}

const COUNTRY_CODES = [
  { code: '+233', flag: '🇬🇭', label: 'GH' },
  { code: '+234', flag: '🇳🇬', label: 'NG' },
  { code: '+254', flag: '🇰🇪', label: 'KE' },
  { code: '+250', flag: '🇷🇼', label: 'RW' },
];

const HERO_THEME_FRAME: Record<
  DesignTheme,
  {
    scrim: string;
    badgeClass: string;
    borderClass: string;
    accentText: string;
  }
> = {
  'editorial-ivory': {
    scrim: 'bg-gradient-to-t from-[#12100E] via-[#12100E]/55 to-[#12100E]/20',
    badgeClass: 'bg-[#F5EFE6] text-[#141210]',
    borderClass: 'border-[#E6DDD0]/30',
    accentText: 'text-[#F5EFE6]',
  },
  'obsidian-gold': {
    scrim: 'bg-gradient-to-t from-[#09090B] via-[#09090B]/55 to-[#09090B]/20',
    badgeClass: 'bg-[#D4AF37] text-[#09090B]',
    borderClass: 'border-[#D4AF37]/40',
    accentText: 'text-[#F3DF98]',
  },
  'swiss-grid': {
    scrim: 'bg-gradient-to-t from-[#0B0B0B] via-[#0B0B0B]/55 to-[#0B0B0B]/15',
    badgeClass: 'bg-white text-[#0B0B0B]',
    borderClass: 'border-white/25',
    accentText: 'text-zinc-200',
  },
  'warm-monochrome': {
    scrim: 'bg-gradient-to-t from-[#0B0B0B] via-[#0B0B0B]/60 to-[#0B0B0B]/20',
    badgeClass: 'bg-zinc-100 text-[#0B0B0B]',
    borderClass: 'border-white/20',
    accentText: 'text-zinc-300',
  },
};

export const PublicEventScreen: React.FC<PublicEventScreenProps> = ({
  events,
  attendees,
  scheduleBlocks = [],
  initialEventId,
  initialFocus = 'top',
  isLoadingEvents = false,
  isSignedIn = false,
  onBackHome,
  onSelectEvent,
  onOpenStudio,
  onFocusModeChange,
  onRegisterAttendee,
  onSubmitGiftTableEntry,
  onOpenDisposableCamera,
  onOpenLegal,
}) => {
  const activeEvents = useMemo(
    () => events.filter((e) => e.status === 'live' || e.status === 'upcoming' || e.id === initialEventId),
    [events, initialEventId]
  );

  const [selectedEventId, setSelectedEventId] = useState(
    initialEventId || activeEvents[0]?.id || events[0]?.id || ''
  );

  useEffect(() => {
    if (initialEventId && events.some((e) => e.id === initialEventId || e.slug === initialEventId)) {
      const found = events.find((e) => e.id === initialEventId || e.slug === initialEventId);
      if (found) setSelectedEventId(found.id);
    } else if (!events.some((e) => e.id === selectedEventId)) {
      setSelectedEventId(activeEvents[0]?.id || events[0]?.id || '');
    }
  }, [initialEventId, events, activeEvents, selectedEventId]);

  const selectedEvent =
    events.find((e) => e.id === selectedEventId) ?? activeEvents[0] ?? events[0];

  const [screenMode, setScreenMode] = useState<'top' | 'checkin' | 'gifts'>(
    initialFocus === 'checkin' ? 'checkin' : initialFocus === 'gifts' ? 'gifts' : 'top'
  );
  const standaloneCheckin = screenMode === 'checkin';
  const standaloneGifts = screenMode === 'gifts';
  const [showCheckinModal, setShowCheckinModal] = useState(false);

  useEffect(() => {
    if (initialFocus === 'checkin') {
      setScreenMode('checkin');
      setShowCheckinModal(false);
    } else if (initialFocus === 'gifts') {
      setScreenMode('gifts');
      setShowCheckinModal(false);
    } else if (initialFocus === 'register' && selectedEvent) {
      setScreenMode('top');
      const timer = window.setTimeout(() => {
        const el = document.getElementById('register-section');
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }, 60);
      return () => window.clearTimeout(timer);
    } else if (initialFocus === 'top') {
      setScreenMode('top');
    }
  }, [initialFocus, selectedEvent]);

  const categoryPreset = useMemo(
    () => getCategoryPreset(selectedEvent?.category || 'Events'),
    [selectedEvent?.category]
  );
  const validationConfig = selectedEvent?.validationConfig ?? categoryPreset.validationConfig;
  const extraDataConfig = selectedEvent?.extraDataConfig ?? categoryPreset.extraDataConfig;
  const giftTableAvailable = Boolean(
    extraDataConfig.enableGiftTable ||
      selectedEvent?.category === 'Wedding' ||
      (extraDataConfig.giftLedger && extraDataConfig.giftLedger.length > 0)
  );
  const eventScheduleBlocks = useMemo(
    () =>
      selectedEvent
        ? scheduleBlocks.filter((b) => b.eventId === selectedEvent.id)
        : [],
    [scheduleBlocks, selectedEvent]
  );

  const [name, setName] = useState('');
  const [countryPrefix, setCountryPrefix] = useState('+233');
  const [phoneInput, setPhoneInput] = useState('');
  const [email, setEmail] = useState('');
  const [validationGroup, setValidationGroup] = useState('');
  const [inviteCodeInput, setInviteCodeInput] = useState('');
  const [customResponses, setCustomResponses] = useState<Record<string, string>>({});

  // Standalone Gift Table state (completely decoupled from RSVP / walk-in / check-in)
  const [giftGiverName, setGiftGiverName] = useState('');
  const [giftGiverPhone, setGiftGiverPhone] = useState('');
  const [giftMode, setGiftMode] = useState<'cash-momo' | 'registry-item' | 'blessing-only'>(
    'cash-momo'
  );
  const [giftCurrency, setGiftCurrency] = useState<'GHS' | 'USD'>('GHS');
  const [giftAmount, setGiftAmount] = useState<string>('250');
  const [giftItem, setGiftItem] = useState<string>('');
  const [giftSide, setGiftSide] = useState<string>('');
  const [giftMessage, setGiftMessage] = useState<string>('');
  const [giftSubmitting, setGiftSubmitting] = useState(false);
  const [giftError, setGiftError] = useState<string | null>(null);
  const [giftReceipt, setGiftReceipt] = useState<GiftTableEntry | null>(null);

  const [issuedPass, setIssuedPass] = useState<Attendee | null>(null);
  const [duplicateError, setDuplicateError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [shareToast, setShareToast] = useState<string | null>(null);
  const [walletSaved, setWalletSaved] = useState(false);
  const [showOgPreview, setShowOgPreview] = useState(false);
  const [heroFailed, setHeroFailed] = useState(false);
  const [checkinSubMode, setCheckinSubMode] = useState<'register' | 'lookup'>('register');
  const [lookupQuery, setLookupQuery] = useState('');
  const [lookupError, setLookupError] = useState<string | null>(null);

  useEffect(() => {
    setHeroFailed(false);
    setValidationGroup('');
    setInviteCodeInput('');
    setGiftGiverName('');
    setGiftGiverPhone('');
    setGiftMode('cash-momo');
    setGiftItem(extraDataConfig.giftRegistryItems?.[0] ?? '');
    setGiftSide('');
    setGiftMessage('');
    setGiftError(null);
    setGiftReceipt(null);
    setCustomResponses({});
    setDuplicateError(null);
    setLookupError(null);
  }, [selectedEvent?.id, selectedEvent?.flyerUrl]);

  const normalizedPhone = useMemo(() => {
    const trimmed = phoneInput.trim();
    if (!trimmed) return '';
    if (trimmed.startsWith('+')) return normalizePhoneE164(trimmed);
    const digits = trimmed.replace(/\D/g, '');
    if (!digits) return '';
    if (digits.startsWith('0') && digits.length >= 9) {
      return `${countryPrefix}${digits.slice(1)}`;
    }
    return `${countryPrefix}${digits}`;
  }, [phoneInput, countryPrefix]);

  const invitationUrl = useMemo(
    () => buildEventInvitationUrl(selectedEvent?.slug ?? selectedEvent?.id ?? 'event'),
    [selectedEvent?.slug, selectedEvent?.id]
  );

  const checkinKioskUrl = useMemo(
    () => buildEventInvitationUrl(selectedEvent?.slug ?? selectedEvent?.id ?? 'event', 'checkin'),
    [selectedEvent?.slug, selectedEvent?.id]
  );

  const giftsStandaloneUrl = useMemo(
    () => buildEventInvitationUrl(selectedEvent?.slug ?? selectedEvent?.id ?? 'event', 'gifts'),
    [selectedEvent?.slug, selectedEvent?.id]
  );

  const ogImageUrl = useMemo(
    () => buildEventOgImageUrl(selectedEvent?.slug ?? selectedEvent?.id ?? 'event'),
    [selectedEvent?.slug, selectedEvent?.id]
  );

  const switchScreenMode = (mode: 'top' | 'checkin' | 'gifts') => {
    setScreenMode(mode);
    setGiftReceipt(null);
    setGiftError(null);
    if (selectedEvent) {
      onFocusModeChange?.(mode, selectedEvent);
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleShare = () => {
    const targetUrl = standaloneCheckin
      ? checkinKioskUrl
      : standaloneGifts
        ? giftsStandaloneUrl
        : invitationUrl;
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(targetUrl).catch(() => {});
    }
    setShareToast(
      standaloneCheckin
        ? `Check-in link copied: /e/${selectedEvent?.slug}/checkin`
        : standaloneGifts
          ? `Gift Table link copied: /e/${selectedEvent?.slug}/gifts`
          : `Invitation link copied: /e/${selectedEvent?.slug}`
    );
    setTimeout(() => setShareToast(null), 2600);
  };

  const handleShareCheckinUrl = async () => {
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(checkinKioskUrl).catch(() => {});
    }
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function' && selectedEvent) {
      try {
        await navigator.share({
          title: `${selectedEvent.title} — Event Check-In`,
          text: `Check in for ${selectedEvent.title} (${selectedEvent.date} · ${selectedEvent.venue})`,
          url: checkinKioskUrl,
        });
      } catch {
        // Ignore user-cancelled share dialog
      }
    }
    setShareToast(`Standalone Check-In URL copied: /e/${selectedEvent?.slug}/checkin`);
    setTimeout(() => setShareToast(null), 2600);
  };

  const handleGiftTableSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedEvent || giftSubmitting) return;
    if (!giftGiverName.trim()) {
      setGiftError('Please enter your name or family name.');
      return;
    }
    if (giftMode === 'cash-momo' && (!giftAmount || Number(giftAmount) <= 0)) {
      setGiftError('Please enter a valid cash or MoMo gift amount.');
      return;
    }
    if (!onSubmitGiftTableEntry) {
      setGiftError('Gift Table submissions are currently unavailable.');
      return;
    }
    setGiftError(null);
    setGiftSubmitting(true);
    try {
      const result = await onSubmitGiftTableEntry(selectedEvent.id, {
        giverName: giftGiverName.trim(),
        giverPhone: giftGiverPhone.trim() ? normalizePhoneE164(giftGiverPhone.trim()) : undefined,
        giftType: giftMode,
        currency: giftCurrency,
        amount: giftMode === 'cash-momo' ? Math.max(1, Number(giftAmount) || 0) : undefined,
        registryItem:
          giftMode === 'registry-item'
            ? giftItem || extraDataConfig.giftRegistryItems?.[0] || 'Registry Gift'
            : undefined,
        side: giftSide.trim() || undefined,
        message: giftMessage.trim() || undefined,
      });
      if (result?.gift) {
        setGiftReceipt(result.gift);
      } else {
        setGiftReceipt({
          id: `gift-${Date.now()}`,
          eventId: selectedEvent.id,
          giverName: giftGiverName.trim(),
          giverPhone: giftGiverPhone.trim() || undefined,
          giftType: giftMode,
          currency: giftCurrency,
          amount: giftMode === 'cash-momo' ? Math.max(1, Number(giftAmount) || 0) : undefined,
          registryItem:
            giftMode === 'registry-item'
              ? giftItem || extraDataConfig.giftRegistryItems?.[0] || 'Registry Gift'
              : undefined,
          side: giftSide.trim() || undefined,
          message: giftMessage.trim() || undefined,
          recordedVia: 'public-table',
          createdAt: new Date().toISOString(),
        });
      }
      setGiftMessage('');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      setGiftError(err instanceof Error ? err.message : 'Unable to record gift entry.');
    } finally {
      setGiftSubmitting(false);
    }
  };

  const handleLookupExistingPass = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedEvent) return;
    const raw = lookupQuery.trim();
    if (!raw) {
      setLookupError('Enter your pass code (e.g. #TSL-2026-8801), phone number, or email.');
      return;
    }
    const cleanLower = raw.toLowerCase();
    const cleanCode = cleanLower.replace(/^#/, '');
    const digitsOnly = raw.replace(/\D/g, '');
    const normalizedLookupPhone = digitsOnly.length >= 9 ? normalizePhoneE164(raw) : '';

    const match = attendees.find((att) => {
      if (att.eventId !== selectedEvent.id) return false;
      const attCode = att.ticketCode.toLowerCase().replace(/^#/, '');
      const attPhone = att.phone.replace(/\s+/g, '');
      const attDigits = att.phone.replace(/\D/g, '');
      return (
        attCode === cleanCode ||
        att.email.toLowerCase() === cleanLower ||
        (normalizedLookupPhone && attPhone === normalizedLookupPhone) ||
        (digitsOnly.length >= 9 && attDigits.endsWith(digitsOnly.slice(-9)))
      );
    });

    if (!match) {
      setLookupError(
        `No registered pass found for "${raw}". Use New Guest Check-In to validate your circle and generate a QR pass.`
      );
      return;
    }

    setLookupError(null);
    setIssuedPass(match);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDownloadIcs = () => {
    if (!selectedEvent) return;
    const ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Events App//Event Registration & SMS Ticketing//EN',
      'BEGIN:VEVENT',
      `UID:${issuedPass?.ticketCode ?? selectedEvent.slug}@eventsbyyou.xyz`,
      `SUMMARY:${selectedEvent.title}`,
      `LOCATION:${selectedEvent.venue}, ${selectedEvent.city}`,
      `DESCRIPTION:Digital Gate Pass ${issuedPass?.ticketCode ?? ''} (${issuedPass?.validationGroup ?? 'Guest'}) · ${invitationUrl}`,
      'DTSTART:20261128T090000Z',
      'DTEND:20261128T170000Z',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${selectedEvent.slug}.ics`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleSaveWallet = () => {
    setWalletSaved(true);
    setTimeout(() => setWalletSaved(false), 3000);
  };

  const switchEvent = (eventId: string) => {
    setSelectedEventId(eventId);
    setIssuedPass(null);
    setDuplicateError(null);
    const matched = events.find((e) => e.id === eventId);
    if (matched) onSelectEvent?.(matched);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedEvent || submitting) return;
    if (selectedEvent.status === 'draft') {
      setDuplicateError('This event is still a draft. Publish it in Creator Studio to open check-in.');
      return;
    }
    if (selectedEvent.qrPassPublished === false) {
      setDuplicateError('Check-in QR passes have not been published by the event creator yet.');
      return;
    }
    if (
      validationConfig.enabled &&
      validationConfig.options.length > 0 &&
      !validationGroup.trim()
    ) {
      setDuplicateError(`Please complete the Validation Form: choose your ${validationConfig.label}.`);
      return;
    }
    if (
      validationConfig.enabled &&
      validationConfig.requireInviteCode &&
      validationConfig.inviteCode &&
      inviteCodeInput.trim().toUpperCase() !== validationConfig.inviteCode.trim().toUpperCase()
    ) {
      setDuplicateError('Invalid invitation passcode. Please confirm the code from your host.');
      return;
    }
    if (!name.trim()) {
      setDuplicateError('Please enter your full name to register.');
      return;
    }
    if (!normalizedPhone || normalizedPhone.replace(/\D/g, '').length < 9) {
      setDuplicateError('Please enter a valid mobile number for your SMS QR pass.');
      return;
    }
    if (!email.trim()) {
      setDuplicateError('Please enter your email address for pass confirmation.');
      return;
    }

    for (const field of extraDataConfig.customFields || []) {
      if (field.required && !(customResponses[field.id] || '').trim()) {
        setDuplicateError(`Please complete required event field: ${field.label}`);
        return;
      }
    }

    const cleanTarget = normalizedPhone.replace(/\s+/g, '');
    const alreadyExists = attendees.some(
      (a) =>
        a.eventId === selectedEvent.id &&
        a.phone.replace(/\s+/g, '') === cleanTarget
    );
    if (alreadyExists) {
      setDuplicateError(
        `Duplicate shield: ${normalizedPhone} already holds a pass for ${selectedEvent.title}.`
      );
      return;
    }

    const filteredCustom: Record<string, string> = {};
    for (const [k, v] of Object.entries(customResponses)) {
      if (v.trim()) filteredCustom[k] = v.trim();
    }

    setDuplicateError(null);
    setSubmitting(true);
    const codePrefix =
      selectedEvent.title
        .split(/\s+/)
        .map((w) => w.replace(/[^A-Za-z0-9]/g, '')[0] ?? '')
        .join('')
        .slice(0, 3)
        .toUpperCase() || 'EVT';
    const randomNum = Math.floor(1000 + Math.random() * 8999);

    const newAttendee: Attendee = {
      id: `att-${Date.now()}`,
      name: name.trim(),
      email: email.trim(),
      phone: normalizedPhone,
      organization: validationGroup || 'Fast Pass Attendee',
      eventId: selectedEvent.id,
      tier: 'General',
      checkedIn: false,
      ticketCode: `#${codePrefix}-2026-${randomNum}`,
      smsStatus: 'Arkesel Sent',
      paymentStatus: 'paid',
      validationGroup: validationGroup || undefined,
      inviteCodeUsed: inviteCodeInput.trim() || undefined,
      customResponses: Object.keys(filteredCustom).length > 0 ? filteredCustom : undefined,
    };

    try {
      const persisted = await onRegisterAttendee(selectedEvent.id, newAttendee);
      setIssuedPass(persisted ?? newAttendee);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      setDuplicateError(
        err instanceof Error ? err.message : 'Unable to complete registration. Please try again.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (!selectedEvent) {
    if (isLoadingEvents) {
      return (
        <div className="min-h-screen bg-[#F5F5F7] text-[#1A1C1D] flex flex-col items-center justify-center gap-3 px-4">
          <Loader2 className="w-6 h-6 animate-spin text-[#0B0B0B]" />
          <p className="text-xs font-medium text-[#71717A]">Loading live check-in registration...</p>
        </div>
      );
    }
    return (
      <div className="min-h-screen bg-[#F5F5F7] text-[#1A1C1D] flex flex-col items-center justify-center px-4 text-center">
        <div className="max-w-md w-full bg-white rounded-[28px] p-8 shadow-sm space-y-4">
          <div className="w-12 h-12 rounded-2xl bg-[#F5F5F7] flex items-center justify-center mx-auto">
            <CalendarDays className="w-6 h-6 text-[#0B0B0B]" />
          </div>
          <h1 className="font-display text-xl font-bold text-[#0B0B0B]">
            No published events yet
          </h1>
          <p className="text-sm text-[#71717A] leading-relaxed">
            Sign in to Creator Studio to create and publish your event page, check-in passes, and optional standalone gift table.
          </p>
          <div className="flex flex-col sm:flex-row gap-2 pt-2 justify-center">
            <button
              type="button"
              onClick={onBackHome}
              className="px-5 py-2.5 rounded-full bg-[#F5F5F7] hover:bg-[#E8E8EA] text-xs font-semibold text-[#0B0B0B] transition-colors"
            >
              Back to Home
            </button>
            <button
              type="button"
              onClick={onOpenStudio}
              className="px-5 py-2.5 rounded-full bg-[#0B0B0B] hover:bg-neutral-800 text-xs font-semibold text-white transition-colors"
            >
              {isSignedIn ? 'Open Creator Studio' : 'Sign In to Publish'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  const spotsRemaining = Math.max(0, selectedEvent.capacity - selectedEvent.registered);
  const canCheckInRegister = selectedEvent.status !== 'draft';
  const isQrPassPublished = selectedEvent.qrPassPublished !== false;
  const activeDesignTheme: DesignTheme =
    selectedEvent.designTheme || categoryPreset.designTheme || 'obsidian-gold';
  const themeFrame = HERO_THEME_FRAME[activeDesignTheme];
  const heroFlyerSrc = selectedEvent.flyerUrl || categoryPreset.flyerUrl;

  const occupancyPct = Math.min(
    100,
    Math.round((selectedEvent.registered / Math.max(1, selectedEvent.capacity)) * 100)
  );
  const firstName = issuedPass?.name.split(' ')[0] ?? 'Guest';
  const passInitials = (issuedPass?.name ?? 'Guest')
    .split(' ')
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase() || 'GS';

  const registerSectionCard = (
    <section
      id="register-section"
      className="scroll-mt-24 bg-white rounded-[32px] p-6 sm:p-7 shadow-md border border-[#E5E5EA]/70 space-y-5"
    >
      {!canCheckInRegister ? (
        <div className="p-5 rounded-2xl bg-[#F5F5F7] border border-[#E5E5EA] space-y-2.5 text-center">
          <div className="w-11 h-11 rounded-2xl bg-[#0B0B0B] text-white flex items-center justify-center mx-auto">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <h3 className="font-display text-lg font-bold text-[#0B0B0B] tracking-tight">
            Event Is In Draft Mode
          </h3>
          <p className="text-xs text-[#71717A] leading-relaxed max-w-md mx-auto">
            Publish this event from Creator Studio to open guest validation and QR pass registration.
          </p>
        </div>
      ) : !isQrPassPublished ? (
        <div className="p-5 rounded-2xl bg-[#F5F5F7] border border-[#E5E5EA] space-y-2.5 text-center">
          <div className="w-11 h-11 rounded-2xl bg-[#0B0B0B] text-white flex items-center justify-center mx-auto">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <h3 className="font-display text-lg font-bold text-[#0B0B0B] tracking-tight">
            Check-In QR Passes Pending Publication
          </h3>
          <p className="text-xs text-[#71717A] leading-relaxed max-w-md mx-auto">
            Guest registration and QR pass delivery will open once the creator publishes check-in passes for this event.
          </p>
        </div>
      ) : (
        <>
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="inline-flex items-center gap-1.5 bg-[#0B0B0B] text-white text-[11px] font-semibold px-3 py-1 rounded-full">
                <Bolt className="w-3.5 h-3.5" />
                <span>
                  {standaloneCheckin
                    ? 'Standalone Event Check-In Process'
                    : 'Guest Validation & Check-In Registration'}
                </span>
              </div>

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => switchScreenMode(standaloneCheckin ? 'top' : 'checkin')}
                  className="text-[11px] font-semibold text-[#0B0B0B] bg-[#F5F5F7] hover:bg-[#E8E8EA] px-3 py-1 rounded-full inline-flex items-center gap-1 transition-colors"
                >
                  {standaloneCheckin ? (
                    <>
                      <ArrowLeft className="w-3 h-3" />
                      <span>Full Event Page</span>
                    </>
                  ) : (
                    <>
                      <span>Open Standalone Check-In Screen</span>
                      <ExternalLink className="w-3 h-3" />
                    </>
                  )}
                </button>
              </div>
            </div>

            <div className="pt-1">
              <h3 className="font-display text-[22px] leading-7 font-bold text-[#0B0B0B] tracking-[-0.02em]">
                {checkinSubMode === 'lookup'
                  ? 'Retrieve Your Existing Check-In QR Pass'
                  : spotsRemaining > 0
                    ? 'Validate & Get QR Check-In Pass'
                    : 'Join Priority Waitlist'}
              </h3>
              <p className="text-[13px] text-[#71717A] mt-0.5">
                {checkinSubMode === 'lookup'
                  ? 'Already registered? Enter your ticket code, mobile number, or email to pull up your QR pass immediately.'
                  : 'Select your guest circle, submit event details, and receive your scannable QR gate pass immediately.'}
              </p>
            </div>

            {/* Standalone Process Tabs: New Guest Check-In vs Retrieve Existing Pass */}
            <div className="grid grid-cols-2 gap-1.5 p-1 bg-[#F5F5F7] rounded-2xl border border-[#E5E5EA]">
              <button
                type="button"
                onClick={() => {
                  setCheckinSubMode('register');
                  setLookupError(null);
                }}
                className={`py-2 px-3 rounded-xl text-xs font-semibold transition-all ${
                  checkinSubMode === 'register'
                    ? 'bg-[#0B0B0B] text-white shadow-sm'
                    : 'text-[#71717A] hover:text-[#0B0B0B]'
                }`}
              >
                New Guest Check-In
              </button>
              <button
                type="button"
                onClick={() => {
                  setCheckinSubMode('lookup');
                  setDuplicateError(null);
                }}
                className={`py-2 px-3 rounded-xl text-xs font-semibold transition-all ${
                  checkinSubMode === 'lookup'
                    ? 'bg-[#0B0B0B] text-white shadow-sm'
                    : 'text-[#71717A] hover:text-[#0B0B0B]'
                }`}
              >
                Find My Existing QR Pass
              </button>
            </div>
          </div>

          {checkinSubMode === 'lookup' ? (
            <form onSubmit={handleLookupExistingPass} className="space-y-4">
              {lookupError && (
                <div className="p-3.5 rounded-2xl bg-[#EF4444]/10 border border-[#EF4444]/30 flex items-center gap-2.5 text-xs font-medium text-[#0B0B0B]">
                  <AlertCircle className="w-4 h-4 text-[#EF4444] shrink-0" />
                  <span>{lookupError}</span>
                </div>
              )}
              <div className="space-y-1.5">
                <label
                  htmlFor="lookup-pass-input"
                  className="block text-xs font-semibold text-[#0B0B0B]"
                >
                  Pass Code, Mobile Number, or Email *
                </label>
                <div className="relative">
                  <input
                    id="lookup-pass-input"
                    type="text"
                    required
                    value={lookupQuery}
                    onChange={(e) => setLookupQuery(e.target.value)}
                    placeholder="e.g. #TSL-2026-8801 or +233 24 123 4567"
                    className="w-full h-12 px-4 pr-10 rounded-full bg-[#F5F5F7] text-[#0B0B0B] text-sm font-mono placeholder:text-[#71717A] focus:outline-none focus:bg-white focus:ring-1 focus:ring-[#0B0B0B] transition-colors"
                  />
                  <QrCode className="w-4 h-4 text-[#71717A] absolute right-4 top-4 pointer-events-none" />
                </div>
              </div>
              <button
                type="submit"
                className="w-full h-13 bg-[#0B0B0B] hover:opacity-90 text-white text-sm font-semibold rounded-full flex items-center justify-center gap-2 shadow-lg transition-all"
              >
                <QrCode className="w-4 h-4" />
                <span>Open My Check-In QR Pass</span>
              </button>
            </form>
          ) : (
            <>
              {duplicateError && (
                <div className="p-3.5 rounded-2xl bg-[#EF4444]/10 border border-[#EF4444]/30 flex items-center gap-2.5 text-xs font-medium text-[#0B0B0B]">
                  <AlertCircle className="w-4 h-4 text-[#EF4444] shrink-0" />
                  <span>{duplicateError}</span>
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-5">
                {/* STEP 1: EVENT VALIDATION FORM */}
                {validationConfig.enabled && validationConfig.options.length > 0 && (
                  <div className="p-4 rounded-2xl bg-[#F5F5F7] border border-[#E5E5EA] space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5">
                        <ShieldCheck className="w-4 h-4 text-[#0B0B0B]" />
                        <span className="text-xs font-bold text-[#0B0B0B]">
                          {validationConfig.label} *
                        </span>
                      </div>
                      <span className="text-[10px] font-mono uppercase tracking-wider text-[#71717A]">
                        {selectedEvent.category} Validation
                      </span>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {validationConfig.options.map((opt) => {
                        const active = validationGroup === opt;
                        return (
                          <button
                            key={opt}
                            type="button"
                            onClick={() => {
                              setValidationGroup(opt);
                              if (!giftSide) setGiftSide(opt);
                              setDuplicateError(null);
                            }}
                            className={`px-3 py-2 rounded-xl text-xs font-semibold text-left border transition-all flex items-center justify-between gap-1.5 ${
                              active
                                ? 'bg-[#0B0B0B] text-white border-[#0B0B0B] shadow-sm'
                                : 'bg-white text-[#0B0B0B] border-[#E5E5EA] hover:border-[#0B0B0B]'
                            }`}
                          >
                            <span className="truncate">{opt}</span>
                            {active && <Check className="w-3.5 h-3.5 shrink-0" />}
                          </button>
                        );
                      })}
                    </div>

                    {validationConfig.requireInviteCode && (
                      <div className="pt-1 space-y-1">
                        <label className="text-[11px] font-semibold text-[#0B0B0B] flex items-center gap-1">
                          <Lock className="w-3 h-3" />
                          Private Invitation Passcode Required
                        </label>
                        <input
                          type="text"
                          required
                          value={inviteCodeInput}
                          onChange={(e) => setInviteCodeInput(e.target.value)}
                          placeholder="Enter host invitation code (e.g. ROYAL2026)"
                          className="w-full h-10 px-4 rounded-full bg-white border border-[#E5E5EA] text-xs font-mono uppercase text-[#0B0B0B] focus:border-[#0B0B0B] focus:outline-none"
                        />
                      </div>
                    )}
                  </div>
                )}

                {/* Full Name */}
                <div className="space-y-1.5">
                  <label
                    className="block text-xs font-semibold text-[#0B0B0B]"
                    htmlFor="checkout-fullName"
                  >
                    Full Name *
                  </label>
                  <div className="relative">
                    <input
                      id="checkout-fullName"
                      type="text"
                      required
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="e.g. Ama Serwaa"
                      className="w-full h-12 px-4 pr-10 rounded-full bg-[#F5F5F7] text-[#0B0B0B] text-sm placeholder:text-[#71717A] focus:outline-none focus:bg-white focus:ring-1 focus:ring-[#0B0B0B] transition-colors"
                    />
                    <User className="w-4 h-4 text-[#71717A] absolute right-4 top-4 pointer-events-none" />
                  </div>
                </div>

                {/* Phone Number with Country Selector */}
                <div className="space-y-1.5">
                  <label
                    className="block text-xs font-semibold text-[#0B0B0B]"
                    htmlFor="checkout-phone"
                  >
                    Phone Number (For SMS Pass) *
                  </label>
                  <div className="flex gap-2">
                    <div className="relative shrink-0">
                      <select
                        aria-label="Country dial code"
                        value={countryPrefix}
                        onChange={(e) => {
                          setCountryPrefix(e.target.value);
                          setDuplicateError(null);
                        }}
                        className="h-12 pl-3.5 pr-8 rounded-full bg-[#F5F5F7] text-[#0B0B0B] text-xs font-semibold appearance-none focus:outline-none focus:ring-1 focus:ring-[#0B0B0B] cursor-pointer"
                      >
                        {COUNTRY_CODES.map((c) => (
                          <option key={c.code} value={c.code}>
                            {c.flag} {c.code}
                          </option>
                        ))}
                      </select>
                      <ChevronDown className="w-3.5 h-3.5 text-[#71717A] absolute right-2.5 top-4 pointer-events-none" />
                    </div>
                    <div className="relative flex-1">
                      <input
                        id="checkout-phone"
                        type="tel"
                        required
                        value={phoneInput}
                        onChange={(e) => {
                          setPhoneInput(e.target.value);
                          setDuplicateError(null);
                        }}
                        placeholder="024 123 4567"
                        className="w-full h-12 px-4 rounded-full bg-[#F5F5F7] text-[#0B0B0B] text-sm font-mono placeholder:text-[#71717A] focus:outline-none focus:bg-white focus:ring-1 focus:ring-[#0B0B0B] transition-colors"
                      />
                    </div>
                  </div>
                  <div className="flex items-center justify-between text-[11px] px-2">
                    <span className="text-[#71717A]">
                      Accepts local format (024XXXXXXX) or E.164
                    </span>
                    <span className="font-mono font-semibold text-emerald-700 tabular-nums">
                      {normalizedPhone || 'Waiting...'}
                    </span>
                  </div>
                </div>

                {/* Email Address */}
                <div className="space-y-1.5">
                  <label
                    className="block text-xs font-semibold text-[#0B0B0B]"
                    htmlFor="checkout-email"
                  >
                    Email Address *
                  </label>
                  <div className="relative">
                    <input
                      id="checkout-email"
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="e.g. ama@eventsbyyou.xyz"
                      className="w-full h-12 px-4 pr-10 rounded-full bg-[#F5F5F7] text-[#0B0B0B] text-sm placeholder:text-[#71717A] focus:outline-none focus:bg-white focus:ring-1 focus:ring-[#0B0B0B] transition-colors"
                    />
                    <Mail className="w-4 h-4 text-[#71717A] absolute right-4 top-4 pointer-events-none" />
                  </div>
                </div>

                {/* EVENT-SPECIFIC EXTRA DATA COLLECTION FIELDS */}
                {(extraDataConfig.customFields?.length ?? 0) > 0 && (
                  <div className="p-4 rounded-2xl bg-[#F5F5F7] border border-[#E5E5EA] space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-[#0B0B0B]">
                        Additional {selectedEvent.category} Details
                      </span>
                      <span className="text-[10px] font-mono uppercase text-[#71717A]">
                        Organizer Form
                      </span>
                    </div>
                    <div className="space-y-3">
                      {extraDataConfig.customFields.map((field) => {
                        const val = customResponses[field.id] || '';
                        return (
                          <div key={field.id} className="space-y-1">
                            <label className="block text-xs font-semibold text-[#0B0B0B]">
                              {field.label}
                              {field.required ? ' *' : ''}
                            </label>
                            {field.type === 'select' && field.options ? (
                              <select
                                required={field.required}
                                value={val}
                                onChange={(e) =>
                                  setCustomResponses((prev) => ({
                                    ...prev,
                                    [field.id]: e.target.value,
                                  }))
                                }
                                className="w-full h-11 px-4 rounded-2xl bg-white border border-[#E5E5EA] text-xs font-medium text-[#0B0B0B] focus:border-[#0B0B0B] focus:outline-none"
                              >
                                <option value="">Select an option...</option>
                                {field.options.map((opt) => (
                                  <option key={opt} value={opt}>
                                    {opt}
                                  </option>
                                ))}
                              </select>
                            ) : field.type === 'textarea' ? (
                              <textarea
                                rows={2}
                                required={field.required}
                                value={val}
                                onChange={(e) =>
                                  setCustomResponses((prev) => ({
                                    ...prev,
                                    [field.id]: e.target.value,
                                  }))
                                }
                                placeholder={field.placeholder || 'Enter response...'}
                                className="w-full p-3 rounded-2xl bg-white border border-[#E5E5EA] text-xs text-[#0B0B0B] focus:border-[#0B0B0B] focus:outline-none resize-none"
                              />
                            ) : (
                              <input
                                type="text"
                                required={field.required}
                                value={val}
                                onChange={(e) =>
                                  setCustomResponses((prev) => ({
                                    ...prev,
                                    [field.id]: e.target.value,
                                  }))
                                }
                                placeholder={field.placeholder || 'Enter response...'}
                                className="w-full h-11 px-4 rounded-2xl bg-white border border-[#E5E5EA] text-xs text-[#0B0B0B] focus:border-[#0B0B0B] focus:outline-none"
                              />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Instant Notification Callout */}
                <div className="p-3 rounded-2xl bg-[#F3F3F5] flex items-start gap-2 text-[#444748]">
                  <ShieldCheck className="w-4 h-4 text-[#0B0B0B] shrink-0 mt-0.5" />
                  <span className="text-[11px] leading-relaxed">
                    Instant SMS with QR entry code and calendar invitation will be dispatched
                    immediately. Strictly no marketing spam.
                  </span>
                </div>

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full h-14 bg-[#0B0B0B] hover:opacity-90 active:scale-[0.99] disabled:opacity-60 text-white text-base font-semibold rounded-full flex items-center justify-center gap-2 shadow-lg transition-all"
                >
                  <span>
                    {submitting
                      ? 'Registering...'
                      : selectedEvent.ticketPrice === 0
                        ? 'Validate & Generate QR Pass'
                        : `Claim Pass ($${selectedEvent.ticketPrice})`}
                  </span>
                  <ArrowRight className="w-5 h-5" />
                </button>
              </form>
            </>
          )}
        </>
      )}
    </section>
  );

  return (
    <div className="min-h-dvh w-full max-w-full bg-[#F5F5F7] text-[#1A1C1D] antialiased flex flex-col overflow-x-clip selection:bg-[#0B0B0B] selection:text-white">
      {/* Fullscreen Kiosk Check-In & QR Pass Modal */}
      {showCheckinModal && (
        <div
          className="fixed inset-0 z-[70] bg-black/70 backdrop-blur-md flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="checkin-qr-kiosk-title"
        >
          <div className="w-full max-w-md bg-white rounded-[32px] p-6 sm:p-7 shadow-2xl border border-[#E5E5EA] space-y-5 relative">
            <button
              type="button"
              onClick={() => setShowCheckinModal(false)}
              aria-label="Close check-in QR screen"
              className="absolute top-5 right-5 w-9 h-9 rounded-full bg-[#F5F5F7] hover:bg-[#E8E8EA] flex items-center justify-center text-[#0B0B0B]"
            >
              <X className="w-4 h-4" />
            </button>

            <div className="space-y-1 pr-8">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-[#0B0B0B] text-white text-[10px] font-bold uppercase tracking-wider">
                <QrCode className="w-3 h-3" />
                Live Gate Check-In QR
              </span>
              <h2 id="checkin-qr-kiosk-title" className="font-display text-xl font-bold text-[#0B0B0B] tracking-tight pt-1">
                {selectedEvent.title}
              </h2>
              <p className="text-xs text-[#71717A] tabular-nums">
                {selectedEvent.date} · {selectedEvent.time} · {selectedEvent.venue}
              </p>
            </div>

            <div className="bg-[#F5F5F7] rounded-3xl p-5 flex flex-col items-center text-center gap-3 border border-[#E5E5EA]">
              <div className="relative p-4 bg-white rounded-2xl shadow-sm border border-[#E5E5EA]">
                <DeterministicQrSvg
                  value={checkinKioskUrl}
                  size={200}
                  label={`Gate check-in QR code for ${selectedEvent.title}`}
                />
              </div>
              <div className="space-y-0.5">
                <p className="text-xs font-semibold text-[#0B0B0B]">
                  Scan at Gate Entrance or Desk
                </p>
                <p className="text-[11px] font-mono text-[#71717A] break-all">
                  /e/{selectedEvent.slug}/checkin
                </p>
              </div>
              <div className="w-full grid grid-cols-2 gap-2 pt-1 text-left">
                <div className="bg-white rounded-2xl px-3 py-2">
                  <span className="text-[10px] text-[#71717A] block">Checked / Registered</span>
                  <span className="text-xs font-bold text-[#0B0B0B] tabular-nums">
                    {selectedEvent.checkedIn} / {selectedEvent.registered} guests
                  </span>
                </div>
                <div className="bg-white rounded-2xl px-3 py-2">
                  <span className="text-[10px] text-[#71717A] block">Pass Status</span>
                  <span className="text-xs font-bold text-emerald-700">
                    {isQrPassPublished ? 'Active Gate QR' : 'Pending Creator'}
                  </span>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => downloadQrSvg(checkinKioskUrl, `${selectedEvent.slug}-checkin-qr.svg`)}
                className="h-11 rounded-full bg-[#F5F5F7] hover:bg-[#E8E8EA] text-xs font-semibold text-[#0B0B0B] inline-flex items-center justify-center gap-1.5"
              >
                <Download className="w-3.5 h-3.5" />
                Download QR
              </button>
              <button
                type="button"
                onClick={() => void handleShareCheckinUrl()}
                className="h-11 rounded-full bg-[#F5F5F7] hover:bg-[#E8E8EA] text-xs font-semibold text-[#0B0B0B] inline-flex items-center justify-center gap-1.5"
              >
                <Copy className="w-3.5 h-3.5" />
                Copy Check-In Link
              </button>
            </div>

            <button
              type="button"
              onClick={() => {
                setShowCheckinModal(false);
                switchScreenMode('checkin');
              }}
              className="w-full h-12 rounded-full bg-[#0B0B0B] hover:bg-neutral-800 text-white text-xs font-semibold inline-flex items-center justify-center gap-2 transition-colors"
            >
              <span>Open Standalone Event Check-In Screen</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Sticky Top Header */}
      <header className="fixed top-0 inset-x-0 w-full z-50 bg-[#F5F5F7]/85 backdrop-blur-xl shadow-[0_1px_8px_rgba(0,0,0,0.04)] pt-[env(safe-area-inset-top)]">
        <div className="h-16 max-w-3xl mx-auto px-4 sm:px-6 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1 min-w-0">
            <button
              type="button"
              aria-label="Go Back"
              onClick={() => {
                if (issuedPass) {
                  setIssuedPass(null);
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                } else {
                  onBackHome();
                }
              }}
              className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-[#E8E8EA] transition-colors text-[#1A1C1D] shrink-0"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <h1 className="font-display text-base font-semibold text-[#1A1C1D] truncate">
              {standaloneCheckin
                ? 'Event Check-In Screen'
                : standaloneGifts
                  ? 'Standalone Gift Table'
                  : 'Event Invitation & Check-In'}
            </h1>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {!issuedPass && (
              <>
                <div className="hidden sm:flex items-center p-1 rounded-full bg-white border border-[#E5E5EA]">
                  <button
                    type="button"
                    onClick={() => switchScreenMode('top')}
                    className={`px-3 py-1 rounded-full text-[11px] font-semibold transition-colors ${
                      screenMode === 'top'
                        ? 'bg-[#0B0B0B] text-white'
                        : 'text-[#71717A] hover:text-[#0B0B0B]'
                    }`}
                  >
                    Invitation
                  </button>
                  <button
                    type="button"
                    onClick={() => switchScreenMode('checkin')}
                    className={`px-3 py-1 rounded-full text-[11px] font-semibold transition-colors ${
                      standaloneCheckin
                        ? 'bg-[#0B0B0B] text-white'
                        : 'text-[#71717A] hover:text-[#0B0B0B]'
                    }`}
                  >
                    Check-In Screen
                  </button>
                  {giftTableAvailable && (
                    <button
                      type="button"
                      onClick={() => switchScreenMode('gifts')}
                      className={`px-3 py-1 rounded-full text-[11px] font-semibold transition-colors ${
                        standaloneGifts
                          ? 'bg-[#0B0B0B] text-white'
                          : 'text-[#71717A] hover:text-[#0B0B0B]'
                      }`}
                    >
                      Gift Table
                    </button>
                  )}
                </div>
                <select
                  value={selectedEvent.id}
                  onChange={(e) => switchEvent(e.target.value)}
                  aria-label="Select event"
                  className="hidden md:block h-9 max-w-[170px] px-3 rounded-full bg-white border border-[#E5E5EA] text-xs font-semibold text-[#0B0B0B] focus:border-[#0B0B0B] focus:outline-none truncate"
                >
                  {activeEvents.map((evt) => (
                    <option key={evt.id} value={evt.id}>
                      /e/{evt.slug}
                    </option>
                  ))}
                </select>
              </>
            )}
            <button
              type="button"
              onClick={() => setShowCheckinModal(true)}
              className="h-9 px-3 rounded-full bg-[#0B0B0B] text-white text-xs font-semibold inline-flex items-center gap-1.5 hover:bg-neutral-800 transition-colors"
            >
              <QrCode className="w-3.5 h-3.5" />
              <span className="hidden xs:inline">Check-In QR</span>
            </button>
            <button
              type="button"
              onClick={handleShare}
              aria-label="Share Page"
              title="Copy Link"
              className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-[#E8E8EA] transition-colors text-[#1A1C1D]"
            >
              <Share2 className="w-4.5 h-4.5" />
            </button>
            <button
              type="button"
              onClick={onOpenStudio}
              title={isSignedIn ? 'Open Creator Studio' : 'Sign In for Creator Studio'}
              aria-label={isSignedIn ? 'Open Creator Studio' : 'Sign In for Creator Studio'}
              className="w-8 h-8 rounded-full bg-[#0B0B0B] text-white flex items-center justify-center hover:opacity-85 transition-opacity"
            >
              <User className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 w-full pt-20 px-4 sm:px-6 pb-10">
        <div className="max-w-3xl mx-auto flex flex-col space-y-6">
          {shareToast && (
            <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-full bg-[#0B0B0B] text-white text-xs font-semibold shadow-lg">
              {shareToast}
            </div>
          )}

          {!issuedPass ? (
            standaloneGifts ? (
              <>
                {/* Mobile View Mode Switcher */}
                <div className="sm:hidden flex items-center justify-between gap-1 bg-white rounded-full p-1.5 shadow-sm border border-[#E5E5EA]">
                  <button
                    type="button"
                    onClick={() => switchScreenMode('top')}
                    className="flex-1 py-1.5 rounded-full text-xs font-semibold text-[#71717A]"
                  >
                    Invitation
                  </button>
                  <button
                    type="button"
                    onClick={() => switchScreenMode('checkin')}
                    className="flex-1 py-1.5 rounded-full text-xs font-semibold text-[#71717A]"
                  >
                    Check-In
                  </button>
                  <button
                    type="button"
                    onClick={() => switchScreenMode('gifts')}
                    className="flex-1 py-1.5 rounded-full text-xs font-semibold bg-[#0B0B0B] text-white"
                  >
                    Gift Table
                  </button>
                </div>

                {/* Standalone Gift Table Hero Card */}
                <section className="bg-[#0B0B0B] text-white rounded-[32px] p-5 sm:p-7 shadow-xl space-y-4">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="space-y-1.5 min-w-0">
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-white text-[#0B0B0B] text-[10px] font-bold uppercase tracking-wider">
                        <Gift className="w-3 h-3" />
                        Standalone Gift Table Activity
                      </span>
                      <h2 className="font-display text-xl sm:text-2xl font-bold text-white">
                        {extraDataConfig.giftTitle || `${selectedEvent.title} — Gift Table`}
                      </h2>
                      <p className="text-xs text-zinc-300 leading-relaxed max-w-xl">
                        Gift pledges, Mobile Money envelopes, and well-wishes are completely separate from guest registration, walk-ins, and gate check-in.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={handleShare}
                      className="px-3.5 py-2 rounded-full bg-white/10 hover:bg-white/20 text-white text-xs font-semibold inline-flex items-center gap-1.5 shrink-0"
                    >
                      <Copy className="w-3.5 h-3.5" />
                      <span>Copy /e/{selectedEvent.slug}/gifts</span>
                    </button>
                  </div>

                  {extraDataConfig.momoNumber && (
                    <div className="p-3.5 rounded-2xl bg-white/10 border border-white/15 flex flex-wrap items-center justify-between gap-3 text-xs">
                      <div>
                        <span className="text-[10px] uppercase tracking-wider text-zinc-300 block">
                          Receiving MoMo / Gift Account
                        </span>
                        <span className="font-mono font-bold text-white">
                          {extraDataConfig.momoNumber} · {extraDataConfig.momoName || selectedEvent.organizer}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard?.writeText(extraDataConfig.momoNumber || '').catch(() => {});
                          setShareToast(`Copied MoMo number ${extraDataConfig.momoNumber}`);
                          setTimeout(() => setShareToast(null), 2200);
                        }}
                        className="px-3 py-1.5 rounded-full bg-white text-[#0B0B0B] text-[11px] font-bold"
                      >
                        Copy Number
                      </button>
                    </div>
                  )}
                </section>

                {/* Standalone Gift Table Form or Receipt */}
                <section className="bg-white rounded-[32px] p-6 sm:p-7 shadow-md border border-[#E5E5EA]/70 space-y-5">
                  {giftReceipt ? (
                    <div className="text-center space-y-4 py-2">
                      <div className="w-14 h-14 rounded-full bg-[#0B0B0B] text-white flex items-center justify-center mx-auto">
                        <Check className="w-7 h-7" />
                      </div>
                      <div className="space-y-1">
                        <span className="inline-block px-3 py-1 rounded-full bg-[#F5F5F7] text-[11px] font-semibold text-[#0B0B0B]">
                          Gift Table Receipt · Standalone Activity
                        </span>
                        <h3 className="font-display text-2xl font-bold text-[#0B0B0B]">
                          Thank you, {giftReceipt.giverName}!
                        </h3>
                        <p className="text-xs text-[#71717A] max-w-md mx-auto">
                          Your gift entry has been recorded on the {selectedEvent.title} Gift Ledger. Attendance &amp; gate check-in remain completely separate.
                        </p>
                      </div>
                      <div className="max-w-md mx-auto p-4 rounded-2xl bg-[#FBF9F5] border border-[#E6DDD0] text-left text-xs space-y-1.5">
                        <div className="flex items-center justify-between">
                          <span className="text-[#71717A]">Gift Type</span>
                          <span className="font-bold text-[#0B0B0B]">
                            {giftReceipt.giftType === 'cash-momo'
                              ? `${giftReceipt.currency || 'GHS'} ${giftReceipt.amount?.toLocaleString()}`
                              : giftReceipt.giftType === 'registry-item'
                                ? giftReceipt.registryItem
                                : 'Well-Wishes Note'}
                          </span>
                        </div>
                        {giftReceipt.side && (
                          <div className="flex items-center justify-between">
                            <span className="text-[#71717A]">Side / Honoring</span>
                            <span className="font-semibold text-[#0B0B0B]">{giftReceipt.side}</span>
                          </div>
                        )}
                        {giftReceipt.message && (
                          <p className="pt-1 text-[11px] text-[#444748] italic">
                            &ldquo;{giftReceipt.message}&rdquo;
                          </p>
                        )}
                      </div>
                      <div className="flex flex-wrap justify-center gap-2.5 pt-2">
                        <button
                          type="button"
                          onClick={() => setGiftReceipt(null)}
                          className="px-5 py-2.5 rounded-full bg-[#0B0B0B] text-white text-xs font-semibold"
                        >
                          Record Another Gift
                        </button>
                        <button
                          type="button"
                          onClick={() => switchScreenMode('top')}
                          className="px-5 py-2.5 rounded-full bg-[#F5F5F7] text-[#0B0B0B] text-xs font-semibold"
                        >
                          Back to Event Page
                        </button>
                      </div>
                    </div>
                  ) : (
                    <form onSubmit={handleGiftTableSubmit} className="space-y-4">
                      <div>
                        <h3 className="font-display text-xl font-bold text-[#0B0B0B]">
                          Record a Gift, Envelope or Well-Wishes
                        </h3>
                        <p className="text-xs text-[#71717A] mt-0.5">
                          No gate registration or attendee ticket is required to leave a gift or blessing.
                        </p>
                      </div>

                      {giftError && (
                        <div className="p-3.5 rounded-2xl bg-red-50 border border-red-200 flex items-start gap-2.5 text-xs text-red-700">
                          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                          <span>{giftError}</span>
                        </div>
                      )}

                      <div className="grid grid-cols-3 gap-2">
                        {(
                          [
                            { id: 'cash-momo', label: 'MoMo / Cash' },
                            { id: 'registry-item', label: 'Registry Gift' },
                            { id: 'blessing-only', label: 'Wishes Note' },
                          ] as const
                        ).map((opt) => (
                          <button
                            key={opt.id}
                            type="button"
                            onClick={() => setGiftMode(opt.id)}
                            className={`py-2.5 px-3 rounded-xl text-xs font-semibold border transition-colors ${
                              giftMode === opt.id
                                ? 'bg-[#0B0B0B] text-white border-[#0B0B0B]'
                                : 'bg-[#F5F5F7] text-[#0B0B0B] border-[#E5E5EA] hover:border-[#0B0B0B]'
                            }`}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-[11px] font-semibold text-[#0B0B0B] mb-1">
                            Giver / Family Name <span className="text-red-500">*</span>
                          </label>
                          <input
                            type="text"
                            required
                            value={giftGiverName}
                            onChange={(e) => setGiftGiverName(e.target.value)}
                            placeholder="Your full name or family name"
                            className="w-full h-11 px-4 rounded-xl bg-[#F5F5F7] text-xs font-medium text-[#0B0B0B]"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] font-semibold text-[#0B0B0B] mb-1">
                            Phone Number (Optional)
                          </label>
                          <input
                            type="tel"
                            value={giftGiverPhone}
                            onChange={(e) => setGiftGiverPhone(e.target.value)}
                            placeholder="+233 XX XXX XXXX"
                            className="w-full h-11 px-4 rounded-xl bg-[#F5F5F7] text-xs font-mono text-[#0B0B0B]"
                          />
                        </div>
                      </div>

                      {giftMode === 'cash-momo' && (
                        <div className="flex gap-2">
                          <select
                            value={giftCurrency}
                            onChange={(e) => setGiftCurrency(e.target.value as 'GHS' | 'USD')}
                            aria-label="Gift currency"
                            className="h-11 px-3 rounded-xl bg-[#F5F5F7] text-xs font-bold text-[#0B0B0B]"
                          >
                            <option value="GHS">GHS</option>
                            <option value="USD">USD</option>
                          </select>
                          <input
                            type="number"
                            min={1}
                            required
                            value={giftAmount}
                            onChange={(e) => setGiftAmount(e.target.value)}
                            placeholder="Envelope / MoMo amount"
                            className="flex-1 h-11 px-4 rounded-xl bg-[#F5F5F7] text-xs font-mono font-semibold text-[#0B0B0B]"
                          />
                        </div>
                      )}

                      {giftMode === 'registry-item' && (
                        <div>
                          <label className="block text-[11px] font-semibold text-[#0B0B0B] mb-1">
                            Select Gift Table Registry Item
                          </label>
                          <select
                            value={giftItem}
                            onChange={(e) => setGiftItem(e.target.value)}
                            className="w-full h-11 px-4 rounded-xl bg-[#F5F5F7] text-xs font-medium text-[#0B0B0B]"
                          >
                            {(
                              extraDataConfig.giftRegistryItems &&
                              extraDataConfig.giftRegistryItems.length > 0
                                ? extraDataConfig.giftRegistryItems
                                : ['Cash Envelope Blessing', 'Gift Hamper', 'Keepsake Item']
                            ).map((item) => (
                              <option key={item} value={item}>
                                {item}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-[11px] font-semibold text-[#0B0B0B] mb-1">
                            Honoring / Side (Optional)
                          </label>
                          <input
                            type="text"
                            value={giftSide}
                            onChange={(e) => setGiftSide(e.target.value)}
                            placeholder="e.g. Bride's Family, Friends, Colleagues"
                            className="w-full h-11 px-4 rounded-xl bg-[#F5F5F7] text-xs text-[#0B0B0B]"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] font-semibold text-[#0B0B0B] mb-1">
                            Well-Wishes Message (Optional)
                          </label>
                          <input
                            type="text"
                            value={giftMessage}
                            onChange={(e) => setGiftMessage(e.target.value)}
                            placeholder="Write a personal note or blessing..."
                            className="w-full h-11 px-4 rounded-xl bg-[#F5F5F7] text-xs text-[#0B0B0B]"
                          />
                        </div>
                      </div>

                      <button
                        type="submit"
                        disabled={giftSubmitting}
                        className="w-full h-13 bg-[#0B0B0B] hover:opacity-90 disabled:opacity-60 text-white text-sm font-semibold rounded-full flex items-center justify-center gap-2 shadow-lg transition-all"
                      >
                        <Gift className="w-4 h-4" />
                        <span>{giftSubmitting ? 'Recording Gift...' : 'Submit Standalone Gift Entry'}</span>
                      </button>
                    </form>
                  )}
                </section>

                {/* Live Public Gift Ledger / Well-Wishes Wall */}
                {(extraDataConfig.giftLedger?.length ?? 0) > 0 && (
                  <section className="bg-white rounded-[28px] p-5 sm:p-6 shadow-sm space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-bold text-[#0B0B0B]">
                        Gift Table Well-Wishes Wall
                      </h3>
                      <span className="text-[11px] text-[#71717A] tabular-nums">
                        {extraDataConfig.giftLedger?.length ?? 0} entries
                      </span>
                    </div>
                    <div className="space-y-2">
                      {(extraDataConfig.giftLedger ?? []).slice(0, 8).map((entry) => (
                        <div
                          key={entry.id}
                          className="p-3.5 rounded-2xl bg-[#FBF9F5] border border-[#E6DDD0] flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                        >
                          <div className="min-w-0">
                            <p className="text-xs font-bold text-[#0B0B0B] truncate">
                              {entry.giverName}
                              {entry.side ? ` · ${entry.side}` : ''}
                            </p>
                            {entry.message && (
                              <p className="text-[11px] text-[#444748] mt-0.5 italic">
                                &ldquo;{entry.message}&rdquo;
                              </p>
                            )}
                          </div>
                          <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full bg-white border border-[#E5E5EA] text-[#0B0B0B] shrink-0 self-start sm:self-center">
                            {entry.giftType === 'cash-momo'
                              ? `${entry.currency || 'GHS'} ${entry.amount?.toLocaleString()}`
                              : entry.giftType === 'registry-item'
                                ? entry.registryItem || 'Registry Gift'
                                : 'Well-Wishes'}
                          </span>
                        </div>
                      ))}
                    </div>
                  </section>
                )}
              </>
            ) : standaloneCheckin ? (
              <>
                {/* Mobile View Mode & Event Switcher */}
                <div className="sm:hidden flex items-center justify-between gap-2 bg-white rounded-full p-1.5 shadow-sm border border-[#E5E5EA]">
                  <button
                    type="button"
                    onClick={() => switchScreenMode('top')}
                    className="flex-1 py-1.5 rounded-full text-xs font-semibold text-[#71717A]"
                  >
                    Invitation
                  </button>
                  <button
                    type="button"
                    onClick={() => switchScreenMode('checkin')}
                    className="flex-1 py-1.5 rounded-full text-xs font-semibold bg-[#0B0B0B] text-white"
                  >
                    Check-In
                  </button>
                  {giftTableAvailable && (
                    <button
                      type="button"
                      onClick={() => switchScreenMode('gifts')}
                      className="flex-1 py-1.5 rounded-full text-xs font-semibold text-[#71717A]"
                    >
                      Gift Table
                    </button>
                  )}
                </div>

                {/* Standalone Event Check-In Screen Summary & Gate QR Card */}
                <section className="bg-[#0B0B0B] text-white rounded-[32px] p-5 sm:p-6 shadow-xl border border-black/10 space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="flex items-center gap-4 min-w-0">
                      <div className="w-20 h-16 rounded-2xl overflow-hidden bg-zinc-900 border border-white/15 shrink-0">
                        {!heroFailed && (
                          <img
                            src={heroFlyerSrc}
                            alt={selectedEvent.title}
                            onError={() => setHeroFailed(true)}
                            className="w-full h-full object-cover"
                          />
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5 mb-1">
                          <span className="px-2.5 py-0.5 rounded-full bg-white text-[#0B0B0B] text-[10px] font-bold uppercase tracking-wider">
                            Standalone Event Check-In
                          </span>
                          <span className="px-2.5 py-0.5 rounded-full bg-white/10 text-zinc-200 text-[10px] font-mono">
                            {selectedEvent.category}
                          </span>
                        </div>
                        <h2 className="font-display text-lg sm:text-xl font-bold text-white truncate">
                          {selectedEvent.title}
                        </h2>
                        <p className="text-xs text-zinc-300 mt-0.5 truncate tabular-nums">
                          {selectedEvent.date} · {selectedEvent.time} · {selectedEvent.venue}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 shrink-0">
                      <div className="p-2 bg-white rounded-2xl shrink-0">
                        <DeterministicQrSvg
                          value={checkinKioskUrl}
                          size={64}
                          label={`Gate Check-In QR for ${selectedEvent.title}`}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-white/15">
                    <div className="text-xs text-zinc-300 tabular-nums">
                      <strong className="text-white">{selectedEvent.checkedIn}</strong> checked in ·{' '}
                      <strong className="text-white">{selectedEvent.registered}</strong> /{' '}
                      {selectedEvent.capacity} seats claimed ({occupancyPct}%)
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void handleShareCheckinUrl()}
                        className="px-3.5 py-1.5 rounded-full bg-white text-[#0B0B0B] hover:bg-zinc-200 text-xs font-bold inline-flex items-center gap-1.5 transition-colors"
                      >
                        <Share2 className="w-3.5 h-3.5" />
                        <span>Share Check-In Link</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowCheckinModal(true)}
                        className="px-3.5 py-1.5 rounded-full bg-white/10 hover:bg-white/20 text-white text-xs font-semibold inline-flex items-center gap-1.5 transition-colors"
                      >
                        <QrCode className="w-3.5 h-3.5" />
                        <span>Fullscreen QR Kiosk</span>
                      </button>
                    </div>
                  </div>
                </section>

                {/* Primary Standalone Event Check-In Section */}
                {registerSectionCard}
              </>
            ) : (
            <>
              {/* Mobile Event Switcher */}
              {activeEvents.length > 1 && (
                <div className="sm:hidden flex items-center justify-between gap-2 bg-white rounded-full px-4 py-2 shadow-sm">
                  <span className="text-[11px] font-semibold text-[#71717A] shrink-0">
                    Event:
                  </span>
                  <select
                    value={selectedEvent.id}
                    onChange={(e) => switchEvent(e.target.value)}
                    aria-label="Select event on mobile"
                    className="flex-1 bg-transparent text-xs font-semibold text-[#0B0B0B] focus:outline-none truncate text-right"
                  >
                    {activeEvents.map((evt) => (
                      <option key={evt.id} value={evt.id}>
                        {evt.title}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* SCREEN 1: EDITORIAL GRAPHIC-DESIGNED FLYER HERO CARD */}
              <section className="w-full relative rounded-[32px] overflow-hidden bg-[#0B0B0B] text-white shadow-xl border border-black/10">
                <div className="w-full min-h-[340px] sm:min-h-[380px] relative flex flex-col justify-between p-5 sm:p-7">
                  {!heroFailed && (
                    <img
                      src={heroFlyerSrc}
                      alt={`${selectedEvent.title} official event flyer`}
                      onError={() => setHeroFailed(true)}
                      className="absolute inset-0 w-full h-full object-cover"
                    />
                  )}
                  <div className={`absolute inset-0 ${themeFrame.scrim}`} />
                  <div
                    className={`absolute inset-3 sm:inset-4 rounded-[24px] border ${themeFrame.borderClass} pointer-events-none`}
                  />

                  {/* Top Designer Stamp Bar */}
                  <div className="relative z-10 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span
                        className={`inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider px-3 py-1 rounded-full shadow-sm ${themeFrame.badgeClass}`}
                      >
                        {selectedEvent.category}
                      </span>
                      <span className="inline-flex items-center gap-1.5 bg-white/95 backdrop-blur-md text-[#0B0B0B] text-[11px] font-semibold px-3 py-1 rounded-full shadow-sm tabular-nums">
                        <span className="w-2 h-2 rounded-full bg-emerald-500" />
                        {spotsRemaining > 0 ? `${spotsRemaining} seats open` : 'Waitlist open'}
                      </span>
                      {extraDataConfig.enableGiftTable && (
                        <span className="inline-flex items-center gap-1 bg-black/75 backdrop-blur-md text-white border border-white/25 text-[11px] font-semibold px-3 py-1 rounded-full">
                          <Gift className="w-3 h-3" />
                          Gift Table
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setShowCheckinModal(true)}
                        className="bg-black/75 hover:bg-black text-white border border-white/30 text-[11px] font-semibold px-3 py-1.5 rounded-full backdrop-blur-md inline-flex items-center gap-1.5 transition-colors"
                      >
                        <QrCode className="w-3.5 h-3.5" />
                        Check-In QR
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          document
                            .getElementById('register-section')
                            ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                        }}
                        className="bg-white hover:bg-zinc-100 text-[#0B0B0B] text-[11px] font-bold px-3.5 py-1.5 rounded-full shadow-sm transition-colors"
                      >
                        {!isQrPassPublished
                          ? 'QR Pending'
                          : selectedEvent.ticketPrice === 0
                            ? 'RSVP Free ↓'
                            : `Get Pass ($${selectedEvent.ticketPrice}) ↓`}
                      </button>
                    </div>
                  </div>

                  {/* Main Editorial Title & Logistics */}
                  <div className="relative z-10 space-y-2 pt-8">
                    <span
                      className={`text-[11px] font-mono font-semibold tracking-[0.18em] uppercase block ${themeFrame.accentText}`}
                    >
                      {selectedEvent.organizer} Presents · Official Invitation
                    </span>
                    <h2 className="font-display text-[28px] sm:text-[36px] leading-[1.12] font-bold text-white tracking-[-0.03em] text-balance">
                      {selectedEvent.title}
                    </h2>
                    <div className="pt-1 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[#E8E8EA] text-[13px]">
                      <div className="flex items-center gap-1.5 tabular-nums">
                        <CalendarDays className="w-4 h-4 text-[#E2E2E4] shrink-0" />
                        <span>
                          {selectedEvent.date} · {selectedEvent.time}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <MapPin className="w-4 h-4 text-[#E2E2E4] shrink-0" />
                        <span>
                          {selectedEvent.venue} · {selectedEvent.city}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Live Capacity Meter Bar */}
                <div className="bg-[#F3F3F5] p-4 flex flex-col gap-1.5 text-[#1A1C1D]">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-[#444748] flex items-center gap-1.5">
                      <Users className="w-3.5 h-3.5 text-[#0B0B0B]" />
                      Live Gate &amp; RSVP Occupancy
                    </span>
                    <span className="text-xs text-[#0B0B0B] font-bold tabular-nums">
                      {selectedEvent.registered} / {selectedEvent.capacity} Claimed ({occupancyPct}
                      %)
                    </span>
                  </div>
                  <div className="w-full h-2 rounded-full bg-[#E2E2E4] overflow-hidden">
                    <div
                      className="h-full bg-[#0B0B0B] rounded-full transition-all duration-300"
                      style={{ width: `${occupancyPct}%` }}
                    />
                  </div>
                </div>
              </section>

              {/* Shareable Invitation Link & Dynamic OG Card Bar */}
              <section className="bg-white rounded-[28px] p-4 sm:p-5 shadow-sm border border-[#E5E5EA] space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[#71717A]">
                      <Link2 className="w-3.5 h-3.5 text-[#0B0B0B]" />
                      <span>Direct Event Invitation Link &amp; OG Card</span>
                    </div>
                    <p className="text-xs font-mono font-semibold text-[#0B0B0B] truncate mt-0.5">
                      {invitationUrl}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => setShowOgPreview((p) => !p)}
                      className="h-9 px-3.5 rounded-full bg-[#F5F5F7] hover:bg-[#E8E8EA] text-xs font-semibold text-[#0B0B0B] transition-colors"
                    >
                      {showOgPreview ? 'Hide OG Preview' : 'Preview OG Card'}
                    </button>
                    <button
                      type="button"
                      onClick={handleShare}
                      className="h-9 px-4 rounded-full bg-[#0B0B0B] hover:bg-neutral-800 text-white text-xs font-semibold inline-flex items-center gap-1.5 transition-colors"
                    >
                      <Copy className="w-3.5 h-3.5" />
                      Copy Invite Link
                    </button>
                  </div>
                </div>

                {showOgPreview && (
                  <div className="rounded-2xl overflow-hidden border border-[#E5E5EA] bg-[#F5F5F7] p-2 space-y-2">
                    <img
                      src={ogImageUrl}
                      alt={`${selectedEvent.title} OpenGraph share card`}
                      className="w-full rounded-xl aspect-[1200/630] object-cover bg-[#0B0B0B]"
                    />
                    <p className="text-[11px] text-[#71717A] px-1 flex items-center justify-between">
                      <span>Dynamic og:image attached to /e/{selectedEvent.slug}</span>
                      <span className="font-mono text-[#0B0B0B]">1200 × 630 SVG</span>
                    </p>
                  </div>
                )}
              </section>

              {/* Prominent Check-In & QR Code Kiosk Desk Card */}
              <section className="bg-[#0B0B0B] text-white rounded-[28px] p-5 sm:p-6 shadow-md flex flex-col sm:flex-row items-center justify-between gap-5">
                <div className="flex items-center gap-4 min-w-0">
                  <div className="p-2.5 bg-white rounded-2xl shrink-0">
                    <DeterministicQrSvg
                      value={checkinKioskUrl}
                      size={76}
                      label={`Gate QR for ${selectedEvent.title}`}
                    />
                  </div>
                  <div className="min-w-0">
                    <span className="inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-widest text-zinc-400">
                      <QrCode className="w-3 h-3" />
                      Prominent Check-In &amp; QR Desk
                    </span>
                    <h3 className="font-display text-lg font-bold text-white mt-0.5">
                      Instant Gate Check-In &amp; QR Screen
                    </h3>
                    <p className="text-xs text-zinc-300 mt-0.5 leading-relaxed">
                      Validate your guest circle below or launch the fullscreen Check-In QR display for rapid gate scanning.
                    </p>
                  </div>
                </div>
                <div className="flex flex-col sm:items-end gap-2 w-full sm:w-auto shrink-0">
                  <button
                    type="button"
                    onClick={() => switchScreenMode('checkin')}
                    className="w-full sm:w-auto h-10 px-4 rounded-full bg-white text-[#0B0B0B] hover:bg-zinc-200 text-xs font-bold inline-flex items-center justify-center gap-1.5 whitespace-nowrap"
                  >
                    <QrCode className="w-4 h-4" />
                    <span>Open Standalone Check-In Screen</span>
                  </button>
                  <div className="flex items-center gap-2 w-full sm:w-auto">
                    <button
                      type="button"
                      onClick={() => setShowCheckinModal(true)}
                      className="flex-1 sm:flex-initial h-9 px-3.5 rounded-full bg-white/10 hover:bg-white/20 text-white text-[11px] font-semibold inline-flex items-center justify-center gap-1.5 whitespace-nowrap"
                    >
                      <QrCode className="w-3.5 h-3.5" />
                      <span>QR Kiosk</span>
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        downloadQrSvg(checkinKioskUrl, `${selectedEvent.slug}-checkin-qr.svg`)
                      }
                      className="flex-1 sm:flex-initial h-9 px-3.5 rounded-full bg-white/10 hover:bg-white/20 text-white text-[11px] font-semibold inline-flex items-center justify-center gap-1.5 whitespace-nowrap"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Save QR</span>
                    </button>
                  </div>
                </div>
              </section>

              {/* Event Overview */}
              <section className="bg-white rounded-[28px] p-5 shadow-sm space-y-3">
                <div className="flex items-center gap-2">
                  <span className="w-1.5 h-4 bg-[#0B0B0B] rounded-full" />
                  <h3 className="text-base font-semibold text-[#0B0B0B]">
                    About this {selectedEvent.category}
                  </h3>
                </div>
                <p className="text-sm text-[#444748] leading-relaxed">
                  {selectedEvent.subtitle} Instant SMS pass &amp; QR gate verification enabled for
                  all registered guests.
                </p>
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {[
                    selectedEvent.category,
                    selectedEvent.city,
                    selectedEvent.ticketPrice === 0 ? 'Free RSVP' : `$${selectedEvent.ticketPrice} Ticket`,
                    validationConfig.enabled ? 'Validated Guest List' : 'Open Entry',
                  ].map((tag) => (
                    <span
                      key={tag}
                      className="text-[11px] font-medium bg-[#F3F3F5] text-[#1A1C1D] px-3 py-1 rounded-full"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </section>

              {/* Standalone Gift Table Launch Card */}
              {giftTableAvailable && (
                <section className="bg-[#FBF9F5] border border-[#E6DDD0] text-[#0B0B0B] rounded-[28px] p-5 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="flex items-start gap-3.5 min-w-0">
                    <div className="w-11 h-11 rounded-2xl bg-[#0B0B0B] text-white flex items-center justify-center shrink-0">
                      <Gift className="w-5 h-5" />
                    </div>
                    <div className="min-w-0">
                      <h3 className="text-sm font-bold text-[#0B0B0B]">
                        {extraDataConfig.giftTitle || 'Standalone Gift Table & Registry'}
                      </h3>
                      <p className="text-xs text-[#71717A] mt-0.5 leading-relaxed">
                        Gift pledges, MoMo blessings &amp; well-wishes operate standalone at /e/{selectedEvent.slug}/gifts — separate from registration and gate check-in.
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => switchScreenMode('gifts')}
                    className="w-full sm:w-auto px-4 py-2.5 rounded-full bg-[#0B0B0B] text-white hover:bg-neutral-800 text-xs font-bold inline-flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
                  >
                    <Gift className="w-3.5 h-3.5" />
                    <span>Open Gift Table</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </section>
              )}

              {/* Event Disposable Camera Launch Card */}
              {onOpenDisposableCamera && (
                <section className="bg-white border border-[#E5E5EA] text-[#0B0B0B] rounded-[28px] p-5 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="flex items-start gap-3.5 min-w-0">
                    <div className="w-11 h-11 rounded-2xl bg-[#0B0B0B] text-white flex items-center justify-center shrink-0">
                      <Camera className="w-5 h-5" />
                    </div>
                    <div className="min-w-0">
                      <h3 className="text-sm font-bold text-[#0B0B0B]">
                        Shared Event Disposable Camera
                      </h3>
                      <p className="text-xs text-[#71717A] mt-0.5 leading-relaxed">
                        Snap candid 35mm film photos with guests on the shared event camera roll.
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => onOpenDisposableCamera(selectedEvent.id, name.trim() || undefined)}
                    className="w-full sm:w-auto px-4 py-2.5 rounded-full bg-[#0B0B0B] text-white hover:bg-neutral-800 text-xs font-bold inline-flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
                  >
                    <Camera className="w-3.5 h-3.5" />
                    <span>Open Disposable Camera (5 Shots)</span>
                  </button>
                </section>
              )}

              {/* Program Schedule Blocks (only rendered when organizer has added real schedule items) */}
              {eventScheduleBlocks.length > 0 && (
                <section className="space-y-2.5">
                  <div className="flex items-center justify-between px-1">
                    <h3 className="text-base font-semibold text-[#0B0B0B]">
                      Event Schedule &amp; Run of Show
                    </h3>
                    <span className="text-[11px] font-medium text-[#71717A]">
                      {eventScheduleBlocks.length} Sessions
                    </span>
                  </div>

                  {eventScheduleBlocks.map((blk) => (
                    <div
                      key={blk.id}
                      className="bg-white rounded-[24px] p-4 shadow-sm flex items-center gap-4"
                    >
                      <div className="w-14 h-14 rounded-full bg-[#0B0B0B] text-white flex items-center justify-center font-bold text-[11px] shrink-0 text-center px-1 tabular-nums">
                        {blk.time.split('-')[0]?.trim() || blk.time}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <h4 className="text-base font-semibold text-[#0B0B0B] truncate">
                            {blk.title}
                          </h4>
                          <span className="text-[11px] font-medium bg-[#F3F3F5] text-[#71717A] px-2.5 py-0.5 rounded-full shrink-0 tabular-nums">
                            {blk.time}
                          </span>
                        </div>
                        <p className="text-[11px] text-[#71717A] uppercase tracking-wider truncate mt-0.5">
                          {blk.lead}
                        </p>
                        <p className="text-[13px] text-[#444748] mt-0.5 truncate font-medium">
                          {blk.stage}
                        </p>
                      </div>
                    </div>
                  ))}
                </section>
              )}

              {/* Venue Location Preview (Architectural Card — no external broken URLs) */}
              <section className="bg-white rounded-[28px] p-5 shadow-sm space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <MapPin className="w-5 h-5 text-[#0B0B0B]" />
                    <h3 className="text-base font-semibold text-[#0B0B0B]">Venue &amp; Directions</h3>
                  </div>
                  <a
                    href={`https://maps.google.com/?q=${encodeURIComponent(`${selectedEvent.venue} ${selectedEvent.city}`)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs font-semibold text-[#0B0B0B] underline inline-flex items-center gap-1"
                  >
                    <span>Open in Maps</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
                <div className="w-full h-40 rounded-2xl relative overflow-hidden bg-[#F5F5F7] border border-[#E5E5EA] flex items-center justify-between px-5">
                  <div className="space-y-1 max-w-[70%]">
                    <span className="text-[10px] font-mono uppercase tracking-widest text-[#71717A]">
                      Gate Entrance Coordinates
                    </span>
                    <p className="text-sm sm:text-base font-bold text-[#0B0B0B]">
                      {selectedEvent.venue}
                    </p>
                    <p className="text-xs text-[#71717A]">
                      {selectedEvent.city} · Guest parking &amp; QR Fast Pass lane
                    </p>
                  </div>
                  <div className="w-12 h-12 rounded-2xl bg-[#0B0B0B] text-white flex items-center justify-center shrink-0">
                    <Navigation className="w-5 h-5" />
                  </div>
                </div>
              </section>

              {/* Guest Validation & Check-In Registration Form */}
              {registerSectionCard}
            </>
            )
          ) : (
            /* SCREEN 2: TICKET CONFIRMATION & DIGITAL PASS SCREEN */
            <div className="flex flex-col w-full">
              {/* Success Celebration Banner */}
              <div className="pt-2 pb-6 flex flex-col items-center text-center">
                <div className="relative mb-4">
                  <div className="w-16 h-16 rounded-full bg-[#0B0B0B] flex items-center justify-center shadow-lg shadow-[#0B0B0B]/10">
                    <Check className="w-8 h-8 text-white" />
                  </div>
                  <div className="absolute -top-1 -right-1 w-6 h-6 rounded-full bg-[#EEEEF0] flex items-center justify-center">
                    <Sparkles className="w-3.5 h-3.5 text-[#0B0B0B]" />
                  </div>
                </div>
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#E8E8EA] text-[#1A1C1D] text-xs font-semibold mb-2">
                  <span className="w-2 h-2 rounded-full bg-[#0B0B0B]" />
                  Registration Confirmed
                </div>
                <h2 className="font-display text-[28px] leading-[34px] font-bold text-[#0B0B0B] tracking-[-0.02em] mb-1">
                  You&apos;re in, {firstName}!
                </h2>
                <p className="text-[13px] text-[#71717A]">
                  Your pass is active. Confirmation is dispatched below.
                </p>
              </div>

              {/* Digital Pass / Ticket Card */}
              <div className="relative bg-white rounded-[32px] p-6 shadow-sm overflow-hidden mb-6">
                <div className="flex items-start justify-between gap-2 mb-4">
                  <div>
                    <div className="flex flex-wrap items-center gap-1.5 mb-1.5">
                      <span className="inline-block px-2.5 py-0.5 rounded-full bg-[#0B0B0B] text-white text-[11px] font-medium tracking-wider uppercase">
                        Fast Pass Attendee
                      </span>
                      {issuedPass.validationGroup && (
                        <span className="inline-block px-2.5 py-0.5 rounded-full bg-[#F5F5F7] border border-[#E5E5EA] text-[#0B0B0B] text-[11px] font-semibold">
                          {issuedPass.validationGroup}
                        </span>
                      )}
                    </div>
                    <h3 className="font-display text-[22px] leading-7 font-bold text-[#0B0B0B] tracking-[-0.02em]">
                      {selectedEvent.title}
                    </h3>
                  </div>
                  <div className="text-right shrink-0">
                    <span className="text-[11px] text-[#71717A] block">Ticket ID</span>
                    <span className="text-xs font-semibold text-[#0B0B0B] font-mono tabular-nums">
                      {issuedPass.ticketCode}
                    </span>
                  </div>
                </div>

                {/* Attendee Meta Row */}
                <div className="bg-[#F5F5F7] rounded-2xl p-4 flex items-center justify-between gap-2 mb-6">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-10 h-10 rounded-full bg-[#E8E8EA] flex items-center justify-center text-[#0B0B0B] font-semibold text-sm shrink-0">
                      {passInitials}
                    </div>
                    <div className="min-w-0">
                      <span className="text-[11px] text-[#71717A] block">Attendee</span>
                      <span className="text-base font-semibold text-[#0B0B0B] truncate block">
                        {issuedPass.name}
                      </span>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <span className="text-[11px] text-[#71717A] block">Validated Circle</span>
                    <span className="text-xs font-semibold text-[#0B0B0B]">
                      {issuedPass.validationGroup || issuedPass.tier}
                    </span>
                  </div>
                </div>

                {/* Unique Deterministic QR Code Section */}
                <div className="relative flex flex-col items-center justify-center p-4 bg-[#F9F9FB] rounded-2xl mb-4">
                  <div className="relative p-3 bg-white rounded-2xl shadow-sm border border-[#E5E5EA]">
                    <DeterministicQrSvg
                      value={`${issuedPass.ticketCode}|${selectedEvent.slug}|${issuedPass.phone}`}
                      size={156}
                      label={`Check-In QR Pass for ${issuedPass.name}`}
                    />
                  </div>
                  <p className="text-[11px] text-[#71717A] mt-2 tracking-wide uppercase">
                    Scan at gate for instant badge check-in
                  </p>
                  <button
                    type="button"
                    onClick={() =>
                      downloadQrSvg(
                        `${issuedPass.ticketCode}|${selectedEvent.slug}|${issuedPass.phone}`,
                        `${selectedEvent.slug}-${issuedPass.ticketCode.replace(/[^A-Za-z0-9-]/g, '')}.svg`
                      )
                    }
                    className="mt-2 px-3.5 py-1.5 rounded-full bg-white border border-[#E5E5EA] hover:border-[#0B0B0B] text-[11px] font-semibold text-[#0B0B0B] inline-flex items-center gap-1.5"
                  >
                    <Download className="w-3 h-3" />
                    Download Personal QR Pass (.svg)
                  </button>
                </div>

                {/* Extra Custom Registration Responses */}
                {issuedPass.customResponses && Object.keys(issuedPass.customResponses).length > 0 && (
                  <div className="mb-4 p-4 rounded-2xl bg-[#F5F5F7] border border-[#E5E5EA] space-y-2 text-xs">
                    <div className="flex flex-wrap gap-1.5">
                      {Object.entries(issuedPass.customResponses).map(([k, v]) => (
                        <span
                          key={k}
                          className="px-2.5 py-0.5 rounded-full bg-white border border-[#E5E5EA] text-[11px] text-[#0B0B0B]"
                        >
                          {k}: <strong>{v}</strong>
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Event Key Logistics */}
                <div className="space-y-3 pt-1">
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-full bg-[#F5F5F7] flex items-center justify-center shrink-0 text-[#0B0B0B]">
                      <CalendarDays className="w-4 h-4" />
                    </div>
                    <div>
                      <span className="text-[11px] text-[#71717A] block">Date &amp; Time</span>
                      <span className="text-[13px] font-medium text-[#0B0B0B] tabular-nums">
                        {selectedEvent.date} · {selectedEvent.time}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-full bg-[#F5F5F7] flex items-center justify-center shrink-0 text-[#0B0B0B]">
                      <MapPin className="w-4 h-4" />
                    </div>
                    <div>
                      <span className="text-[11px] text-[#71717A] block">Venue &amp; Entry</span>
                      <span className="text-[13px] font-medium text-[#0B0B0B] block">
                        {selectedEvent.venue}
                      </span>
                      <span className="text-[11px] text-[#71717A] block">
                        {selectedEvent.city} · Fast Pass Check-In Lane
                      </span>
                    </div>
                  </div>
                </div>

                <div className="mt-4 bg-[#F5F5F7] rounded-2xl p-3 flex items-center gap-2">
                  <Info className="w-4 h-4 text-[#0B0B0B] shrink-0" />
                  <p className="text-[11px] text-[#444748]">
                    Show this QR code at the check-in desk for entry badge printing and welcome kit
                    collection.
                  </p>
                </div>
              </div>

              {/* Dispatch Status Card */}
              <div className="bg-white rounded-[28px] p-5 mb-6 shadow-sm">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-base font-semibold text-[#0B0B0B]">Dispatch Status</h3>
                  <span className="text-[11px] px-2.5 py-0.5 rounded-full bg-[#E8E8EA] text-[#0B0B0B] font-semibold">
                    Instant Verified
                  </span>
                </div>
                <div className="space-y-3">
                  <div className="p-3 bg-[#F5F5F7] rounded-2xl flex items-start gap-3">
                    <div className="w-7 h-7 rounded-full bg-[#0B0B0B] text-white flex items-center justify-center shrink-0 mt-0.5">
                      <MessageSquare className="w-3.5 h-3.5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-[#0B0B0B]">
                          SMS Ticket Pass
                        </span>
                        <span className="text-[11px] text-emerald-600 font-semibold">
                          Delivered
                        </span>
                      </div>
                      <p className="text-[11px] text-[#71717A] truncate font-mono">
                        Sent via Arkesel SMS to {issuedPass.phone}
                      </p>
                      <div className="mt-1.5 px-2.5 py-1 bg-[#EEEEF0] rounded-lg text-[11px] font-mono text-[#0B0B0B] truncate">
                        &ldquo;{selectedEvent.title}: Confirmed! Ticket {issuedPass.ticketCode}
                        &rdquo;
                      </div>
                    </div>
                  </div>

                  <div className="p-3 bg-[#F5F5F7] rounded-2xl flex items-start gap-3">
                    <div className="w-7 h-7 rounded-full bg-[#0B0B0B] text-white flex items-center justify-center shrink-0 mt-0.5">
                      <Mail className="w-3.5 h-3.5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-[#0B0B0B]">
                          Official Receipt &amp; PDF
                        </span>
                        <span className="text-[11px] text-emerald-600 font-semibold">
                          Delivered
                        </span>
                      </div>
                      <p className="text-[11px] text-[#71717A] truncate">
                        Confirmation &amp; calendar invite sent to {issuedPass.email}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Action CTAs */}
              <div className="space-y-2.5 mb-6">
                {onOpenDisposableCamera && (
                  <button
                    type="button"
                    onClick={() =>
                      onOpenDisposableCamera(selectedEvent.id, issuedPass.name, issuedPass.ticketCode)
                    }
                    className="w-full h-12 bg-[#0B0B0B] text-white rounded-full flex items-center justify-center gap-2 hover:bg-neutral-800 transition-colors shadow-sm text-sm font-semibold"
                  >
                    <Camera className="w-4.5 h-4.5" />
                    <span>Open Disposable Camera (5 Shots &amp; Collage)</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleSaveWallet}
                  className={`w-full h-12 rounded-full flex items-center justify-center gap-2 transition-colors shadow-sm text-sm font-semibold ${
                    onOpenDisposableCamera
                      ? 'bg-white text-[#0B0B0B] hover:bg-[#EEEEF0]'
                      : 'bg-[#0B0B0B] text-white hover:bg-neutral-800'
                  }`}
                >
                  <Wallet className="w-4.5 h-4.5" />
                  <span>
                    {walletSaved ? 'Pass Saved for Offline Check-In ✓' : 'Save Ticket to Apple Wallet'}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={handleDownloadIcs}
                  className="w-full h-12 bg-white text-[#0B0B0B] rounded-full flex items-center justify-center gap-2 hover:bg-[#EEEEF0] transition-colors shadow-sm text-sm font-semibold"
                >
                  <Calendar className="w-4.5 h-4.5" />
                  <span>Add to Google / Apple Calendar (.ics)</span>
                </button>
                <button
                  type="button"
                  onClick={handleShare}
                  className="w-full h-11 bg-[#E8E8EA] text-[#0B0B0B] rounded-full flex items-center justify-center gap-2 hover:bg-[#E2E2E4] transition-colors text-xs font-semibold"
                >
                  <Share2 className="w-4 h-4" />
                  <span>Copy Event Invitation Link</span>
                </button>
              </div>

              {/* Venue & Arrival Card */}
              <div className="bg-white rounded-[28px] p-5 mb-6 shadow-sm overflow-hidden">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h3 className="text-base font-semibold text-[#0B0B0B]">Venue &amp; Arrival</h3>
                    <p className="text-[11px] text-[#71717A]">{selectedEvent.venue} · {selectedEvent.city}</p>
                  </div>
                  <a
                    href={`https://maps.google.com/?q=${encodeURIComponent(`${selectedEvent.venue} ${selectedEvent.city}`)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="Directions"
                    className="w-8 h-8 rounded-full bg-[#F5F5F7] flex items-center justify-center text-[#0B0B0B] hover:bg-[#EEEEF0]"
                  >
                    <Navigation className="w-4 h-4" />
                  </a>
                </div>
                <div className="w-full px-4 py-3 bg-[#F5F5F7] rounded-2xl flex items-center justify-between text-xs text-[#0B0B0B]">
                  <span className="font-medium">Guest Parking &amp; Gate Check-In Available</span>
                  <span className="font-mono text-[11px] text-[#71717A]">{selectedEvent.time}</span>
                </div>
              </div>

              {/* Event Program Preview (only rendered when organizer configured real schedule blocks) */}
              {eventScheduleBlocks.length > 0 && (
                <div className="bg-white rounded-[28px] p-5 mb-6 shadow-sm">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-base font-semibold text-[#0B0B0B]">
                      {selectedEvent.category} Schedule Preview
                    </h3>
                    <span className="text-[11px] text-[#71717A]">Local Event Time</span>
                  </div>
                  <div className="space-y-2.5">
                    {eventScheduleBlocks.map((item, idx) => (
                      <div
                        key={item.id}
                        className="flex items-start gap-3 p-3 bg-[#F5F5F7] rounded-2xl"
                      >
                        <div
                          className={`px-2.5 py-1 rounded-lg text-[11px] font-mono font-medium shrink-0 tabular-nums ${
                            idx === 0
                              ? 'bg-[#0B0B0B] text-white'
                              : 'bg-[#E8E8EA] text-[#0B0B0B]'
                          }`}
                        >
                          {item.time}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-[13px] font-semibold text-[#0B0B0B] truncate">
                            {item.title}
                          </p>
                          <p className="text-[11px] text-[#71717A]">
                            {item.stage} · {item.lead}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Switch between guest demo and studio */}
              <div className="flex flex-wrap items-center justify-center gap-3 mb-4">
                <button
                  type="button"
                  onClick={() => {
                    setIssuedPass(null);
                    setName('');
                    setEmail('');
                  }}
                  className="px-5 py-2.5 rounded-full bg-white border border-[#E5E5EA] text-xs font-semibold text-[#0B0B0B] hover:border-[#0B0B0B]"
                >
                  Register Another Guest
                </button>
                <button
                  type="button"
                  onClick={onOpenStudio}
                  className="px-5 py-2.5 rounded-full bg-[#0B0B0B] text-white text-xs font-semibold hover:bg-neutral-800"
                >
                  {isSignedIn ? 'View Guest in Creator Studio' : 'Sign In for Creator Studio'}
                </button>
              </div>
            </div>
          )}

          {/* Footer Attribution */}
          <footer className="w-full py-4 flex flex-col items-center justify-center gap-1.5 text-center">
            <span className="text-[11px] text-[#71717A] uppercase tracking-wider">
              Free Public Tier
            </span>
            <span className="text-[11px] text-[#71717A]">
              Powered by <strong className="text-[#0B0B0B] font-semibold">Events App</strong>
            </span>
            {onOpenLegal && (
              <div className="flex items-center gap-4 text-[11px] text-[#71717A] pt-1">
                <button
                  type="button"
                  onClick={() => onOpenLegal('terms')}
                  className="hover:text-[#0B0B0B] underline underline-offset-4 transition-colors"
                >
                  Terms &amp; Conditions
                </button>
                <button
                  type="button"
                  onClick={() => onOpenLegal('privacy')}
                  className="hover:text-[#0B0B0B] underline underline-offset-4 transition-colors"
                >
                  Privacy Policy
                </button>
              </div>
            )}
          </footer>
        </div>
      </main>
    </div>
  );
};
