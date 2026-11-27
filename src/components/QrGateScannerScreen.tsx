import React, { useEffect, useMemo, useRef, useState } from 'react';
import jsQR from 'jsqr';
import {
  AlertTriangle,
  ArrowLeft,
  Camera,
  CameraOff,
  Check,
  CheckCircle2,
  Copy,
  Download,
  ExternalLink,
  ImageUp,
  Maximize2,
  Minimize2,
  QrCode,
  RotateCcw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Trash2,
  UserPlus,
  Users,
  Volume2,
  VolumeX,
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
import { playCheckInChime, primeCheckInAudio } from '../lib/audioFeedback';
import {
  formatEventDateSpan,
  formatEventDurationBadge,
  getAttendeeCheckedInDaysCount,
  getEventCheckInPolicy,
  getTodayIsoDate,
  isAttendeeCheckedInForDate,
} from '../lib/eventDates';
import { buildCameraLinkForOrigin } from '../lib/eventMessages';
import { useDocumentFullscreen } from '../lib/fullscreen';
import {
  buildEventInvitationUrl,
  DeterministicQrSvg,
  downloadQrSvg,
  extractPassLookupToken,
  isEventInvitationOrWalkInUrl,
} from '../lib/qr';
import { CheckInFlyerSidePanel } from './CheckInFlyerSidePanel';
import { CircularGauge } from './MonochromeArtwork';
import { TopUtilityBar } from './TopUtilityBar';

interface QrGateScannerScreenProps {
  events: EventItem[];
  attendees: Attendee[];
  alerts: SystemAlert[];
  profile: OrganizerProfile;
  initialEventId?: string;
  initialCode?: string;
  onBackToStudio?: () => void;
  onToggleCheckIn: (
    attendeeId: string,
    options?: { mode?: 'toggle' | 'checkin' | 'undo'; dateIso?: string }
  ) => Promise<{
    checkInMessageSent?: boolean;
    checkInSmsSent?: boolean;
    cameraUrl?: string;
    dispatchedMessage?: string;
    smsSkippedReason?: string;
  } | void> | void;
  onRegisterAttendee: (
    eventId: string,
    attendee: Attendee
  ) => Promise<{
    checkInMessageSent?: boolean;
    checkInSmsSent?: boolean;
    cameraUrl?: string;
    dispatchedMessage?: string;
    smsSkippedReason?: string;
  } | void> | void;
  onDeleteAttendee?: (attendeeId: string) => Promise<void> | void;
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
    }
  | {
      status: 'rejected';
      attendee?: Attendee;
      eventTitle: string;
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
  onBackToStudio,
  onToggleCheckIn,
  onRegisterAttendee,
  onDeleteAttendee,
  onToggleQrPassPublished,
  onManageEvent,
  onNavigateSettings,
  onResolveAlert,
}) => {
  const { isFullscreen, toggleFullscreen } = useDocumentFullscreen();
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
  const todayIso = getTodayIsoDate();
  const selectedEventPolicy = getEventCheckInPolicy(selectedEvent);
  const selectedEventDurationBadge = formatEventDurationBadge(selectedEvent);
  const selectedEventDateSpan = selectedEvent
    ? formatEventDateSpan(selectedEvent.isoDate, selectedEvent.endIsoDate, selectedEvent.date)
    : '';
  const checkinKioskUrl = useMemo(
    () =>
      selectedEvent
        ? buildEventInvitationUrl(selectedEvent.slug || selectedEvent.id, 'checkin')
        : '',
    [selectedEvent]
  );
  const isEventCreator = profile.appRole !== 'gate_staff';
  const isQrPassPublished = selectedEvent ? selectedEvent.qrPassPublished !== false : false;

  const [codeInput, setCodeInput] = useState(initialCode ?? '');
  const [searchQuery, setSearchQuery] = useState('');
  const [rosterFilter, setRosterFilter] = useState<'pending' | 'checked' | 'all'>('pending');
  const [lastOutcome, setLastOutcome] = useState<ScanOutcome | null>(null);
  const [scanHistory, setScanHistory] = useState<ScanOutcome[]>([]);

  // Real camera + BarcodeDetector + jsQR fallback state
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const qrImageInputRef = useRef<HTMLInputElement | null>(null);
  const lastScannedRef = useRef<{ value: string; at: number }>({ value: '', at: 0 });
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [detectorSupported, setDetectorSupported] = useState(false);
  const [chimeEnabled, setChimeEnabled] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    return window.localStorage.getItem('eventsbyyou_gate_chime_enabled') !== 'false';
  });
  const chimeEnabledRef = useRef(chimeEnabled);
  chimeEnabledRef.current = chimeEnabled;

  const toggleChime = () => {
    setChimeEnabled((prev) => {
      const next = !prev;
      if (typeof window !== 'undefined') {
        window.localStorage.setItem('eventsbyyou_gate_chime_enabled', String(next));
      }
      if (next) {
        primeCheckInAudio();
        playCheckInChime();
      }
      return next;
    });
  };

  const triggerCheckInChime = () => {
    if (chimeEnabledRef.current) {
      playCheckInChime();
    }
  };

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
  const [confirmDeleteAttendee, setConfirmDeleteAttendee] = useState<Attendee | null>(null);
  const [deletingAttendee, setDeletingAttendee] = useState(false);

  const eventAttendees = useMemo(
    () => attendees.filter((a) => !selectedEvent || a.eventId === selectedEvent.id),
    [attendees, selectedEvent]
  );

  const checkedInCount = useMemo(
    () =>
      eventAttendees.filter((a) =>
        isAttendeeCheckedInForDate(a, selectedEvent, todayIso)
      ).length,
    [eventAttendees, selectedEvent, todayIso]
  );

  const pendingAttendees = useMemo(
    () =>
      eventAttendees.filter(
        (a) => !isAttendeeCheckedInForDate(a, selectedEvent, todayIso)
      ),
    [eventAttendees, selectedEvent, todayIso]
  );

  const turnoutPct =
    eventAttendees.length > 0 ? Math.round((checkedInCount / eventAttendees.length) * 100) : 0;

  const filteredRoster = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return eventAttendees.filter((att) => {
      const checkedForActivePolicy = isAttendeeCheckedInForDate(att, selectedEvent, todayIso);
      const matchesStatus =
        rosterFilter === 'all' ||
        (rosterFilter === 'checked' ? checkedForActivePolicy : !checkedForActivePolicy);
      const matchesSearch =
        !q ||
        att.name.toLowerCase().includes(q) ||
        att.ticketCode.toLowerCase().includes(q) ||
        att.phone.toLowerCase().includes(q) ||
        att.organization.toLowerCase().includes(q);
      return matchesStatus && matchesSearch;
    });
  }, [eventAttendees, rosterFilter, searchQuery, selectedEvent, todayIso]);

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
    const rawTrimmed = rawInput.trim();
    if (!rawTrimmed) return;

    const nowTime = new Date().toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });

    const portalUrlMatch = isEventInvitationOrWalkInUrl(rawTrimmed);
    if (portalUrlMatch) {
      const outcome: ScanOutcome = {
        status: 'not-found',
        query: rawTrimmed,
        message:
          'Scanned the Event Check-In QR. Guests scan this on their phones to validate & open their pass, or scan a guest personal pass QR code here.',
        timestamp: nowTime,
      };
      setLastOutcome(outcome);
      setScanHistory((prev) => [outcome, ...prev].slice(0, 8));
      return;
    }

    const extractedToken = extractPassLookupToken(rawTrimmed);
    const cleaned = extractedToken.trim().toLowerCase();
    if (!cleaned) return;

    // Search within selected event first, then across all events
    const normalizedQuery = cleaned.replace(/^#/, '');
    const digitsOnly = cleaned.replace(/\D/g, '');
    const matchesAttendee = (a: Attendee) => {
      const attCode = a.ticketCode.toLowerCase().replace(/^#/, '');
      const attPhone = a.phone.replace(/\s+/g, '').toLowerCase();
      const attDigits = a.phone.replace(/\D/g, '');
      return (
        attCode === normalizedQuery ||
        attPhone === cleaned.replace(/\s+/g, '') ||
        (digitsOnly.length >= 9 && attDigits.endsWith(digitsOnly.slice(-9))) ||
        a.name.toLowerCase() === cleaned ||
        (a.email?.trim() && a.email.trim().toLowerCase() === cleaned)
      );
    };

    const matchInSelected = eventAttendees.find(matchesAttendee);
    const matchAny = matchInSelected || attendees.find(matchesAttendee);

    if (!matchAny) {
      const outcome: ScanOutcome = {
        status: 'not-found',
        query: extractedToken,
        message: `No pass found matching "${extractedToken}". Use the Walk-In Check-In Registration panel to register the guest and issue a QR pass immediately.`,
        timestamp: nowTime,
      };
      setLastOutcome(outcome);
      setScanHistory((prev) => [outcome, ...prev].slice(0, 8));
      return;
    }

    const targetEvent = events.find((e) => e.id === matchAny.eventId) ?? selectedEvent;
    const evtTitle = targetEvent?.title ?? 'Event';
    const targetPolicy = getEventCheckInPolicy(targetEvent);
    const alreadyCheckedForGate = isAttendeeCheckedInForDate(matchAny, targetEvent, todayIso);
    const hadPriorDays = getAttendeeCheckedInDaysCount(matchAny) > 0;

    if (alreadyCheckedForGate) {
      const outcome: ScanOutcome = {
        status: 'duplicate',
        attendee: matchAny,
        eventTitle: evtTitle,
        message:
          targetPolicy === 'daily-reentry'
            ? `Anti-passback alert: ${matchAny.name} (${matchAny.ticketCode}) already checked in today (${todayIso}) at ${matchAny.checkedInAt ?? 'earlier'}.`
            : `Anti-passback alert: ${matchAny.name} (${matchAny.ticketCode}) already checked in at ${matchAny.checkedInAt ?? 'earlier'}.`,
        timestamp: nowTime,
      };
      setLastOutcome(outcome);
      setScanHistory((prev) => [outcome, ...prev].slice(0, 8));
      return;
    }

    // Valid pass for this gate/day -> Check them in immediately
    const fallbackCameraUrl = targetEvent
      ? buildCameraLinkForOrigin(
          targetEvent.slug || targetEvent.id,
          undefined,
          matchAny.name,
          matchAny.ticketCode
        )
      : undefined;

    const nextDates = Array.from(
      new Set([...(matchAny.checkedInDates ?? []), todayIso])
    ).sort();
    const updatedAttendee: Attendee = {
      ...matchAny,
      checkedIn: true,
      checkedInAt: nowTime.slice(0, 5),
      checkedInDates: nextDates,
    };
    const isRepeatDayReentry = targetPolicy === 'daily-reentry' && hadPriorDays;
    const initialOutcome: ScanOutcome = {
      status: 'verified',
      attendee: updatedAttendee,
      eventTitle: evtTitle,
      message: isRepeatDayReentry
        ? `Access Granted (Day Re-Entry) — ${matchAny.name} (${matchAny.tier} Pass) checked in for ${todayIso}.`
        : `Access Granted — ${matchAny.name} (${matchAny.tier} Pass) checked in.${
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
    triggerCheckInChime();

    void Promise.resolve(
      onToggleCheckIn(matchAny.id, { mode: 'checkin', dateIso: todayIso })
    )
      .then((res) => {
        if (!res) return;
        const updatedMessage = res.checkInSmsSent
          ? `Access Granted — ${matchAny.name} (${matchAny.tier} Pass) checked in. Post-check-in SMS ("Thank you for being a part of the celebration.") + Disposable Camera link sent.`
          : res.smsSkippedReason
            ? `Access Granted — ${matchAny.name} (${matchAny.tier} Pass) checked in. SMS not sent: ${res.smsSkippedReason}`
            : res.checkInMessageSent
              ? `Access Granted — ${matchAny.name} (${matchAny.tier} Pass) checked in. Check-in email + Disposable Camera link sent.`
              : isRepeatDayReentry
                ? `Access Granted (Daily Re-Entry) — ${matchAny.name} verified for ${todayIso} (${nextDates.length} total days).`
                : `Access Granted — ${matchAny.name} (${matchAny.tier} Pass) checked in.`;
        const enriched: ScanOutcome = {
          ...initialOutcome,
          cameraUrl: res.cameraUrl || initialOutcome.cameraUrl,
          message: updatedMessage,
        };
        setLastOutcome(enriched);
      })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : 'Unable to persist gate check-in to Supabase.';
        const failedOutcome: ScanOutcome = {
          status: 'rejected',
          attendee: matchAny,
          eventTitle: evtTitle,
          message: `Check-in failed for ${matchAny.name}: ${msg}`,
          timestamp: nowTime,
        };
        setLastOutcome(failedOutcome);
        setScanHistory((prev) => prev.filter((item) => item !== initialOutcome));
      });
  };

  useEffect(() => {
    if (initialCode) {
      verifyAndProcessCode(initialCode);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialCode]);

  const handleDetectedQrPayload = (detectedValue: string) => {
    const now = Date.now();
    if (
      lastScannedRef.current.value === detectedValue &&
      now - lastScannedRef.current.at < 2600
    ) {
      return;
    }
    lastScannedRef.current = { value: detectedValue, at: now };
    const displayToken = extractPassLookupToken(detectedValue);
    setCodeInput(displayToken);
    verifyAndProcessCode(detectedValue);
  };

  // Universal live QR camera loop (BarcodeDetector + canvas jsQR fallback for iOS/Firefox/all browsers)
  useEffect(() => {
    if (!cameraActive) return;
    let cancelled = false;
    let timerId: number | undefined;

    const decodeFrameWithCanvas = (video: HTMLVideoElement): string | null => {
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      if (!vw || !vh) return null;
      const canvas = canvasRef.current || document.createElement('canvas');
      canvasRef.current = canvas;
      const maxDim = 720;
      const scale = Math.min(1, maxDim / Math.max(vw, vh));
      const w = Math.max(1, Math.round(vw * scale));
      const h = Math.max(1, Math.round(vh * scale));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return null;
      ctx.drawImage(video, 0, 0, w, h);
      const imageData = ctx.getImageData(0, 0, w, h);
      const result = jsQR(imageData.data, w, h, { inversionAttempts: 'attemptBoth' });
      return result?.data?.trim() || null;
    };

    const scanFrame = async () => {
      if (cancelled || !videoRef.current || videoRef.current.readyState < 2) {
        if (!cancelled) timerId = window.setTimeout(scanFrame, 280);
        return;
      }
      let detectedValue: string | null = null;
      try {
        if (detectorSupported) {
          // @ts-expect-error BarcodeDetector is a progressive browser API
          const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
          const codes = await detector.detect(videoRef.current);
          if (codes && codes.length > 0 && codes[0].rawValue) {
            detectedValue = String(codes[0].rawValue).trim();
          }
        }
      } catch {
        // Ignore single BarcodeDetector error and fall through to jsQR
      }

      if (!detectedValue && videoRef.current) {
        try {
          detectedValue = decodeFrameWithCanvas(videoRef.current);
        } catch {
          // Ignore canvas read error
        }
      }

      if (detectedValue) {
        handleDetectedQrPayload(detectedValue);
        timerId = window.setTimeout(scanFrame, 1200);
        return;
      }

      if (!cancelled) {
        timerId = window.setTimeout(scanFrame, 240);
      }
    };

    timerId = window.setTimeout(scanFrame, 320);
    return () => {
      cancelled = true;
      if (timerId) window.clearTimeout(timerId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraActive, detectorSupported, selectedEventId, attendees]);

  const handleScanQrImageFile = async (file: File | undefined) => {
    if (!file) return;
    setCameraError(null);
    try {
      const objectUrl = URL.createObjectURL(file);
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('Unable to read QR image file.'));
        img.src = objectUrl;
      });
      const maxDim = 1024;
      const scale = Math.min(1, maxDim / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
      const w = Math.max(1, Math.round((img.naturalWidth || 512) * scale));
      const h = Math.max(1, Math.round((img.naturalHeight || 512) * scale));
      const canvas = canvasRef.current || document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      URL.revokeObjectURL(objectUrl);
      if (!ctx) throw new Error('Canvas QR decoder unavailable.');
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      const imageData = ctx.getImageData(0, 0, w, h);
      const decoded = jsQR(imageData.data, w, h, { inversionAttempts: 'attemptBoth' });
      if (!decoded?.data) {
        setCameraError('No readable QR code found in the selected image. Try a clearer pass image.');
        return;
      }
      handleDetectedQrPayload(decoded.data.trim());
    } catch (err) {
      setCameraError(
        err instanceof Error ? err.message : 'Unable to decode the selected QR code image.'
      );
    }
  };

  const startCamera = async () => {
    primeCheckInAudio();
    setCameraError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError(
        'Live webcam access is unavailable in this browser context. Upload a QR screenshot or type the pass code below.'
      );
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
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
        'Camera permission denied or no webcam detected. Upload a QR pass image or tap any pending guest below.'
      );
    }
  };

  const handleScanSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    primeCheckInAudio();
    verifyAndProcessCode(codeInput);
  };

  const handleWalkInSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    primeCheckInAudio();
    if (!selectedEvent || !walkInName.trim() || !walkInPhone.trim()) return;

    const normalized = normalizePhoneE164(walkInPhone);
    const codePrefix = selectedEvent.category.slice(0, 2).toUpperCase() || 'EV';
    const code = `${codePrefix}-${Math.floor(1000 + Math.random() * 8999)}`;
    const nowTime = new Date().toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
    });

    const cleanEmail = walkInEmail.trim();
    if (cleanEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      setLastOutcome({
        status: 'rejected',
        eventTitle: selectedEvent.title,
        message: 'Please enter a valid optional email address, or leave it blank.',
        timestamp: nowTime,
      });
      return;
    }

    const created: Attendee = {
      id: `att-${Date.now()}`,
      eventId: selectedEvent.id,
      name: walkInName.trim(),
      email: cleanEmail,
      phone: normalized,
      organization: walkInOrg.trim() || `${selectedEvent.category} Walk-In`,
      tier: walkInTier,
      ticketCode: code,
      checkedIn: walkInAutoCheckIn,
      checkedInAt: walkInAutoCheckIn ? nowTime : undefined,
      checkedInDates: walkInAutoCheckIn ? [todayIso] : undefined,
      paymentStatus: 'paid',
      smsStatus: 'Arkesel Sent',
      validationGroup: walkInValidationGroup || activeValidationCircles[0],
    };

    try {
      const regRes = await Promise.resolve(onRegisterAttendee(selectedEvent.id, created));
      setWalkInSuccess(created);
      setWalkInName('');
      setWalkInPhone('');
      setWalkInEmail('');
      setWalkInOrg('');

      if (walkInAutoCheckIn) {
        triggerCheckInChime();
        const walkInCameraUrl =
          regRes?.cameraUrl ||
          buildCameraLinkForOrigin(
            selectedEvent.slug || selectedEvent.id,
            undefined,
            created.name,
            created.ticketCode
          );
        const walkInOutcomeMsg = regRes?.checkInSmsSent
          ? `Walk-In Registered & Checked In — QR Pass ${code} & post-check-in SMS ("Thank you for being a part of the celebration.") sent via Arkesel.`
          : regRes?.smsSkippedReason
            ? `Walk-In Registered & Checked In — QR Pass ${code}. SMS skipped: ${regRes.smsSkippedReason}`
            : `Walk-In Registered & Checked In — QR Pass ${code} issued.`;
        const outcome: ScanOutcome = {
          status: 'verified',
          attendee: created,
          eventTitle: selectedEvent.title,
          message: walkInOutcomeMsg,
          cameraUrl: walkInCameraUrl,
          timestamp: nowTime,
        };
        setLastOutcome(outcome);
        setScanHistory((prev) => [outcome, ...prev].slice(0, 8));
      }
    } catch (err) {
      setLastOutcome({
        status: 'rejected',
        eventTitle: selectedEvent.title,
        message: err instanceof Error ? err.message : 'Unable to register walk-in guest.',
        timestamp: nowTime,
      });
    }
  };

  return (
    <div className="w-full space-y-5">
      {/* Top Full-Screen Header & Utility Bar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3 min-w-0">
          {onBackToStudio && (
            <button
              type="button"
              onClick={onBackToStudio}
              className="px-3.5 py-2 rounded-full bg-[#F5F5F7] hover:bg-[#E8E8EA] text-xs font-semibold text-[#0B0B0B] inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Studio</span>
            </button>
          )}
          <div className="min-w-0">
            <h1 className="font-display text-[26px] sm:text-[32px] font-bold tracking-[-0.02em] text-[#0B0B0B] leading-tight">
              Gate Check-In &amp; QR Scanner
            </h1>
            <p className="text-xs sm:text-sm text-[#71717A] mt-0.5">
              Scan digital QR passes, enforce anti-passback, and register walk-in guests on the spot.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 lg:justify-end">
          <button
            type="button"
            onClick={toggleChime}
            aria-pressed={chimeEnabled}
            title={chimeEnabled ? 'Mute check-in chime' : 'Enable check-in chime'}
            className={`min-h-[40px] px-3.5 py-2 rounded-full border text-xs font-semibold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 ${
              chimeEnabled
                ? 'bg-white border-[#E5E5EA] hover:border-[#0B0B0B] text-[#0B0B0B]'
                : 'bg-[#F5F5F7] border-[#E5E5EA] text-[#71717A] hover:text-[#0B0B0B]'
            }`}
          >
            {chimeEnabled ? (
              <>
                <Volume2 className="w-3.5 h-3.5" />
                <span>Chime On</span>
              </>
            ) : (
              <>
                <VolumeX className="w-3.5 h-3.5" />
                <span>Chime Muted</span>
              </>
            )}
          </button>
          <button
            type="button"
            onClick={toggleFullscreen}
            className="min-h-[40px] px-3.5 py-2 rounded-full bg-[#F5F5F7] border border-[#E5E5EA] hover:border-[#0B0B0B] text-xs font-semibold text-[#0B0B0B] inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
          >
            {isFullscreen ? (
              <>
                <Minimize2 className="w-3.5 h-3.5" />
                <span>Exit Full Screen</span>
              </>
            ) : (
              <>
                <Maximize2 className="w-3.5 h-3.5" />
                <span>Full Screen</span>
              </>
            )}
          </button>
          <div className="w-full sm:w-[380px] lg:w-[400px]">
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
      </div>

      {/* Active Event Context & Live Throughput Bar */}
      {selectedEvent && (
        <section className="p-4 sm:p-5 rounded-3xl bg-[#F5F5F7] flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3.5 min-w-0">
            <div className="w-11 h-11 rounded-2xl bg-[#0B0B0B] text-white flex items-center justify-center shrink-0">
              <QrCode className="w-5 h-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <label htmlFor="scanner-event-select" className="block text-[11px] font-semibold text-[#71717A]">
                  Active Gate Event ({selectedEvent.category} · {selectedEventDateSpan} · {selectedEvent.city})
                </label>
                {selectedEventDurationBadge && (
                  <span className="px-2 py-0.5 rounded-full bg-[#0B0B0B] text-white text-[10px] font-semibold">
                    {selectedEventDurationBadge}
                  </span>
                )}
                {selectedEventPolicy === 'daily-reentry' && (
                  <span className="px-2 py-0.5 rounded-full bg-white border border-[#E5E5EA] text-[#0B0B0B] text-[10px] font-semibold">
                    Daily Re-Entry ({todayIso})
                  </span>
                )}
              </div>
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

          <div className="flex flex-wrap items-center gap-4 shrink-0">
            <div className="flex items-center gap-3">
              <CircularGauge value={turnoutPct} size={46} strokeWidth={4.5} alertThreshold={101} />
              <div>
                <p className="text-sm font-bold text-[#0B0B0B] tabular-nums">
                  {checkedInCount} / {eventAttendees.length} Checked In
                </p>
                <p className="text-xs text-[#71717A] tabular-nums">
                  {pendingAttendees.length} pending arrival · {turnoutPct}% turnout
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:flex sm:flex-wrap items-center gap-2 w-full sm:w-auto">
              <button
                type="button"
                onClick={focusWalkInRegistration}
                className="col-span-2 sm:col-span-1 min-h-[40px] px-4 py-2 rounded-full bg-[#0B0B0B] text-white hover:bg-zinc-800 text-xs font-bold inline-flex items-center justify-center gap-1.5 shadow-sm transition-colors whitespace-nowrap shrink-0"
              >
                <UserPlus className="w-3.5 h-3.5 shrink-0" />
                <span>Walk-In Registration</span>
              </button>
              <span
                className={`min-h-[40px] px-3 py-1.5 rounded-full text-[11px] font-semibold border whitespace-nowrap inline-flex items-center justify-center ${
                  isQrPassPublished
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                    : 'bg-[#0B0B0B] border-[#0B0B0B] text-white'
                }`}
              >
                {isQrPassPublished ? 'Live QR Active' : 'Live QR Inactive'}
              </span>
              {isEventCreator && onToggleQrPassPublished && (
                <button
                  type="button"
                  disabled={selectedEvent.status === 'draft'}
                  onClick={() =>
                    void onToggleQrPassPublished(selectedEvent.id, !isQrPassPublished)
                  }
                  className={`min-h-[40px] px-4 py-2 rounded-full text-xs font-semibold transition-colors whitespace-nowrap shrink-0 disabled:opacity-40 inline-flex items-center justify-center ${
                    isQrPassPublished
                      ? 'bg-white border border-[#E5E5EA] hover:border-[#0B0B0B] text-[#0B0B0B]'
                      : 'bg-[#0B0B0B] text-white hover:bg-zinc-800'
                  }`}
                >
                  {isQrPassPublished ? 'Pause Live QR' : 'Activate Live QR'}
                </button>
              )}
              <button
                type="button"
                onClick={() => onManageEvent(selectedEvent)}
                className="col-span-2 sm:col-span-1 min-h-[40px] px-4 py-2 rounded-full bg-white border border-[#E5E5EA] hover:border-[#0B0B0B] text-xs font-semibold text-[#0B0B0B] transition-colors whitespace-nowrap shrink-0 inline-flex items-center justify-center"
              >
                Open Event Workspace
              </button>
            </div>
          </div>
        </section>
      )}

      {/* FULL-SCREEN SPLIT: EVENT FLYER / LOGO AT SIDE + SCANNER / WALK-IN / MANIFEST */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
        {selectedEvent && (
          <div className="xl:col-span-4 2xl:col-span-3 xl:sticky xl:top-4 xl:h-[calc(100dvh-2rem)] xl:max-h-[820px] xl:flex xl:flex-col">
            <CheckInFlyerSidePanel
              event={selectedEvent}
              checkedInCount={checkedInCount}
              registeredCount={eventAttendees.length}
              checkinUrl={checkinKioskUrl}
              showQrCard
              showCheckInCount
              isFullscreen={isFullscreen}
              onToggleFullscreen={toggleFullscreen}
              heroHeightClass="h-[200px] sm:h-[230px] xl:h-auto xl:min-h-0 xl:flex-1"
              className="xl:flex-1 xl:min-h-0"
            />
          </div>
        )}

        <div className={`${selectedEvent ? 'xl:col-span-8 2xl:col-span-9' : 'xl:col-span-12'} space-y-5 min-w-0`}>
          {/* MAIN COMMAND SPLIT: QR CODE SCANNER (Left 6 cols) + WALK-IN CHECK-IN REGISTRATION (Right 6 cols) */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
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

              <div className="flex flex-wrap items-center gap-2">
                <input
                  ref={qrImageInputRef}
                  type="file"
                  accept="image/*,.svg"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = '';
                    void handleScanQrImageFile(file);
                  }}
                />
                <button
                  type="button"
                  onClick={() => {
                    primeCheckInAudio();
                    qrImageInputRef.current?.click();
                  }}
                  className="min-h-[40px] px-3.5 py-2 rounded-full bg-white/10 hover:bg-white/20 text-white text-xs font-semibold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
                >
                  <ImageUp className="w-3.5 h-3.5" />
                  <span>Scan Image</span>
                </button>
                <button
                  type="button"
                  onClick={cameraActive ? stopCamera : startCamera}
                  className={`min-h-[40px] px-4 py-2 rounded-full text-xs font-semibold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 ${
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
            </div>

            <canvas ref={canvasRef} className="hidden" aria-hidden="true" />

            {/* Camera Viewfinder Frame */}
            <div className="mt-5 relative rounded-2xl bg-zinc-900 border border-white/10 overflow-hidden h-[min(62vw,250px)] sm:h-64 xl:h-[280px] flex items-center justify-center">
              {cameraActive ? (
                <>
                  <video
                    ref={videoRef}
                    muted
                    playsInline
                    className="w-full h-full object-cover"
                  />
                  {/* Reticle overlay */}
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div className="w-[min(44vw,176px)] h-[min(44vw,176px)] sm:w-44 sm:h-44 rounded-2xl border-2 border-white/85 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]" />
                  </div>
                  <div className="absolute bottom-2.5 inset-x-3 flex justify-center pointer-events-none">
                    <span className="text-[11px] font-mono text-white whitespace-nowrap bg-[#0B0B0B]/85 border border-white/15 px-3 py-1 rounded-full">
                      Live QR scanner active — point at pass
                    </span>
                  </div>
                </>
              ) : (
                <div className="p-5 sm:p-6 text-center max-w-md space-y-2.5 sm:space-y-3">
                  <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl bg-white/10 border border-white/15 mx-auto flex items-center justify-center">
                    <QrCode className="w-7 h-7 sm:w-8 sm:h-8 text-white" />
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
                      onClick={() => {
                        primeCheckInAudio();
                        verifyAndProcessCode(att.ticketCode);
                      }}
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
                        : lastOutcome.status === 'rejected'
                          ? 'SAVE FAILED — REVERTED'
                          : 'UNRECOGNIZED PASS CODE'}
                  </p>
                  <p className="text-xs text-zinc-200 mt-0.5">{lastOutcome.message}</p>
                  {'attendee' in lastOutcome && lastOutcome.attendee && (
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
                    const targetAttendee = lastOutcome.attendee;
                    const evtTitle = lastOutcome.eventTitle;
                    const targetEvent =
                      events.find((e) => e.id === targetAttendee.eventId) ?? selectedEvent;
                    const isDailyPolicy = getEventCheckInPolicy(targetEvent) === 'daily-reentry';
                    void Promise.resolve(
                      isDailyPolicy
                        ? onToggleCheckIn(targetAttendee.id, { mode: 'undo', dateIso: todayIso })
                        : onToggleCheckIn(targetAttendee.id)
                    )
                      .then(() => {
                        setLastOutcome(null);
                      })
                      .catch((err) => {
                        setLastOutcome({
                          status: 'rejected',
                          attendee: targetAttendee,
                          eventTitle: evtTitle,
                          message:
                            err instanceof Error
                              ? err.message
                              : 'Unable to undo check-in right now.',
                          timestamp: new Date().toLocaleTimeString('en-GB', {
                            hour: '2-digit',
                            minute: '2-digit',
                          }),
                        });
                      });
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
                      Live Gate QR Passes Inactive
                    </p>
                    <p className="text-[11px] text-[#71717A] leading-relaxed">
                      {selectedEvent.status === 'draft'
                        ? 'Launch this draft event first before activating live check-in QR passes.'
                        : 'Activate Live Check-In QR Passes as the event creator so public pass validation, check-in QR passes, and gate scans go live.'}
                    </p>
                    {onToggleQrPassPublished && (
                      <button
                        type="button"
                        disabled={selectedEvent.status === 'draft'}
                        onClick={() => void onToggleQrPassPublished(selectedEvent.id, true)}
                        className="px-4 py-2 rounded-full bg-[#0B0B0B] text-white text-xs font-semibold hover:bg-zinc-800 transition-colors disabled:opacity-40"
                      >
                        Activate Live Check-In QR
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
              filteredRoster.map((att) => {
                const isDailyPolicy = selectedEventPolicy === 'daily-reentry';
                const checkedInToday = isAttendeeCheckedInForDate(att, selectedEvent, todayIso);
                const daysCount = getAttendeeCheckedInDaysCount(att);
                const checkedForGate = isDailyPolicy ? checkedInToday : att.checkedIn;
                return (
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
                      {isDailyPolicy && daysCount > 0 && (
                        <span className="px-2 py-0.5 rounded-full bg-[#F5F5F7] text-[10px] font-semibold text-[#0B0B0B] border border-[#E5E5EA] tabular-nums">
                          {checkedInToday
                            ? `${daysCount} ${daysCount === 1 ? 'day' : 'days'} logged`
                            : `${daysCount} ${daysCount === 1 ? 'day' : 'days'} prior · Ready today`}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-[#71717A] mt-0.5 truncate">
                      {att.organization} · {att.phone}
                    </p>
                  </div>

                  <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 w-full sm:w-auto shrink-0">
                    <button
                      type="button"
                      onClick={() => setPreviewPass(att)}
                      className="flex-1 sm:flex-initial min-h-[40px] px-3.5 py-1.5 rounded-full bg-[#F5F5F7] hover:bg-[#E8E8EA] text-xs font-semibold text-[#0B0B0B] inline-flex items-center justify-center gap-1.5 whitespace-nowrap"
                    >
                      <QrCode className="w-3.5 h-3.5" />
                      Pass QR
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        primeCheckInAudio();
                        const checkingInNow = !checkedForGate;
                        if (checkingInNow) {
                          triggerCheckInChime();
                        }
                        void Promise.resolve(
                          isDailyPolicy
                            ? onToggleCheckIn(att.id, {
                                mode: checkedInToday ? 'undo' : 'checkin',
                                dateIso: todayIso,
                              })
                            : onToggleCheckIn(att.id)
                        )
                          .then((res) => {
                            if (!checkingInNow) return;
                            const evtTitle = selectedEvent?.title ?? 'Event Gate';
                            const timestamp = new Date().toLocaleTimeString('en-GB', {
                              hour: '2-digit',
                              minute: '2-digit',
                            });
                            const msg = res?.checkInSmsSent
                              ? `Access Granted — ${att.name} (${att.tier} Pass) checked in. Post-check-in SMS ("Thank you for being a part of the celebration.") + Disposable Camera link sent.`
                              : res?.smsSkippedReason
                                ? `Access Granted — ${att.name} (${att.tier} Pass) checked in. SMS not sent: ${res.smsSkippedReason}`
                                : res?.checkInMessageSent
                                  ? `Access Granted — ${att.name} (${att.tier} Pass) checked in. Check-in welcome email + Disposable Camera link sent.`
                                  : `Access Granted — ${att.name} (${att.tier} Pass) checked in.`;
                            const manualOutcome: ScanOutcome = {
                              status: 'verified',
                              attendee: {
                                ...att,
                                checkedIn: true,
                                checkedInAt: timestamp,
                              },
                              eventTitle: evtTitle,
                              message: msg,
                              cameraUrl:
                                res?.cameraUrl ||
                                (selectedEvent
                                  ? buildCameraLinkForOrigin(
                                      selectedEvent.slug || selectedEvent.id,
                                      undefined,
                                      att.name,
                                      att.ticketCode
                                    )
                                  : undefined),
                              timestamp,
                            };
                            setLastOutcome(manualOutcome);
                            setScanHistory((prev) => [manualOutcome, ...prev].slice(0, 8));
                          })
                          .catch((err) => {
                          setLastOutcome({
                            status: 'rejected',
                            attendee: att,
                            eventTitle: selectedEvent?.title ?? 'Event Gate',
                            message:
                              err instanceof Error
                                ? err.message
                                : `Unable to update check-in status for ${att.name}.`,
                            timestamp: new Date().toLocaleTimeString('en-GB', {
                              hour: '2-digit',
                              minute: '2-digit',
                            }),
                          });
                        });
                      }}
                      className={`flex-1 sm:flex-initial min-h-[40px] px-4 py-1.5 rounded-full text-xs font-semibold transition-colors inline-flex items-center justify-center gap-1.5 whitespace-nowrap ${
                        checkedForGate
                          ? 'bg-emerald-50 text-emerald-800 border border-emerald-200 hover:bg-emerald-100'
                          : 'bg-[#0B0B0B] text-white hover:bg-zinc-800'
                      }`}
                    >
                      {checkedForGate ? (
                        <>
                          <Check className="w-3.5 h-3.5" />
                          {isDailyPolicy
                            ? `Checked Today (${att.checkedInAt ?? 'Today'})`
                            : `Checked In (${att.checkedInAt ?? 'Today'})`}
                        </>
                      ) : isDailyPolicy && daysCount > 0 ? (
                        'Check In Today'
                      ) : (
                        'Check In Now'
                      )}
                    </button>
                    {isEventCreator && onDeleteAttendee && (
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteAttendee(att)}
                        title="Delete attendee"
                        aria-label={`Delete ${att.name}`}
                        className="w-10 h-10 rounded-full bg-white border border-[#E5E5EA] hover:border-[#EF4444] hover:bg-red-50 text-[#71717A] hover:text-[#EF4444] transition-colors inline-flex items-center justify-center shrink-0"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
                );
              })
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
                          : item.status === 'rejected'
                            ? 'Save Failed'
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
        </div>
      </div>

      {/* Attendee Digital QR Pass Modal */}
      {previewPass && (
        <div
          className="fixed inset-0 z-50 bg-black/50 backdrop-blur-[2px] flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="qr-pass-preview-title"
        >
          <div className="bg-white w-full max-w-sm rounded-3xl p-5 sm:p-6 border border-[#E5E5EA] soft-popover-shadow text-center space-y-4 max-h-[92dvh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-[#71717A]">Digital Gate Pass</span>
              <button
                type="button"
                onClick={() => setPreviewPass(null)}
                aria-label="Close pass modal"
                className="w-9 h-9 rounded-full border border-[#E5E5EA] flex items-center justify-center text-[#0B0B0B] hover:bg-[#F5F5F7]"
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

            <div className="p-4 sm:p-5 bg-[#F5F5F7] rounded-2xl flex flex-col items-center">
              <div className="w-[min(56vw,210px)] aspect-square p-3 bg-white rounded-2xl border border-[#E5E5EA] flex items-center justify-center">
                <DeterministicQrSvg
                  value={`${previewPass.ticketCode}|${selectedEvent?.slug ?? previewPass.eventId}|${previewPass.phone}`}
                  size={240}
                  className="w-full h-full block"
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
                  primeCheckInAudio();
                  verifyAndProcessCode(previewPass.ticketCode);
                  setPreviewPass(null);
                }}
                className="flex-1 h-11 rounded-full bg-[#0B0B0B] text-white text-xs font-semibold hover:bg-zinc-800 transition-colors"
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
                className="px-3.5 h-11 rounded-full bg-[#F5F5F7] hover:bg-[#E8E8EA] text-xs font-semibold text-[#0B0B0B] inline-flex items-center gap-1"
              >
                <Download className="w-3.5 h-3.5" />
                SVG
              </button>
              <button
                type="button"
                onClick={() => setPreviewPass(null)}
                className="px-4 h-11 rounded-full border border-[#E5E5EA] text-xs font-semibold text-[#0B0B0B]"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Attendee Confirmation Modal */}
      {confirmDeleteAttendee && (
        <div
          className="fixed inset-0 z-50 bg-black/50 backdrop-blur-[2px] flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="gate-delete-attendee-title"
        >
          <div className="bg-white w-full max-w-sm rounded-3xl p-5 sm:p-6 border border-[#E5E5EA] soft-popover-shadow space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <h3
                  id="gate-delete-attendee-title"
                  className="text-base font-bold text-[#0B0B0B]"
                >
                  Delete attendee?
                </h3>
                <p className="text-xs text-[#71717A] leading-relaxed">
                  Remove <span className="font-semibold text-[#0B0B0B]">{confirmDeleteAttendee.name}</span>{' '}
                  ({confirmDeleteAttendee.ticketCode}) from{' '}
                  <span className="font-semibold text-[#0B0B0B]">
                    {selectedEvent?.title ?? 'this event'}
                  </span>
                  {confirmDeleteAttendee.checkedIn ? ', including their check-in record' : ''}? This action cannot be undone.
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
                    if (previewPass?.id === target.id) setPreviewPass(null);
                    if (walkInSuccess?.id === target.id) setWalkInSuccess(null);
                    setConfirmDeleteAttendee(null);
                  } catch (err) {
                    setLastOutcome({
                      status: 'rejected',
                      attendee: target,
                      eventTitle: selectedEvent?.title ?? 'Event Gate',
                      message:
                        err instanceof Error
                          ? err.message
                          : `Unable to delete ${target.name}.`,
                      timestamp: new Date().toLocaleTimeString('en-GB', {
                        hour: '2-digit',
                        minute: '2-digit',
                      }),
                    });
                    setConfirmDeleteAttendee(null);
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
