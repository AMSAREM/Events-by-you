import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Aperture,
  Archive,
  ArrowLeft,
  Camera,
  CameraOff,
  Check,
  Download,
  Eye,
  Film,
  Heart,
  ImagePlus,
  LayoutGrid,
  Lock,
  Pencil,
  RefreshCw,
  Share2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Unlock,
  User,
  X,
  Zap,
  ZapOff,
} from 'lucide-react';
import {
  DisposableRollSettings,
  DisposableShot,
  EventItem,
  FilmStock,
  OrganizerProfile,
  SystemAlert,
} from '../types/events';
import { formatEventDateSpan } from '../lib/eventDates';
import { MAX_SHOTS_PER_USER } from '../lib/eventMessages';
import { createZipBlob, type ZipFileEntry } from '../lib/zip';
import { TopUtilityBar } from './TopUtilityBar';

interface DisposableCameraScreenProps {
  mode: 'studio' | 'public';
  events: EventItem[];
  shots: DisposableShot[];
  rollSettings: Record<string, DisposableRollSettings>;
  alerts: SystemAlert[];
  profile: OrganizerProfile;
  initialEventId?: string;
  initialGuestName?: string;
  initialPassCode?: string;
  verifiedPass?: {
    attendeeName: string;
    ticketCode: string;
    checkedIn: boolean;
    tier: string;
  } | null;
  onAddShot: (shot: DisposableShot) => Promise<{ ok: boolean; error?: string } | void> | void;
  onToggleLikeShot: (shotId: string) => Promise<void> | void;
  onDeleteShot: (shotId: string, shooterKey?: string) => Promise<void> | void;
  onDevelopRoll: (eventId: string) => Promise<void> | void;
  onUpdateRollSettings: (eventId: string, next: DisposableRollSettings) => Promise<void> | void;
  onManageEvent?: (event: EventItem) => void;
  onNavigateSettings?: () => void;
  onResolveAlert?: (id: string) => void;
  onBack?: () => void;
}

const FILM_STOCKS: {
  id: FilmStock;
  label: string;
  shortLabel: string;
  iso: string;
  cssFilter: string;
  tintOverlay: string;
}[] = [
  {
    id: 'ilford-bw',
    label: 'Ilford HP5',
    shortLabel: 'B&W 400',
    iso: 'B&W 400',
    cssFilter: 'grayscale(1) contrast(1.22) brightness(0.98)',
    tintOverlay: 'rgba(255,255,255,0)',
  },
  {
    id: 'kodak-gold',
    label: 'Kodak Gold',
    shortLabel: 'Gold 200',
    iso: 'Warm 200',
    cssFilter: 'sepia(0.24) saturate(1.22) contrast(1.06) brightness(1.02)',
    tintOverlay: 'rgba(245, 180, 90, 0.08)',
  },
  {
    id: 'fuji-c200',
    label: 'Fuji C200',
    shortLabel: 'Fuji C200',
    iso: 'Daylight',
    cssFilter: 'contrast(1.06) saturate(1.12) hue-rotate(-4deg)',
    tintOverlay: 'rgba(80, 175, 130, 0.06)',
  },
  {
    id: 'cinestill-800t',
    label: 'CineStill 800T',
    shortLabel: 'Cine 800T',
    iso: 'Night 800',
    cssFilter: 'contrast(1.12) saturate(1.15) hue-rotate(8deg) brightness(0.95)',
    tintOverlay: 'rgba(65, 125, 220, 0.09)',
  },
];

function playMechanicalShutterSound() {
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(1150, now);
    osc.frequency.exponentialRampToValueAtTime(140, now + 0.045);

    gain.gain.setValueAtTime(0.18, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.055);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.06);

    setTimeout(() => {
      ctx.close().catch(() => {});
    }, 150);
  } catch {
    // Ignore audio context restrictions
  }
}

function formatQuartzDateStamp(): string {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `'${yy} ${mm} ${dd}`;
}

const CAMERA_SHOOTER_KEY_STORAGE = 'eventsapp_camera_shooter_key_v1';

function getOrCreateShooterKey(): string {
  try {
    const existing = localStorage.getItem(CAMERA_SHOOTER_KEY_STORAGE);
    if (existing && existing.trim()) return existing.trim();
    const created = `cam-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
    localStorage.setItem(CAMERA_SHOOTER_KEY_STORAGE, created);
    return created;
  } catch {
    return `cam-sess-${Math.random().toString(36).slice(2, 8)}`;
  }
}

type CollageLayout = '2-split' | '3-strip' | '4-grid' | '5-mosaic';
type CollageTheme = 'dark' | 'ivory';

export const DisposableCameraScreen: React.FC<DisposableCameraScreenProps> = ({
  mode,
  events,
  shots,
  rollSettings,
  alerts,
  profile,
  initialEventId,
  initialGuestName,
  initialPassCode,
  verifiedPass,
  onAddShot,
  onToggleLikeShot,
  onDeleteShot,
  onDevelopRoll,
  onUpdateRollSettings,
  onManageEvent,
  onNavigateSettings,
  onResolveAlert,
  onBack,
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

  const currentRollConfig: DisposableRollSettings = useMemo(() => {
    if (!selectedEvent) return { exposuresLimit: 24, darkroomMode: false };
    return rollSettings[selectedEvent.id] ?? { exposuresLimit: 24, darkroomMode: false };
  }, [selectedEvent, rollSettings]);

  // Camera hardware & viewfinder state
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const contactSheetRef = useRef<HTMLElement | null>(null);

  const [cameraActive, setCameraActive] = useState(false);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [flashMode, setFlashMode] = useState<'auto' | 'on' | 'off'>('auto');
  const [dateStampEnabled, setDateStampEnabled] = useState(true);
  const [selectedStock, setSelectedStock] = useState<FilmStock>('ilford-bw');
  const [guestName, setGuestName] = useState(
    verifiedPass?.attendeeName?.trim() ||
      initialGuestName?.trim() ||
      (mode === 'studio' ? profile.name : 'Guest Photographer')
  );
  const [guestNameTouched, setGuestNameTouched] = useState(false);
  const [editingGuestName, setEditingGuestName] = useState(false);
  const [caption, setCaption] = useState('');

  // Mobile (< lg) single-pane focus switcher: Camera vs Film Roll / Contact Sheet
  const [mobilePanel, setMobilePanel] = useState<'camera' | 'roll'>('camera');

  useEffect(() => {
    if (guestNameTouched) return;
    const incoming = verifiedPass?.attendeeName?.trim() || initialGuestName?.trim();
    if (incoming) {
      setGuestName(incoming);
    }
  }, [verifiedPass?.attendeeName, initialGuestName, guestNameTouched]);

  const activePassCode = (verifiedPass?.ticketCode || initialPassCode || '').trim().toUpperCase();

  const effectiveShooterKey = useMemo(() => {
    if (mode === 'studio' && profile.email?.trim()) {
      return `studio:${profile.email.trim().toLowerCase()}`;
    }
    if (activePassCode && selectedEvent?.id) {
      return `pass:${selectedEvent.id}:${activePassCode}`;
    }
    return getOrCreateShooterKey();
  }, [mode, profile.email, activePassCode, selectedEvent?.id]);

  // Tactile shutter + deletion states
  const [flashPulse, setFlashPulse] = useState(false);
  const [winding, setWinding] = useState(false);
  const [savingShot, setSavingShot] = useState(false);
  const [deletingShotId, setDeletingShotId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [zippingPhotos, setZippingPhotos] = useState(false);
  const [shotError, setShotError] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  // Gallery filter + Lightbox state
  const [searchQuery, setSearchQuery] = useState('');
  const [galleryTab, setGalleryTab] = useState<'all' | 'developed' | 'favorites'>('all');
  const [lightboxShot, setLightboxShot] = useState<DisposableShot | null>(null);

  // Interactive Photo Collage Studio state
  const [collageOpen, setCollageOpen] = useState(false);
  const [collageSelectedIds, setCollageSelectedIds] = useState<string[]>([]);
  const [collageLayout, setCollageLayout] = useState<CollageLayout>('5-mosaic');
  const [collageTheme, setCollageTheme] = useState<CollageTheme>('dark');
  const [collageTitle, setCollageTitle] = useState('');
  const [collagePreviewUrl, setCollagePreviewUrl] = useState<string | null>(null);
  const [collageRendering, setCollageRendering] = useState(false);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    window.setTimeout(() => {
      setToastMsg((curr) => (curr === msg ? null : curr));
    }, 2600);
  };

  useEffect(() => {
    if (!confirmDeleteId) return;
    const timer = window.setTimeout(() => {
      setConfirmDeleteId(null);
    }, 3500);
    return () => window.clearTimeout(timer);
  }, [confirmDeleteId]);

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
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  const startCamera = async (nextFacing: 'environment' | 'user' = facingMode) => {
    setCameraError(null);
    stopCamera();
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError(
        'Live camera unavailable here. Tap Gallery Upload or Shutter for a 35mm frame.'
      );
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: nextFacing },
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
        'Camera permission unavailable. Tap Upload or Shutter to snap onto the roll.'
      );
    }
  };

  const autoStartedSmsRef = useRef(false);
  useEffect(() => {
    if (autoStartedSmsRef.current) return;
    if (mode !== 'public') return;
    if (!initialPassCode && !initialGuestName && !verifiedPass) return;
    if (!navigator.mediaDevices?.getUserMedia) return;
    autoStartedSmsRef.current = true;
    void startCamera('environment');
  }, [mode, initialPassCode, initialGuestName, verifiedPass]);

  const handleFlipCamera = () => {
    const next = facingMode === 'environment' ? 'user' : 'environment';
    setFacingMode(next);
    if (cameraActive) {
      void startCamera(next);
    }
  };

  const eventShots = useMemo(
    () =>
      shots
        .filter((s) => !selectedEvent || s.eventId === selectedEvent.id)
        .sort((a, b) => b.frameNumber - a.frameNumber),
    [shots, selectedEvent]
  );

  const sealedCount = useMemo(
    () => eventShots.filter((s) => !s.developed).length,
    [eventShots]
  );

  const developedShots = useMemo(
    () => eventShots.filter((s) => s.developed),
    [eventShots]
  );

  const filteredShots = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return eventShots.filter((s) => {
      const matchesTab =
        galleryTab === 'all' ||
        (galleryTab === 'developed' ? s.developed : Boolean(s.liked));
      const matchesSearch =
        !q ||
        s.capturedBy.toLowerCase().includes(q) ||
        (s.caption ?? '').toLowerCase().includes(q) ||
        s.filmStock.toLowerCase().includes(q);
      return matchesTab && matchesSearch;
    });
  }, [eventShots, galleryTab, searchQuery]);

  const isOwnShot = (shot: DisposableShot): boolean =>
    Boolean(shot.shooterKey && shot.shooterKey === effectiveShooterKey);

  const canDeleteShot = (shot: DisposableShot): boolean =>
    mode === 'studio' || isOwnShot(shot);

  const myEventShots = useMemo(() => {
    const authorNorm = (guestName.trim() || 'Guest Photographer').toLowerCase();
    return eventShots.filter((s) =>
      s.shooterKey
        ? s.shooterKey === effectiveShooterKey
        : s.capturedBy.trim().toLowerCase() === authorNorm
    );
  }, [eventShots, effectiveShooterKey, guestName]);

  const myDevelopedShots = useMemo(
    () => myEventShots.filter((s) => s.developed),
    [myEventShots]
  );

  const userShotsUsed = myEventShots.length;
  const userShotsLeft = Math.max(0, MAX_SHOTS_PER_USER - userShotsUsed);
  const isUserLimitReached = userShotsUsed >= MAX_SHOTS_PER_USER;

  const rollRemaining = Math.max(0, currentRollConfig.exposuresLimit - eventShots.length);
  const isRollFull = eventShots.length >= currentRollConfig.exposuresLimit;
  const isCaptureDisabled = isRollFull || isUserLimitReached || savingShot;
  const activeStockMeta =
    FILM_STOCKS.find((f) => f.id === selectedStock) ?? FILM_STOCKS[0];

  const handleRequestDeleteShot = async (shot: DisposableShot) => {
    if (!canDeleteShot(shot) || deletingShotId === shot.id) return;

    if (confirmDeleteId !== shot.id) {
      setConfirmDeleteId(shot.id);
      return;
    }

    setConfirmDeleteId(null);
    setDeletingShotId(shot.id);
    try {
      const keyArg = mode === 'public' && isOwnShot(shot) ? effectiveShooterKey : undefined;
      await Promise.resolve(onDeleteShot(shot.id, keyArg));
      setCollageSelectedIds((prev) => prev.filter((id) => id !== shot.id));
      if (lightboxShot?.id === shot.id) {
        setLightboxShot(null);
      }
      setShotError(null);
      const frameCode = `${String(shot.frameNumber).padStart(2, '0')}A`;
      showToast(`Frame #${frameCode} deleted`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Unable to delete photo right now.');
    } finally {
      setDeletingShotId(null);
    }
  };

  const triggerShutterEffects = () => {
    playMechanicalShutterSound();
    if (flashMode !== 'off') {
      setFlashPulse(true);
      setTimeout(() => setFlashPulse(false), 220);
    }
    setWinding(true);
    setTimeout(() => setWinding(false), 360);
  };

  const finalizeCanvasToRoll = async (canvas: HTMLCanvasElement, stamp: string) => {
    if (!selectedEvent) return;
    if (isUserLimitReached) {
      setShotError(
        `Limit reached (${MAX_SHOTS_PER_USER}/${MAX_SHOTS_PER_USER}). Delete a photo from your roll to retake.`
      );
      return;
    }
    const ctx = canvas.getContext('2d');
    if (ctx) {
      const w = canvas.width;
      const h = canvas.height;

      ctx.fillStyle = activeStockMeta.tintOverlay;
      ctx.fillRect(0, 0, w, h);

      const grad = ctx.createRadialGradient(
        w / 2,
        h / 2,
        w * 0.25,
        w / 2,
        h / 2,
        w * 0.72
      );
      grad.addColorStop(0, 'rgba(0,0,0,0)');
      grad.addColorStop(1, 'rgba(0,0,0,0.34)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);

      ctx.fillStyle = 'rgba(255,255,255,0.055)';
      for (let i = 0; i < 650; i++) {
        const gx = Math.random() * w;
        const gy = Math.random() * h;
        ctx.fillRect(gx, gy, 1.4, 1.4);
      }

      if (dateStampEnabled) {
        const fontPx = Math.max(24, Math.round(w * 0.027));
        const marginX = Math.round(w * 0.035);
        const marginY = Math.round(h * 0.038);
        ctx.save();
        ctx.font = `bold ${fontPx}px "JetBrains Mono", monospace`;
        ctx.textAlign = 'right';
        ctx.shadowColor = 'rgba(255, 115, 29, 0.75)';
        ctx.shadowBlur = Math.round(fontPx * 0.3);
        ctx.fillStyle = '#FF8A2B';
        ctx.fillText(stamp, w - marginX, h - marginY);
        ctx.restore();
      }
    }

    const dataUrl = canvas.toDataURL('image/jpeg', 0.91);
    const nextFrame =
      eventShots.reduce((max, s) => Math.max(max, s.frameNumber), 0) + 1;

    const newShot: DisposableShot = {
      id: `shot-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      eventId: selectedEvent.id,
      frameNumber: nextFrame,
      dataUrl,
      capturedBy: guestName.trim() || 'Guest Photographer',
      shooterKey: effectiveShooterKey,
      caption: caption.trim() || undefined,
      filmStock: selectedStock,
      dateStamp: stamp,
      capturedAt: new Date().toLocaleTimeString('en-GB', {
        hour: '2-digit',
        minute: '2-digit',
      }),
      developed: !currentRollConfig.darkroomMode,
      likes: 0,
      liked: false,
    };

    setSavingShot(true);
    setShotError(null);
    try {
      const res = await Promise.resolve(onAddShot(newShot));
      if (res && res.ok === false) {
        setShotError(
          res.error ||
            `Limit reached (${MAX_SHOTS_PER_USER}/${MAX_SHOTS_PER_USER}). Delete a photo to retake.`
        );
        showToast(res.error || `Max ${MAX_SHOTS_PER_USER} pictures per user reached`);
        return;
      }
      setCaption('');
      showToast(
        currentRollConfig.darkroomMode
          ? `Frame #${String(nextFrame).padStart(2, '0')}A sealed (${userShotsUsed + 1}/${MAX_SHOTS_PER_USER})`
          : `Frame #${String(nextFrame).padStart(2, '0')}A captured (${userShotsUsed + 1}/${MAX_SHOTS_PER_USER})`
      );
    } finally {
      setSavingShot(false);
    }
  };

  const handleCaptureLiveOrDemo = () => {
    if (!selectedEvent || isCaptureDisabled) {
      if (isUserLimitReached) {
        setShotError(
          `You've used all ${MAX_SHOTS_PER_USER} shots. Delete a photo in your roll to retake or build a Collage.`
        );
      }
      return;
    }

    const stamp = formatQuartzDateStamp();
    const canvas = document.createElement('canvas');
    canvas.width = 1600;
    canvas.height = 1200;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    triggerShutterEffects();

    if (cameraActive && videoRef.current && videoRef.current.readyState >= 2) {
      const video = videoRef.current;
      const vw = video.videoWidth || 1600;
      const vh = video.videoHeight || 1200;
      const targetRatio = 1600 / 1200;
      const sourceRatio = vw / vh;

      let sx = 0;
      let sy = 0;
      let sw = vw;
      let sh = vh;
      if (sourceRatio > targetRatio) {
        sw = vh * targetRatio;
        sx = (vw - sw) / 2;
      } else {
        sh = vw / targetRatio;
        sy = (vh - sh) / 2;
      }

      ctx.save();
      ctx.filter = activeStockMeta.cssFilter;
      if (facingMode === 'user') {
        ctx.translate(canvas.width, 0);
        ctx.scale(-1, 1);
      }
      ctx.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
      ctx.restore();
      void finalizeCanvasToRoll(canvas, stamp);
      return;
    }

    // Procedural high-contrast documentary film frame fallback
    ctx.save();
    ctx.filter = activeStockMeta.cssFilter;
    const sceneScale = canvas.width / 960;
    ctx.scale(sceneScale, sceneScale);

    const bg = ctx.createLinearGradient(0, 0, 960, 720);
    bg.addColorStop(0, '#18181B');
    bg.addColorStop(0.55, '#27272A');
    bg.addColorStop(1, '#09090B');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, 960, 720);

    const beamOffsets = [220, 480, 740];
    beamOffsets.forEach((bx, idx) => {
      const beam = ctx.createRadialGradient(bx, 110, 12, bx + (idx - 1) * 40, 520, 380);
      beam.addColorStop(0, 'rgba(255, 245, 225, 0.72)');
      beam.addColorStop(0.45, 'rgba(255, 235, 205, 0.16)');
      beam.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = beam;
      ctx.beginPath();
      ctx.moveTo(bx - 35, 80);
      ctx.lineTo(bx + 35, 80);
      ctx.lineTo(bx + 210, 720);
      ctx.lineTo(bx - 210, 720);
      ctx.closePath();
      ctx.fill();
    });

    ctx.fillStyle = '#0B0B0B';
    for (let i = 0; i < 14; i++) {
      const px = 65 + i * 64 + ((i % 3) - 1) * 10;
      const py = 475 + (i % 2) * 28;
      ctx.beginPath();
      ctx.arc(px, py, 24, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.roundRect(px - 34, py + 24, 68, 220, 26);
      ctx.fill();
    }

    ctx.fillStyle = 'rgba(255,255,255,0.72)';
    ctx.font = '600 18px "Plus Jakarta Sans", sans-serif';
    ctx.fillText(`${selectedEvent.title} · ${selectedEvent.city}`, 38, 668);
    ctx.restore();

    void finalizeCanvasToRoll(canvas, stamp);
  };

  const handleUploadPhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !selectedEvent || isCaptureDisabled) return;

    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = 1600;
        canvas.height = 1200;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const targetRatio = 1600 / 1200;
        const sourceRatio = img.width / Math.max(1, img.height);
        let sx = 0;
        let sy = 0;
        let sw = img.width;
        let sh = img.height;

        if (sourceRatio > targetRatio) {
          sw = img.height * targetRatio;
          sx = (img.width - sw) / 2;
        } else {
          sh = img.width / targetRatio;
          sy = (img.height - sh) / 2;
        }

        triggerShutterEffects();
        ctx.save();
        ctx.filter = activeStockMeta.cssFilter;
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
        ctx.restore();
        void finalizeCanvasToRoll(canvas, formatQuartzDateStamp());
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  };

  const handleDownloadSinglePrint = (shot: DisposableShot) => {
    const link = document.createElement('a');
    link.href = shot.dataUrl;
    link.download = `${selectedEvent?.slug ?? 'event'}-frame-${String(shot.frameNumber).padStart(2, '0')}.jpg`;
    link.click();
    showToast(`Downloaded Frame #${String(shot.frameNumber).padStart(2, '0')}A`);
  };

  const handleDownloadMyPhotosZip = async () => {
    if (!selectedEvent || zippingPhotos) return;
    if (myDevelopedShots.length === 0) {
      showToast(
        myEventShots.length > 0
          ? 'Your photos are sealed in the darkroom until the organiser develops the roll.'
          : 'Capture your photos first to download your high-resolution ZIP roll.'
      );
      return;
    }

    setZippingPhotos(true);
    try {
      const ownShots = [...myDevelopedShots]
        .sort((a, b) => a.frameNumber - b.frameNumber)
        .slice(0, MAX_SHOTS_PER_USER);

      const folderName = `${selectedEvent.slug || selectedEvent.id}-my-photos`;
      const renderHighResJpegBytes = (shot: DisposableShot): Promise<Uint8Array> =>
        new Promise((resolve, reject) => {
          const img = new Image();
          img.crossOrigin = 'anonymous';
          img.onload = () => {
            const natW = img.naturalWidth || img.width || 1600;
            const natH = img.naturalHeight || img.height || 1200;
            const targetW = Math.max(2400, natW);
            const targetH = Math.round((targetW * natH) / Math.max(1, natW));

            const hiCanvas = document.createElement('canvas');
            hiCanvas.width = targetW;
            hiCanvas.height = targetH;
            const hiCtx = hiCanvas.getContext('2d');
            if (!hiCtx) {
              reject(new Error('Canvas unavailable for high-resolution export.'));
              return;
            }
            hiCtx.imageSmoothingEnabled = true;
            hiCtx.imageSmoothingQuality = 'high';
            hiCtx.drawImage(img, 0, 0, targetW, targetH);

            hiCanvas.toBlob(
              (blob) => {
                if (!blob) {
                  reject(new Error('Failed to encode high-resolution JPEG frame.'));
                  return;
                }
                blob
                  .arrayBuffer()
                  .then((buf) => resolve(new Uint8Array(buf)))
                  .catch(reject);
              },
              'image/jpeg',
              0.96
            );
          };
          img.onerror = () => {
            fetch(shot.dataUrl)
              .then((r) => r.arrayBuffer())
              .then((buf) => resolve(new Uint8Array(buf)))
              .catch(() => reject(new Error(`Unable to load frame #${shot.frameNumber}`)));
          };
          img.src = shot.dataUrl;
        });

      const entries: ZipFileEntry[] = [];
      for (let i = 0; i < ownShots.length; i++) {
        const shot = ownShots[i];
        const idxPrefix = String(i + 1).padStart(2, '0');
        const frameCode = `${String(shot.frameNumber).padStart(2, '0')}A`;
        const stockSlug = shot.filmStock.replace(/[^a-z0-9-]/gi, '-').toLowerCase();
        const bytes = await renderHighResJpegBytes(shot);
        entries.push({
          name: `${folderName}/${idxPrefix}-frame-${frameCode}-${stockSlug}.jpg`,
          data: bytes,
        });
      }

      const formattedEventDate = formatEventDateSpan(
        selectedEvent.isoDate,
        selectedEvent.endIsoDate,
        selectedEvent.date
      );
      const infoLines = [
        `${selectedEvent.title} — Personal 35mm Film Roll (High-Resolution Print Archive)`,
        `Date: ${formattedEventDate} · Venue: ${selectedEvent.venue}, ${selectedEvent.city}`,
        `Photographer: ${guestName.trim() || 'Guest Photographer'}${activePassCode ? ` · Pass: ${activePassCode}` : ''}`,
        `Frames Exported: ${ownShots.length} of ${MAX_SHOTS_PER_USER} max per user (2400px Hi-Res JPEG)`,
        '',
        ...ownShots.map((s, idx) => {
          const frameCode = `${String(s.frameNumber).padStart(2, '0')}A`;
          return `${idx + 1}. Frame ${frameCode} | ${s.filmStock} | ${s.capturedAt}${s.caption ? ` | "${s.caption}"` : ''}`;
        }),
      ].join('\n');

      entries.push({
        name: `${folderName}/roll-details.txt`,
        data: new TextEncoder().encode(infoLines),
      });

      const zipBlob = createZipBlob(entries);
      const url = URL.createObjectURL(zipBlob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${selectedEvent.slug || selectedEvent.id}-my-${ownShots.length}-photos-hi-res.zip`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.setTimeout(() => URL.revokeObjectURL(url), 4000);
      showToast(`Downloaded ${ownShots.length} high-res photo${ownShots.length > 1 ? 's' : ''} (.ZIP)`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not build high-resolution ZIP.');
    } finally {
      setZippingPhotos(false);
    }
  };

  const handleDownloadContactSheet = async () => {
    if (!selectedEvent || developedShots.length === 0) return;

    const cols = 3;
    const rows = Math.ceil(developedShots.length / cols);
    const thumbW = 360;
    const thumbH = 270;
    const pad = 36;
    const headerH = 110;

    const canvas = document.createElement('canvas');
    canvas.width = cols * thumbW + (cols + 1) * pad;
    canvas.height = headerH + rows * (thumbH + 54) + pad;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.fillStyle = '#0B0B0B';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 28px "Plus Jakarta Sans", sans-serif';
    ctx.fillText(`${selectedEvent.title.toUpperCase()} — 35MM CONTACT SHEET`, pad, 54);
    ctx.fillStyle = '#A1A1AA';
    ctx.font = '16px "JetBrains Mono", monospace';
    ctx.fillText(
      `${formatEventDateSpan(selectedEvent.isoDate, selectedEvent.endIsoDate, selectedEvent.date)} · ${selectedEvent.venue} · ${developedShots.length} EXPOSURES`,
      pad,
      84
    );

    const ordered = [...developedShots].sort((a, b) => a.frameNumber - b.frameNumber);

    await Promise.all(
      ordered.map(
        (shot, idx) =>
          new Promise<void>((resolve) => {
            const col = idx % cols;
            const row = Math.floor(idx / cols);
            const x = pad + col * (thumbW + pad);
            const y = headerH + row * (thumbH + 54);

            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => {
              ctx.fillStyle = '#18181B';
              ctx.fillRect(x - 4, y - 4, thumbW + 8, thumbH + 8);
              ctx.drawImage(img, x, y, thumbW, thumbH);
              ctx.fillStyle = '#F59E0B';
              ctx.font = 'bold 14px "JetBrains Mono", monospace';
              ctx.fillText(`${String(shot.frameNumber).padStart(2, '0')}A`, x, y + thumbH + 26);
              ctx.fillStyle = '#D4D4D8';
              ctx.font = '14px "DM Sans", sans-serif';
              ctx.fillText(
                `${shot.capturedBy} · ${shot.capturedAt}`,
                x + 42,
                y + thumbH + 26
              );
              resolve();
            };
            img.onerror = () => resolve();
            img.src = shot.dataUrl;
          })
      )
    );

    const link = document.createElement('a');
    link.href = canvas.toDataURL('image/png');
    link.download = `${selectedEvent.slug}-contact-sheet.png`;
    link.click();
    showToast('35mm Contact Sheet PNG exported');
  };

  const openCollageStudio = (preferMyShots = false) => {
    const sourcePool =
      preferMyShots && myDevelopedShots.length >= 2 ? myDevelopedShots : developedShots;
    if (sourcePool.length < 2) {
      showToast('Capture or develop at least 2 photos to create a collage.');
      return;
    }
    const picked = sourcePool.slice(0, MAX_SHOTS_PER_USER).map((s) => s.id);
    setCollageSelectedIds(picked);
    setCollageLayout(
      picked.length >= 5
        ? '5-mosaic'
        : picked.length === 4
          ? '4-grid'
          : picked.length === 3
            ? '3-strip'
            : '2-split'
    );
    setCollageTitle(selectedEvent?.title || 'Event Memories');
    setCollageOpen(true);
  };

  const toggleCollageShot = (shotId: string) => {
    setCollageSelectedIds((prev) => {
      if (prev.includes(shotId)) {
        return prev.length <= 2 ? prev : prev.filter((id) => id !== shotId);
      }
      if (prev.length >= MAX_SHOTS_PER_USER) {
        showToast(`Collages hold up to ${MAX_SHOTS_PER_USER} photos.`);
        return prev;
      }
      return [...prev, shotId];
    });
  };

  const collageShots = useMemo(() => {
    const map = new Map(developedShots.map((s) => [s.id, s]));
    return collageSelectedIds
      .map((id) => map.get(id))
      .filter((s): s is DisposableShot => Boolean(s));
  }, [collageSelectedIds, developedShots]);

  useEffect(() => {
    if (!collageOpen || collageShots.length === 0) return;
    let cancelled = false;
    setCollageRendering(true);

    const render = async () => {
      const width = 1440;
      const height = 1440;
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const isDark = collageTheme === 'dark';
      ctx.fillStyle = isDark ? '#0B0B0B' : '#F5F5F7';
      ctx.fillRect(0, 0, width, height);

      const pad = 56;
      const gap = 22;
      const footerH = 160;
      const areaX = pad;
      const areaY = pad;
      const areaW = width - pad * 2;
      const areaH = height - pad * 2 - footerH;

      const frames: Array<{ x: number; y: number; w: number; h: number }> = [];
      if (collageLayout === '2-split') {
        const cellW = (areaW - gap) / 2;
        frames.push({ x: areaX, y: areaY, w: cellW, h: areaH });
        frames.push({ x: areaX + cellW + gap, y: areaY, w: cellW, h: areaH });
      } else if (collageLayout === '3-strip') {
        const topH = Math.round(areaH * 0.56);
        const botH = areaH - topH - gap;
        const botW = (areaW - gap) / 2;
        frames.push({ x: areaX, y: areaY, w: areaW, h: topH });
        frames.push({ x: areaX, y: areaY + topH + gap, w: botW, h: botH });
        frames.push({ x: areaX + botW + gap, y: areaY + topH + gap, w: botW, h: botH });
      } else if (collageLayout === '4-grid') {
        const cw = (areaW - gap) / 2;
        const ch = (areaH - gap) / 2;
        frames.push({ x: areaX, y: areaY, w: cw, h: ch });
        frames.push({ x: areaX + cw + gap, y: areaY, w: cw, h: ch });
        frames.push({ x: areaX, y: areaY + ch + gap, w: cw, h: ch });
        frames.push({ x: areaX + cw + gap, y: areaY + ch + gap, w: cw, h: ch });
      } else {
        const topH = Math.round(areaH * 0.55);
        const botH = areaH - topH - gap;
        const topW = (areaW - gap) / 2;
        const botW = (areaW - gap * 2) / 3;
        frames.push({ x: areaX, y: areaY, w: topW, h: topH });
        frames.push({ x: areaX + topW + gap, y: areaY, w: topW, h: topH });
        frames.push({ x: areaX, y: areaY + topH + gap, w: botW, h: botH });
        frames.push({ x: areaX + botW + gap, y: areaY + topH + gap, w: botW, h: botH });
        frames.push({ x: areaX + (botW + gap) * 2, y: areaY + topH + gap, w: botW, h: botH });
      }

      await Promise.all(
        frames.map((rect, idx) => {
          const shot = collageShots[idx % collageShots.length];
          return new Promise<void>((resolve) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => {
              ctx.save();
              ctx.beginPath();
              ctx.roundRect(rect.x, rect.y, rect.w, rect.h, 24);
              ctx.clip();

              const targetRatio = rect.w / rect.h;
              const srcRatio = img.width / Math.max(1, img.height);
              let sx = 0;
              let sy = 0;
              let sw = img.width;
              let sh = img.height;
              if (srcRatio > targetRatio) {
                sw = img.height * targetRatio;
                sx = (img.width - sw) / 2;
              } else {
                sh = img.width / targetRatio;
                sy = (img.height - sh) / 2;
              }
              ctx.drawImage(img, sx, sy, sw, sh, rect.x, rect.y, rect.w, rect.h);
              ctx.restore();

              ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.14)' : 'rgba(11,11,11,0.08)';
              ctx.lineWidth = 2;
              ctx.beginPath();
              ctx.roundRect(rect.x, rect.y, rect.w, rect.h, 24);
              ctx.stroke();
              resolve();
            };
            img.onerror = () => resolve();
            img.src = shot.dataUrl;
          });
        })
      );

      const footY = height - pad - footerH + 46;
      ctx.fillStyle = isDark ? '#FFFFFF' : '#0B0B0B';
      ctx.font = 'bold 38px "Plus Jakarta Sans", sans-serif';
      ctx.fillText(
        (collageTitle.trim() || selectedEvent?.title || 'Event Memories').slice(0, 44),
        areaX,
        footY + 14
      );
      ctx.fillStyle = isDark ? '#A1A1AA' : '#71717A';
      ctx.font = '20px "JetBrains Mono", monospace';
      const collageFormattedDate = selectedEvent
        ? formatEventDateSpan(selectedEvent.isoDate, selectedEvent.endIsoDate, selectedEvent.date)
        : '';
      ctx.fillText(
        `${collageFormattedDate} · ${selectedEvent?.city || ''} · ${collageShots.length} FRAMES · EVENTS BY YOU 35MM`.toUpperCase(),
        areaX,
        footY + 56
      );

      if (!cancelled) {
        setCollagePreviewUrl(canvas.toDataURL('image/png'));
        setCollageRendering(false);
      }
    };

    void render();
    return () => {
      cancelled = true;
    };
  }, [
    collageOpen,
    collageShots,
    collageLayout,
    collageTheme,
    collageTitle,
    selectedEvent?.title,
    selectedEvent?.date,
    selectedEvent?.isoDate,
    selectedEvent?.endIsoDate,
    selectedEvent?.city,
  ]);

  const handleDownloadCollage = () => {
    if (!collagePreviewUrl) return;
    const link = document.createElement('a');
    link.href = collagePreviewUrl;
    link.download = `${selectedEvent?.slug ?? 'event'}-collage-${collageLayout}.png`;
    link.click();
    showToast('Photo Collage PNG downloaded!');
  };

  const handleShareCollage = async () => {
    if (!collagePreviewUrl) return;
    try {
      if (navigator.share) {
        const blob = await (await fetch(collagePreviewUrl)).blob();
        const file = new File([blob], `${selectedEvent?.slug ?? 'event'}-collage.png`, {
          type: 'image/png',
        });
        if (navigator.canShare?.({ files: [file] })) {
          await navigator.share({
            title: collageTitle || selectedEvent?.title || 'Event Collage',
            files: [file],
          });
          return;
        }
      }
    } catch {
      // Fallback to download
    }
    handleDownloadCollage();
  };

  const latestShot = eventShots[0] ?? null;

  return (
    <div
      className={
        mode === 'public'
          ? 'min-h-dvh bg-[#0B0B0B] lg:bg-[#F5F5F7] text-white lg:text-[#0B0B0B] antialiased flex flex-col overflow-x-hidden'
          : 'space-y-4 lg:space-y-6 overflow-x-hidden'
      }
    >
      {/* Compact Public Top Bar — Mobile WhatsApp Dark Header / Desktop Frosted Bar */}
      {mode === 'public' && (
        <header className="sticky top-0 z-40 w-full bg-[#0B0B0B]/95 lg:bg-[#F5F5F7]/90 backdrop-blur-xl border-b border-white/10 lg:border-[#E5E5EA]">
          <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-10 h-14 flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 min-w-0">
              {onBack && (
                <button
                  type="button"
                  onClick={() => {
                    stopCamera();
                    onBack();
                  }}
                  aria-label="Go Back"
                  className="w-11 h-11 rounded-full hover:bg-white/10 lg:hover:bg-[#E8E8EA] flex items-center justify-center text-white lg:text-[#0B0B0B] transition-colors shrink-0"
                >
                  <ArrowLeft className="w-5 h-5" />
                </button>
              )}
              <div className="min-w-0">
                <h1 className="font-display text-sm sm:text-base font-bold text-white lg:text-[#0B0B0B] truncate">
                  {selectedEvent?.title || 'Disposable Camera'}
                </h1>
                <p className="text-[11px] font-mono text-zinc-400 lg:text-[#71717A] truncate tabular-nums">
                  {userShotsLeft}/{MAX_SHOTS_PER_USER} shots left · {eventShots.length}/{currentRollConfig.exposuresLimit} roll
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              {/* Mobile Camera / Roll Quick Toggle */}
              <div className="lg:hidden inline-flex items-center p-0.5 rounded-full bg-white/10 border border-white/10">
                <button
                  type="button"
                  onClick={() => setMobilePanel('camera')}
                  className={`min-h-[36px] px-3 rounded-full text-[11px] font-semibold transition-colors ${
                    mobilePanel === 'camera'
                      ? 'bg-white text-[#0B0B0B]'
                      : 'text-zinc-300'
                  }`}
                >
                  Camera
                </button>
                <button
                  type="button"
                  onClick={() => setMobilePanel('roll')}
                  className={`min-h-[36px] px-3 rounded-full text-[11px] font-semibold transition-colors tabular-nums ${
                    mobilePanel === 'roll'
                      ? 'bg-white text-[#0B0B0B]'
                      : 'text-zinc-300'
                  }`}
                >
                  Roll ({eventShots.length})
                </button>
              </div>
            </div>
          </div>

          {/* Slim Single-Line Checked-In Pass Strip */}
          {(verifiedPass || activePassCode || initialGuestName) && (
            <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-10 py-1.5 border-t border-white/10 lg:border-[#E5E5EA] bg-emerald-500/10 lg:bg-[#0B0B0B] text-emerald-200 lg:text-white flex items-center justify-between gap-2 text-[11px]">
              <span className="inline-flex items-center gap-1.5 font-medium truncate">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span className="truncate">
                  {verifiedPass?.attendeeName || initialGuestName || 'Checked-In Guest'}
                  {activePassCode ? ` · ${activePassCode}` : ''}
                </span>
              </span>
              <span className="font-mono font-bold tabular-nums shrink-0 text-white">
                {userShotsLeft}/{MAX_SHOTS_PER_USER} left
              </span>
            </div>
          )}
        </header>
      )}

      <div
        className={
          mode === 'public'
            ? 'flex-1 w-full max-w-7xl mx-auto px-0 sm:px-6 lg:px-10 py-0 sm:py-5 lg:py-8 flex flex-col lg:block space-y-0 lg:space-y-6'
            : 'space-y-4 lg:space-y-6'
        }
      >
        {/* Toast feedback */}
        {toastMsg && (
          <div className="fixed bottom-24 lg:bottom-6 left-1/2 -translate-x-1/2 lg:left-auto lg:translate-x-0 lg:right-6 z-50 px-4 py-2.5 rounded-full bg-white lg:bg-[#0B0B0B] text-[#0B0B0B] lg:text-white text-xs font-semibold shadow-2xl border border-black/10 lg:border-white/15 flex items-center gap-2 whitespace-nowrap max-w-[92vw]">
            <Check className="w-3.5 h-3.5 text-emerald-600 lg:text-emerald-400 shrink-0" />
            <span className="truncate">{toastMsg}</span>
          </div>
        )}

        {/* Studio Header & Utility Bar */}
        {mode === 'studio' && (
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            <div>
              <h1 className="font-display text-2xl sm:text-[32px] font-bold tracking-[-0.02em] text-[#0B0B0B]">
                Event Disposable Camera
              </h1>
              <p className="text-xs sm:text-sm text-[#71717A] mt-0.5">
                35mm shared guest film rolls — capture, review, delete, develop, and export contact sheets.
              </p>
            </div>

            <div className="lg:w-[440px]">
              <TopUtilityBar
                searchQuery={searchQuery}
                onSearchChange={setSearchQuery}
                searchPlaceholder="Filter photos by guest or film stock..."
                alerts={alerts}
                onResolveAlert={onResolveAlert ?? (() => {})}
                onInspectAlertEvent={(id) => {
                  const found = events.find((e) => e.id === id);
                  if (found && onManageEvent) onManageEvent(found);
                }}
                profile={profile}
                onOpenSettings={onNavigateSettings ?? (() => {})}
              />
            </div>
          </div>
        )}

        {/* Active Event Film Roll Context Bar (Compact on mobile; full stats on desktop) */}
        {selectedEvent && (
          <section
            className={`${
              mode === 'public' ? 'hidden lg:flex' : 'flex'
            } p-3.5 sm:p-5 rounded-2xl sm:rounded-3xl bg-[#F5F5F7] border border-[#E5E5EA] flex-col lg:flex-row lg:items-center justify-between gap-3`}
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-xl bg-[#0B0B0B] text-white flex items-center justify-center shrink-0">
                <Film className="w-5 h-5" />
              </div>
              <div className="min-w-0 flex-1">
                <span className="block text-[11px] font-semibold text-[#71717A] truncate">
                  {selectedEvent.category} · {selectedEvent.city} · {userShotsUsed}/{MAX_SHOTS_PER_USER} yours ·{' '}
                  {String(eventShots.length).padStart(2, '0')}/{currentRollConfig.exposuresLimit} EXP
                </span>
                <select
                  aria-label="Select event film roll"
                  value={selectedEvent.id}
                  onChange={(e) => {
                    setSelectedEventId(e.target.value);
                    setLightboxShot(null);
                  }}
                  className="mt-1 w-full sm:w-auto max-w-full h-10 px-3.5 rounded-full bg-white border border-[#E5E5EA] text-xs sm:text-sm font-bold text-[#0B0B0B] focus:border-[#0B0B0B] focus:outline-none cursor-pointer"
                >
                  {events.map((evt) => (
                    <option key={evt.id} value={evt.id}>
                      {evt.title} ({evt.category})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between lg:justify-end gap-2.5 shrink-0">
              <div className="hidden sm:flex items-center gap-3 px-4 py-2 rounded-2xl bg-white border border-[#E5E5EA] text-xs tabular-nums">
                <span className="font-mono font-bold text-[#0B0B0B]">
                  {userShotsUsed}/{MAX_SHOTS_PER_USER} Shots
                </span>
                <span className="text-[#D4D4D8]">·</span>
                <span className="font-mono font-bold text-[#0B0B0B]">
                  {String(eventShots.length).padStart(2, '0')}/{currentRollConfig.exposuresLimit} EXP
                </span>
                <span className="text-[#D4D4D8]">·</span>
                <span className="font-mono font-bold text-emerald-700">{rollRemaining} Left</span>
              </div>

              {/* Studio Mobile View Switcher */}
              {mode === 'studio' && (
                <div className="lg:hidden inline-flex items-center p-1 rounded-full bg-white border border-[#E5E5EA]">
                  <button
                    type="button"
                    onClick={() => setMobilePanel('camera')}
                    className={`min-h-[36px] px-3.5 rounded-full text-xs font-semibold transition-colors ${
                      mobilePanel === 'camera'
                        ? 'bg-[#0B0B0B] text-white'
                        : 'text-[#71717A]'
                    }`}
                  >
                    Camera
                  </button>
                  <button
                    type="button"
                    onClick={() => setMobilePanel('roll')}
                    className={`min-h-[36px] px-3.5 rounded-full text-xs font-semibold transition-colors tabular-nums ${
                      mobilePanel === 'roll'
                        ? 'bg-[#0B0B0B] text-white'
                        : 'text-[#71717A]'
                    }`}
                  >
                    Roll ({eventShots.length})
                  </button>
                </div>
              )}

              {mode === 'studio' && onManageEvent && (
                <button
                  type="button"
                  onClick={() => onManageEvent(selectedEvent)}
                  className="min-h-[40px] px-4 rounded-full bg-white border border-[#E5E5EA] hover:border-[#0B0B0B] text-xs font-semibold text-[#0B0B0B] transition-colors whitespace-nowrap"
                >
                  Workspace
                </button>
              )}
            </div>
          </section>
        )}

        {/* MAIN RESPONSIVE LAYOUT: WhatsApp Camera UI (Left 5 cols) + Event Film Roll (Right 7 cols) */}
        <div
          className={
            mode === 'public'
              ? 'flex-1 flex flex-col lg:grid lg:grid-cols-12 lg:gap-6 lg:items-start'
              : 'grid grid-cols-1 lg:grid-cols-12 gap-5 lg:gap-6 items-start'
          }
        >
          {/* LEFT 5 COLS: WhatsApp-Style Full-Bleed Dark Camera UI */}
          <section
            className={`${
              mobilePanel === 'camera' ? 'flex' : 'hidden lg:flex'
            } lg:col-span-5 flex-col bg-[#0B0B0B] text-white overflow-hidden shadow-2xl ${
              mode === 'public'
                ? 'flex-1 min-h-[calc(100dvh-3.6rem)] sm:min-h-[600px] sm:rounded-3xl lg:min-h-0'
                : 'rounded-2xl sm:rounded-3xl min-h-[540px] sm:min-h-0'
            }`}
          >
            {/* Full-Bleed Viewfinder Canvas with Floating WhatsApp Overlays */}
            <div className="relative flex-1 min-h-[290px] sm:min-h-[320px] lg:aspect-[4/3] lg:flex-none w-full bg-zinc-950 overflow-hidden flex items-center justify-center">
              {cameraActive ? (
                <video
                  ref={videoRef}
                  muted
                  playsInline
                  style={{
                    filter: activeStockMeta.cssFilter,
                    transform: facingMode === 'user' ? 'scaleX(-1)' : undefined,
                  }}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="p-6 text-center space-y-3.5 max-w-xs z-10">
                  <button
                    type="button"
                    onClick={() => void startCamera()}
                    className="w-16 h-16 rounded-full bg-white/15 hover:bg-white/25 border border-white/25 mx-auto flex items-center justify-center transition-all active:scale-95"
                    aria-label="Enable live camera viewfinder"
                  >
                    <Camera className="w-7 h-7 text-white" />
                  </button>
                  <div className="space-y-1">
                    <p className="text-xs font-semibold text-white">
                      {cameraError ? 'Live Viewfinder Offline' : 'Tap to Open Camera'}
                    </p>
                    <p className="text-[11px] text-zinc-300 leading-relaxed">
                      {cameraError
                        ? cameraError
                        : 'Enable your camera or tap the shutter below to snap an instant 35mm film frame.'}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void startCamera()}
                    className="min-h-[44px] px-5 rounded-full bg-white text-[#0B0B0B] text-xs font-bold hover:bg-zinc-200 transition-colors inline-flex items-center gap-2"
                  >
                    <Camera className="w-4 h-4" />
                    <span>Enable Live Camera</span>
                  </button>
                </div>
              )}

              {/* Subtle Viewfinder Framing Corners */}
              <div className="absolute inset-3 sm:inset-4 pointer-events-none">
                <div className="absolute top-0 left-0 w-4 h-4 border-t-2 border-l-2 border-white/60 rounded-tl-md" />
                <div className="absolute top-0 right-0 w-4 h-4 border-t-2 border-r-2 border-white/60 rounded-tr-md" />
                <div className="absolute bottom-0 left-0 w-4 h-4 border-b-2 border-l-2 border-white/60 rounded-bl-md" />
                <div className="absolute bottom-0 right-0 w-4 h-4 border-b-2 border-r-2 border-white/60 rounded-br-md" />
              </div>

              {/* Floating Top Translucent Toolbar (Flash, Date Stamp, Event Roll Switcher, Camera Power) */}
              <div className="absolute top-0 inset-x-0 p-2.5 sm:p-3 bg-gradient-to-b from-black/75 via-black/35 to-transparent flex items-center justify-between gap-2 z-20">
                <div className="flex items-center gap-1.5 min-w-0">
                  <button
                    type="button"
                    onClick={() =>
                      setFlashMode((prev) =>
                        prev === 'auto' ? 'on' : prev === 'on' ? 'off' : 'auto'
                      )
                    }
                    title="Cycle Flash Mode"
                    aria-label={`Flash ${flashMode}`}
                    className={`min-h-[44px] min-w-[44px] px-3 rounded-full backdrop-blur-md text-[11px] font-semibold inline-flex items-center justify-center gap-1 transition-colors ${
                      flashMode === 'off'
                        ? 'bg-black/50 text-zinc-300'
                        : 'bg-amber-400/25 text-amber-200 border border-amber-300/30'
                    }`}
                  >
                    {flashMode === 'off' ? (
                      <ZapOff className="w-4 h-4" />
                    ) : (
                      <Zap className="w-4 h-4" />
                    )}
                    <span className="capitalize">{flashMode}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setDateStampEnabled((v) => !v)}
                    aria-label="Toggle 35mm date stamp"
                    className={`min-h-[44px] px-3 rounded-full backdrop-blur-md font-mono text-[11px] font-bold transition-colors ${
                      dateStampEnabled
                        ? 'bg-black/55 text-[#FF8A2B] border border-[#FF8A2B]/35'
                        : 'bg-black/45 text-zinc-400'
                    }`}
                  >
                    {dateStampEnabled ? formatQuartzDateStamp() : 'Stamp Off'}
                  </button>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  {!initialEventId && events.length > 1 && mode === 'public' && (
                    <select
                      aria-label="Switch event roll"
                      value={selectedEvent?.id || ''}
                      onChange={(e) => {
                        setSelectedEventId(e.target.value);
                        setLightboxShot(null);
                      }}
                      className="h-11 max-w-[130px] px-3 rounded-full bg-black/55 backdrop-blur-md border border-white/20 text-[11px] font-semibold text-white focus:outline-none truncate"
                    >
                      {events.map((evt) => (
                        <option key={evt.id} value={evt.id} className="text-[#0B0B0B]">
                          {evt.title}
                        </option>
                      ))}
                    </select>
                  )}

                  <button
                    type="button"
                    onClick={() => (cameraActive ? stopCamera() : void startCamera())}
                    aria-label={cameraActive ? 'Pause live camera' : 'Start live camera'}
                    className={`w-11 h-11 rounded-full backdrop-blur-md flex items-center justify-center transition-colors ${
                      cameraActive
                        ? 'bg-black/55 text-white hover:bg-black/75'
                        : 'bg-white/20 text-white hover:bg-white/30'
                    }`}
                  >
                    {cameraActive ? (
                      <CameraOff className="w-4 h-4" />
                    ) : (
                      <Camera className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>

              {/* WhatsApp-Style Floating Recent Captures Strip at Bottom of Viewfinder */}
              {eventShots.length > 0 && (
                <div className="absolute bottom-0 inset-x-0 px-2.5 pt-6 pb-2 bg-gradient-to-t from-black/80 via-black/40 to-transparent z-20">
                  <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-0.5">
                    {eventShots.slice(0, 10).map((shot) => {
                      const canDel = canDeleteShot(shot);
                      const isConfirming = confirmDeleteId === shot.id;
                      const frameCode = `${String(shot.frameNumber).padStart(2, '0')}A`;
                      return (
                        <div
                          key={shot.id}
                          className="relative w-14 h-14 rounded-xl overflow-hidden border border-white/30 bg-zinc-900 shrink-0 shadow-md"
                        >
                          <button
                            type="button"
                            onClick={() => {
                              if (shot.developed) {
                                setLightboxShot(shot);
                              } else {
                                setMobilePanel('roll');
                                contactSheetRef.current?.scrollIntoView({ behavior: 'smooth' });
                              }
                            }}
                            aria-label={`Preview frame ${frameCode}`}
                            className="w-full h-full block"
                          >
                            {shot.developed ? (
                              <img
                                src={shot.dataUrl}
                                alt={shot.caption || `Frame ${frameCode}`}
                                referrerPolicy="no-referrer"
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <div className="w-full h-full flex flex-col items-center justify-center bg-[#18181B] text-zinc-300">
                                <Lock className="w-3.5 h-3.5" />
                                <span className="text-[9px] font-mono mt-0.5">{frameCode}</span>
                              </div>
                            )}
                          </button>
                          {canDel && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                void handleRequestDeleteShot(shot);
                              }}
                              disabled={deletingShotId === shot.id}
                              aria-label={
                                isConfirming
                                  ? `Confirm delete frame ${frameCode}`
                                  : `Delete frame ${frameCode}`
                              }
                              title={isConfirming ? 'Tap again to delete' : 'Delete photo'}
                              className={`absolute top-0.5 right-0.5 min-w-[24px] h-6 px-1 rounded-full flex items-center justify-center transition-colors shadow ${
                                isConfirming
                                  ? 'bg-[#EF4444] text-white text-[9px] font-bold'
                                  : 'bg-black/70 hover:bg-[#EF4444] text-white'
                              }`}
                            >
                              {isConfirming ? (
                                <span>Del?</span>
                              ) : (
                                <X className="w-3 h-3" />
                              )}
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Quartz Date Stamp Overlay Preview (when no bottom strip overlap or subtle top-right under toolbar) */}
              {dateStampEnabled && eventShots.length === 0 && (
                <span className="absolute bottom-3 right-3.5 font-mono text-xs font-bold text-[#FF8A2B] tracking-wider drop-shadow pointer-events-none">
                  {formatQuartzDateStamp()}
                </span>
              )}

              {/* Shutter Flash Pulse Overlay */}
              {flashPulse && (
                <div className="absolute inset-0 bg-white pointer-events-none z-30 transition-opacity duration-200" />
              )}
            </div>

            {/* Bottom WhatsApp Camera Controls Deck */}
            <div className="bg-[#0B0B0B] px-3 sm:px-4 pt-2.5 pb-4 sm:pb-5 space-y-2.5 border-t border-white/10">
              {shotError && (
                <div className="px-3 py-2 rounded-2xl bg-[#EF4444]/15 border border-[#EF4444]/35 text-[11px] text-red-200 text-center">
                  {shotError}
                </div>
              )}

              {/* Film Emulsion Single-Row Horizontal Selector */}
              <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
                {FILM_STOCKS.map((stock) => {
                  const active = selectedStock === stock.id;
                  return (
                    <button
                      key={stock.id}
                      type="button"
                      onClick={() => setSelectedStock(stock.id)}
                      className={`min-h-[36px] px-3 rounded-full text-[11px] font-semibold whitespace-nowrap shrink-0 border transition-colors ${
                        active
                          ? 'bg-white text-[#0B0B0B] border-white'
                          : 'bg-white/5 text-zinc-300 border-white/15 hover:bg-white/15'
                      }`}
                    >
                      {stock.label}
                    </button>
                  );
                })}
              </div>

              {/* WhatsApp-Style "Add a caption..." Bar + Collapsible Photographer Chip */}
              <div className="flex items-center gap-2">
                {editingGuestName ? (
                  <div className="flex items-center gap-1.5 flex-1 bg-white/10 border border-white/25 rounded-full px-3 h-10">
                    <User className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                    <input
                      type="text"
                      value={guestName}
                      onChange={(e) => {
                        setGuestNameTouched(true);
                        setGuestName(e.target.value);
                      }}
                      placeholder="Your name"
                      aria-label="Photographer name"
                      autoFocus
                      className="w-full bg-transparent text-xs text-white placeholder:text-zinc-400 focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => setEditingGuestName(false)}
                      aria-label="Done editing name"
                      className="w-7 h-7 rounded-full bg-white text-[#0B0B0B] flex items-center justify-center shrink-0"
                    >
                      <Check className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => setEditingGuestName(true)}
                      aria-label="Change photographer name"
                      className="h-10 max-w-[132px] px-3 rounded-full bg-white/10 hover:bg-white/15 border border-white/15 text-[11px] font-semibold text-zinc-200 inline-flex items-center gap-1.5 shrink-0"
                    >
                      <User className="w-3 h-3 text-zinc-400 shrink-0" />
                      <span className="truncate">{guestName || 'Guest'}</span>
                      <Pencil className="w-2.5 h-2.5 text-zinc-400 shrink-0" />
                    </button>
                    <input
                      type="text"
                      value={caption}
                      onChange={(e) => setCaption(e.target.value)}
                      placeholder="Add a caption..."
                      aria-label="Photo caption"
                      className="flex-1 min-w-0 h-10 px-3.5 rounded-full bg-white/10 border border-white/15 text-xs text-white placeholder:text-zinc-400 focus:bg-white focus:text-[#0B0B0B] focus:outline-none transition-colors"
                    />
                  </>
                )}
              </div>

              {/* Iconic 3-Zone WhatsApp Thumb-Zone Shutter Deck */}
              <div className="flex items-center justify-between gap-2 pt-1">
                {/* Left Zone: Roll Gallery Button + Device Upload */}
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setMobilePanel('roll');
                      contactSheetRef.current?.scrollIntoView({ behavior: 'smooth' });
                    }}
                    aria-label="Open event film roll gallery"
                    className="relative w-12 h-12 rounded-2xl bg-white/10 hover:bg-white/20 border border-white/20 overflow-hidden flex items-center justify-center transition-colors shrink-0"
                  >
                    {latestShot && latestShot.developed ? (
                      <img
                        src={latestShot.dataUrl}
                        alt="Latest captured frame"
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <Film className="w-5 h-5 text-white" />
                    )}
                    <span className="absolute -bottom-0.5 -right-0.5 min-w-[20px] h-5 px-1 rounded-tl-lg bg-[#0B0B0B]/90 text-white text-[10px] font-mono font-bold flex items-center justify-center tabular-nums">
                      {eventShots.length}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isCaptureDisabled}
                    aria-label="Upload photo from gallery"
                    title="Upload photo from device"
                    className="w-11 h-11 rounded-full bg-white/10 hover:bg-white/20 disabled:opacity-40 text-white flex items-center justify-center transition-colors shrink-0"
                  >
                    <ImagePlus className="w-5 h-5" />
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    onChange={handleUploadPhoto}
                    className="hidden"
                  />
                </div>

                {/* Center Zone: Circular Tactile WhatsApp Shutter Ring */}
                <div className="flex flex-col items-center">
                  <button
                    type="button"
                    onClick={handleCaptureLiveOrDemo}
                    disabled={isCaptureDisabled}
                    aria-label={
                      isRollFull
                        ? 'Film roll full'
                        : isUserLimitReached
                          ? 'User shot limit reached'
                          : 'Take photo'
                    }
                    className={`w-[72px] h-[72px] rounded-full p-1 flex items-center justify-center transition-all active:scale-90 shadow-xl ${
                      isCaptureDisabled
                        ? 'border-[4px] border-zinc-600 opacity-60 cursor-not-allowed'
                        : 'border-[4px] border-white hover:scale-[1.03]'
                    }`}
                  >
                    <span
                      className={`w-full h-full rounded-full flex items-center justify-center transition-colors ${
                        isCaptureDisabled ? 'bg-zinc-600' : 'bg-white'
                      }`}
                    >
                      {savingShot || winding ? (
                        <Aperture className="w-6 h-6 text-[#0B0B0B] animate-spin" />
                      ) : null}
                    </span>
                  </button>
                </div>

                {/* Right Zone: Flip Camera + Quick Collage Icon */}
                <div className="flex items-center gap-2">
                  {developedShots.length >= 2 && (
                    <button
                      type="button"
                      onClick={() => openCollageStudio(myDevelopedShots.length >= 2)}
                      aria-label="Open photo collage studio"
                      title="Photo Collage"
                      className="w-11 h-11 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors shrink-0"
                    >
                      <LayoutGrid className="w-5 h-5" />
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={handleFlipCamera}
                    aria-label="Flip front or rear camera"
                    title="Flip Camera"
                    className="w-12 h-12 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors shrink-0"
                  >
                    <RefreshCw className="w-5 h-5" />
                  </button>
                </div>
              </div>

              {/* Compact Bottom Counter + Hi-Res Export Bar */}
              <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5 text-[11px] font-mono text-zinc-400 tabular-nums">
                <span>
                  {isRollFull
                    ? `Roll full (${currentRollConfig.exposuresLimit}/${currentRollConfig.exposuresLimit})`
                    : isUserLimitReached
                      ? `${MAX_SHOTS_PER_USER}/${MAX_SHOTS_PER_USER} used · Delete one to retake`
                      : currentRollConfig.darkroomMode
                        ? `Darkroom · ${userShotsLeft}/${MAX_SHOTS_PER_USER} left`
                        : `${userShotsLeft}/${MAX_SHOTS_PER_USER} shots left · ${activeStockMeta.shortLabel}`}
                </span>

                <div className="flex items-center gap-2">
                  {myDevelopedShots.length > 0 && (
                    <button
                      type="button"
                      disabled={zippingPhotos}
                      onClick={() => void handleDownloadMyPhotosZip()}
                      className="px-2.5 py-1 rounded-full bg-white text-[#0B0B0B] font-sans font-bold text-[11px] inline-flex items-center gap-1 hover:bg-zinc-200 disabled:opacity-50"
                    >
                      <Archive className="w-3 h-3" />
                      <span>{zippingPhotos ? 'ZIP...' : `My ZIP (${myDevelopedShots.length})`}</span>
                    </button>
                  )}
                </div>
              </div>
            </div>
          </section>

          {/* RIGHT 7 COLS: 35mm Event Film Roll & Contact Sheet */}
          <section
            ref={contactSheetRef}
            className={`${
              mobilePanel === 'roll' ? 'block' : 'hidden lg:block'
            } lg:col-span-7 bg-white text-[#0B0B0B] rounded-none sm:rounded-3xl border-0 sm:border border-[#E5E5EA] overflow-hidden shadow-sm`}
          >
            {/* Contact Sheet Toolbar */}
            <div className="p-4 sm:p-5 border-b border-[#E5E5EA] bg-[#F5F5F7]/80 flex flex-col gap-3.5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h2 className="font-display text-base sm:text-lg font-bold text-[#0B0B0B]">
                      35mm Event Film Roll
                    </h2>
                    <p className="text-xs text-[#71717A] tabular-nums">
                      {eventShots.length} exposures · {developedShots.length} developed ·{' '}
                      {sealedCount} sealed
                    </p>
                  </div>

                  {/* Mobile quick return to Camera */}
                  <button
                    type="button"
                    onClick={() => setMobilePanel('camera')}
                    className="lg:hidden min-h-[40px] px-3.5 rounded-full bg-[#0B0B0B] text-white text-xs font-semibold inline-flex items-center gap-1.5 shrink-0"
                  >
                    <Camera className="w-3.5 h-3.5" />
                    <span>Snap Photo</span>
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {developedShots.length >= 2 && (
                    <button
                      type="button"
                      onClick={() => openCollageStudio(myDevelopedShots.length >= 2)}
                      className="min-h-[40px] px-3.5 rounded-full bg-[#0B0B0B] text-white hover:bg-neutral-800 text-xs font-semibold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap"
                    >
                      <LayoutGrid className="w-3.5 h-3.5" />
                      <span>
                        {myDevelopedShots.length >= 2
                          ? `Collage (${Math.min(MAX_SHOTS_PER_USER, myDevelopedShots.length)})`
                          : 'Make Collage'}
                      </span>
                    </button>
                  )}

                  {myDevelopedShots.length > 0 && (
                    <button
                      type="button"
                      disabled={zippingPhotos}
                      onClick={() => void handleDownloadMyPhotosZip()}
                      className="min-h-[40px] px-3.5 rounded-full bg-white border border-[#0B0B0B] hover:bg-[#0B0B0B] hover:text-white disabled:opacity-50 text-xs font-semibold text-[#0B0B0B] inline-flex items-center gap-1.5 transition-colors whitespace-nowrap"
                    >
                      <Archive className="w-3.5 h-3.5" />
                      <span>
                        {zippingPhotos
                          ? 'Packing .ZIP...'
                          : `My .ZIP (${Math.min(MAX_SHOTS_PER_USER, myDevelopedShots.length)}/${MAX_SHOTS_PER_USER})`}
                      </span>
                    </button>
                  )}

                  {developedShots.length > 0 && (
                    <button
                      type="button"
                      onClick={handleDownloadContactSheet}
                      className="min-h-[40px] px-3.5 rounded-full bg-white border border-[#E5E5EA] hover:border-[#0B0B0B] text-xs font-semibold text-[#0B0B0B] inline-flex items-center gap-1.5 transition-colors whitespace-nowrap"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Contact Sheet</span>
                    </button>
                  )}

                  {mode === 'studio' && sealedCount > 0 && selectedEvent && (
                    <button
                      type="button"
                      onClick={() => {
                        void (async () => {
                          try {
                            await Promise.resolve(onDevelopRoll(selectedEvent.id));
                            showToast(`Developed ${sealedCount} film negatives!`);
                          } catch (err) {
                            showToast(
                              err instanceof Error
                                ? err.message
                                : 'Unable to develop negatives right now.'
                            );
                          }
                        })();
                      }}
                      className="min-h-[40px] px-4 rounded-full bg-[#0B0B0B] text-white hover:bg-neutral-800 text-xs font-semibold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap"
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      <span>Develop {sealedCount} Negatives</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Filter Tabs + Organizer Darkroom Controls */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                <div className="inline-flex items-center gap-1 p-1 bg-white rounded-full border border-[#E5E5EA] self-start overflow-x-auto max-w-full">
                  {(
                    [
                      { id: 'all', label: `All (${eventShots.length})` },
                      { id: 'developed', label: `Developed (${developedShots.length})` },
                      {
                        id: 'favorites',
                        label: `Favs (${eventShots.filter((s) => s.liked).length})`,
                      },
                    ] as const
                  ).map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setGalleryTab(tab.id)}
                      className={`min-h-[34px] px-3 rounded-full text-[11px] font-semibold transition-colors whitespace-nowrap tabular-nums ${
                        galleryTab === tab.id
                          ? 'bg-[#0B0B0B] text-white'
                          : 'text-[#71717A] hover:text-[#0B0B0B]'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>

                {mode === 'studio' && selectedEvent ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        void Promise.resolve(
                          onUpdateRollSettings(selectedEvent.id, {
                            ...currentRollConfig,
                            darkroomMode: !currentRollConfig.darkroomMode,
                          })
                        ).catch((err) => {
                          showToast(
                            err instanceof Error
                              ? err.message
                              : 'Unable to update darkroom mode.'
                          );
                        });
                      }}
                      className={`min-h-[36px] px-3 rounded-full text-[11px] font-semibold border inline-flex items-center gap-1.5 transition-colors whitespace-nowrap ${
                        currentRollConfig.darkroomMode
                          ? 'bg-[#0B0B0B] text-white border-[#0B0B0B]'
                          : 'bg-white text-[#0B0B0B] border-[#E5E5EA] hover:border-[#0B0B0B]'
                      }`}
                    >
                      {currentRollConfig.darkroomMode ? (
                        <>
                          <Lock className="w-3 h-3" />
                          <span>Darkroom Seal: ON</span>
                        </>
                      ) : (
                        <>
                          <Unlock className="w-3 h-3" />
                          <span>Instant Reveal</span>
                        </>
                      )}
                    </button>

                    <div className="inline-flex items-center gap-1 bg-white border border-[#E5E5EA] rounded-full px-2 py-1">
                      <SlidersHorizontal className="w-3 h-3 text-[#71717A] ml-1" />
                      {([12, 24, 36] as const).map((limit) => (
                        <button
                          key={limit}
                          type="button"
                          onClick={() => {
                            void Promise.resolve(
                              onUpdateRollSettings(selectedEvent.id, {
                                ...currentRollConfig,
                                exposuresLimit: limit,
                              })
                            ).catch((err) => {
                              showToast(
                                err instanceof Error
                                  ? err.message
                                  : 'Unable to update roll exposure limit.'
                              );
                            });
                          }}
                          className={`min-w-[28px] min-h-[28px] px-2 rounded-full text-[11px] font-mono font-semibold transition-colors ${
                            currentRollConfig.exposuresLimit === limit
                              ? 'bg-[#0B0B0B] text-white'
                              : 'text-[#71717A] hover:text-[#0B0B0B]'
                          }`}
                        >
                          {limit}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <span className="text-[11px] font-medium text-[#71717A] inline-flex items-center gap-1.5">
                    {currentRollConfig.darkroomMode ? (
                      <>
                        <Lock className="w-3 h-3 text-[#0B0B0B]" />
                        <span>Darkroom Seal Active · Organiser Develops Roll</span>
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-3 h-3 text-[#0B0B0B]" />
                        <span>Instant Reveal · {currentRollConfig.exposuresLimit} EXP Roll</span>
                      </>
                    )}
                  </span>
                )}
              </div>
            </div>

            {/* Film Frames Grid */}
            <div className="p-3.5 sm:p-5">
              {filteredShots.length === 0 ? (
                <div className="py-14 px-4 text-center space-y-3 bg-[#F5F5F7] rounded-2xl">
                  <Film className="w-8 h-8 text-[#71717A] mx-auto" />
                  <div>
                    <p className="text-sm font-semibold text-[#0B0B0B]">
                      No film frames in this view yet
                    </p>
                    <p className="text-xs text-[#71717A] mt-1">
                      Tap Snap Photo to capture the first candid moment for {selectedEvent?.title}.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setMobilePanel('camera')}
                    className="lg:hidden min-h-[44px] px-5 rounded-full bg-[#0B0B0B] text-white text-xs font-semibold inline-flex items-center gap-2"
                  >
                    <Camera className="w-4 h-4" />
                    <span>Open Camera</span>
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 sm:gap-4">
                  {filteredShots.map((shot) => {
                    const frameCode = `${String(shot.frameNumber).padStart(2, '0')}A`;
                    const stockInfo =
                      FILM_STOCKS.find((f) => f.id === shot.filmStock) ?? FILM_STOCKS[0];
                    const deletable = canDeleteShot(shot);
                    const isConfirmingDelete = confirmDeleteId === shot.id;
                    const isDeleting = deletingShotId === shot.id;

                    return (
                      <article
                        key={shot.id}
                        className="bg-[#0B0B0B] text-white rounded-2xl overflow-hidden flex flex-col shadow-sm border border-[#1E1E22]"
                      >
                        {/* Top Film Sprocket Strip */}
                        <div className="px-3 py-1.5 flex items-center justify-between text-[10px] font-mono text-amber-400/90 border-b border-white/10 tabular-nums">
                          <span>FRAME {frameCode}</span>
                          <span className="text-zinc-400">{stockInfo.label}</span>
                        </div>

                        {/* Photo Frame or Sealed Darkroom Negative */}
                        {shot.developed ? (
                          <button
                            type="button"
                            onClick={() => setLightboxShot(shot)}
                            className="relative aspect-[4/3] w-full overflow-hidden bg-zinc-900 group text-left"
                          >
                            <img
                              src={shot.dataUrl}
                              alt={shot.caption || `Event frame ${frameCode} by ${shot.capturedBy}`}
                              referrerPolicy="no-referrer"
                              className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-200"
                            />
                            <span className="absolute top-2.5 right-2.5 w-9 h-9 rounded-full bg-black/60 backdrop-blur-md text-white flex items-center justify-center sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                              <Eye className="w-4 h-4" />
                            </span>
                          </button>
                        ) : (
                          <div className="aspect-[4/3] w-full bg-[#141416] flex flex-col items-center justify-center p-5 text-center gap-2 border-b border-white/5">
                            <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center">
                              <Lock className="w-4 h-4 text-zinc-300" />
                            </div>
                            <p className="text-xs font-semibold text-white">
                              Sealed Negative · {frameCode}
                            </p>
                            <p className="text-[11px] text-zinc-400">
                              Waiting for darkroom develop &amp; reveal
                            </p>
                          </div>
                        )}

                        {/* Bottom Metadata + Actions (Touch-Friendly 44px Height Targets) */}
                        <div className="p-3 flex items-center justify-between gap-2 bg-[#0B0B0B]">
                          <div className="min-w-0">
                            <p className="text-xs font-semibold text-white truncate">
                              {shot.capturedBy}
                            </p>
                            <p className="text-[11px] text-zinc-400 truncate tabular-nums">
                              {shot.caption ? `${shot.caption} · ` : ''}
                              {shot.capturedAt}
                            </p>
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              type="button"
                              onClick={() => {
                                void Promise.resolve(onToggleLikeShot(shot.id)).catch((err) => {
                                  showToast(
                                    err instanceof Error
                                      ? err.message
                                      : 'Unable to update favorite right now.'
                                  );
                                });
                              }}
                              aria-label={`Favorite frame ${frameCode}`}
                              className={`min-h-[38px] px-2.5 rounded-full text-[11px] font-mono font-semibold inline-flex items-center gap-1 transition-colors tabular-nums ${
                                shot.liked
                                  ? 'bg-white text-[#0B0B0B]'
                                  : 'bg-white/10 text-zinc-300 hover:bg-white/20'
                              }`}
                            >
                              <Heart
                                className={`w-3.5 h-3.5 ${shot.liked ? 'fill-current' : ''}`}
                              />
                              <span>{shot.likes}</span>
                            </button>

                            {shot.developed && (
                              <button
                                type="button"
                                onClick={() => handleDownloadSinglePrint(shot)}
                                aria-label={`Download frame ${frameCode}`}
                                title="Download Print"
                                className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors"
                              >
                                <Download className="w-3.5 h-3.5" />
                              </button>
                            )}

                            {deletable && (
                              <button
                                type="button"
                                disabled={isDeleting}
                                onClick={() => void handleRequestDeleteShot(shot)}
                                aria-label={
                                  isConfirmingDelete
                                    ? `Confirm delete frame ${frameCode}`
                                    : `Delete frame ${frameCode}`
                                }
                                title={
                                  isConfirmingDelete ? 'Tap again to confirm delete' : 'Delete photo'
                                }
                                className={`min-h-[38px] rounded-full inline-flex items-center justify-center gap-1 transition-colors ${
                                  isConfirmingDelete
                                    ? 'px-2.5 bg-[#EF4444] text-white text-[11px] font-semibold'
                                    : 'w-9 bg-[#EF4444]/15 hover:bg-[#EF4444]/30 text-[#EF4444]'
                                }`}
                              >
                                <Trash2 className="w-3.5 h-3.5 shrink-0" />
                                {isConfirmingDelete && (
                                  <span>{isDeleting ? '...' : 'Confirm'}</span>
                                )}
                              </button>
                            )}
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </div>
          </section>
        </div>
      </div>

      {/* Photo Lightbox Modal (Full-Screen on Mobile for Thumb Comfort) */}
      {lightboxShot && (
        <div
          className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-0 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="dispo-lightbox-title"
        >
          <div className="bg-[#0B0B0B] text-white w-full h-dvh sm:h-auto sm:max-h-[90vh] sm:max-w-2xl sm:rounded-3xl overflow-hidden sm:border border-white/15 shadow-2xl flex flex-col">
            <div className="px-4 sm:px-5 py-3.5 flex items-center justify-between border-b border-white/10 shrink-0">
              <div className="min-w-0">
                <h3 id="dispo-lightbox-title" className="text-sm font-bold truncate">
                  Frame {String(lightboxShot.frameNumber).padStart(2, '0')}A ·{' '}
                  {lightboxShot.capturedBy}
                </h3>
                <p className="text-[11px] font-mono text-zinc-400 tabular-nums">
                  {lightboxShot.dateStamp} · {lightboxShot.capturedAt}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setConfirmDeleteId(null);
                  setLightboxShot(null);
                }}
                aria-label="Close photo preview"
                className="w-11 h-11 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 bg-black flex items-center justify-center overflow-hidden min-h-0">
              <img
                src={lightboxShot.dataUrl}
                alt={lightboxShot.caption || `Frame ${lightboxShot.frameNumber}`}
                referrerPolicy="no-referrer"
                className="w-full h-full object-contain max-h-full"
              />
            </div>

            <div className="px-4 sm:px-5 py-3.5 pb-6 sm:pb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-t border-white/10 shrink-0">
              <p className="text-xs text-zinc-300 truncate">
                {lightboxShot.caption || 'Captured on Events By You 35mm Disposable Camera'}
              </p>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    const snapshot = lightboxShot;
                    setLightboxShot((prev) =>
                      prev
                        ? {
                            ...prev,
                            liked: !prev.liked,
                            likes: prev.liked ? Math.max(0, prev.likes - 1) : prev.likes + 1,
                          }
                        : null
                    );
                    void Promise.resolve(onToggleLikeShot(snapshot.id)).catch((err) => {
                      setLightboxShot((curr) => (curr?.id === snapshot.id ? snapshot : curr));
                      showToast(
                        err instanceof Error
                          ? err.message
                          : 'Unable to update favorite right now.'
                      );
                    });
                  }}
                  className="min-h-[44px] px-4 rounded-full bg-white/10 hover:bg-white/20 text-xs font-semibold inline-flex items-center gap-1.5 tabular-nums"
                >
                  <Heart className={`w-4 h-4 ${lightboxShot.liked ? 'fill-current' : ''}`} />
                  <span>{lightboxShot.likes}</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleDownloadSinglePrint(lightboxShot)}
                  className="flex-1 sm:flex-initial min-h-[44px] px-4 rounded-full bg-white text-[#0B0B0B] hover:bg-zinc-200 text-xs font-bold inline-flex items-center justify-center gap-1.5"
                >
                  <Download className="w-4 h-4" />
                  <span>Download</span>
                </button>

                {canDeleteShot(lightboxShot) && (
                  <button
                    type="button"
                    disabled={deletingShotId === lightboxShot.id}
                    onClick={() => void handleRequestDeleteShot(lightboxShot)}
                    aria-label={
                      confirmDeleteId === lightboxShot.id ? 'Confirm delete photo' : 'Delete photo'
                    }
                    className={`min-h-[44px] rounded-full inline-flex items-center justify-center gap-1.5 text-xs font-bold transition-colors ${
                      confirmDeleteId === lightboxShot.id
                        ? 'px-4 bg-[#EF4444] text-white'
                        : 'w-11 bg-[#EF4444]/20 hover:bg-[#EF4444]/35 text-[#EF4444]'
                    }`}
                  >
                    <Trash2 className="w-4 h-4 shrink-0" />
                    {confirmDeleteId === lightboxShot.id && (
                      <span>{deletingShotId === lightboxShot.id ? 'Deleting...' : 'Confirm'}</span>
                    )}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Photo Collage Studio Modal */}
      {collageOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-2 sm:p-5"
          role="dialog"
          aria-modal="true"
          aria-labelledby="collage-studio-title"
        >
          <div className="bg-white text-[#0B0B0B] w-full max-w-4xl max-h-[94dvh] rounded-2xl sm:rounded-3xl overflow-hidden border border-[#E5E5EA] shadow-2xl flex flex-col">
            <div className="px-4 sm:px-6 py-3.5 sm:py-4 flex items-center justify-between border-b border-[#E5E5EA] bg-[#F5F5F7]">
              <div>
                <h3 id="collage-studio-title" className="font-display text-base sm:text-lg font-bold text-[#0B0B0B]">
                  35mm Photo Collage Studio
                </h3>
                <p className="text-xs text-[#71717A] tabular-nums">
                  Select 2–{MAX_SHOTS_PER_USER} photos ({collageShots.length}/{MAX_SHOTS_PER_USER} selected)
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCollageOpen(false)}
                aria-label="Close collage studio"
                className="w-10 h-10 rounded-full bg-white border border-[#E5E5EA] hover:border-[#0B0B0B] flex items-center justify-center text-[#0B0B0B]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 sm:p-6 grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
              {/* Left: Live Rendered Collage Canvas Preview */}
              <div className="lg:col-span-6 space-y-3">
                <div className="aspect-square w-full rounded-2xl bg-[#0B0B0B] border border-[#E5E5EA] overflow-hidden flex items-center justify-center relative">
                  {collagePreviewUrl ? (
                    <img
                      src={collagePreviewUrl}
                      alt="Generated event photo collage preview"
                      className="w-full h-full object-contain"
                    />
                  ) : (
                    <span className="text-xs font-mono text-zinc-400">
                      Rendering collage...
                    </span>
                  )}
                  {collageRendering && (
                    <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                      <span className="px-3 py-1 rounded-full bg-black/80 text-white text-xs font-mono">
                        Composing...
                      </span>
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2.5">
                  <button
                    type="button"
                    disabled={!collagePreviewUrl || collageRendering}
                    onClick={handleDownloadCollage}
                    className="flex-1 h-11 px-5 rounded-full bg-[#0B0B0B] text-white hover:bg-zinc-800 disabled:opacity-50 text-xs font-semibold inline-flex items-center justify-center gap-1.5"
                  >
                    <Download className="w-4 h-4" />
                    <span>Download Collage PNG</span>
                  </button>
                  <button
                    type="button"
                    disabled={!collagePreviewUrl || collageRendering}
                    onClick={() => void handleShareCollage()}
                    className="h-11 px-5 rounded-full bg-[#F5F5F7] border border-[#E5E5EA] hover:border-[#0B0B0B] text-xs font-semibold text-[#0B0B0B] inline-flex items-center gap-1.5"
                  >
                    <Share2 className="w-3.5 h-3.5" />
                    <span>Share</span>
                  </button>
                </div>
              </div>

              {/* Right: Layout, Frame Theme & Photo Picker */}
              <div className="lg:col-span-6 space-y-4">
                <div>
                  <span className="text-xs font-semibold text-[#0B0B0B] block mb-2">
                    Collage Layout
                  </span>
                  <div className="grid grid-cols-2 gap-2">
                    {(
                      [
                        { id: '2-split', label: '2-Up Split' },
                        { id: '3-strip', label: '3-Frame Hero' },
                        { id: '4-grid', label: '4-Square Grid' },
                        { id: '5-mosaic', label: '5-Photo Mosaic' },
                      ] as const
                    ).map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => setCollageLayout(opt.id)}
                        className={`min-h-[42px] px-3.5 py-2 rounded-2xl text-xs font-semibold border transition-colors ${
                          collageLayout === opt.id
                            ? 'bg-[#0B0B0B] text-white border-[#0B0B0B]'
                            : 'bg-[#F5F5F7] text-[#0B0B0B] border-[#E5E5EA] hover:border-[#0B0B0B]'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <span className="text-xs font-semibold text-[#0B0B0B] block mb-1.5">
                      Frame Border Style
                    </span>
                    <div className="grid grid-cols-2 gap-2">
                      {(
                        [
                          { id: 'dark', label: 'Darkroom' },
                          { id: 'ivory', label: 'Ivory Matte' },
                        ] as const
                      ).map((t) => (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => setCollageTheme(t.id)}
                          className={`min-h-[40px] px-3 py-2 rounded-xl text-xs font-semibold border ${
                            collageTheme === t.id
                              ? 'bg-[#0B0B0B] text-white border-[#0B0B0B]'
                              : 'bg-[#F5F5F7] text-[#0B0B0B] border-[#E5E5EA]'
                          }`}
                        >
                          {t.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label
                      htmlFor="collage-caption-input"
                      className="text-xs font-semibold text-[#0B0B0B] block mb-1.5"
                    >
                      Collage Title Imprint
                    </label>
                    <input
                      id="collage-caption-input"
                      type="text"
                      value={collageTitle}
                      onChange={(e) => setCollageTitle(e.target.value)}
                      placeholder="Event title or memory"
                      className="w-full h-10 px-3 rounded-xl bg-[#F5F5F7] border border-[#E5E5EA] text-xs text-[#0B0B0B] focus:border-[#0B0B0B] focus:outline-none"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-[#0B0B0B]">
                      Pick Photos (up to {MAX_SHOTS_PER_USER})
                    </span>
                    {myDevelopedShots.length >= 2 && (
                      <button
                        type="button"
                        onClick={() =>
                          setCollageSelectedIds(
                            myDevelopedShots.slice(0, MAX_SHOTS_PER_USER).map((s) => s.id)
                          )
                        }
                        className="text-[11px] font-semibold underline text-[#0B0B0B]"
                      >
                        Select My Shots ({Math.min(MAX_SHOTS_PER_USER, myDevelopedShots.length)})
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 max-h-52 overflow-y-auto p-1">
                    {developedShots.map((shot) => {
                      const active = collageSelectedIds.includes(shot.id);
                      const orderIdx = collageSelectedIds.indexOf(shot.id);
                      return (
                        <button
                          key={shot.id}
                          type="button"
                          onClick={() => toggleCollageShot(shot.id)}
                          className={`relative aspect-[4/3] rounded-xl overflow-hidden border-2 transition-all ${
                            active
                              ? 'border-[#0B0B0B] ring-2 ring-[#0B0B0B]/20'
                              : 'border-transparent opacity-75 hover:opacity-100'
                          }`}
                        >
                          <img
                            src={shot.dataUrl}
                            alt={`Frame ${shot.frameNumber}`}
                            referrerPolicy="no-referrer"
                            className="w-full h-full object-cover"
                          />
                          {active && (
                            <span className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-[#0B0B0B] text-white text-[10px] font-mono font-bold flex items-center justify-center">
                              {orderIdx + 1}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
