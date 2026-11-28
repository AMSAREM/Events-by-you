import React, { useEffect, useMemo, useState } from 'react';
import { CalendarDays, Clock, Layers } from 'lucide-react';
import type { EventItem, EventProgramOutline, ScheduleBlock } from '../types/events';
import {
  ALL_SCHEDULE_DAYS,
  compareScheduleBlocksChronological,
  formatIsoDateShort,
  formatScheduleBlockDateBadge,
  getEventDateSlots,
  getScheduleSections,
  groupScheduleBlocksBySection,
  resolveScheduleBlockDate,
} from '../lib/eventDates';
import { PublicProgramOutlineCard } from './ProgramOutlineViewer';

interface PublicProgramOutlineSectionProps {
  event: EventItem;
  programOutline?: EventProgramOutline;
  scheduleBlocks: ScheduleBlock[];
  variant?: 'invitation' | 'checkin' | 'pass';
  id?: string;
}

export const PublicProgramOutlineSection: React.FC<PublicProgramOutlineSectionProps> = ({
  event,
  programOutline,
  scheduleBlocks,
  variant = 'invitation',
  id,
}) => {
  const [dateFilter, setDateFilter] = useState<'all' | string>('all');
  const [dayFilter, setDayFilter] = useState<'all' | ScheduleBlock['day']>('all');
  const [sectionFilter, setSectionFilter] = useState<'all' | string>('all');

  useEffect(() => {
    setDateFilter('all');
    setDayFilter('all');
    setSectionFilter('all');
  }, [event.id]);

  const sortedBlocks = useMemo(
    () =>
      scheduleBlocks
        .filter((b) => b.eventId === event.id)
        .slice()
        .sort((a, b) => compareScheduleBlocksChronological(a, b, event)),
    [scheduleBlocks, event]
  );

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

  const dayNotes = event.extraDataConfig?.planningConfig?.dayScheduleNotes;
  const activeDayNote = dateFilter !== 'all' ? dayNotes?.[dateFilter] : undefined;

  if (sortedBlocks.length === 0 && !programOutline) {
    return null;
  }

  const headingTitle =
    variant === 'checkin'
      ? 'Program Outline & Schedule'
      : variant === 'pass'
        ? `${event.category} Program Outline`
        : 'Event Program & Schedule';

  const showMultipleDateTabs = dateTabs.length > 1;
  const showMultipleDayTabs = !showMultipleDateTabs && distinctDays.length > 1;

  return (
    <section
      id={id}
      className="bg-white rounded-[24px] sm:rounded-[28px] p-4 sm:p-6 shadow-sm border border-[#E5E5EA]/70 space-y-4 min-w-0"
    >
      {/* Header */}
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-display text-base sm:text-lg font-bold tracking-[-0.01em] text-[#0B0B0B]">
            {headingTitle}
          </h3>
          <p className="text-[11px] sm:text-xs text-[#71717A] mt-0.5 tabular-nums">
            {sortedBlocks.length > 0
              ? `${visibleBlocks.length} ${visibleBlocks.length === 1 ? 'session' : 'sessions'}${
                  availableSections.length > 0 ? ` · ${availableSections.length} sections` : ''
                }`
              : 'Official downloadable program document'}
          </p>
        </div>

        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-[#71717A] shrink-0">
          <CalendarDays className="w-3.5 h-3.5" />
          <span>{event.venue}</span>
        </span>
      </div>

      {/* Attached Outline Document Card */}
      {programOutline && (
        <PublicProgramOutlineCard
          compact={variant !== 'invitation'}
          outline={programOutline}
          eventTitle={event.title}
        />
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
        <div className="px-3.5 py-2.5 rounded-2xl bg-[#F5F5F7] text-xs text-[#444748]">
          <span className="font-semibold text-[#0B0B0B]">
            {formatIsoDateShort(dateFilter, true)} Note:{' '}
          </span>
          {activeDayNote}
        </div>
      )}

      {/* Sessions Grouped by Section (Clean Hairline Dividers, Zero Nested Card Clutter) */}
      {sortedBlocks.length > 0 && (
        <div className="space-y-4">
          {sectionGroups.map((group, gIdx) => (
            <div key={group.section || `section-${gIdx}`} className="min-w-0">
              {showSectionHeaders && (
                <div className="flex items-center justify-between gap-2 pb-2 mb-1 border-b border-[#E5E5EA]">
                  <h4 className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#0B0B0B] truncate">
                    {group.section}
                  </h4>
                  <span className="text-[11px] text-[#71717A] tabular-nums shrink-0">
                    {group.blocks.length} {group.blocks.length === 1 ? 'item' : 'items'}
                  </span>
                </div>
              )}

              <div className="divide-y divide-[#ECECEF]">
                {group.blocks.map((blk) => {
                  const dateLabel = formatScheduleBlockDateBadge(blk, event);
                  return (
                    <div
                      key={blk.id}
                      className="py-3 first:pt-1 last:pb-1 flex flex-col sm:flex-row sm:items-baseline gap-1.5 sm:gap-5 min-w-0"
                    >
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 sm:w-44 shrink-0">
                        <span className="font-mono text-xs sm:text-[13px] font-bold text-[#0B0B0B] tabular-nums inline-flex items-center gap-1.5">
                          <Clock className="w-3.5 h-3.5 text-[#71717A] sm:hidden shrink-0" />
                          {blk.time}
                        </span>
                        <span className="text-[11px] text-[#71717A] tabular-nums">
                          {dateLabel}
                          {blk.duration ? ` · ${blk.duration}` : ''}
                        </span>
                      </div>

                      <div className="min-w-0 flex-1">
                        <p className="text-sm sm:text-[15px] font-semibold text-[#0B0B0B] leading-snug break-words">
                          {blk.title}
                        </p>
                        <p className="text-xs text-[#52525B] mt-0.5 break-words">
                          {blk.stage} · Led by {blk.lead}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
};
