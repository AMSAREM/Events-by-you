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
  ExternalLink,
  Info,
  Loader2,
  Mail,
  MapPin,
  MessageSquare,
  Navigation,
  Share2,
  ShieldCheck,
  Sparkles,
  User,
  Users,
  Wallet,
} from 'lucide-react';
import { Attendee, EventItem } from '../types/events';
import { normalizePhoneE164 } from '../data/initialData';

interface PublicEventScreenProps {
  events: EventItem[];
  attendees: Attendee[];
  initialEventId?: string;
  initialFocus?: 'top' | 'register';
  isLoadingEvents?: boolean;
  isSignedIn?: boolean;
  hasSetEvent?: boolean;
  onBackHome: () => void;
  onOpenStudio: () => void;
  onNavigateSignUp?: () => void;
  onCreateEvent?: () => void;
  onRegisterAttendee: (eventId: string, attendee: Attendee) => Promise<Attendee | void> | void;
  onOpenDisposableCamera?: (eventId: string, guestName?: string) => void;
  onOpenLegal?: (doc: 'terms' | 'privacy') => void;
}

const FLYER_HERO_IMG =
  'https://lh3.googleusercontent.com/aida-public/AB6AXuDB9p-wUB4rUeDw-qPBezXd-au6s-kM-gfqxbwrCbbDbYE6MeBxdzf76a_Y27WCPgw8EeJ5wz6NyXKtmqVbsQASf4nilIjiEKzwdsXbQOYsl6Ps0KhkLh-jhTUpk9AsXBAD_G9zJlkU8h1qIEz1gtcfUlTzoXNvm_i5jYXMs-FRl_A-HACoNgOlxOHQxKL84gfqzAHZIFJ53hGLIVtH7qy6546LQpWKciLjiSXqD-I';

const VENUE_MAP_CHECKOUT_IMG =
  'https://lh3.googleusercontent.com/aida-public/AB6AXuAoULdwiLk5vifLKQU3hPExsYFMOX1JUca7lT0q-1ANWN3DZUoR-5AYE4Xrx2uTXhWkgXHLohOo76we7qSqHh7LGeGoqqG6u0Z2DkoPC4jIrYUShPUWk6xZbBC-PTfM4fFuA8UR0oMPGZs33VC6niaoGH5fC-h2guWxYesQRy0VVeJABI7-yyGbN38Mdk7dHlWwfDzdCWazRM0CTSJ6R_OOJZV1Z_Ke4AHTRevks4o';

const VENUE_MAP_PASS_IMG =
  'https://lh3.googleusercontent.com/aida-public/AB6AXuB9PUGoGWokVvCQin8gS2PjT3g4Dw73Ei52xLSFPv4pZPuexXIBFAU119C0zgxhIUtjCDjA7SZKN05uKFUnmZTPe5TPN5kqm9sbXkmSz8DFcKJRg03Ew73P9F6KF6mCeN0km8Dg_6Pd3sL_vPc9W09UmvFZFUXw6L2aAwhC9UsruG45RVPeu0ZVAAVyDARcpcvEqfRtShp-eSFuFTRho3zeIAgCfwnLofjtRgP3jUM';

const SPEAKERS = [
  {
    name: 'Dr. Kwame Mensah',
    initials: 'KM',
    role: 'Keynote Speaker',
    topic: 'Future of African Tech Infrastructure',
    time: '10:00 AM',
    avatar:
      'https://lh3.googleusercontent.com/aida-public/AB6AXuBeoR-yxLSnw0P-nvgOpqtrdZtih3y3EVeq8PvCJbph_EasonGO3SYH2M9uNe4pD0rYrw9vJ89OeGkch_U6u6b9-TpWkmbpZZqJ1u6TV4EtLQkIs0Lvh7XSLRHQj0nuBqY_TyeZtUZkx7k4hzGEV1xaH3vOPD12aF_QqI3iw9GpJ0FQTMKNW75BSXEW4YPhb-k5nA3EVsla3qEhqlY6IIIZe95JqhYCd2qk_eJYK_8',
  },
  {
    name: 'Elena Boateng',
    initials: 'EB',
    role: 'VP Engineering · CrossPay',
    topic: 'Scaling FinTech Rails Across Borders',
    time: '01:30 PM',
    avatar:
      'https://lh3.googleusercontent.com/aida-public/AB6AXuDk6U_eY4JjTR8DmIHiI4BA-OkvUNMU79K_Bbu-znhqEv3t9pRCWlrd4FVV4dcguRQWy9fdb4piRlf9IpiJDH1BRezpjCyAoJsCHmVgQch1JETG7PICHWJw8RwyDUrHJQ4WdHiEAhkmYLcagUVoB9NOi8bOFGIsBNyBlSn60-X1BJes2i0pH6si4ctB1zxlA3IQDOjRpvG4QDI_zD8vnyoTDyYK1NjSoKtXqXTyVQo',
  },
  {
    name: 'Josh Mensah',
    initials: 'JM',
    role: 'Lead Systems Architect',
    topic: 'Building Resilient Edge Architectures',
    time: '03:45 PM',
    avatar:
      'https://lh3.googleusercontent.com/aida-public/AB6AXuBu_CFxmr2V2QcEl4w05UAxyeryVNFTuxnOEEK6VillVQtBnwfCjmg_6FwEXL-2RFQ0DGMKjvmsClX7mevWwqImjjbsbjw1rOU5xn82LuaZXjGjt9NlsZG-WP9r74GaGrC24c4nBaAQ-jk9pHY-ibO43dfcPLOczG2DSSPA2kzjTGqV2zmnG-XZLgZqrRhIkCC8A7hHk943IWVYLjILlor-st5pnb0PuHk1S3rMTD0',
  },
];

const COUNTRY_CODES = [
  { code: '+233', flag: '🇬🇭', label: 'GH' },
  { code: '+234', flag: '🇳🇬', label: 'NG' },
  { code: '+254', flag: '🇰🇪', label: 'KE' },
  { code: '+250', flag: '🇷🇼', label: 'RW' },
];

export const PublicEventScreen: React.FC<PublicEventScreenProps> = ({
  events,
  attendees,
  initialEventId,
  initialFocus = 'top',
  isLoadingEvents = false,
  isSignedIn = false,
  hasSetEvent = false,
  onBackHome,
  onOpenStudio,
  onNavigateSignUp,
  onCreateEvent,
  onRegisterAttendee,
  onOpenDisposableCamera,
  onOpenLegal,
}) => {
  const activeEvents = useMemo(
    () => events.filter((e) => e.status === 'live' || e.status === 'upcoming'),
    [events]
  );

  const [selectedEventId, setSelectedEventId] = useState(
    initialEventId || activeEvents[0]?.id || events[0]?.id || ''
  );

  useEffect(() => {
    if (initialEventId && events.some((e) => e.id === initialEventId)) {
      setSelectedEventId(initialEventId);
    } else if (!events.some((e) => e.id === selectedEventId)) {
      setSelectedEventId(activeEvents[0]?.id || events[0]?.id || '');
    }
  }, [initialEventId, events, activeEvents, selectedEventId]);

  const selectedEvent =
    events.find((e) => e.id === selectedEventId) ?? activeEvents[0] ?? events[0];

  useEffect(() => {
    if (initialFocus === 'register' && selectedEvent) {
      const timer = window.setTimeout(() => {
        const el = document.getElementById('register-section');
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }, 60);
      return () => window.clearTimeout(timer);
    }
  }, [initialFocus, selectedEvent]);

  const [name, setName] = useState('');
  const [countryPrefix, setCountryPrefix] = useState('+233');
  const [phoneInput, setPhoneInput] = useState('');
  const [email, setEmail] = useState('');
  const [issuedPass, setIssuedPass] = useState<Attendee | null>(null);
  const [duplicateError, setDuplicateError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [shareToast, setShareToast] = useState(false);
  const [walletSaved, setWalletSaved] = useState(false);

  const [heroFailed, setHeroFailed] = useState(false);
  const [mapFailed, setMapFailed] = useState(false);
  const [speakerFailed, setSpeakerFailed] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setHeroFailed(false);
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

  const handleShare = () => {
    const url = `${window.location.origin}/e/${selectedEvent?.slug ?? 'tech-leaders-summit-2026'}`;
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(url).catch(() => {});
    }
    setShareToast(true);
    setTimeout(() => setShareToast(false), 2600);
  };

  const handleDownloadIcs = () => {
    if (!selectedEvent) return;
    const ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Events App//Africa Tech & Creators//EN',
      'BEGIN:VEVENT',
      `UID:${issuedPass?.ticketCode ?? selectedEvent.slug}@eventsapp.africa`,
      `SUMMARY:${selectedEvent.title}`,
      `LOCATION:${selectedEvent.venue}, ${selectedEvent.city}`,
      `DESCRIPTION:Digital Gate Pass ${issuedPass?.ticketCode ?? ''} · Powered by Events App`,
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedEvent || submitting) return;
    if (!isSignedIn || !hasSetEvent) {
      setDuplicateError(
        !isSignedIn
          ? 'Please sign up first to unlock Check-In Registration.'
          : 'Please create or set an event first to enable Check-In Registration.'
      );
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
    if (selectedEvent.qrPassPublished === false) {
      setDuplicateError('Check-in QR passes have not been published by the event creator yet.');
      return;
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
      organization: 'Fast Pass Attendee',
      eventId: selectedEvent.id,
      tier: 'General',
      checkedIn: false,
      ticketCode: `#${codePrefix}-2026-${randomNum}`,
      smsStatus: 'Arkesel Sent',
      paymentStatus: 'paid',
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
            No published events in Supabase yet
          </h1>
          <p className="text-sm text-[#71717A] leading-relaxed">
            Sign in to Creator Studio to publish an event or load starter events into your Supabase
            database.
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
  const canCheckInRegister = Boolean(isSignedIn && hasSetEvent);
  const isQrPassPublished = selectedEvent.qrPassPublished !== false;
  const occupancyPct = Math.min(
    100,
    Math.round((selectedEvent.registered / Math.max(1, selectedEvent.capacity)) * 100)
  );
  const firstName = issuedPass?.name.split(' ')[0] ?? 'Ama';
  const passInitials = (issuedPass?.name ?? 'Ama Serwaa')
    .split(' ')
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="min-h-dvh w-full max-w-full bg-[#F5F5F7] text-[#1A1C1D] antialiased flex flex-col overflow-x-clip selection:bg-[#0B0B0B] selection:text-white">
      {/* Sticky Top Header matching Mobile Stack Checkout */}
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
              Check-In Registration &amp; QR Pass
            </h1>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {!issuedPass && (
              <select
                value={selectedEvent.id}
                onChange={(e) => {
                  setSelectedEventId(e.target.value);
                  setIssuedPass(null);
                  setDuplicateError(null);
                }}
                aria-label="Select event"
                className="hidden sm:block h-9 max-w-[175px] px-3 rounded-full bg-white border border-[#E5E5EA] text-xs font-semibold text-[#0B0B0B] focus:border-[#0B0B0B] focus:outline-none truncate"
              >
                {activeEvents.map((evt) => (
                  <option key={evt.id} value={evt.id}>
                    /e/{evt.slug}
                  </option>
                ))}
              </select>
            )}
            <button
              type="button"
              onClick={handleShare}
              aria-label="Share Page"
              title="Copy Event Link"
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
              Event link copied to clipboard!
            </div>
          )}

          {!issuedPass ? (
            <>
              {/* Mobile Event Switcher */}
              {activeEvents.length > 1 && (
                <div className="sm:hidden flex items-center justify-between gap-2 bg-white rounded-full px-4 py-2 shadow-sm">
                  <span className="text-[11px] font-semibold text-[#71717A] shrink-0">
                    Event:
                  </span>
                  <select
                    value={selectedEvent.id}
                    onChange={(e) => {
                      setSelectedEventId(e.target.value);
                      setIssuedPass(null);
                      setDuplicateError(null);
                    }}
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

              {/* SCREEN 1: FLYER & HERO CARD */}
              <section className="w-full relative rounded-[32px] overflow-hidden bg-[#0B0B0B] text-white shadow-xl">
                <div className="w-full h-80 relative flex flex-col justify-between p-5">
                  {!heroFailed && (
                    <img
                      src={selectedEvent.flyerUrl || FLYER_HERO_IMG}
                      alt={selectedEvent.title}
                      referrerPolicy="no-referrer"
                      onError={() => setHeroFailed(true)}
                      className="absolute inset-0 w-full h-full object-cover"
                    />
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-[#0B0B0B] via-[#0B0B0B]/45 to-black/25" />

                  {/* Top Badges */}
                  <div className="relative z-10 flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5 bg-white/95 backdrop-blur-md text-[#0B0B0B] text-xs font-semibold px-3.5 py-1.5 rounded-full shadow-sm tabular-nums">
                      <span className="w-2 h-2 rounded-full bg-[#EF4444]" />
                      {spotsRemaining > 0 ? `${spotsRemaining} spots remaining` : 'Waitlist open'}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        document
                          .getElementById('register-section')
                          ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                      }}
                      className="bg-white/95 hover:bg-white text-[#0B0B0B] text-[11px] font-semibold px-3 py-1.5 rounded-full shadow-sm transition-colors"
                    >
                      {!isQrPassPublished
                        ? 'QR Pass Pending'
                        : selectedEvent.ticketPrice === 0
                          ? 'Claim Free Pass ↓'
                          : `Get Pass ($${selectedEvent.ticketPrice}) ↓`}
                    </button>
                  </div>

                  {/* Main Flyer Title & Logistics */}
                  <div className="relative z-10 space-y-1.5">
                    <span className="text-[11px] font-medium text-[#E3E1EC] tracking-widest uppercase block">
                      {selectedEvent.category} · {selectedEvent.organizer}
                    </span>
                    <h2 className="font-display text-[28px] leading-[34px] font-bold text-white tracking-[-0.02em]">
                      {selectedEvent.title}
                    </h2>
                    <div className="pt-1 flex flex-col gap-1 text-[#E8E8EA] text-[13px]">
                      <div className="flex items-center gap-1.5 tabular-nums">
                        <CalendarDays className="w-4 h-4 text-[#E2E2E4] shrink-0" />
                        <span>
                          {selectedEvent.date} · {selectedEvent.time}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <MapPin className="w-4 h-4 text-[#E2E2E4] shrink-0" />
                        <span className="truncate">
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
                      Capacity Status
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

              {/* Event Disposable Camera Launch Card */}
              {onOpenDisposableCamera && (
                <section className="bg-[#0B0B0B] text-white rounded-[28px] p-5 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="flex items-start gap-3.5 min-w-0">
                    <div className="w-11 h-11 rounded-2xl bg-white text-[#0B0B0B] flex items-center justify-center shrink-0">
                      <Camera className="w-5 h-5" />
                    </div>
                    <div className="min-w-0">
                      <h3 className="text-sm font-bold text-white">
                        Shared Event Disposable Camera
                      </h3>
                      <p className="text-xs text-zinc-300 mt-0.5 leading-relaxed">
                        Snap candid 35mm film photos with guests on the shared event camera roll.
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => onOpenDisposableCamera(selectedEvent.id, name.trim() || undefined)}
                    className="w-full sm:w-auto px-4 py-2.5 rounded-full bg-white text-[#0B0B0B] hover:bg-zinc-200 text-xs font-bold inline-flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
                  >
                    <Camera className="w-3.5 h-3.5" />
                    <span>{isSignedIn ? 'Open Camera' : 'Sign In for Camera'}</span>
                  </button>
                </section>
              )}

              {/* Featured Program / Hosts */}
              <section className="space-y-2.5">
                <div className="flex items-center justify-between px-1">
                  <h3 className="text-base font-semibold text-[#0B0B0B]">
                    {selectedEvent.category === 'Wedding'
                      ? 'Officiants & Ceremony Hosts'
                      : selectedEvent.category === 'Funeral'
                        ? 'Tributes & Family Officiants'
                        : selectedEvent.category === 'Church'
                          ? 'Ministers & Choir Leaders'
                          : selectedEvent.category === 'Musical'
                            ? 'Headline Artists & Lineup'
                            : 'Featured Speakers & Hosts'}
                  </h3>
                  <span className="text-[11px] font-medium text-[#71717A]">
                    {SPEAKERS.length} Highlights
                  </span>
                </div>

                {SPEAKERS.map((spk) => (
                  <div
                    key={spk.name}
                    className="bg-white rounded-[24px] p-4 shadow-sm flex items-center gap-4"
                  >
                    {!speakerFailed[spk.name] ? (
                      <img
                        src={spk.avatar}
                        alt={spk.name}
                        referrerPolicy="no-referrer"
                        onError={() =>
                          setSpeakerFailed((prev) => ({ ...prev, [spk.name]: true }))
                        }
                        className="w-14 h-14 rounded-full object-cover shrink-0 bg-[#F5F5F7]"
                      />
                    ) : (
                      <div className="w-14 h-14 rounded-full bg-[#0B0B0B] text-white flex items-center justify-center font-bold text-sm shrink-0">
                        {spk.initials}
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <h4 className="text-base font-semibold text-[#0B0B0B] truncate">
                          {spk.name}
                        </h4>
                        <span className="text-[11px] font-medium bg-[#F3F3F5] text-[#71717A] px-2.5 py-0.5 rounded-full shrink-0 tabular-nums">
                          {spk.time}
                        </span>
                      </div>
                      <p className="text-[11px] text-[#71717A] uppercase tracking-wider truncate mt-0.5">
                        {spk.role}
                      </p>
                      <p className="text-[13px] text-[#444748] mt-0.5 truncate font-medium">
                        {spk.topic}
                      </p>
                    </div>
                  </div>
                ))}
              </section>

              {/* Venue Location Map Preview */}
              <section className="bg-white rounded-[28px] p-5 shadow-sm space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <MapPin className="w-5 h-5 text-[#0B0B0B]" />
                    <h3 className="text-base font-semibold text-[#0B0B0B]">Venue</h3>
                  </div>
                  <a
                    href="https://maps.google.com/?q=Accra+International+Conference+Centre"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs font-semibold text-[#0B0B0B] underline inline-flex items-center gap-1"
                  >
                    <span>Get Directions</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
                <div className="w-full h-44 rounded-2xl relative overflow-hidden bg-[#E8E8EA]">
                  {!mapFailed ? (
                    <img
                      src={VENUE_MAP_CHECKOUT_IMG}
                      alt={`${selectedEvent.venue} map`}
                      referrerPolicy="no-referrer"
                      onError={() => setMapFailed(true)}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-xs text-[#71717A]">
                      {selectedEvent.venue}
                    </div>
                  )}
                  <div className="absolute bottom-2.5 left-2.5 bg-white/95 backdrop-blur-md px-3 py-1 rounded-full flex items-center gap-1.5 shadow-sm">
                    <MapPin className="w-3.5 h-3.5 text-[#EF4444]" />
                    <span className="text-[11px] text-[#0B0B0B] font-semibold">
                      Castle Rd, {selectedEvent.city}
                    </span>
                  </div>
                </div>
              </section>

              {/* Frictionless Registration Card */}
              <section
                id="register-section"
                className="scroll-mt-24 bg-white rounded-[32px] p-6 shadow-md space-y-5"
              >
                {!canCheckInRegister ? (
                  <div className="p-5 rounded-2xl bg-[#F5F5F7] border border-[#E5E5EA] space-y-3 text-center">
                    <div className="w-11 h-11 rounded-2xl bg-[#0B0B0B] text-white flex items-center justify-center mx-auto">
                      <ShieldCheck className="w-5 h-5" />
                    </div>
                    <h3 className="font-display text-lg font-bold text-[#0B0B0B] tracking-tight">
                      {!isSignedIn
                        ? 'Sign Up Required for Check-In Registration'
                        : 'Set Up an Event to Enable Check-In Registration'}
                    </h3>
                    <p className="text-xs text-[#71717A] leading-relaxed max-w-md mx-auto">
                      {!isSignedIn
                        ? 'Check-in registration is only available after signing up and setting up an event.'
                        : 'You are signed in, but no event has been set yet. Create your first event to unlock check-in registration.'}
                    </p>
                    <div className="pt-1 flex justify-center">
                      <button
                        type="button"
                        onClick={() => {
                          if (!isSignedIn && onNavigateSignUp) {
                            onNavigateSignUp();
                          } else if (isSignedIn && onCreateEvent) {
                            onCreateEvent();
                          } else {
                            onOpenStudio();
                          }
                        }}
                        className="px-5 py-2.5 rounded-full bg-[#0B0B0B] hover:bg-neutral-800 text-white text-xs font-semibold transition-colors"
                      >
                        {!isSignedIn ? 'Sign Up to Unlock' : 'Create & Set Event'}
                      </button>
                    </div>
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
                      Only the event creator can publish check-in QR passes. Guest registration and QR pass delivery will open once the creator publishes check-in passes for this event.
                    </p>
                  </div>
                ) : (
                  <>
                <div className="space-y-1">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <div className="inline-flex items-center gap-1 bg-[#F3F3F5] text-[#0B0B0B] text-[11px] font-medium px-2.5 py-0.5 rounded-full">
                      <Bolt className="w-3.5 h-3.5" />
                      <span>Instant Check-In Registration</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        const rand = Math.floor(100 + Math.random() * 899);
                        setName('Yaw Osei');
                        setCountryPrefix('+233');
                        setPhoneInput(`024 778 9${rand}`);
                        setEmail(`yaw.osei${rand}@techhub.gh`);
                        setDuplicateError(null);
                      }}
                      className="text-[11px] font-semibold text-[#71717A] hover:text-[#0B0B0B] underline underline-offset-2"
                    >
                      Fill sample guest
                    </button>
                  </div>
                  <h3 className="font-display text-[22px] leading-7 font-bold text-[#0B0B0B] tracking-[-0.02em]">
                    {spotsRemaining > 0 ? 'Register & Get QR Check-In Pass' : 'Join Priority Waitlist'}
                  </h3>
                  <p className="text-[13px] text-[#71717A]">
                    No password or app required. Your scannable QR gate pass is delivered
                    immediately via SMS &amp; Email.
                  </p>
                </div>

                {duplicateError && (
                  <div className="p-3.5 rounded-2xl bg-[#EF4444]/10 border border-[#EF4444]/30 flex items-center gap-2.5 text-xs font-medium text-[#0B0B0B]">
                    <AlertCircle className="w-4 h-4 text-[#EF4444] shrink-0" />
                    <span>{duplicateError}</span>
                  </div>
                )}

                <form onSubmit={handleSubmit} className="space-y-4">
                  {/* Full Name */}
                  <div className="space-y-1.5">
                    <label
                      className="block text-xs font-semibold text-[#0B0B0B]"
                      htmlFor="checkout-fullName"
                    >
                      Full Name
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
                      Phone Number (For SMS Pass)
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
                      Email Address
                    </label>
                    <div className="relative">
                      <input
                        id="checkout-email"
                        type="email"
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="e.g. ama@techhub.gh"
                        className="w-full h-12 px-4 pr-10 rounded-full bg-[#F5F5F7] text-[#0B0B0B] text-sm placeholder:text-[#71717A] focus:outline-none focus:bg-white focus:ring-1 focus:ring-[#0B0B0B] transition-colors"
                      />
                      <Mail className="w-4 h-4 text-[#71717A] absolute right-4 top-4 pointer-events-none" />
                    </div>
                  </div>

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
                          ? 'Register Free Pass'
                          : `Claim Pass ($${selectedEvent.ticketPrice})`}
                    </span>
                    <ArrowRight className="w-5 h-5" />
                  </button>
                </form>
                  </>
                )}
              </section>
            </>
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
                    <span className="inline-block px-2.5 py-0.5 rounded-full bg-[#0B0B0B] text-white text-[11px] font-medium tracking-wider uppercase mb-1.5">
                      Fast Pass Attendee
                    </span>
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
                    <span className="text-[11px] text-[#71717A] block">Access Level</span>
                    <span className="text-xs font-semibold text-[#0B0B0B]">
                      Main + VIP Lounge
                    </span>
                  </div>
                </div>

                {/* QR Code Section */}
                <div className="relative flex flex-col items-center justify-center p-4 bg-[#F9F9FB] rounded-2xl mb-4">
                  <div className="relative p-3 bg-white rounded-2xl shadow-sm">
                    <div className="absolute top-1 left-1 w-3 h-3 border-t-2 border-l-2 border-[#0B0B0B]" />
                    <div className="absolute top-1 right-1 w-3 h-3 border-t-2 border-r-2 border-[#0B0B0B]" />
                    <div className="absolute bottom-1 left-1 w-3 h-3 border-b-2 border-l-2 border-[#0B0B0B]" />
                    <div className="absolute bottom-1 right-1 w-3 h-3 border-b-2 border-r-2 border-[#0B0B0B]" />
                    <svg
                      className="w-36 h-36"
                      fill="none"
                      viewBox="0 0 160 160"
                      aria-hidden="true"
                    >
                      <rect fill="#0B0B0B" height="40" rx="4" width="40" x="10" y="10" />
                      <rect fill="white" height="24" rx="2" width="24" x="18" y="18" />
                      <rect fill="#0B0B0B" height="12" rx="1" width="12" x="24" y="24" />
                      <rect fill="#0B0B0B" height="40" rx="4" width="40" x="110" y="10" />
                      <rect fill="white" height="24" rx="2" width="24" x="118" y="18" />
                      <rect fill="#0B0B0B" height="12" rx="1" width="12" x="124" y="24" />
                      <rect fill="#0B0B0B" height="40" rx="4" width="40" x="10" y="110" />
                      <rect fill="white" height="24" rx="2" width="24" x="18" y="118" />
                      <rect fill="#0B0B0B" height="12" rx="1" width="12" x="24" y="124" />
                      <rect fill="#0B0B0B" height="8" rx="2" width="8" x="60" y="12" />
                      <rect fill="#0B0B0B" height="8" rx="2" width="8" x="76" y="12" />
                      <rect fill="#0B0B0B" height="8" rx="2" width="8" x="92" y="12" />
                      <rect fill="#0B0B0B" height="8" rx="2" width="8" x="60" y="28" />
                      <rect fill="#0B0B0B" height="8" rx="2" width="8" x="84" y="28" />
                      <rect fill="#0B0B0B" height="8" rx="2" width="8" x="68" y="44" />
                      <rect fill="#0B0B0B" height="8" rx="2" width="8" x="84" y="44" />
                      <rect fill="#0B0B0B" height="8" rx="2" width="8" x="12" y="60" />
                      <rect fill="#0B0B0B" height="8" rx="2" width="8" x="28" y="60" />
                      <rect fill="#0B0B0B" height="8" rx="2" width="8" x="44" y="60" />
                      <rect fill="#0B0B0B" height="8" rx="2" width="16" x="60" y="60" />
                      <rect fill="#0B0B0B" height="8" rx="2" width="8" x="84" y="60" />
                      <rect fill="#0B0B0B" height="8" rx="2" width="8" x="100" y="60" />
                      <rect fill="#0B0B0B" height="8" rx="2" width="8" x="116" y="60" />
                      <rect fill="#0B0B0B" height="8" rx="2" width="16" x="132" y="60" />
                      <rect fill="#0B0B0B" height="8" rx="2" width="8" x="28" y="76" />
                      <rect fill="#0B0B0B" height="8" rx="2" width="16" x="52" y="76" />
                      <rect fill="#0B0B0B" height="8" rx="2" width="8" x="76" y="76" />
                      <rect fill="#0B0B0B" height="8" rx="2" width="16" x="92" y="76" />
                      <rect fill="#0B0B0B" height="8" rx="2" width="8" x="124" y="76" />
                      <rect fill="#0B0B0B" height="8" rx="2" width="16" x="12" y="92" />
                      <rect fill="#0B0B0B" height="8" rx="2" width="8" x="36" y="92" />
                      <rect fill="#0B0B0B" height="8" rx="2" width="8" x="60" y="92" />
                      <rect fill="#0B0B0B" height="8" rx="2" width="8" x="84" y="92" />
                      <rect fill="#0B0B0B" height="8" rx="2" width="16" x="108" y="92" />
                      <rect fill="#0B0B0B" height="8" rx="2" width="8" x="132" y="92" />
                      <rect fill="#0B0B0B" height="8" rx="2" width="8" x="60" y="108" />
                      <rect fill="#0B0B0B" height="8" rx="2" width="16" x="76" y="108" />
                      <rect fill="#0B0B0B" height="8" rx="2" width="8" x="100" y="108" />
                      <rect fill="#0B0B0B" height="8" rx="2" width="8" x="116" y="108" />
                      <rect fill="#0B0B0B" height="8" rx="2" width="8" x="68" y="124" />
                      <rect fill="#0B0B0B" height="8" rx="2" width="8" x="84" y="124" />
                      <rect fill="#0B0B0B" height="8" rx="2" width="16" x="108" y="124" />
                      <rect fill="#0B0B0B" height="8" rx="2" width="8" x="132" y="124" />
                      <rect fill="#0B0B0B" height="8" rx="2" width="16" x="60" y="140" />
                      <rect fill="#0B0B0B" height="8" rx="2" width="8" x="92" y="140" />
                      <rect fill="#0B0B0B" height="8" rx="2" width="16" x="116" y="140" />
                    </svg>
                  </div>
                  <p className="text-[11px] text-[#71717A] mt-2 tracking-wide uppercase">
                    Scan for instant badge print
                  </p>
                </div>

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
                        Castle Rd, {selectedEvent.city} · Main Gate 2
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
                    onClick={() => onOpenDisposableCamera(selectedEvent.id, issuedPass.name)}
                    className="w-full h-12 bg-[#0B0B0B] text-white rounded-full flex items-center justify-center gap-2 hover:bg-neutral-800 transition-colors shadow-sm text-sm font-semibold"
                  >
                    <Camera className="w-4.5 h-4.5" />
                    <span>
                      {isSignedIn
                        ? 'Snap Photos on Disposable Camera'
                        : 'Sign In to Use Disposable Camera'}
                    </span>
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
                  <span>Share Event Pass Link</span>
                </button>
              </div>

              {/* Venue & Arrival Card */}
              <div className="bg-white rounded-[28px] p-5 mb-6 shadow-sm overflow-hidden">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h3 className="text-base font-semibold text-[#0B0B0B]">Venue &amp; Arrival</h3>
                    <p className="text-[11px] text-[#71717A]">{selectedEvent.venue}</p>
                  </div>
                  <a
                    href={`https://maps.google.com/?q=${encodeURIComponent(selectedEvent.venue)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="Directions"
                    className="w-8 h-8 rounded-full bg-[#F5F5F7] flex items-center justify-center text-[#0B0B0B] hover:bg-[#EEEEF0]"
                  >
                    <Navigation className="w-4 h-4" />
                  </a>
                </div>
                <div className="w-full h-36 bg-[#E8E8EA] rounded-2xl relative overflow-hidden">
                  <img
                    src={VENUE_MAP_PASS_IMG}
                    alt="Venue Arrival Map"
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute inset-0 bg-[#0B0B0B]/10" />
                  <div className="absolute bottom-2 left-2 bg-[#0B0B0B]/85 backdrop-blur-md px-3 py-1 rounded-full text-white text-[11px] font-medium">
                    Guest Parking &amp; Gate Check-In Available
                  </div>
                </div>
              </div>

              {/* Event Program Preview */}
              <div className="bg-white rounded-[28px] p-5 mb-6 shadow-sm">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-base font-semibold text-[#0B0B0B]">
                    {selectedEvent.category} Schedule Preview
                  </h3>
                  <span className="text-[11px] text-[#71717A]">Local Event Time</span>
                </div>
                <div className="space-y-2.5">
                  {(selectedEvent.category === 'Wedding'
                    ? [
                        { time: '10:00 AM', title: 'Guest Arrival & Processional', meta: 'Main Sanctuary · Ushers & String Quartet', active: true },
                        { time: '11:30 AM', title: 'Exchange of Vows & Blessing', meta: 'Altar · Ceremony Officiants', active: false },
                        { time: '02:00 PM', title: 'Grand Reception & Dinner Banquet', meta: 'Garden Pavilion · Live Band', active: false },
                      ]
                    : selectedEvent.category === 'Funeral'
                    ? [
                        { time: '07:30 AM', title: 'Filing Past & Laying in State', meta: 'Memorial Hall · Family Reception', active: true },
                        { time: '09:30 AM', title: 'Memorial Service & Tributes', meta: 'Main Forecourt · Officiating Clergy', active: false },
                        { time: '01:00 PM', title: 'Thanksgiving & Refreshments', meta: 'Family Grounds · Traditional Ensemble', active: false },
                      ]
                    : selectedEvent.category === 'Church'
                    ? [
                        { time: '05:30 PM', title: 'Doors Open & Prayer Watch', meta: 'Main Auditorium · Intercessory Team', active: true },
                        { time: '06:30 PM', title: 'Mass Choir Worship Ministration', meta: 'Sanctuary Stage · Praise & Worship', active: false },
                        { time: '08:00 PM', title: 'Keynote Word & Altar Ministration', meta: 'Main Altar · Guest Minister', active: false },
                      ]
                    : selectedEvent.category === 'Musical'
                    ? [
                        { time: '06:00 PM', title: 'Gate Entry & Soundcheck Lounge', meta: 'VIP & General Concourse · DJ Opening Set', active: true },
                        { time: '08:00 PM', title: 'Live Acoustic & Backing Band', meta: 'Main Stage · Supporting Acts', active: false },
                        { time: '10:00 PM', title: 'Headliner Live Performance', meta: 'Arena Stage · Full Production Finale', active: false },
                      ]
                    : selectedEvent.category === 'Corporate'
                    ? [
                        { time: '05:30 PM', title: 'Executive Red Carpet & Cocktails', meta: 'Atrium Foyer · Press & Leadership', active: true },
                        { time: '07:00 PM', title: 'Annual Address & Dinner Service', meta: 'Grand Ballroom · Executive Board', active: false },
                        { time: '08:45 PM', title: 'Industry Excellence Awards', meta: 'Main Podium · Presentation & Gala', active: false },
                      ]
                    : [
                        { time: '10:00 AM', title: 'Opening Keynote & Welcome', meta: 'Main Auditorium · Lead Host', active: true },
                        { time: '01:30 PM', title: 'Featured Panel & Live Showcase', meta: 'Hall B · Guest Speakers', active: false },
                        { time: '03:45 PM', title: 'Closing Fireside & Networking', meta: 'Executive Stage · Q&A Session', active: false },
                      ]
                  ).map((item) => (
                    <div
                      key={item.time}
                      className="flex items-start gap-3 p-3 bg-[#F5F5F7] rounded-2xl"
                    >
                      <div
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-mono font-medium shrink-0 tabular-nums ${
                          item.active
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
                        <p className="text-[11px] text-[#71717A]">{item.meta}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

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
