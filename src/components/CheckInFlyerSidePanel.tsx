import React, { useEffect, useState } from 'react';
import {
  CalendarDays,
  Check,
  Copy,
  MapPin,
  Maximize2,
  Minimize2,
  QrCode,
  ShieldCheck,
  Users,
} from 'lucide-react';
import type { DesignTheme, EventItem } from '../types/events';
import { getCategoryPreset } from '../data/initialData';
import { DeterministicQrSvg } from '../lib/qr';
import { getContrastTextColor, normalizeHexColor } from '../lib/themeColors';
import { BrandMark } from './BrandLogo';
import { CircularGauge, MonochromePoster } from './MonochromeArtwork';

interface CheckInFlyerSidePanelProps {
  event: EventItem;
  checkedInCount?: number;
  registeredCount?: number;
  checkinUrl?: string;
  showQrCard?: boolean;
  showFooter?: boolean;
  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;
  variant?: 'full' | 'compact';
  featherEdge?: 'none' | 'white';
  featherBreakpoint?: 'md' | 'lg';
  showCheckInCount?: boolean;
  topBarRightPaddingClass?: string;
  heroHeightClass?: string;
  className?: string;
}

const SCRIM_BY_THEME: Record<DesignTheme, string> = {
  'editorial-ivory': 'bg-gradient-to-t from-[#12100E]/90 via-[#12100E]/20 to-black/25',
  'obsidian-gold': 'bg-gradient-to-t from-[#09090B]/90 via-[#09090B]/20 to-black/25',
  'swiss-grid': 'bg-gradient-to-t from-[#0B0B0B]/90 via-[#0B0B0B]/20 to-black/20',
  'warm-monochrome': 'bg-gradient-to-t from-[#0B0B0B]/90 via-[#0B0B0B]/20 to-black/25',
};

export const CheckInFlyerSidePanel: React.FC<CheckInFlyerSidePanelProps> = ({
  event,
  checkedInCount,
  registeredCount,
  checkinUrl,
  showQrCard = false,
  showFooter = true,
  isFullscreen = false,
  onToggleFullscreen,
  variant = 'full',
  featherEdge = 'none',
  featherBreakpoint = 'lg',
  showCheckInCount = false,
  topBarRightPaddingClass = '',
  heroHeightClass,
  className = '',
}) => {
  const preset = getCategoryPreset(event.category);
  const flyerSrc = event.flyerUrl || preset.flyerUrl;
  const [imageFailed, setImageFailed] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);

  useEffect(() => {
    setImageFailed(false);
  }, [flyerSrc, event.id]);

  const activeTheme: DesignTheme = event.designTheme || preset.designTheme || 'obsidian-gold';
  const scrimClass = SCRIM_BY_THEME[activeTheme];
  const customBrand = normalizeHexColor(event.brandColor ?? event.extraDataConfig?.brandColor);
  const customBrandText = customBrand ? getContrastTextColor(customBrand) : undefined;

  const liveRegistered = registeredCount ?? event.registered ?? 0;
  const liveCheckedIn = checkedInCount ?? event.checkedIn ?? 0;
  const capacity = Math.max(1, event.capacity || liveRegistered || 1);
  const turnoutBase = Math.max(1, liveRegistered || capacity);
  const turnoutPct = Math.min(100, Math.round((liveCheckedIn / turnoutBase) * 100));

  const organizerInitials =
    (event.organizer || event.title || 'EV')
      .split(/\s+/)
      .map((part) => part[0])
      .join('')
      .slice(0, 2)
      .toUpperCase() || 'EV';

  const handleCopyUrl = () => {
    if (!checkinUrl) return;
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(checkinUrl).catch(() => {});
    }
    setCopiedUrl(true);
    window.setTimeout(() => setCopiedUrl(false), 1800);
  };

  const isCompact = variant === 'compact';
  const isFeatheredWhite = featherEdge === 'white';
  const isMdFeather = featherBreakpoint === 'md';
  const featherMaskClass = isFeatheredWhite
    ? isMdFeather
      ? 'flyer-feather-mask-white-md'
      : 'flyer-feather-mask-white'
    : '';

  return (
    <aside
      aria-label={`${event.title} Flyer and Event Identity`}
      className={`rounded-[28px] ${
        isFeatheredWhite ? 'bg-white' : 'bg-[#0B0B0B]'
      } text-white overflow-hidden border border-[#27272A] shadow-xl flex flex-col justify-between ${className}`}
    >
      {/* Top Hero Event Flyer or Vector Logo Artwork */}
      <div
        className={`relative w-full overflow-hidden select-none ${
          heroHeightClass
            ? heroHeightClass
            : isCompact
              ? 'aspect-[16/10] sm:aspect-[4/3]'
              : isMdFeather
                ? 'h-[230px] sm:h-[280px] md:h-auto md:min-h-0 md:flex-1'
                : 'h-[240px] sm:h-[300px] lg:h-auto lg:min-h-0 lg:flex-1'
        }`}
      >
        {flyerSrc && !imageFailed ? (
          <img
            src={flyerSrc}
            alt={`${event.title} official flyer`}
            referrerPolicy="no-referrer"
            onError={() => setImageFailed(true)}
            className={`absolute inset-0 w-full h-full object-cover object-center animate-flyer-kenburns will-change-transform ${featherMaskClass}`}
          />
        ) : (
          <div
            className={`w-full h-full relative flex flex-col items-center justify-center bg-[#0B0B0B] p-6 ${featherMaskClass}`}
          >
            <MonochromePoster variant={event.artwork} className="w-full h-full absolute inset-0 opacity-90 animate-flyer-kenburns" />
            <div className="relative z-10 flex flex-col items-center gap-3 text-center">
              <div className="w-16 h-16 rounded-2xl bg-white/10 backdrop-blur-md border border-white/25 flex items-center justify-center shadow-lg">
                {!event.whiteLabel ? (
                  <BrandMark size={40} />
                ) : (
                  <span className="font-display text-xl font-bold text-white tracking-tight">
                    {organizerInitials}
                  </span>
                )}
              </div>
              <span className="text-xs font-mono uppercase tracking-[0.18em] text-zinc-200">
                {event.organizer}
              </span>
            </div>
          </div>
        )}

        <div className={`absolute inset-0 ${scrimClass} ${featherMaskClass}`} />
        {!isFeatheredWhite && (
          <div className="absolute inset-3 rounded-[20px] border border-white/15 pointer-events-none" />
        )}
        {isFeatheredWhite && (
          <>
            <div
              className={`${
                isMdFeather ? 'md:hidden' : 'lg:hidden'
              } pointer-events-none absolute inset-x-0 bottom-0 h-28 sm:h-32 z-[5] bg-gradient-to-t from-white via-white/75 to-transparent`}
            />
            <div
              className={`hidden ${
                isMdFeather ? 'md:block' : 'lg:block'
              } pointer-events-none absolute inset-y-0 right-0 w-28 lg:w-36 xl:w-52 z-[5] bg-gradient-to-l from-white via-white/65 to-transparent`}
            />
          </>
        )}

        {/* Top Event Logo Crest & Fullscreen Action */}
        <div className={`absolute top-4 left-4 right-4 z-10 flex items-center justify-between gap-2 ${topBarRightPaddingClass}`}>
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-black/75 backdrop-blur-md border border-white/20 flex items-center justify-center shrink-0 overflow-hidden shadow-sm">
              {!event.whiteLabel ? (
                <BrandMark size={24} />
              ) : (
                <MonochromePoster variant={event.artwork} className="w-full h-full" />
              )}
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-mono uppercase tracking-[0.16em] text-white/80 truncate">
                {event.organizer}
              </p>
              <p
                className="text-[11px] font-semibold truncate text-white"
                style={customBrand ? { color: customBrandText === '#0B0B0B' ? '#FFFFFF' : '#FFFFFF' } : undefined}
              >
                {event.category} · {event.status === 'live' ? 'Live Gate' : event.date}
              </p>
            </div>
          </div>

          {onToggleFullscreen && (
            <button
              type="button"
              onClick={onToggleFullscreen}
              title={isFullscreen ? 'Exit Full Screen' : 'Open Full Screen'}
              className="px-3 py-1.5 rounded-full bg-black/75 hover:bg-black text-white border border-white/25 text-[11px] font-semibold inline-flex items-center gap-1.5 backdrop-blur-md transition-colors whitespace-nowrap shrink-0"
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
          )}
        </div>

        {/* Bottom Flyer Overlay Title & Venue Logistics */}
        <div
          className={`absolute left-4 right-4 z-10 space-y-1.5 sm:space-y-2 ${
            isFeatheredWhite
              ? isMdFeather
                ? 'bottom-10 sm:bottom-14 md:bottom-6 md:pr-24 lg:pr-28 drop-shadow-[0_2px_12px_rgba(0,0,0,0.88)]'
                : 'bottom-10 sm:bottom-14 lg:bottom-6 lg:pr-28 xl:pr-36 drop-shadow-[0_2px_12px_rgba(0,0,0,0.88)]'
              : 'bottom-4'
          }`}
        >
          <h2 className="font-display text-lg sm:text-2xl font-bold tracking-[-0.02em] leading-snug text-white text-balance line-clamp-2">
            {event.title}
          </h2>
          {event.subtitle && !isCompact && (
            <p className="text-xs text-zinc-200 line-clamp-2 leading-relaxed">
              {event.subtitle}
            </p>
          )}
          <div className="pt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-200 tabular-nums">
            <span className="inline-flex items-center gap-1.5">
              <CalendarDays className="w-3.5 h-3.5 text-zinc-300 shrink-0" />
              {event.date} · {event.time}
            </span>
            <span className="inline-flex items-center gap-1.5 truncate max-w-full">
              <MapPin className="w-3.5 h-3.5 text-zinc-300 shrink-0" />
              {event.venue}, {event.city}
            </span>
          </div>
        </div>
      </div>

      {/* Bottom Gate Stats & Optional QR Kiosk Preview */}
      {showFooter && (
        <div className="p-4 sm:p-5 bg-[#121215] border-t border-white/10 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              {showCheckInCount && (
                <div className="bg-white rounded-full p-0.5 shrink-0">
                  <CircularGauge value={turnoutPct} size={44} strokeWidth={4} alertThreshold={101} />
                </div>
              )}
              <div className="min-w-0">
                {showCheckInCount ? (
                  <p className="text-xs font-bold text-white tabular-nums flex items-center gap-1.5">
                    <Users className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                    <span>
                      {liveCheckedIn} Checked In · {liveRegistered} / {event.capacity}
                    </span>
                  </p>
                ) : (
                  <p className="text-xs font-bold text-white flex items-center gap-1.5 truncate">
                    <QrCode className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                    <span className="truncate">{event.title}</span>
                  </p>
                )}
                <p className="text-[11px] text-zinc-400 tabular-nums truncate">
                  {event.qrPassPublished === false
                    ? 'QR Pass pending creator publication'
                    : 'Check-In QR Passes active'}
                </p>
              </div>
            </div>

            <ShieldCheck
              className={`w-5 h-5 shrink-0 ${
                event.qrPassPublished === false ? 'text-zinc-500' : 'text-emerald-400'
              }`}
            />
          </div>

          {showQrCard && checkinUrl && (
            <div className="p-3.5 rounded-2xl bg-white text-[#0B0B0B] flex items-center justify-between gap-3">
              <div className="min-w-0 flex-1 space-y-1.5">
                <p className="text-[11px] font-bold uppercase tracking-wider text-[#71717A] flex items-center gap-1">
                  <QrCode className="w-3 h-3 text-[#0B0B0B] shrink-0" />
                  <span className="truncate">Gate Check-In Kiosk Link</span>
                </p>
                <p className="text-xs font-mono text-[#0B0B0B] truncate">
                  /e/{event.slug}/checkin
                </p>
                <button
                  type="button"
                  onClick={handleCopyUrl}
                  className="min-h-[36px] px-3.5 py-1.5 rounded-full bg-[#F5F5F7] hover:bg-[#E5E5EA] text-[11px] font-semibold text-[#0B0B0B] inline-flex items-center gap-1.5 transition-colors whitespace-nowrap"
                >
                  {copiedUrl ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-600" />
                      <span>Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>Copy Link</span>
                    </>
                  )}
                </button>
              </div>

              <div className="p-2 rounded-xl bg-[#F5F5F7] border border-[#E5E5EA] shrink-0">
                <DeterministicQrSvg
                  value={checkinUrl}
                  size={72}
                  className="w-16 h-16 sm:w-[72px] sm:h-[72px] block"
                  label={`Gate check-in QR for ${event.title}`}
                />
              </div>
            </div>
          )}
        </div>
      )}
    </aside>
  );
};
