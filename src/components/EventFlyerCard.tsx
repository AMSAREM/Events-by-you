import React, { useEffect, useState } from 'react';
import { Calendar, Check, Copy, ExternalLink, MapPin, QrCode, ShieldCheck, Gift } from 'lucide-react';
import type { DesignTheme, EventItem } from '../types/events';
import { getCategoryPreset } from '../data/initialData';
import { buildEventInvitationUrl } from '../lib/qr';
import { MonochromePoster } from './MonochromeArtwork';

interface EventFlyerCardProps {
  event: EventItem;
  themeOverride?: DesignTheme;
  compact?: boolean;
  showActions?: boolean;
  onOpenInvite?: (event: EventItem) => void;
  onOpenCheckIn?: (event: EventItem) => void;
  onManage?: (event: EventItem) => void;
}

const THEME_STYLES: Record<
  DesignTheme,
  {
    frameClass: string;
    scrimClass: string;
    kickerClass: string;
    accentLineClass: string;
    sealBgClass: string;
  }
> = {
  'editorial-ivory': {
    frameClass: 'bg-[#161513] text-white border-[#D6CEC2]',
    scrimClass:
      'bg-gradient-to-t from-[#12110F] via-[#12110F]/65 to-[#12110F]/20',
    kickerClass: 'bg-[#F5EFE6]/95 text-[#141210] border border-white/40',
    accentLineClass: 'border-[#E6DDD0]/30',
    sealBgClass: 'bg-[#F5EFE6] text-[#141210]',
  },
  'obsidian-gold': {
    frameClass: 'bg-[#09090B] text-white border-[#27272A]',
    scrimClass:
      'bg-gradient-to-t from-[#09090B] via-[#09090B]/60 to-[#09090B]/20',
    kickerClass: 'bg-[#D4AF37] text-[#09090B]',
    accentLineClass: 'border-[#D4AF37]/35',
    sealBgClass: 'bg-[#D4AF37] text-[#09090B]',
  },
  'swiss-grid': {
    frameClass: 'bg-[#0B0B0B] text-white border-[#27272A]',
    scrimClass:
      'bg-gradient-to-t from-[#0B0B0B] via-[#0B0B0B]/60 to-transparent',
    kickerClass: 'bg-white text-[#0B0B0B]',
    accentLineClass: 'border-white/25',
    sealBgClass: 'bg-white text-[#0B0B0B]',
  },
  'warm-monochrome': {
    frameClass: 'bg-[#141416] text-white border-[#27272A]',
    scrimClass:
      'bg-gradient-to-t from-[#0B0B0B] via-[#0B0B0B]/65 to-[#0B0B0B]/15',
    kickerClass: 'bg-zinc-100 text-[#0B0B0B]',
    accentLineClass: 'border-white/20',
    sealBgClass: 'bg-zinc-900/90 text-white border border-white/25',
  },
};

export const EventFlyerCard: React.FC<EventFlyerCardProps> = ({
  event,
  themeOverride,
  compact = false,
  showActions = true,
  onOpenInvite,
  onOpenCheckIn,
  onManage,
}) => {
  const [imgError, setImgError] = useState(false);
  const [copiedInvite, setCopiedInvite] = useState(false);

  const preset = getCategoryPreset(event.category);
  const theme: DesignTheme =
    themeOverride || event.designTheme || preset.designTheme || 'obsidian-gold';
  const flyerSrc = event.flyerUrl || preset.flyerUrl;
  const styles = THEME_STYLES[theme];
  const inviteUrl = buildEventInvitationUrl(event.slug || event.id);

  useEffect(() => {
    setImgError(false);
  }, [flyerSrc]);

  const handleCopyInvite = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(inviteUrl);
      }
      setCopiedInvite(true);
      setTimeout(() => setCopiedInvite(false), 1800);
    } catch {
      setCopiedInvite(true);
      setTimeout(() => setCopiedInvite(false), 1800);
    }
  };

  return (
    <article
      className={`group rounded-3xl overflow-hidden border ${styles.frameClass} flex flex-col justify-between shadow-[0_14px_38px_-14px_rgba(11,11,11,0.22)] transition-transform duration-200 hover:-translate-y-0.5`}
    >
      {/* Editorial Graphic-Designer Poster Canvas */}
      <div
        onClick={() => (onOpenInvite ? onOpenInvite(event) : onManage?.(event))}
        className={`relative w-full ${compact ? 'aspect-[16/10]' : 'aspect-[16/10] sm:aspect-[16/9]'} overflow-hidden cursor-pointer select-none`}
      >
        {flyerSrc && !imgError ? (
          <img
            src={flyerSrc}
            alt={`${event.title} editorial flyer`}
            onError={() => setImgError(true)}
            className="w-full h-full object-cover object-center group-hover:scale-[1.03] transition-transform duration-500"
          />
        ) : (
          <MonochromePoster variant={event.artwork} className="w-full h-full" />
        )}

        {/* Scrim & Graphic Designer Swiss Framing Lines */}
        <div className={`absolute inset-0 ${styles.scrimClass}`} />
        <div className="absolute inset-3 sm:inset-4 rounded-2xl border border-white/15 pointer-events-none" />

        {/* Top Poster Stamp Bar */}
        <div className="absolute top-5 left-5 right-5 flex items-center justify-between gap-2 z-10">
          <div className="flex items-center gap-1.5 min-w-0">
            <span
              className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-[0.14em] whitespace-nowrap ${styles.kickerClass}`}
            >
              {event.category}
            </span>
            {event.extraDataConfig?.enableGiftTable && (
              <span className="px-2.5 py-1 rounded-full bg-black/65 backdrop-blur-md text-white border border-white/20 text-[10px] font-semibold inline-flex items-center gap-1 whitespace-nowrap">
                <Gift className="w-2.5 h-2.5" />
                Gift Table
              </span>
            )}
          </div>

          <span
            className={`px-2.5 py-1 rounded-full text-[10px] font-mono font-semibold uppercase tracking-wider whitespace-nowrap ${styles.sealBgClass}`}
          >
            {event.status === 'live'
              ? 'LIVE GATE'
              : event.status === 'draft'
                ? 'DRAFT'
                : event.date}
          </span>
        </div>

        {/* Bottom Poster Typography Block */}
        <div className="absolute bottom-5 left-5 right-5 z-10">
          <div className={`pt-3 border-t ${styles.accentLineClass}`}>
            <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-white/75 truncate">
              {event.organizer} Presents
            </p>
            <h3 className="mt-1 font-display text-lg sm:text-xl font-bold tracking-[-0.02em] leading-snug text-white line-clamp-2 text-balance">
              {event.title}
            </h3>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-white/85">
              <span className="inline-flex items-center gap-1 font-mono tabular-nums">
                <Calendar className="w-3 h-3 shrink-0" />
                {event.date}
              </span>
              <span className="inline-flex items-center gap-1 truncate max-w-[200px]">
                <MapPin className="w-3 h-3 shrink-0" />
                {event.venue}, {event.city}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Graphic Poster Spec Sheet + Action Strip */}
      {showActions && (
        <div className="bg-white text-[#0B0B0B] p-4 sm:p-5 flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2 text-[11px] text-[#71717A]">
            <span className="inline-flex items-center gap-1.5 font-medium text-[#0B0B0B] truncate">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
              {event.validationConfig?.enabled
                ? `${event.validationConfig.options.length} Validation Circles`
                : 'Open RSVP'}
            </span>
            <span className="font-mono font-semibold text-[#0B0B0B] tabular-nums shrink-0">
              {event.ticketPrice > 0 ? `$${event.ticketPrice}` : 'Free Pass'} ·{' '}
              {event.registered}/{event.capacity}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {onOpenInvite && (
              <button
                type="button"
                onClick={() => onOpenInvite(event)}
                className="flex-1 min-w-[120px] h-9 px-3.5 rounded-full bg-[#0B0B0B] text-white text-xs font-semibold hover:bg-neutral-800 transition-colors inline-flex items-center justify-center gap-1.5 whitespace-nowrap"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>Open Invite</span>
              </button>
            )}

            <button
              type="button"
              onClick={handleCopyInvite}
              title={`Copy ${inviteUrl}`}
              className="h-9 px-3.5 rounded-full bg-[#F5F5F7] hover:bg-[#E5E5EA] text-[#0B0B0B] text-xs font-semibold transition-colors inline-flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0"
            >
              {copiedInvite ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Copied Link</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span>Invite Link</span>
                </>
              )}
            </button>

            {onOpenCheckIn && (
              <button
                type="button"
                onClick={() => onOpenCheckIn(event)}
                className="h-9 px-3.5 rounded-full border border-[#E5E5EA] hover:border-[#0B0B0B] bg-white text-[#0B0B0B] text-xs font-semibold transition-colors inline-flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0"
              >
                <QrCode className="w-3.5 h-3.5" />
                <span>Check-In QR</span>
              </button>
            )}

            {onManage && (
              <button
                type="button"
                onClick={() => onManage(event)}
                className="h-9 px-3.5 rounded-full border border-[#E5E5EA] hover:border-[#0B0B0B] bg-white text-[#0B0B0B] text-xs font-semibold transition-colors whitespace-nowrap shrink-0"
              >
                Studio
              </button>
            )}
          </div>
        </div>
      )}
    </article>
  );
};
