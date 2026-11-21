import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Camera,
  CameraOff,
  Check,
  CheckCircle2,
  Copy,
  Download,
  ExternalLink,
  QrCode,
  RotateCcw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import {
  Attendee,
  AttendeeTier,
  EventItem,
  OrganizerProfile,
  SystemAlert,
} from '../types/events';
import { getCategoryPreset, normalizePhoneE164 } from '../data/initialData';
import { buildCameraLinkForOrigin } from '../lib/eventMessages';
import { DeterministicQrSvg, downloadQrSvg } from '../lib/qr';
import { CircularGauge } from './MonochromeArtwork';
import { TopUtilityBar } from './TopUtilityBar';

interface QrGateScannerScreenProps {
  events: EventItem[];
  attendees: Attendee[];
  alerts: SystemAlert[];
  profile: OrganizerProfile;
  initialEventId?: string;
  initialCode?: string;
  onToggleCheckIn: (
    attendeeId: string
  ) => Promise<{
    checkInMessageSent?: boolean;
    checkInSmsSent?: boolean;
    cameraUrl?: string;
    dispatchedMessage?: string;
    smsSkippedReason?: string;
  } | void> | void;
  onRegisterAttendee: (eventId: string, attendee: Attendee) => void;
  onToggleQrPassPublished?: (eventId: string, published: boolean) => Promise<void> | void;
  onManageEvent: (event: EventItem) => void;
  onNavigateSettings: () => void;
  onResolveAlert: (id: string) => void;
}

type ScanOutcome =
  | {
      status: 'verified';
      attendee: Attendee;
      eventTitle: string;
      message: string;
      cameraUrl?: string;
      timestamp: string;
    }
  | {
      status: 'duplicate';
      attendee: Attendee;
      eventTitle: string;
      message: string;
      timestamp: string;
    }
  | {
      status: 'not-found';
      query: string;
      message: string;
      timestamp: string;
    };

export const QrGateScannerScreen: React.FC<QrGateScannerScreenProps> = ({
  events,
  attendees,
  alerts,
  profile,
  initialEventId,
  initialCode,
  onToggleCheckIn,
  onRegisterAttendee,
  onToggleQrPassPublished,
  onManageEvent,
  onNavigateSettings,
  onResolveAlert,
}) => {
  const activePool = useMemo(() => {
    const liveOrUpcoming = events.filter((e) => e.status === 'live' || e.status === 'upcoming');
    return liveOrUpcoming.length > 0 ? liveOrUpcoming : events;
  }, [events]);

  const [selectedEventId, setSelectedEventId] = useState<string>(
    initialEventId && events.some((e) => e.id === initialEventId)
      ? initialEventId
      : activePool[0]?.id ?? events[0]?.id ?? ''
  );

  useEffect(() => {
    if (initialEventId && events.some((e) => e.id === initialEventId)) {
      setSelectedEventId(initialEventId);
    }
  }, [initialEventId, events]);

  const selectedEvent =
    events.find((e) => e.id === selectedEventId) ?? activePool[0] ?? events[0];
  const isEventCreator = profile.appRole !== 'gate_staff';
  const isQrPassPublished = selectedEvent ? selectedEvent.qrPassPublished !== false : false;

  const [codeInput, setCodeInput] = useState(initialCode ?? '');
  const [searchQuery, setSearchQuery] = useState('');
  const [rosterFilter, setRosterFilter] = useState<'pending' | 'checked' | 'all'>('pending');
  const [lastOutcome, setLastOutcome] = useState<ScanOutcome | null>(null);
  const [scanHistory, setScanHistory] = useState<ScanOutcome[]>([]);

  // Real camera + BarcodeDetector state
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [detectorSupported, setDetectorSupported] = useState(false);

  const activeValidationCircles = useMemo<string[]>(() => {
    if (!selectedEvent) return ['Invited Guest'];
    return (
      selectedEvent.validationConfig?.options ??
      getCategoryPreset(selectedEvent.category).validationConfig.options
    );
  }, [selectedEvent]);

  // Walk-In Gate Registration Form state
  const walkInSectionRef = useRef<HTMLElement | null>(null);
  const walkInNameInputRef = useRef<HTMLInputElement | null>(null);
  const [walkInName, setWalkInName] = useState('');
  const [walkInPhone, setWalkInPhone] = useState('');
  const [walkInEmail, setWalkInEmail] = useState('');
  const [walkInOrg, setWalkInOrg] = useState('');
  const [walkInTier, setWalkInTier] = useState<AttendeeTier>('General');
  const [walkInValidationGroup, setWalkInValidationGroup] = useState<string>(
    activeValidationCircles[0] ?? 'Invited Guest'
  );
  const [walkInAutoCheckIn, setWalkInAutoCheckIn] = useState(true);
  const [walkInSuccess, setWalkInSuccess] = useState<Attendee | null>(null);

  const focusWalkInRegistration = () => {
    walkInSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    window.setTimeout(() => {
      walkInNameInputRef.current?.focus();
    }, 220);
  };

  useEffect(() => {
    if (activeValidationCircles.length > 0 && !activeValidationCircles.includes(walkInValidationGroup)) {
      setWalkInValidationGroup(activeValidationCircles[0]);
    }
  }, [activeValidationCircles, walkInValidationGroup]);

  // QR Preview Modal for an attendee
  const [previewPass, setPreviewPass] = useState<Attendee | null>(null);

  const eventAttendees = useMemo(
    () => attendees.filter((a) => !selectedEvent || a.eventId === selectedEvent.id),
    [attendees, selectedEvent]
  );

  const checkedInCount = useMemo(
    () => eventAttendees.filter((a) => a.checkedIn).length,
    [eventAttendees]
  );

  const pendingAttendees = useMemo(
    () => eventAttendees.filter((a) => !a.checkedIn),
    [eventAttendees]
  );

  const turnoutPct =
    eventAttendees.length > 0 ? Math.round((checkedInCount / eventAttendees.length) * 100) : 0;

  const filteredRoster = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return eventAttendees.filter((att) => {
      const matchesStatus =
        rosterFilter === 'all' ||
        (rosterFilter === 'checked' ? att.checkedIn : !att.checkedIn);
      const matchesSearch =
        !q ||
        att.name.toLowerCase().includes(q) ||
        att.ticketCode.toLowerCase().includes(q) ||
        att.phone.toLowerCase().includes(q) ||
        att.organization.toLowerCase().includes(q);
      return matchesStatus && matchesSearch;
    });
  }, [eventAttendees, rosterFilter, searchQuery]);

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
  };

  useEffect(() => {
    setDetectorSupported(typeof window !== 'undefined' && 'BarcodeDetector' in window);
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  const verifyAndProcessCode = (rawInput: string) => {
    const cleaned = rawInput.trim().toLowerCase();
    if (!cleaned) return;

    const nowTime = new Date().toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });

    // Search within selected event first, then across all events
    const normalizedQuery = cleaned.replace(/^#/, '');
    const matchInSelected = eventAttendees.find(
      (a) =>
        a.ticketCode.toLowerCase().replace(/^#/, '') === normalizedQuery ||
        a.phone.replace(/\s+/g, '').toLowerCase() === cleaned.replace(/\s+/g, '') ||
        a.name.toLowerCase() === cleaned
    );

    const matchAny =
      matchInSelected ||
      attendees.find(
        (a) =>
          a.ticketCode.toLowerCase().replace(/^#/, '') === normalizedQuery ||
          a.phone.replace(/\s+/g, '').toLowerCase() === cleaned.replace(/\s+/g, '')
      );

    if (!matchAny) {
      const outcome: ScanOutcome = {
        status: 'not-found',
        query: rawInput.trim(),
        message: `No pass found matching "${rawInput.trim()}". Use the Check-In Registration panel to issue a walk-in QR pass immediately.`,
        timestamp: nowTime,
      };
      setLastOutcome(outcome);
      setScanHistory((prev) => [outcome, ...prev].slice(0, 8));
      return;
    }

    const evtTitle =
      events.find((e) => e.id === matchAny.eventId)?.title ?? selectedEvent?.title ?? 'Event';

    if (matchAny.checkedIn) {
      const outcome: ScanOutcome = {
        status: 'duplicate',
        attendee: matchAny,
        eventTitle: evtTitle,
        message: `Anti-passback alert: ${matchAny.name} (${matchAny.ticketCode}) already checked in at ${matchAny.checkedInAt ?? 'earlier'}.`,
        timestamp: nowTime,
      };
      setLastOutcome(outcome);
      setScanHistory((prev) => [outcome, ...prev].slice(0, 8));
      return;
    }

    // Valid unchecked pass -> Check them in immediately & dispatch check-in SMS + camera link!
    const fallbackEvt = events.find((e) => e.id === matchAny.eventId) ?? selectedEvent;
    const fallbackCameraUrl = fallbackEvt
      ? buildCameraLinkForOrigin(
          fallbackEvt.slug || fallbackEvt.id,
          undefined,
          matchAny.name,
          matchAny.ticketCode
        )
      : undefined;

    const updatedAttendee: Attendee = {
      ...matchAny,
      checkedIn: true,
      checkedInAt: nowTime.slice(0, 5),
    };
    const initialOutcome: ScanOutcome = {
      status: 'verified',
      attendee: updatedAttendee,
      eventTitle: evtTitle,
      message: `Access Granted — ${matchAny.name} (${matchAny.tier} Pass) checked in.${
        profile.smsCredits > 0
          ? ' Dispatching welcome SMS + Disposable Camera link...'
          : ' Checking SMS bundle balance...'
      }`,
      cameraUrl: fallbackCameraUrl,
      timestamp: nowTime,
    };
    setLastOutcome(initialOutcome);
    setScanHistory((prev) => [initialOutcome, ...prev].slice(0, 8));
    setCodeInput('');

    void Promise.resolve(onToggleCheckIn(matchAny.id)).then((res) => {
      if (!res) return;
      const updatedMessage = res.checkInSmsSent
        ? `Access Granted — ${matchAny.name} (${matchAny.tier} Pass) checked in. Check-in welcome SMS + Disposable Camera link sent.`
        : res.smsSkippedReason
          ? `Access Granted — ${matchAny.name} (${matchAny.tier} Pass) checked in. SMS not sent: ${res.smsSkippedReason}`
          : res.checkInMessageSent
            ? `Access Granted — ${matchAny.name} (${matchAny.tier} Pass) checked in. Check-in email + Disposable Camera link sent.`
            : `Access Granted — ${matchAny.name} (${matchAny.tier} Pass) checked in.`;
      const enriched: ScanOutcome = {
        ...initialOutcome,
        cameraUrl: res.cameraUrl || initialOutcome.cameraUrl,
        message: updatedMessage,
      };
      setLastOutcome(enriched);
    });
  };

  useEffect(() => {
    if (initialCode) {
      verifyAndProcessCode(initialCode);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialCode]);

  // BarcodeDetector loop when camera is live
  useEffect(() => {
    if (!cameraActive || !detectorSupported) return;
    let cancelled = false;
    let timerId: number | undefined;

    const scanFrame = async () => {
      if (cancelled || !videoRef.current || videoRef.current.readyState < 2) {
        if (!cancelled) timerId = window.setTimeout(scanFrame, 350);
        return;
      }
      try {
        // @ts-expect-error BarcodeDetector is a progressive browser API
        const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
        const codes = await detector.detect(videoRef.current);
        if (codes && codes.length > 0 && codes[0].rawValue) {
          const detectedValue = String(codes[0].rawValue).trim();
          if (detectedValue) {
            setCodeInput(detectedValue);
            verifyAndProcessCode(detectedValue);
            timerId = window.setTimeout(scanFrame, 1800);
            return;
          }
        }
      } catch {
        // Ignore single frame detection error
      }
      if (!cancelled) {
        timerId = window.setTimeout(scanFrame, 350);
      }
    };

    timerId = window.setTimeout(scanFrame, 400);
    return () => {
      cancelled = true;
      if (timerId) window.clearTimeout(timerId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraActive, detectorSupported, selectedEventId, attendees]);

  const startCamera = async () => {
    setCameraError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError(
        'Camera access is unavailable in this browser context. Use manual QR code / pass lookup or instant guest scan below.'
      );
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      });
      streamRef.current = stream;
      setCameraActive(true);
      requestAnimationFrame(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => {});
        }
      });
    } catch {
      setCameraError(
        'Camera permission denied or no webcam detected. Enter a pass code or tap any pending guest below to verify immediately.'
      );
    }
  };

  const handleScanSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    verifyAndProcessCode(codeInput);
  };

  const handleWalkInSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedEvent || !walkInName.trim() || !walkInPhone.trim()) return;

    const normalized = normalizePhoneE164(walkInPhone);
    const codePrefix = selectedEvent.category.slice(0, 2).toUpperCase() || 'EV';
    const code = `${codePrefix}-${Math.floor(1000 + Math.random() * 8999)}`;
    const nowTime = new Date().toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
    });

    const created: Attendee = {
      id: `att-${Date.now()}`,
      eventId: selectedEvent.id,
      name: walkInName.trim(),
      email:
        walkInEmail.trim() ||
        `${walkInName.trim().toLowerCase().replace(/\s+/g, '.')}@guest.eventsapp.africa`,
      phone: normalized,
      organization: walkInOrg.trim() || `${selectedEvent.category} Walk-In`,
      tier: walkInTier,
      ticketCode: code,
      checkedIn: walkInAutoCheckIn,
      checkedInAt: walkInAutoCheckIn ? nowTime : undefined,
      paymentStatus: 'paid',
      smsStatus: 'Arkesel Sent',
      validationGroup: walkInValidationGroup || activeValidationCircles[0],
    };

    onRegisterAttendee(selectedEvent.id, created);
    setWalkInSuccess(created);
    setWalkInName('');
    setWalkInPhone('');
    setWalkInEmail('');
    setWalkInOrg('');

    if (walkInAutoCheckIn) {
      const walkInCameraUrl = buildCameraLinkForOrigin(
        selectedEvent.slug || selectedEvent.id,
        undefined,
        created.name,
        created.ticketCode
      );
      const outcome: ScanOutcome = {
        status: 'verified',
        attendee: created,
        eventTitle: selectedEvent.title,
        message: `Walk-In Registered & Checked In — QR Pass ${code} & Disposable Camera link sent via Arkesel SMS.`,
        cameraUrl: walkInCameraUrl,
        timestamp: nowTime,
      };
      setLastOutcome(outcome);
      setScanHistory((prev) => [outcome, ...prev].slice(0, 8));
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Header & Utility Bar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-[28px] sm:text-[34px] font-bold tracking-[-0.02em] text-[#0B0B0B]">
            Gate Check-In &amp; QR Scanner
          </h1>
          <p className="text-sm text-[#71717A] mt-0.5">
            Scan digital QR passes, enforce anti-passback, and register walk-in guests on the spot.
          </p>
        </div>

        <div className="lg:w-[440px]">
          <TopUtilityBar
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            searchPlaceholder="Filter gate roster or pass code..."
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

      {/* Active Event Context & Live Throughput Bar */}
      {selectedEvent && (
        <section className="p-5 sm:p-6 rounded-3xl bg-[#F5F5F7] flex flex-col lg:flex-row lg:items-center justify-between gap-5">
          <div className="flex flex-col sm:flex-row sm:items-center gap-4 min-w-0">
            <div className="w-12 h-12 rounded-2xl bg-[#0B0B0B] text-white flex items-center justify-center shrink-0">
              <QrCode className="w-6 h-6" />
            </div>
            <div className="min-w-0 flex-1">
              <label htmlFor="scanner-event-select" className="block text-[11px] font-semibold text-[#71717A]">
                Active Gate Event ({selectedEvent.category} · {selectedEvent.city})
              </label>
              <select
                id="scanner-event-select"
                value={selectedEvent.id}
                onChange={(e) => {
                  setSelectedEventId(e.target.value);
                  setLastOutcome(null);
                }}
                className="mt-1 w-full sm:w-auto max-w-full h-10 px-4 rounded-full bg-white border border-[#E5E5EA] text-sm font-bold text-[#0B0B0B] focus:border-[#0B0B0B] focus:outline-none cursor-pointer"
              >
                {events.map((evt) => (
                  <option key={evt.id} value={evt.id}>
                    {evt.title} ({evt.category})
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-6 shrink-0">
            <div className="flex items-center gap-3">
              <CircularGauge value={turnoutPct} size={48} strokeWidth={4.5} alertThreshold={101} />
              <div>
                <p className="text-sm font-bold text-[#0B0B0B] tabular-nums">
                  {checkedInCount} / {eventAttendees.length} Checked In
                </p>
                <p className="text-xs text-[#71717A] tabular-nums">
                  {pendingAttendees.length} pending arrival · {turnoutPct}% turnout
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                onClick={focusWalkInRegistration}
                className="px-4 py-2 rounded-full bg-[#0B0B0B] text-white hover:bg-zinc-800 text-xs font-bold inline-flex items-center gap-1.5 shadow-sm transition-colors whitespace-nowrap shrink-0"
              >
                <UserPlus className="w-3.5 h-3.5" />
                Walk-In Check-In Registration
              </button>
              <span
                className={`px-3 py-1.5 rounded-full text-[11px] font-semibold border whitespace-nowrap ${
                  isQrPassPublished
                    ? 'bg-white border-[#E5E5EA] text-[#0B0B0B]'
                    : 'bg-[#0B0B0B] border-[#0B0B0B] text-white'
                }`}
              >
                {isQrPassPublished ? 'QR Pass Published' : 'QR Pass Unpublished'}
              </span>
              {isEventCreator && onToggleQrPassPublished && (
                <button
                  type="button"
                  disabled={selectedEvent.status === 'draft'}
                  onClick={() =>
                    void onToggleQrPassPublished(selectedEvent.id, !isQrPassPublished)
                  }
                  className="px-4 py-2 rounded-full bg-white border border-[#E5E5EA] hover:border-[#0B0B0B] text-xs font-semibold text-[#0B0B0B] transition-colors whitespace-nowrap shrink-0 disabled:opacity-40"
                >
                  {isQrPassPublished ? 'Unpublish QR' : 'Publish QR Pass'}
                </button>
              )}
              <button
                type="button"
                onClick={() => onManageEvent(selectedEvent)}
                className="px-4 py-2 rounded-full bg-white border border-[#E5E5EA] hover:border-[#0B0B0B] text-xs font-semibold text-[#0B0B0B] transition-colors whitespace-nowrap shrink-0"
              >
                Open Event Workspace
              </button>
            </div>
          </div>
        </section>
      )}

      {/* MAIN COMMAND SPLIT: QR CODE SCANNER (Left 6 cols) + WALK-IN CHECK-IN REGISTRATION (Right 6 cols) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        {/* LEFT 6 COLS: QR Code Scanner & Instant Pass Verification */}
        <section className="lg:col-span-6 bg-[#0B0B0B] text-white rounded-3xl p-6 sm:p-7 flex flex-col justify-between gap-5">
          <div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-white/10 flex items-center justify-center">
                  <Camera className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h2 className="font-display text-lg sm:text-xl font-bold tracking-tight">
                    QR Code Gate Scanner
                  </h2>
                  <p className="text-xs text-zinc-400">
                    Camera QR decode, instant pass-code lookup &amp; duplicate anti-passback check
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={cameraActive ? stopCamera : startCamera}
                className={`px-4 py-2 rounded-full text-xs font-semibold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 ${
                  cameraActive
                    ? 'bg-[#EF4444] text-white hover:bg-red-600'
                    : 'bg-white text-[#0B0B0B] hover:bg-zinc-200'
                }`}
              >
                {cameraActive ? (
                  <>
                    <CameraOff className="w-3.5 h-3.5" />
                    Stop Camera
                  </>
                ) : (
                  <>
                    <Camera className="w-3.5 h-3.5" />
                    Start Camera Scanner
                  </>
                )}
              </button>
            </div>

            {/* Camera Viewfinder Frame */}
            <div className="mt-5 relative rounded-2xl bg-zinc-900 border border-white/10 overflow-hidden min-h-[210px] flex items-center justify-center">
              {cameraActive ? (
                <>
                  <video
                    ref={videoRef}
                    muted
                    playsInline
                    className="w-full h-56 object-cover"
                  />
                  {/* Reticle overlay */}
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div className="w-40 h-40 rounded-2xl border-2 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)] relative">
                      <span className="absolute -bottom-7 left-1/2 -translate-x-1/2 text-[11px] font-mono text-white whitespace-nowrap bg-[#0B0B0B]/80 px-2.5 py-0.5 rounded-full">
                        {detectorSupported
                          ? 'Point at guest QR pass'
                          : 'Camera active — enter code below'}
                      </span>
                    </div>
                  </div>
                </>
              ) : (
                <div className="p-6 text-center max-w-md space-y-3">
                  <div className="w-16 h-16 rounded-2xl bg-white/10 border border-white/15 mx-auto flex items-center justify-center">
                    <QrCode className="w-8 h-8 text-white" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-white">
                      Ready to scan attendee QR passes
                    </p>
                    <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
                      {cameraError
                        ? cameraError
                        : 'Click "Start Camera Scanner" to use your webcam/phone camera, or scan/type any pass code below.'}
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Manual Pass Code / USB Scanner Input */}
            <form onSubmit={handleScanSubmit} className="mt-4 flex flex-col sm:flex-row gap-2.5">
              <div className="relative flex-1">
                <QrCode className="w-4 h-4 text-zinc-400 absolute left-4 top-3.5 pointer-events-none" />
                <input
                  type="text"
                  value={codeInput}
                  onChange={(e) => setCodeInput(e.target.value)}
                  placeholder="Enter or scan pass code (e.g. EV-8801), phone, or name..."
                  aria-label="Pass code or attendee search"
                  className="w-full h-11 pl-11 pr-4 rounded-full bg-white/10 border border-white/15 text-sm font-mono text-white placeholder:text-zinc-400 focus:bg-white focus:text-[#0B0B0B] focus:outline-none transition-colors"
                />
              </div>
              <button
                type="submit"
                className="h-11 px-6 rounded-full bg-white text-[#0B0B0B] text-xs font-bold hover:bg-zinc-200 transition-colors whitespace-nowrap shrink-0"
              >
                Verify &amp; Check In
              </button>
            </form>

            {/* Quick-Scan Pending Guest Chips */}
            {pendingAttendees.length > 0 && (
              <div className="mt-4">
                <span className="text-[11px] font-medium text-zinc-400 block mb-2">
                  Quick Scan Pending Passes ({pendingAttendees.length} waiting at gate):
                </span>
                <div className="flex flex-wrap gap-2">
                  {pendingAttendees.slice(0, 4).map((att) => (
                    <button
                      key={att.id}
                      type="button"
                      onClick={() => verifyAndProcessCode(att.ticketCode)}
                      className="px-3 py-1.5 rounded-full bg-white/10 hover:bg-white hover:text-[#0B0B0B] text-xs font-medium text-white transition-colors inline-flex items-center gap-1.5 whitespace-nowrap"
                    >
                      <QrCode className="w-3 h-3" />
                      <span className="font-mono">{att.ticketCode}</span>
                      <span aria-hidden="true">·</span>
                      <span>{att.name.split(' ')[0]}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Scan Result Output Banner */}
          {lastOutcome && (
            <div
              className={`p-4 rounded-2xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                lastOutcome.status === 'verified'
                  ? 'bg-emerald-500/15 border-emerald-400/40 text-white'
                  : lastOutcome.status === 'duplicate'
                    ? 'bg-amber-500/15 border-amber-400/40 text-white'
                    : 'bg-[#EF4444]/15 border-[#EF4444]/40 text-white'
              }`}
            >
              <div className="flex items-start gap-3 min-w-0">
                {lastOutcome.status === 'verified' ? (
                  <ShieldCheck className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
                ) : lastOutcome.status === 'duplicate' ? (
                  <ShieldAlert className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                ) : (
                  <AlertTriangle className="w-5 h-5 text-[#EF4444] shrink-0 mt-0.5" />
                )}
                <div className="min-w-0">
                  <p className="text-xs font-bold">
                    {lastOutcome.status === 'verified'
                      ? 'PASS VERIFIED — CHECKED IN'
                      : lastOutcome.status === 'duplicate'
                        ? 'DUPLICATE ENTRY BLOCKED'
                        : 'UNRECOGNIZED PASS CODE'}
                  </p>
                  <p className="text-xs text-zinc-200 mt-0.5">{lastOutcome.message}</p>
                  {'attendee' in lastOutcome && (
                    <div className="mt-1.5 space-y-1">
                      <p className="text-[11px] font-mono text-zinc-300 tabular-nums">
                        {lastOutcome.attendee.tier} · {lastOutcome.attendee.phone} ·{' '}
                        {lastOutcome.eventTitle} · {lastOutcome.timestamp}
                      </p>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {lastOutcome.attendee.validationGroup && (
                          <span className="px-2 py-0.5 rounded-full bg-white/15 text-[10px] font-semibold text-white">
                            Circle: {lastOutcome.attendee.validationGroup}
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {lastOutcome.status === 'verified' && lastOutcome.cameraUrl && (
                <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      if (navigator.clipboard?.writeText) {
                        navigator.clipboard.writeText(lastOutcome.cameraUrl!).catch(() => {});
                      }
                    }}
                    className="px-3 py-1.5 rounded-full bg-white/15 hover:bg-white/25 text-[11px] font-semibold text-white inline-flex items-center gap-1 whitespace-nowrap"
                  >
                    <Copy className="w-3 h-3" />
                    Copy Camera Link
                  </button>
                  <a
                    href={lastOutcome.cameraUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="px-3 py-1.5 rounded-full bg-white text-[#0B0B0B] hover:bg-zinc-200 text-[11px] font-semibold inline-flex items-center gap-1 whitespace-nowrap"
                  >
                    <ExternalLink className="w-3 h-3" />
                    Camera
                  </a>
                </div>
              )}

              {lastOutcome.status === 'duplicate' && (
                <button
                  type="button"
                  onClick={() => {
                    void onToggleCheckIn(lastOutcome.attendee.id);
                    setLastOutcome(null);
                  }}
                  className="px-3 py-1.5 rounded-full bg-white/15 hover:bg-white/25 text-[11px] font-semibold text-white inline-flex items-center gap-1 whitespace-nowrap shrink-0"
                >
                  <RotateCcw className="w-3 h-3" />
                  Undo Check-In
                </button>
              )}
            </div>
          )}
        </section>

        {/* RIGHT 6 COLS: Prominent Walk-In Check-In Registration Desk */}
        <section
          id="walk-in-registration"
          ref={walkInSectionRef}
          className="lg:col-span-6 bg-white rounded-3xl border-2 border-[#0B0B0B]/15 shadow-sm p-6 sm:p-7 flex flex-col justify-between"
        >
          <div>
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4 pb-4 border-b border-[#E5E5EA]">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-2xl bg-[#0B0B0B] text-white flex items-center justify-center shrink-0">
                  <UserPlus className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="font-display text-lg sm:text-xl font-bold tracking-tight text-[#0B0B0B]">
                      Walk-In Check-In Registration
                    </h2>
                  </div>
                  <p className="text-xs text-[#71717A]">
                    Register on-site walk-in guests, assign validation circle &amp; issue instant SMS QR passes
                  </p>
                </div>
              </div>
              <span className="px-2.5 py-1 rounded-full bg-[#0B0B0B] text-white text-[10px] font-bold tracking-wider uppercase whitespace-nowrap">
                Walk-In Desk
              </span>
            </div>

            {!isEventCreator ? (
              <div className="p-5 rounded-2xl bg-[#F5F5F7] border border-[#E5E5EA] space-y-2">
                <p className="text-xs font-bold text-[#0B0B0B]">
                  Creator-Only QR Pass Publishing
                </p>
                <p className="text-xs text-[#71717A] leading-relaxed">
                  Only the event creator can publish or issue check-in QR passes. Gate staff can scan and verify existing passes in the scanner panel.
                </p>
              </div>
            ) : (
              <>
                {selectedEvent && !isQrPassPublished && (
                  <div className="mb-4 p-4 rounded-2xl bg-[#F5F5F7] border border-[#E5E5EA] space-y-2.5">
                    <p className="text-xs font-semibold text-[#0B0B0B]">
                      Check-In QR Passes Unpublished
                    </p>
                    <p className="text-[11px] text-[#71717A] leading-relaxed">
                      {selectedEvent.status === 'draft'
                        ? 'Launch this draft event first before publishing check-in QR passes.'
                        : 'Publish the Check-In QR Pass as the event creator before issuing walk-in QR passes.'}
                    </p>
                    {onToggleQrPassPublished && (
                      <button
                        type="button"
                        disabled={selectedEvent.status === 'draft'}
                        onClick={() => void onToggleQrPassPublished(selectedEvent.id, true)}
                        className="px-4 py-2 rounded-full bg-[#0B0B0B] text-white text-xs font-semibold hover:bg-zinc-800 transition-colors disabled:opacity-40"
                      >
                        Publish Check-In QR Pass
                      </button>
                    )}
                  </div>
                )}

                <form onSubmit={handleWalkInSubmit} className="space-y-3.5">
                  <div>
                    <label className="block text-xs font-semibold text-[#0B0B0B] mb-1">
                      Walk-In Guest Full Name
                    </label>
                    <input
                      ref={walkInNameInputRef}
                      type="text"
                      required
                      disabled={!isQrPassPublished}
                      value={walkInName}
                      onChange={(e) => setWalkInName(e.target.value)}
                      placeholder="e.g. Efua Mensah"
                      className="w-full h-10 px-4 rounded-2xl bg-[#F5F5F7] border border-[#E5E5EA] text-sm text-[#0B0B0B] focus:bg-white focus:border-[#0B0B0B] focus:outline-none disabled:opacity-50"
                    />
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs font-semibold text-[#0B0B0B]">
                        Mobile Number (SMS QR Delivery)
                      </label>
                      {walkInPhone.trim() && (
                        <span className="text-[11px] font-mono text-emerald-700 font-semibold tabular-nums">
                          {normalizePhoneE164(walkInPhone)}
                        </span>
                      )}
                    </div>
                    <input
                      type="tel"
                      required
                      disabled={!isQrPassPublished}
                      value={walkInPhone}
                      onChange={(e) => setWalkInPhone(e.target.value)}
                      placeholder="024 555 0199"
                      className="w-full h-10 px-4 rounded-2xl bg-white border border-[#E5E5EA] text-sm font-mono text-[#0B0B0B] focus:border-[#0B0B0B] focus:outline-none disabled:opacity-50"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-[#0B0B0B] mb-1">
                        Email (Optional)
                      </label>
                      <input
                        type="email"
                        disabled={!isQrPassPublished}
                        value={walkInEmail}
                        onChange={(e) => setWalkInEmail(e.target.value)}
                        placeholder="guest@domain.com"
                        className="w-full h-10 px-4 rounded-2xl bg-white border border-[#E5E5EA] text-xs text-[#0B0B0B] focus:border-[#0B0B0B] focus:outline-none disabled:opacity-50"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-[#0B0B0B] mb-1">
                        Pass Tier
                      </label>
                      <select
                        disabled={!isQrPassPublished}
                        value={walkInTier}
                        onChange={(e) => setWalkInTier(e.target.value as AttendeeTier)}
                        className="w-full h-10 px-3 rounded-2xl bg-white border border-[#E5E5EA] text-xs font-semibold text-[#0B0B0B] focus:border-[#0B0B0B] focus:outline-none cursor-pointer disabled:opacity-50"
                      >
                        <option value="General">General</option>
                        <option value="VIP">VIP / High Table</option>
                        <option value="Speaker">Speaker / Officiant</option>
                        <option value="Press">Press / Choir / Crew</option>
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-[#0B0B0B] mb-1">
                        Validation Circle
                      </label>
                      <select
                        disabled={!isQrPassPublished}
                        value={walkInValidationGroup}
                        onChange={(e) => setWalkInValidationGroup(e.target.value)}
                        className="w-full h-10 px-3 rounded-2xl bg-white border border-[#E5E5EA] text-xs font-semibold text-[#0B0B0B] focus:border-[#0B0B0B] focus:outline-none cursor-pointer disabled:opacity-50"
                      >
                        {activeValidationCircles.map((circle: string) => (
                          <option key={circle} value={circle}>
                            {circle}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-[#0B0B0B] mb-1">
                        Group / Family / Organization
                      </label>
                      <input
                        type="text"
                        disabled={!isQrPassPublished}
                        value={walkInOrg}
                        onChange={(e) => setWalkInOrg(e.target.value)}
                        placeholder="e.g. Table 4 / Accra Tech"
                        className="w-full h-10 px-4 rounded-2xl bg-white border border-[#E5E5EA] text-xs text-[#0B0B0B] focus:border-[#0B0B0B] focus:outline-none disabled:opacity-50"
                      />
                    </div>
                  </div>

                  <label className="flex items-center gap-2.5 pt-1 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      disabled={!isQrPassPublished}
                      checked={walkInAutoCheckIn}
                      onChange={(e) => setWalkInAutoCheckIn(e.target.checked)}
                      className="accent-[#0B0B0B] w-4 h-4"
                    />
                    <span className="text-xs font-medium text-[#0B0B0B]">
                      Check guest in immediately &amp; send Arkesel SMS pass
                    </span>
                  </label>

                  <button
                    type="submit"
                    disabled={!isQrPassPublished}
                    className="w-full h-11 rounded-full bg-[#0B0B0B] text-white text-xs font-bold hover:bg-zinc-800 transition-colors inline-flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed shadow-sm"
                  >
                    <Sparkles className="w-4 h-4" />
                    <span>Complete Walk-In Check-In &amp; Issue QR Pass</span>
                  </button>
                </form>
              </>
            )}
          </div>

          {walkInSuccess && isEventCreator && (
            <div className="mt-4 p-4 rounded-2xl bg-[#F5F5F7] border border-[#E5E5EA] flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-bold text-[#0B0B0B] flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  Pass Issued: {walkInSuccess.ticketCode}
                </p>
                <p className="text-[11px] text-[#71717A] truncate mt-0.5">
                  {walkInSuccess.name} · {walkInSuccess.phone}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPreviewPass(walkInSuccess)}
                className="px-3 py-1.5 rounded-full bg-[#0B0B0B] text-white text-[11px] font-semibold inline-flex items-center gap-1 whitespace-nowrap shrink-0"
              >
                <QrCode className="w-3.5 h-3.5" />
                View QR
              </button>
            </div>
          )}
        </section>
      </div>

      {/* RECENT SCANS LOG + GATE ROSTER */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Gate Roster Table (8 cols) */}
        <section className="lg:col-span-8 bg-white rounded-3xl border border-[#E5E5EA] overflow-hidden">
          <div className="p-5 border-b border-[#E5E5EA] flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-[#F5F5F7]/60">
            <div className="flex items-center gap-2.5">
              <Users className="w-4 h-4 text-[#0B0B0B]" />
              <h2 className="text-sm font-bold text-[#0B0B0B]">
                Gate Manifest ({eventAttendees.length} Guests)
              </h2>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1 p-1 bg-white rounded-full border border-[#E5E5EA]">
                {(
                  [
                    { id: 'pending', label: `Pending (${pendingAttendees.length})` },
                    { id: 'checked', label: `Checked In (${checkedInCount})` },
                    { id: 'all', label: `All (${eventAttendees.length})` },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setRosterFilter(tab.id)}
                    className={`px-3 py-1 rounded-full text-[11px] font-semibold transition-colors whitespace-nowrap shrink-0 ${
                      rosterFilter === tab.id
                        ? 'bg-[#0B0B0B] text-white'
                        : 'text-[#71717A] hover:text-[#0B0B0B]'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="p-4 border-b border-[#E5E5EA]">
            <div className="relative">
              <Search className="w-4 h-4 text-[#71717A] absolute left-3.5 top-3 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search guest name, phone, or pass code..."
                className="w-full h-10 pl-10 pr-4 rounded-full bg-[#F5F5F7] text-xs text-[#0B0B0B] placeholder:text-[#71717A] focus:bg-white focus:ring-1 focus:ring-[#0B0B0B] focus:outline-none"
              />
            </div>
          </div>

          <div className="divide-y divide-[#E5E5EA]">
            {filteredRoster.length === 0 ? (
              <div className="py-10 text-center text-xs text-[#71717A]">
                No guests match this gate filter.
              </div>
            ) : (
              filteredRoster.map((att) => (
                <div
                  key={att.id}
                  className="px-5 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-[#F5F5F7]/50 transition-colors"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-[#0B0B0B]">{att.name}</span>
                      <span className="text-xs text-[#71717A]">· {att.tier}</span>
                      <span className="text-xs font-mono text-[#0B0B0B] tabular-nums">
                        · {att.ticketCode}
                      </span>
                      {att.validationGroup && (
                        <span className="px-2 py-0.5 rounded-full bg-[#F5F5F7] text-[10px] font-semibold text-[#0B0B0B] border border-[#E5E5EA]">
                          {att.validationGroup}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-[#71717A] mt-0.5 truncate">
                      {att.organization} · {att.phone}
                    </p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => setPreviewPass(att)}
                      className="px-3 py-1.5 rounded-full bg-[#F5F5F7] hover:bg-[#E8E8EA] text-xs font-semibold text-[#0B0B0B] inline-flex items-center gap-1 whitespace-nowrap"
                    >
                      <QrCode className="w-3.5 h-3.5" />
                      Pass QR
                    </button>
                    <button
                      type="button"
                      onClick={() => onToggleCheckIn(att.id)}
                      className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-colors inline-flex items-center gap-1.5 whitespace-nowrap ${
                        att.checkedIn
                          ? 'bg-emerald-50 text-emerald-800 border border-emerald-200 hover:bg-emerald-100'
                          : 'bg-[#0B0B0B] text-white hover:bg-zinc-800'
                      }`}
                    >
                      {att.checkedIn ? (
                        <>
                          <Check className="w-3.5 h-3.5" />
                          Checked In ({att.checkedInAt ?? 'Today'})
                        </>
                      ) : (
                        'Check In Now'
                      )}
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        {/* Recent Scan Activity Feed (4 cols) */}
        <section className="lg:col-span-4 bg-[#F5F5F7] rounded-3xl p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-[#0B0B0B]">Recent Gate Scans</h2>
            <span className="text-[11px] font-mono text-[#71717A] tabular-nums">
              {scanHistory.length} recorded
            </span>
          </div>

          {scanHistory.length === 0 ? (
            <div className="p-5 rounded-2xl bg-white text-center text-xs text-[#71717A]">
              Scans and walk-in check-ins appear here in real time.
            </div>
          ) : (
            <div className="space-y-2.5">
              {scanHistory.map((item, idx) => (
                <div
                  key={`${item.timestamp}-${idx}`}
                  className="p-3.5 rounded-2xl bg-white space-y-1"
                >
                  <div className="flex items-center justify-between text-[11px]">
                    <span
                      className={`font-bold ${
                        item.status === 'verified'
                          ? 'text-emerald-700'
                          : item.status === 'duplicate'
                            ? 'text-amber-700'
                            : 'text-[#EF4444]'
                      }`}
                    >
                      {item.status === 'verified'
                        ? 'Admitted'
                        : item.status === 'duplicate'
                          ? 'Duplicate Blocked'
                          : 'Unknown Code'}
                    </span>
                    <span className="font-mono text-[#71717A] tabular-nums">{item.timestamp}</span>
                  </div>
                  <p className="text-xs text-[#0B0B0B] font-medium leading-snug">{item.message}</p>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Attendee Digital QR Pass Modal */}
      {previewPass && (
        <div
          className="fixed inset-0 z-50 bg-black/50 backdrop-blur-[2px] flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="qr-pass-preview-title"
        >
          <div className="bg-white w-full max-w-sm rounded-3xl p-6 border border-[#E5E5EA] soft-popover-shadow text-center space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-[#71717A]">Digital Gate Pass</span>
              <button
                type="button"
                onClick={() => setPreviewPass(null)}
                aria-label="Close pass modal"
                className="w-8 h-8 rounded-full border border-[#E5E5EA] flex items-center justify-center text-[#0B0B0B] hover:bg-[#F5F5F7]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div>
              <h3 id="qr-pass-preview-title" className="text-lg font-bold text-[#0B0B0B]">
                {previewPass.name}
              </h3>
              <p className="text-xs text-[#71717A]">
                {previewPass.tier} · {previewPass.organization}
              </p>
            </div>

            <div className="p-5 bg-[#F5F5F7] rounded-2xl flex flex-col items-center">
              <div className="p-3 bg-white rounded-2xl border border-[#E5E5EA]">
                <DeterministicQrSvg
                  value={`${previewPass.ticketCode}|${selectedEvent?.slug ?? previewPass.eventId}|${previewPass.phone}`}
                  size={156}
                />
              </div>
              <span className="mt-3 font-mono text-sm font-bold tracking-widest text-[#0B0B0B] tabular-nums">
                {previewPass.ticketCode}
              </span>
              {previewPass.validationGroup && (
                <div className="mt-2 flex flex-wrap justify-center gap-1.5">
                  <span className="px-2.5 py-0.5 rounded-full bg-white text-[11px] font-semibold text-[#0B0B0B] border border-[#E5E5EA]">
                    {previewPass.validationGroup}
                  </span>
                </div>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  verifyAndProcessCode(previewPass.ticketCode);
                  setPreviewPass(null);
                }}
                className="flex-1 h-10 rounded-full bg-[#0B0B0B] text-white text-xs font-semibold hover:bg-zinc-800 transition-colors"
              >
                {previewPass.checkedIn ? 'Verify Status' : 'Scan & Check In'}
              </button>
              <button
                type="button"
                onClick={() =>
                  downloadQrSvg(
                    `${previewPass.ticketCode}|${selectedEvent?.slug ?? previewPass.eventId}|${previewPass.phone}`,
                    `${previewPass.ticketCode.toLowerCase()}-pass.svg`
                  )
                }
                aria-label="Download QR SVG"
                className="px-3.5 h-10 rounded-full bg-[#F5F5F7] hover:bg-[#E8E8EA] text-xs font-semibold text-[#0B0B0B] inline-flex items-center gap-1"
              >
                <Download className="w-3.5 h-3.5" />
                SVG
              </button>
              <button
                type="button"
                onClick={() => setPreviewPass(null)}
                className="px-4 h-10 rounded-full border border-[#E5E5EA] text-xs font-semibold text-[#0B0B0B]"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
