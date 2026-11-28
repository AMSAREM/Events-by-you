import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  CalendarDays,
  Check,
  Copy,
  Download,
  Layers,
  Loader2,
  MapPin,
  Printer,
  UserCheck,
} from 'lucide-react';
import type { EventItem, EventProgramOutline, ScheduleBlock } from '../types/events';
import { getCategoryPreset } from '../data/initialData';
import {
  ALL_SCHEDULE_DAYS,
  compareScheduleBlocksChronological,
  formatEventDateSpan,
  formatEventDurationBadge,
  formatIsoDateShort,
  formatScheduleBlockDateBadge,
  getEventDateSlots,
  getScheduleSections,
  groupScheduleBlocksBySection,
  resolveScheduleBlockDate,
  sanitizeScheduleSection,
} from '../lib/eventDates';
import {
  decodeProgramOutlineText,
  isTextProgramOutline,
  parseProgramOutlineTextToBlocks,
  sanitizeEventLogoUrl,
} from '../lib/programOutline';
import {
  exportDesignedProgramOutlinePng,
  printDesignedProgramOutlineSheet,
} from '../lib/programOutlineExport';
import { DeterministicQrSvg, buildEventProgramUrl } from '../lib/qr';
import { getContrastTextColor, hexWithAlpha, resolveEventBrandColor } from '../lib/themeColors';
import { MonochromePoster } from './MonochromeArtwork';
import { PublicProgramOutlineCard } from './ProgramOutlineViewer';

interface PublicProgramOutlineSectionProps {
  event: EventItem;
  programOutline?: EventProgramOutline;
  scheduleBlocks: ScheduleBlock[];
  variant?: 'invitation' | 'checkin' | 'pass' | 'program';
  id?: string;
  onValidateCheckIn?: () => void;
  onShareProgram?: () => void;
  onBackToInvitation?: () => void;
}

function deriveMonogram(label?: string | null): string {
  const words = (label || 'EV').trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    return `${words[0][0] ?? ''}${words[1][0] ?? ''}`.toUpperCase();
  }
  return (words[0] || 'EV').slice(0, 2).toUpperCase();
}

export const PublicProgramOutlineSection: React.FC<PublicProgramOutlineSectionProps> = ({
  event,
  programOutline,
  scheduleBlocks,
  variant = 'invitation',
  id,
  onValidateCheckIn,
  onShareProgram,
  onBackToInvitation,
}) => {
  const [dateFilter, setDateFilter] = useState<'all' | string>('all');
  const [dayFilter, setDayFilter] = useState<'all' | ScheduleBlock['day']>('all');
  const [sectionFilter, setSectionFilter] = useState<'all' | string>('all');
  const [flyerFailed, setFlyerFailed] = useState(false);
  const [exportingPng, setExportingPng] = useState(false);
  const [printingSheet, setPrintingSheet] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);

  const preset = useMemo(() => getCategoryPreset(event.category), [event.category]);
  const flyerSrc = event.flyerUrl || preset.flyerUrl;
  const logoUrl = useMemo(
    () => sanitizeEventLogoUrl(event.extraDataConfig?.logoUrl),
    [event.extraDataConfig?.logoUrl]
  );
  const brandColor = useMemo(() => resolveEventBrandColor(event), [event]);
  const brandTextColor = useMemo(() => getContrastTextColor(brandColor), [brandColor]);
  const monogram = useMemo(
    () => deriveMonogram(event.organizer || event.title),
    [event.organizer, event.title]
  );
  const formattedEventDate = useMemo(
    () => formatEventDateSpan(event.isoDate, event.endIsoDate, event.date),
    [event.isoDate, event.endIsoDate, event.date]
  );
  const durationBadge = useMemo(() => formatEventDurationBadge(event), [event]);
  const programUrl = useMemo(
    () => buildEventProgramUrl(event.slug || event.id),
    [event.slug, event.id]
  );

  useEffect(() => {
    setDateFilter('all');
    setDayFilter('all');
    setSectionFilter('all');
    setFlyerFailed(false);
    setActionFeedback(null);
  }, [event.id, flyerSrc]);

  const sortedBlocks = useMemo(() => {
    const directBlocks = scheduleBlocks
      .filter((b) => b.eventId === event.id)
      .slice()
      .sort((a, b) => compareScheduleBlocksChronological(a, b, event));

    if (directBlocks.length > 0) {
      return directBlocks;
    }

    if (programOutline && isTextProgramOutline(programOutline)) {
      const parsed = parseProgramOutlineTextToBlocks(
        decodeProgramOutlineText(programOutline),
        event
      );
      return parsed
        .map((b, idx) => ({
          id: `parsed-${idx}`,
          eventId: event.id,
          time: b.time,
          duration: b.duration,
          title: b.title,
          stage: b.stage,
          lead: b.lead,
          completed: false,
          day: b.day,
          ...(b.date ? { date: b.date } : {}),
          ...(sanitizeScheduleSection(b.section)
            ? { section: sanitizeScheduleSection(b.section) }
            : {}),
        }))
        .sort((a, b) => compareScheduleBlocksChronological(a, b, event));
    }

    return [];
  }, [scheduleBlocks, event, programOutline]);

  const dateTabs = useMemo(() => {
    const map = new Map<string, string>();
    for (const slot of getEventDateSlots(event)) {
      map.set(slot.isoDate, slot.fullLabel);
    }
    for (const blk of sortedBlocks) {
      const resolved = resolveScheduleBlockDate(blk, event);
      if (resolved && !map.has(resolved)) {
        map.set(resolved, formatIsoDateShort(resolved, true));
      }
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([isoDate, label]) => ({ isoDate, label }));
  }, [sortedBlocks, event]);

  const distinctDays = useMemo(() => {
    const present = new Set(sortedBlocks.map((b) => b.day));
    return ALL_SCHEDULE_DAYS.filter((d) => present.has(d));
  }, [sortedBlocks]);

  const dateFilteredBlocks = useMemo(
    () =>
      sortedBlocks.filter((b) => {
        if (dateFilter !== 'all') {
          return resolveScheduleBlockDate(b, event) === dateFilter;
        }
        return dayFilter === 'all' || b.day === dayFilter;
      }),
    [sortedBlocks, dateFilter, dayFilter, event]
  );

  const availableSections = useMemo(
    () => getScheduleSections(dateFilteredBlocks),
    [dateFilteredBlocks]
  );

  const effectiveSectionFilter =
    sectionFilter !== 'all' && availableSections.includes(sectionFilter) ? sectionFilter : 'all';

  const visibleBlocks = useMemo(() => {
    if (effectiveSectionFilter === 'all') return dateFilteredBlocks;
    return dateFilteredBlocks.filter((b) => b.section?.trim() === effectiveSectionFilter);
  }, [dateFilteredBlocks, effectiveSectionFilter]);

  const sectionGroups = useMemo(
    () => groupScheduleBlocksBySection(visibleBlocks),
    [visibleBlocks]
  );
  const showSectionHeaders =
    sectionGroups.length > 1 || (sectionGroups.length === 1 && !sectionGroups[0].isGeneral);

  // Visual proportional overview segments (sections when multiple sections exist, else dates/days)
  const graphicSegments = useMemo(() => {
    const palette = [
      brandColor,
      hexWithAlpha(brandColor, 0.72),
      '#27272A',
      hexWithAlpha(brandColor, 0.48),
      '#52525B',
      '#71717A',
    ];

    if (availableSections.length > 1) {
      const grouped = groupScheduleBlocksBySection(dateFilteredBlocks);
      return grouped.map((grp, idx) => ({
        key: `sec-${grp.section}`,
        kind: 'section' as const,
        value: grp.isGeneral ? 'all' : grp.section,
        label: grp.section,
        count: grp.blocks.length,
        color: palette[idx % palette.length],
        active:
          effectiveSectionFilter === (grp.isGeneral ? 'all' : grp.section) &&
          effectiveSectionFilter !== 'all',
      }));
    }

    if (dateTabs.length > 1) {
      return dateTabs
        .map((tab, idx) => {
          const count = sortedBlocks.filter(
            (b) => resolveScheduleBlockDate(b, event) === tab.isoDate
          ).length;
          return {
            key: `date-${tab.isoDate}`,
            kind: 'date' as const,
            value: tab.isoDate,
            label: tab.label,
            count,
            color: palette[idx % palette.length],
            active: dateFilter === tab.isoDate,
          };
        })
        .filter((seg) => seg.count > 0);
    }

    if (distinctDays.length > 1) {
      return distinctDays.map((day, idx) => ({
        key: `day-${day}`,
        kind: 'day' as const,
        value: day,
        label: day,
        count: sortedBlocks.filter((b) => b.day === day).length,
        color: palette[idx % palette.length],
        active: dayFilter === day,
      }));
    }

    return [];
  }, [
    availableSections.length,
    brandColor,
    dateFilteredBlocks,
    dateFilter,
    dateTabs,
    dayFilter,
    distinctDays,
    effectiveSectionFilter,
    event,
    sortedBlocks,
  ]);

  const dayNotes = event.extraDataConfig?.planningConfig?.dayScheduleNotes;
  const activeDayNote = dateFilter !== 'all' ? dayNotes?.[dateFilter] : undefined;
  const outlineIsImage = Boolean(programOutline?.mimeType.startsWith('image/'));
  const isStandaloneProgram = variant === 'program';

  if (!isStandaloneProgram && sortedBlocks.length === 0 && !programOutline) {
    return null;
  }

  const handleDownloadPng = async () => {
    setActionFeedback(null);
    setExportingPng(true);
    try {
      const fileName = await exportDesignedProgramOutlinePng(event, sortedBlocks);
      setActionFeedback(`Saved ${fileName}`);
    } catch (err) {
      setActionFeedback(err instanceof Error ? err.message : 'Unable to save program PNG.');
    } finally {
      setExportingPng(false);
    }
  };

  const handlePrintSheet = async () => {
    setActionFeedback(null);
    setPrintingSheet(true);
    try {
      await printDesignedProgramOutlineSheet(event, sortedBlocks);
    } catch (err) {
      setActionFeedback(err instanceof Error ? err.message : 'Unable to open print sheet.');
    } finally {
      setPrintingSheet(false);
    }
  };

  const handleCopyLink = async () => {
    if (onShareProgram) {
      onShareProgram();
      setCopiedLink(true);
      window.setTimeout(() => setCopiedLink(false), 1800);
      return;
    }
    try {
      await navigator.clipboard?.writeText(programUrl);
      setCopiedLink(true);
      window.setTimeout(() => setCopiedLink(false), 1800);
    } catch {
      setCopiedLink(true);
      window.setTimeout(() => setCopiedLink(false), 1800);
    }
  };

  const headingTitle =
    variant === 'checkin'
      ? 'Program Outline & Schedule'
      : variant === 'pass'
        ? `${event.category} Program Outline`
        : 'Event Program & Schedule';

  const showMultipleDateTabs = dateTabs.length > 1;
  const showMultipleDayTabs = !showMultipleDateTabs && distinctDays.length > 1;
  const totalSectionsCount = getScheduleSections(sortedBlocks).length;

  return (
    <section
      id={id}
      className="bg-white rounded-[24px] sm:rounded-[28px] shadow-sm border border-[#E5E5EA]/80 overflow-hidden min-w-0"
    >
      {/* Top Graphical Event Image Showcase */}
      {isStandaloneProgram ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 border-b border-[#E5E5EA]">
          {/* Event Image / Flyer Poster Panel */}
          <div className="lg:col-span-5 relative min-h-[230px] sm:min-h-[280px] lg:min-h-[340px] bg-[#0B0B0B] overflow-hidden">
            {flyerSrc && !flyerFailed ? (
              <img
                src={flyerSrc}
                alt={`${event.title} event image`}
                referrerPolicy="no-referrer"
                onError={() => setFlyerFailed(true)}
                className="absolute inset-0 w-full h-full object-cover object-center"
              />
            ) : (
              <div className="absolute inset-0">
                <MonochromePoster variant={event.artwork} className="w-full h-full" />
              </div>
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-[#0B0B0B]/88 via-[#0B0B0B]/30 to-[#0B0B0B]/20" />
            <div className="absolute inset-3 rounded-[18px] border border-white/20 pointer-events-none" />

            <div className="relative z-10 h-full p-5 sm:p-6 flex flex-col justify-between text-white">
              <div className="flex items-center gap-3">
                <div
                  className="w-11 h-11 rounded-xl bg-white flex items-center justify-center overflow-hidden shrink-0 shadow-sm"
                  style={{ border: `2px solid ${brandColor}` }}
                >
                  {logoUrl ? (
                    <img
                      src={logoUrl}
                      alt={`${event.organizer} logo`}
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-contain p-1"
                    />
                  ) : (
                    <span className="font-serif font-bold text-sm text-[#0B0B0B]">{monogram}</span>
                  )}
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] font-mono uppercase tracking-[0.16em] text-white/85 truncate">
                    {event.organizer}
                  </p>
                  <p className="text-xs font-semibold text-white truncate">{event.category}</p>
                </div>
              </div>

              <div className="pt-10">
                <div className="w-10 h-0.5 mb-2" style={{ backgroundColor: brandColor }} />
                <p className="text-[11px] font-mono uppercase tracking-[0.14em] text-white/80">
                  Official Attendee Program
                </p>
                <p className="text-xs text-white/90 mt-0.5 truncate">
                  {event.venue} · {event.city}
                </p>
              </div>
            </div>
          </div>

          {/* Editorial Masthead & Attendee Actions */}
          <div className="lg:col-span-7 bg-[#FAF8F5] p-5 sm:p-7 flex flex-col justify-between gap-5">
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[11px] font-mono font-semibold uppercase tracking-[0.16em] text-[#52525B]">
                  Program Outline &amp; Run of Show
                </span>
                <span className="text-[11px] font-mono text-[#52525B] tabular-nums">
                  {sortedBlocks.length > 0
                    ? `${sortedBlocks.length} ${sortedBlocks.length === 1 ? 'Session' : 'Sessions'}${
                        totalSectionsCount > 0 ? ` · ${totalSectionsCount} Sections` : ''
                      }`
                    : programOutline
                      ? 'Official Booklet Attached'
                      : 'Schedule Overview'}
                </span>
              </div>

              <div className="w-12 h-1" style={{ backgroundColor: brandColor }} />

              <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-[-0.02em] leading-[1.15] text-[#0B0B0B] text-balance">
                {programOutline?.title || event.title}
              </h1>

              {programOutline?.title && programOutline.title !== event.title && (
                <p className="text-xs font-semibold text-[#52525B]">{event.title}</p>
              )}

              {event.subtitle && (
                <p className="text-xs sm:text-sm text-[#444748] leading-relaxed max-w-prose">
                  {event.subtitle}
                </p>
              )}

              <dl className="pt-2 border-t border-[#E5E2DC] grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-xs">
                <div className="flex items-start gap-2 min-w-0">
                  <CalendarDays className="w-4 h-4 text-[#0B0B0B] shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <dt className="text-[10px] font-mono uppercase tracking-wider text-[#71717A]">
                      Date &amp; Start Time
                    </dt>
                    <dd className="font-semibold text-[#0B0B0B] tabular-nums">
                      {formattedEventDate} · {event.time}
                      {durationBadge ? ` · ${durationBadge}` : ''}
                    </dd>
                  </div>
                </div>
                <div className="flex items-start gap-2 min-w-0">
                  <MapPin className="w-4 h-4 text-[#0B0B0B] shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <dt className="text-[10px] font-mono uppercase tracking-wider text-[#71717A]">
                      Venue Location
                    </dt>
                    <dd className="font-semibold text-[#0B0B0B] truncate">
                      {event.venue}, {event.city}
                    </dd>
                  </div>
                </div>
              </dl>
            </div>

            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                {onValidateCheckIn && (
                  <button
                    type="button"
                    onClick={onValidateCheckIn}
                    className="min-h-[40px] px-4 py-2 rounded-full text-xs font-bold inline-flex items-center gap-1.5 transition-opacity hover:opacity-90 whitespace-nowrap"
                    style={{ backgroundColor: brandColor, color: brandTextColor }}
                  >
                    <span>Validate &amp; Check-In</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                )}
                <button
                  type="button"
                  disabled={exportingPng || printingSheet}
                  onClick={() => void handleDownloadPng()}
                  className="min-h-[40px] px-3.5 py-2 rounded-full bg-[#0B0B0B] hover:bg-zinc-800 text-white text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-50 transition-colors whitespace-nowrap"
                >
                  {exportingPng ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Download className="w-3.5 h-3.5" />
                  )}
                  <span>Save Graphic (.png)</span>
                </button>
                <button
                  type="button"
                  disabled={printingSheet || exportingPng}
                  onClick={() => void handlePrintSheet()}
                  className="min-h-[40px] px-3.5 py-2 rounded-full bg-white border border-[#D4D0C7] hover:border-[#0B0B0B] text-[#0B0B0B] text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-50 transition-colors whitespace-nowrap"
                >
                  {printingSheet ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Printer className="w-3.5 h-3.5" />
                  )}
                  <span>Print / PDF</span>
                </button>
                <button
                  type="button"
                  onClick={() => void handleCopyLink()}
                  className="min-h-[40px] px-3.5 py-2 rounded-full bg-white border border-[#D4D0C7] hover:border-[#0B0B0B] text-[#0B0B0B] text-xs font-semibold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap"
                >
                  {copiedLink ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-600" />
                      <span>Link Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>Share Program</span>
                    </>
                  )}
                </button>
              </div>
              {actionFeedback && (
                <p className="text-[11px] font-medium text-[#52525B]">{actionFeedback}</p>
              )}
            </div>
          </div>
        </div>
      ) : (
        /* Embedded Graphical Event Image Banner for Invitation / Check-In / Pass */
        <div className="relative h-28 sm:h-32 bg-[#0B0B0B] text-white overflow-hidden border-b border-[#E5E5EA]">
          {flyerSrc && !flyerFailed ? (
            <img
              src={flyerSrc}
              alt={`${event.title} event banner`}
              referrerPolicy="no-referrer"
              onError={() => setFlyerFailed(true)}
              className="absolute inset-0 w-full h-full object-cover object-center"
            />
          ) : (
            <div className="absolute inset-0">
              <MonochromePoster variant={event.artwork} className="w-full h-full" />
            </div>
          )}
          <div className="absolute inset-0 bg-gradient-to-r from-[#0B0B0B]/92 via-[#0B0B0B]/75 to-[#0B0B0B]/55" />

          <div className="relative z-10 h-full px-4 sm:px-6 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3.5 min-w-0">
              <div
                className="w-11 h-11 rounded-xl bg-white flex items-center justify-center overflow-hidden shrink-0 shadow-sm"
                style={{ border: `2px solid ${brandColor}` }}
              >
                {logoUrl ? (
                  <img
                    src={logoUrl}
                    alt={`${event.organizer} logo`}
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-contain p-1"
                  />
                ) : (
                  <span className="font-serif font-bold text-sm text-[#0B0B0B]">{monogram}</span>
                )}
              </div>
              <div className="min-w-0">
                <p className="text-[10px] font-mono uppercase tracking-[0.14em] text-white/75 truncate">
                  {event.organizer} · {event.venue}
                </p>
                <h3 className="font-display text-base sm:text-lg font-bold tracking-[-0.01em] text-white truncate">
                  {headingTitle}
                </h3>
                <p className="text-[11px] text-white/80 tabular-nums truncate">
                  {sortedBlocks.length > 0
                    ? `${visibleBlocks.length} ${visibleBlocks.length === 1 ? 'session' : 'sessions'}${
                        availableSections.length > 0 ? ` · ${availableSections.length} sections` : ''
                      }`
                    : 'Official program booklet'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                disabled={exportingPng || printingSheet}
                onClick={() => void handleDownloadPng()}
                title="Save graphical program PNG"
                aria-label="Save graphical program PNG"
                className="min-h-[36px] px-3 py-1.5 rounded-full bg-white/95 hover:bg-white text-[#0B0B0B] text-[11px] font-semibold inline-flex items-center gap-1.5 disabled:opacity-50 transition-colors whitespace-nowrap"
              >
                {exportingPng ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Download className="w-3.5 h-3.5" />
                )}
                <span className="hidden sm:inline">Save PNG</span>
              </button>
              <button
                type="button"
                disabled={printingSheet || exportingPng}
                onClick={() => void handlePrintSheet()}
                title="Print or save program PDF"
                aria-label="Print or save program PDF"
                className="min-h-[36px] px-3 py-1.5 rounded-full bg-black/65 hover:bg-black text-white border border-white/25 text-[11px] font-semibold inline-flex items-center gap-1.5 disabled:opacity-50 transition-colors whitespace-nowrap"
              >
                {printingSheet ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Printer className="w-3.5 h-3.5" />
                )}
                <span className="hidden sm:inline">Print</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Program Body */}
      <div className="p-4 sm:p-6 space-y-5">
        {/* Graphical Proportional Flow Bar */}
        {graphicSegments.length > 1 && (
          <div className="rounded-2xl bg-[#FAF8F5] border border-[#E5E2DC] p-3.5 sm:p-4 space-y-3">
            <div className="flex items-center justify-between gap-2 text-[11px]">
              <span className="font-mono font-semibold uppercase tracking-[0.12em] text-[#52525B]">
                Program Structure Overview
              </span>
              <span className="font-mono text-[#71717A] tabular-nums">
                {graphicSegments.reduce((sum, s) => sum + s.count, 0)} Total Sessions
              </span>
            </div>

            <div
              className="w-full h-3 rounded-lg overflow-hidden flex gap-0.5 bg-[#EAE7E0]"
              role="group"
              aria-label="Program proportional breakdown"
            >
              {graphicSegments.map((seg) => (
                <button
                  key={seg.key}
                  type="button"
                  onClick={() => {
                    if (seg.kind === 'section') {
                      setSectionFilter((prev) => (prev === seg.value ? 'all' : seg.value));
                    } else if (seg.kind === 'date') {
                      setDateFilter((prev) => (prev === seg.value ? 'all' : seg.value));
                      setDayFilter('all');
                      setSectionFilter('all');
                    } else {
                      setDayFilter((prev) =>
                        prev === seg.value ? 'all' : (seg.value as ScheduleBlock['day'])
                      );
                      setSectionFilter('all');
                    }
                  }}
                  title={`${seg.label}: ${seg.count} session${seg.count === 1 ? '' : 's'}`}
                  style={{
                    flexGrow: Math.max(1, seg.count),
                    backgroundColor: seg.color,
                    opacity:
                      graphicSegments.some((s) => s.active) && !seg.active ? 0.38 : 1,
                  }}
                  className="h-full transition-opacity hover:opacity-90 focus:outline-none"
                />
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
              {graphicSegments.map((seg, idx) => (
                <button
                  key={seg.key}
                  type="button"
                  onClick={() => {
                    if (seg.kind === 'section') {
                      setSectionFilter((prev) => (prev === seg.value ? 'all' : seg.value));
                    } else if (seg.kind === 'date') {
                      setDateFilter((prev) => (prev === seg.value ? 'all' : seg.value));
                      setDayFilter('all');
                      setSectionFilter('all');
                    } else {
                      setDayFilter((prev) =>
                        prev === seg.value ? 'all' : (seg.value as ScheduleBlock['day'])
                      );
                      setSectionFilter('all');
                    }
                  }}
                  className={`inline-flex items-center gap-1.5 text-[11px] transition-opacity whitespace-nowrap ${
                    graphicSegments.some((s) => s.active) && !seg.active
                      ? 'opacity-50 hover:opacity-100'
                      : 'opacity-100'
                  }`}
                >
                  <span
                    className="w-2.5 h-2.5 rounded-[3px] shrink-0"
                    style={{ backgroundColor: seg.color }}
                  />
                  <span className="font-mono text-[#71717A] tabular-nums">
                    {String(idx + 1).padStart(2, '0')}
                  </span>
                  <span className="font-semibold text-[#0B0B0B]">{seg.label}</span>
                  <span className="text-[#71717A] tabular-nums">({seg.count})</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Attached Outline Document Card & Inline Image Artwork */}
        {programOutline && (
          <div className="space-y-3">
            {outlineIsImage && (
              <div className="rounded-2xl bg-[#FAF8F5] border border-[#E5E2DC] p-3">
                <img
                  src={programOutline.dataUrl}
                  alt={programOutline.title || programOutline.fileName}
                  referrerPolicy="no-referrer"
                  className="w-full max-h-[420px] object-contain rounded-xl bg-white"
                />
              </div>
            )}
            <PublicProgramOutlineCard
              compact={variant !== 'invitation' && variant !== 'program'}
              outline={programOutline}
              eventTitle={event.title}
            />
          </div>
        )}

        {/* Filter Rails — horizontal scroll on compact phones with >=40px tap targets */}
        {(showMultipleDateTabs || showMultipleDayTabs || availableSections.length > 1) && (
          <div className="space-y-2">
            {showMultipleDateTabs && (
              <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 -mx-1 px-1">
                <button
                  type="button"
                  onClick={() => {
                    setDateFilter('all');
                    setDayFilter('all');
                    setSectionFilter('all');
                  }}
                  className={`min-h-[40px] px-3.5 py-2 rounded-full text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                    dateFilter === 'all'
                      ? 'bg-[#0B0B0B] text-white'
                      : 'bg-[#F5F5F7] text-[#71717A] hover:text-[#0B0B0B]'
                  }`}
                >
                  All Dates
                </button>
                {dateTabs.map((tab) => (
                  <button
                    key={tab.isoDate}
                    type="button"
                    onClick={() => {
                      setDateFilter(tab.isoDate);
                      setDayFilter('all');
                      setSectionFilter('all');
                    }}
                    className={`min-h-[40px] px-3.5 py-2 rounded-full text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                      dateFilter === tab.isoDate
                        ? 'bg-[#0B0B0B] text-white'
                        : 'bg-[#F5F5F7] text-[#71717A] hover:text-[#0B0B0B]'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            )}

            {showMultipleDayTabs && (
              <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 -mx-1 px-1">
                <button
                  type="button"
                  onClick={() => {
                    setDayFilter('all');
                    setSectionFilter('all');
                  }}
                  className={`min-h-[40px] px-3.5 py-2 rounded-full text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                    dayFilter === 'all'
                      ? 'bg-[#0B0B0B] text-white'
                      : 'bg-[#F5F5F7] text-[#71717A] hover:text-[#0B0B0B]'
                  }`}
                >
                  All Days
                </button>
                {distinctDays.map((day) => (
                  <button
                    key={day}
                    type="button"
                    onClick={() => {
                      setDayFilter(day);
                      setSectionFilter('all');
                    }}
                    className={`min-h-[40px] px-3.5 py-2 rounded-full text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                      dayFilter === day
                        ? 'bg-[#0B0B0B] text-white'
                        : 'bg-[#F5F5F7] text-[#71717A] hover:text-[#0B0B0B]'
                    }`}
                  >
                    {day}
                  </button>
                ))}
              </div>
            )}

            {availableSections.length > 1 && (
              <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 -mx-1 px-1">
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#71717A] pr-1 shrink-0">
                  <Layers className="w-3.5 h-3.5" />
                  <span>Sections:</span>
                </span>
                <button
                  type="button"
                  onClick={() => setSectionFilter('all')}
                  className={`min-h-[40px] px-3 py-1.5 rounded-full text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                    effectiveSectionFilter === 'all'
                      ? 'bg-[#0B0B0B] text-white'
                      : 'bg-[#F5F5F7] text-[#71717A] hover:text-[#0B0B0B]'
                  }`}
                >
                  All Sections
                </button>
                {availableSections.map((sectionName) => (
                  <button
                    key={sectionName}
                    type="button"
                    onClick={() => setSectionFilter(sectionName)}
                    className={`min-h-[40px] px-3 py-1.5 rounded-full text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                      effectiveSectionFilter === sectionName
                        ? 'bg-[#0B0B0B] text-white'
                        : 'bg-[#F5F5F7] text-[#71717A] hover:text-[#0B0B0B]'
                    }`}
                  >
                    {sectionName}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Optional Day Schedule Note */}
        {activeDayNote && (
          <div className="px-4 py-2.5 rounded-2xl bg-[#FAF8F5] border border-[#E5E2DC] text-xs text-[#444748]">
            <span className="font-semibold text-[#0B0B0B]">
              {formatIsoDateShort(dateFilter, true)} Note:{' '}
            </span>
            {activeDayNote}
          </div>
        )}

        {/* Visual Chronological Timeline Grouped by Section */}
        {sortedBlocks.length > 0 ? (
          <div className="space-y-6">
            {sectionGroups.map((group, gIdx) => (
              <div key={group.section || `section-${gIdx}`} className="min-w-0">
                {showSectionHeaders && (
                  <div className="flex items-center justify-between gap-2 pb-2.5 mb-3 border-b border-[#E5E5EA]">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span
                        className="font-mono text-[11px] font-bold tabular-nums shrink-0"
                        style={{ color: brandColor }}
                      >
                        {String(gIdx + 1).padStart(2, '0')}
                      </span>
                      <h4 className="text-xs font-bold uppercase tracking-[0.12em] text-[#0B0B0B] truncate">
                        {group.section}
                      </h4>
                    </div>
                    <span className="text-[11px] font-mono text-[#71717A] tabular-nums shrink-0">
                      {group.blocks.length} {group.blocks.length === 1 ? 'session' : 'sessions'}
                    </span>
                  </div>
                )}

                <div className="space-y-0">
                  {group.blocks.map((blk, bIdx) => {
                    const dateLabel = formatScheduleBlockDateBadge(blk, event);
                    const isFirst = bIdx === 0;
                    const isLast = bIdx === group.blocks.length - 1;
                    return (
                      <div key={blk.id} className="flex items-stretch gap-3 sm:gap-4 min-w-0">
                        {/* Left Monospace Time Column */}
                        <div className="w-24 sm:w-32 pt-1.5 pb-4 shrink-0 text-right">
                          <p className="font-mono text-xs sm:text-[13px] font-bold text-[#0B0B0B] tabular-nums">
                            {blk.time}
                          </p>
                          <p className="text-[11px] text-[#71717A] mt-0.5 tabular-nums truncate">
                            {dateLabel}
                            {blk.duration ? ` · ${blk.duration}` : ''}
                          </p>
                        </div>

                        {/* Center Visual Axis & Geometric Node */}
                        <div className="relative flex flex-col items-center w-5 shrink-0">
                          <div
                            className={`w-px h-2.5 ${isFirst ? 'bg-transparent' : 'bg-[#E5E5EA]'}`}
                          />
                          <div
                            className="w-3 h-3 rounded-full shrink-0 flex items-center justify-center bg-white"
                            style={{
                              border: `2px solid ${brandColor}`,
                            }}
                          >
                            {isFirst && (
                              <span
                                className="w-1.5 h-1.5 rounded-full"
                                style={{ backgroundColor: brandColor }}
                              />
                            )}
                          </div>
                          <div
                            className={`w-px flex-1 ${isLast ? 'bg-transparent' : 'bg-[#E5E5EA]'}`}
                          />
                        </div>

                        {/* Right Session Details */}
                        <div
                          className={`min-w-0 flex-1 pt-0.5 pb-4 ${
                            !isLast ? 'border-b border-[#F1F1F3]' : ''
                          }`}
                        >
                          <p className="text-sm sm:text-[15px] font-semibold text-[#0B0B0B] leading-snug break-words">
                            {blk.title}
                          </p>
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1 text-xs text-[#52525B]">
                            <span className="inline-flex items-center gap-1 min-w-0">
                              <MapPin className="w-3 h-3 text-[#71717A] shrink-0" />
                              <span className="truncate">{blk.stage}</span>
                            </span>
                            <span className="inline-flex items-center gap-1 min-w-0">
                              <UserCheck className="w-3 h-3 text-[#71717A] shrink-0" />
                              <span className="truncate">Led by {blk.lead}</span>
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        ) : (
          !programOutline && (
            <div className="py-8 text-center space-y-3 border-t border-[#E5E5EA]">
              <p className="text-sm font-semibold text-[#0B0B0B]">
                Program outline sessions will appear here once published by the organiser.
              </p>
              {onBackToInvitation && (
                <button
                  type="button"
                  onClick={onBackToInvitation}
                  className="min-h-[40px] px-4 py-2 rounded-full bg-[#0B0B0B] text-white text-xs font-semibold hover:bg-neutral-800 transition-colors"
                >
                  Back to Event Invitation
                </button>
              )}
            </div>
          )
        )}
      </div>

      {/* Graphical QR & Direct Attendee Program Stamp Footer (Standalone Route) */}
      {isStandaloneProgram && (
        <div className="px-4 sm:px-6 py-4 bg-[#FAF8F5] border-t border-[#E5E2DC] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-11 h-11 rounded-xl bg-white border border-[#D4D0C7] flex items-center justify-center overflow-hidden shrink-0">
              {logoUrl ? (
                <img
                  src={logoUrl}
                  alt={`${event.organizer} emblem`}
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-contain p-1"
                />
              ) : (
                <span className="font-serif font-bold text-xs text-[#0B0B0B]">{monogram}</span>
              )}
            </div>
            <div className="min-w-0">
              <p className="text-xs font-bold text-[#0B0B0B]">
                Live Attendee Program &amp; Schedule Link
              </p>
              <p className="text-[11px] font-mono text-[#52525B] truncate mt-0.5">{programUrl}</p>
            </div>
          </div>

          <div className="flex items-center gap-3 self-end sm:self-auto shrink-0">
            <div className="p-1.5 rounded-xl bg-white border border-[#E5E2DC]">
              <DeterministicQrSvg
                value={programUrl}
                size={60}
                label={`Program link QR for ${event.title}`}
              />
            </div>
          </div>
        </div>
      )}
    </section>
  );
};
