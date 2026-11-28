import React, { useEffect, useMemo, useState } from 'react';
import { Calendar, Check, Clock, FileText, Layers, Plus, Printer, Trash2 } from 'lucide-react';
import { EventItem, EventProgramOutline, OrganizerProfile, ScheduleBlock, SystemAlert } from '../types/events';
import {
  ALL_SCHEDULE_DAYS,
  SCHEDULE_EVENT_DAYS,
  SCHEDULE_WEEKDAYS,
  compareScheduleBlocksChronological,
  formatIsoDateShort,
  formatScheduleBlockDateBadge,
  getEventDateSlots,
  getEventDayOptions,
  getScheduleBlockDayFromIso,
  getScheduleSections,
  groupScheduleBlocksBySection,
  isMultiDayEvent,
  resolveIsoDateForScheduleDay,
  resolveScheduleBlockDate,
  sanitizeIsoDate,
  sanitizeScheduleSection,
} from '../lib/eventDates';
import type { ParsedProgramOutlineBlock } from '../lib/programOutline';
import { ProgramOutlineExportModal } from './ProgramOutlineExportModal';
import { ProgramOutlineUploadCard } from './ProgramOutlineUploadCard';
import { TopUtilityBar } from './TopUtilityBar';

interface ScheduleScreenProps {
  events: EventItem[];
  blocks: ScheduleBlock[];
  alerts: SystemAlert[];
  profile: OrganizerProfile;
  onToggleBlock: (id: string) => void;
  onAddBlock: (block: ScheduleBlock) => Promise<void> | void;
  onUpdateBlock?: (id: string, patch: Partial<ScheduleBlock>) => Promise<void> | void;
  onDeleteBlock?: (id: string) => void;
  onUpdateEvent?: (updated: EventItem) => Promise<void> | void;
  onManageEvent: (event: EventItem) => void;
  onNavigateSettings: () => void;
  onResolveAlert: (id: string) => void;
}

export const ScheduleScreen: React.FC<ScheduleScreenProps> = ({
  events,
  blocks,
  alerts,
  profile,
  onToggleBlock,
  onAddBlock,
  onUpdateBlock,
  onDeleteBlock,
  onUpdateEvent,
  onManageEvent,
  onNavigateSettings,
  onResolveAlert,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDay, setSelectedDay] = useState<'All' | ScheduleBlock['day']>('All');
  const [selectedDate, setSelectedDate] = useState<'all' | string>('all');
  const [selectedSection, setSelectedSection] = useState<'all' | string>('all');
  const [selectedEventId, setSelectedEventId] = useState<string>('all');
  const [showAddForm, setShowAddForm] = useState(false);
  const [showOutlinePanel, setShowOutlinePanel] = useState(false);
  const [savingOutline, setSavingOutline] = useState(false);
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [editingSectionBlockId, setEditingSectionBlockId] = useState<string | null>(null);
  const [editingSectionDraft, setEditingSectionDraft] = useState('');

  const [newTitle, setNewTitle] = useState('');
  const [newSection, setNewSection] = useState('');
  const [newTime, setNewTime] = useState('14:00');
  const [newDuration, setNewDuration] = useState('45m');
  const [newStage, setNewStage] = useState('Main Stage');
  const [newLead, setNewLead] = useState(profile.name);
  const [newEventId, setNewEventId] = useState(events[0]?.id ?? '');
  const [newDay, setNewDay] = useState<ScheduleBlock['day']>(() =>
    isMultiDayEvent(events[0]) ? 'Day 1' : 'Sat'
  );
  const [newDate, setNewDate] = useState<string>(
    () =>
      resolveIsoDateForScheduleDay(
        isMultiDayEvent(events[0]) ? 'Day 1' : 'Sat',
        events[0]
      ) ||
      sanitizeIsoDate(events[0]?.isoDate) ||
      ''
  );

  useEffect(() => {
    if (events.length > 0 && (!newEventId || !events.some((e) => e.id === newEventId))) {
      const firstEvt = events[0];
      const nextDay = isMultiDayEvent(firstEvt) ? 'Day 1' : 'Sat';
      setNewEventId(firstEvt.id);
      setNewDay(nextDay);
      setNewDate(
        resolveIsoDateForScheduleDay(nextDay, firstEvt) ||
          sanitizeIsoDate(firstEvt.isoDate) ||
          ''
      );
    }
  }, [events, newEventId]);

  const eventMap = useMemo(() => {
    const map = new Map<string, EventItem>();
    events.forEach((e) => map.set(e.id, e));
    return map;
  }, [events]);

  const filterDays = useMemo<('All' | ScheduleBlock['day'])[]>(() => {
    const used = new Set(blocks.map((b) => b.day));
    const selectedEvt = selectedEventId !== 'all' ? eventMap.get(selectedEventId) : undefined;
    const base: ScheduleBlock['day'][] = [];
    if (selectedEvt && isMultiDayEvent(selectedEvt)) {
      for (const opt of getEventDayOptions(selectedEvt)) {
        if (SCHEDULE_EVENT_DAYS.includes(opt.value as (typeof SCHEDULE_EVENT_DAYS)[number])) {
          base.push(opt.value);
        }
      }
    } else {
      for (const d of SCHEDULE_EVENT_DAYS) {
        if (used.has(d)) base.push(d);
      }
    }
    for (const wd of SCHEDULE_WEEKDAYS) {
      if (used.has(wd) || ['Tue', 'Wed', 'Thu', 'Sat', 'Sun'].includes(wd)) {
        if (!base.includes(wd)) base.push(wd);
      }
    }
    for (const d of ALL_SCHEDULE_DAYS) {
      if (used.has(d) && !base.includes(d)) base.push(d);
    }
    return ['All', ...base];
  }, [blocks, selectedEventId, eventMap]);

  const filterDateSlots = useMemo(() => {
    const map = new Map<string, string>();
    const selectedEvt = selectedEventId !== 'all' ? eventMap.get(selectedEventId) : undefined;
    if (selectedEvt) {
      for (const slot of getEventDateSlots(selectedEvt)) {
        map.set(slot.isoDate, slot.fullLabel);
      }
      for (const b of blocks) {
        if (b.eventId !== selectedEvt.id) continue;
        const resolved = resolveScheduleBlockDate(b, selectedEvt);
        if (resolved && !map.has(resolved)) {
          map.set(resolved, formatIsoDateShort(resolved, true));
        }
      }
    } else {
      for (const b of blocks) {
        const evt = eventMap.get(b.eventId);
        const resolved = resolveScheduleBlockDate(b, evt ?? null);
        if (resolved && !map.has(resolved)) {
          map.set(resolved, formatIsoDateShort(resolved, true));
        }
      }
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([isoDate, label]) => ({ isoDate, label }));
  }, [blocks, selectedEventId, eventMap]);

  const targetCreateEvent = eventMap.get(newEventId);
  const outlineTargetEvent =
    (selectedEventId !== 'all' ? eventMap.get(selectedEventId) : targetCreateEvent) ??
    events[0];
  const targetCreateDateSlots = useMemo(
    () => getEventDateSlots(targetCreateEvent),
    [targetCreateEvent]
  );

  const cueDayOptions = useMemo(() => {
    const opts = getEventDayOptions(targetCreateEvent);
    const present = new Set(opts.map((o) => o.value));
    for (const d of ALL_SCHEDULE_DAYS) {
      if (!present.has(d)) opts.push({ value: d, label: d });
    }
    return opts;
  }, [targetCreateEvent]);

  const availableSections = useMemo(() => {
    const scoped =
      selectedEventId === 'all' ? blocks : blocks.filter((b) => b.eventId === selectedEventId);
    return getScheduleSections(scoped);
  }, [blocks, selectedEventId]);

  useEffect(() => {
    if (selectedSection !== 'all' && !availableSections.includes(selectedSection)) {
      setSelectedSection('all');
    }
  }, [availableSections, selectedSection]);

  const filteredBlocks = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return blocks
      .filter((b) => {
        const evt = eventMap.get(b.eventId);
        const matchesDay = selectedDay === 'All' || b.day === selectedDay;
        const resolvedDate = resolveScheduleBlockDate(b, evt ?? null);
        const matchesDate = selectedDate === 'all' || resolvedDate === selectedDate;
        const blockSection = sanitizeScheduleSection(b.section);
        const matchesSection =
          selectedSection === 'all' || blockSection === selectedSection;
        const matchesEvent = selectedEventId === 'all' || b.eventId === selectedEventId;
        const evtTitle = evt?.title.toLowerCase() ?? '';
        const matchesQuery =
          !q ||
          b.title.toLowerCase().includes(q) ||
          b.stage.toLowerCase().includes(q) ||
          b.lead.toLowerCase().includes(q) ||
          (blockSection && blockSection.toLowerCase().includes(q)) ||
          (resolvedDate && resolvedDate.includes(q)) ||
          evtTitle.includes(q);
        return matchesDay && matchesDate && matchesSection && matchesEvent && matchesQuery;
      })
      .sort((a, b) =>
        compareScheduleBlocksChronological(
          a,
          b,
          eventMap.get(a.eventId) ?? eventMap.get(b.eventId) ?? null
        )
      );
  }, [blocks, selectedDay, selectedDate, selectedSection, selectedEventId, searchQuery, eventMap]);

  const groupedBlocks = useMemo(
    () => groupScheduleBlocksBySection(filteredBlocks, 'General Program'),
    [filteredBlocks]
  );

  const hasMultipleSectionGroups =
    groupedBlocks.length > 1 || (groupedBlocks.length === 1 && !groupedBlocks[0].isGeneral);

  const completedCount = filteredBlocks.filter((b) => b.completed).length;

  const handleCreateCue = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim() || !newEventId) return;
    const evt = eventMap.get(newEventId);
    const chosenDate =
      sanitizeIsoDate(newDate) || resolveIsoDateForScheduleDay(newDay, evt);
    const chosenDay = chosenDate
      ? getScheduleBlockDayFromIso(chosenDate, evt, newDay)
      : newDay;
    const cleanSection = sanitizeScheduleSection(newSection);
    try {
      await Promise.resolve(
        onAddBlock({
          id: `sch-${Date.now()}`,
          eventId: newEventId,
          time: newTime,
          duration: newDuration,
          title: newTitle.trim(),
          stage: newStage.trim() || 'Main Stage',
          lead: newLead.trim() || profile.name,
          completed: false,
          day: chosenDay,
          ...(chosenDate ? { date: chosenDate } : {}),
          ...(cleanSection ? { section: cleanSection } : {}),
        })
      );
      setNewTitle('');
      setShowAddForm(false);
    } catch {
      // Error surfaced via top-level banner
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-[28px] sm:text-[32px] font-bold tracking-[-0.02em] text-[#0B0B0B]">
            Production Schedule
          </h1>
          <p className="text-sm text-[#71717A] mt-0.5 tabular-nums">
            {completedCount} of {filteredBlocks.length} production cues verified ready
          </p>
        </div>

        <div className="lg:w-[440px]">
          <TopUtilityBar
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            searchPlaceholder="Search cues, dates, stages, leads..."
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

      {/* Filter Bar */}
      <div className="space-y-2.5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2.5 min-w-0">
            <div className="flex items-center gap-1 p-1 bg-[#F5F5F7] rounded-full overflow-x-auto max-w-full">
              {filterDays.map((day) => (
                <button
                  key={day}
                  type="button"
                  onClick={() => {
                    setSelectedDay(day);
                    setSelectedDate('all');
                  }}
                  className={`min-h-[36px] px-3.5 py-1.5 rounded-full text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                    selectedDay === day && selectedDate === 'all'
                      ? 'bg-[#0B0B0B] text-white'
                      : 'text-[#71717A] hover:text-[#0B0B0B]'
                  }`}
                >
                  {day === 'All' ? 'All Days' : day}
                </button>
              ))}
            </div>

            <select
              value={selectedEventId}
              onChange={(e) => {
                setSelectedEventId(e.target.value);
                setSelectedDate('all');
                setSelectedSection('all');
              }}
              aria-label="Filter by event"
              className="h-10 px-4 rounded-full bg-[#F5F5F7] text-xs font-semibold text-[#0B0B0B] border border-transparent focus:border-[#0B0B0B] focus:bg-white focus:outline-none max-w-full"
            >
              <option value="all">All Productions</option>
              {events.map((evt) => (
                <option key={evt.id} value={evt.id}>
                  {evt.title}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {outlineTargetEvent && (
              <button
                type="button"
                onClick={() => setExportModalOpen(true)}
                className="min-h-[40px] px-4 py-2 rounded-full bg-white border border-[#E5E5EA] hover:border-[#0B0B0B] text-xs font-semibold text-[#0B0B0B] transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>Export Program Sheet</span>
              </button>
            )}
            {onUpdateEvent && events.length > 0 && (
              <button
                type="button"
                onClick={() => setShowOutlinePanel((prev) => !prev)}
                className={`min-h-[40px] px-4 py-2 rounded-full text-xs font-semibold transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
                  showOutlinePanel || outlineTargetEvent?.extraDataConfig?.programOutline
                    ? 'bg-white border border-[#0B0B0B] text-[#0B0B0B]'
                    : 'bg-[#F5F5F7] hover:bg-[#E5E5EA] text-[#0B0B0B]'
                }`}
              >
                <FileText className="w-3.5 h-3.5" />
                <span>
                  {showOutlinePanel
                    ? 'Hide Outline Upload'
                    : outlineTargetEvent?.extraDataConfig?.programOutline
                      ? 'Program Outline Attached'
                      : 'Upload Program Outline'}
                </span>
              </button>
            )}
            <button
              type="button"
              onClick={() => setShowAddForm((prev) => !prev)}
              className="min-h-[40px] px-5 py-2 rounded-full bg-[#0B0B0B] text-white text-xs font-semibold hover:bg-zinc-800 transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
            >
              <Plus className="w-4 h-4" />
              Add Cue
            </button>
          </div>
        </div>

        {filterDateSlots.length > 0 && (
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#71717A] pr-1 shrink-0">
              <Calendar className="w-3.5 h-3.5" />
              Dates:
            </span>
            <button
              type="button"
              onClick={() => setSelectedDate('all')}
              className={`min-h-[36px] px-3.5 py-1.5 rounded-full text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                selectedDate === 'all'
                  ? 'bg-[#0B0B0B] text-white'
                  : 'bg-[#F5F5F7] text-[#71717A] hover:text-[#0B0B0B]'
              }`}
            >
              All Dates
            </button>
            {filterDateSlots.map((slot) => (
              <button
                key={slot.isoDate}
                type="button"
                onClick={() => {
                  setSelectedDate(slot.isoDate);
                  setSelectedDay('All');
                }}
                className={`min-h-[36px] px-3.5 py-1.5 rounded-full text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                  selectedDate === slot.isoDate
                    ? 'bg-[#0B0B0B] text-white'
                    : 'bg-[#F5F5F7] text-[#71717A] hover:text-[#0B0B0B]'
                }`}
              >
                {slot.label}
              </button>
            ))}
          </div>
        )}

        {availableSections.length > 0 && (
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#71717A] pr-1 shrink-0">
              <Layers className="w-3.5 h-3.5" />
              Sections:
            </span>
            <button
              type="button"
              onClick={() => setSelectedSection('all')}
              className={`min-h-[36px] px-3.5 py-1.5 rounded-full text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                selectedSection === 'all'
                  ? 'bg-[#0B0B0B] text-white'
                  : 'bg-[#F5F5F7] text-[#71717A] hover:text-[#0B0B0B]'
              }`}
            >
              All Sections
            </button>
            {availableSections.map((sec) => (
              <button
                key={sec}
                type="button"
                onClick={() => setSelectedSection(sec)}
                className={`min-h-[36px] px-3.5 py-1.5 rounded-full text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                  selectedSection === sec
                    ? 'bg-[#0B0B0B] text-white'
                    : 'bg-[#F5F5F7] text-[#71717A] hover:text-[#0B0B0B]'
                }`}
              >
                {sec}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Collapsible Program Outline Uploader & Importer */}
      {showOutlinePanel && onUpdateEvent && outlineTargetEvent && (
        <div className="p-4 sm:p-5 rounded-3xl bg-[#F5F5F7] space-y-3">
          {selectedEventId === 'all' && events.length > 1 && (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-semibold text-[#0B0B0B]">
                Target Production for Program Outline
              </span>
              <select
                value={outlineTargetEvent.id}
                onChange={(e) => setNewEventId(e.target.value)}
                aria-label="Target production for program outline"
                className="h-9 px-3.5 rounded-full bg-white border border-[#E5E5EA] text-xs font-semibold text-[#0B0B0B]"
              >
                {events.map((evt) => (
                  <option key={evt.id} value={evt.id}>
                    {evt.title}
                  </option>
                ))}
              </select>
            </div>
          )}
          <ProgramOutlineUploadCard
            compact
            outline={outlineTargetEvent.extraDataConfig?.programOutline}
            eventTitle={outlineTargetEvent.title}
            eventContext={outlineTargetEvent}
            logoUrl={outlineTargetEvent.extraDataConfig?.logoUrl || profile.avatarUrl}
            hasScheduleBlocks={blocks.some((b) => b.eventId === outlineTargetEvent.id)}
            busy={savingOutline}
            onOpenExportDesign={() => setExportModalOpen(true)}
            onLogoChange={async (nextLogoUrl) => {
              setSavingOutline(true);
              try {
                const baseExtra = outlineTargetEvent.extraDataConfig ?? {
                  enableGiftTable: false,
                  customFields: [],
                };
                await Promise.resolve(
                  onUpdateEvent({
                    ...outlineTargetEvent,
                    extraDataConfig: {
                      ...baseExtra,
                      logoUrl: (nextLogoUrl ?? null) as unknown as string,
                    },
                  })
                );
              } finally {
                setSavingOutline(false);
              }
            }}
            onSaveOutline={async (nextOutline) => {
              setSavingOutline(true);
              try {
                const baseExtra = outlineTargetEvent.extraDataConfig ?? {
                  enableGiftTable: false,
                  customFields: [],
                };
                await Promise.resolve(
                  onUpdateEvent({
                    ...outlineTargetEvent,
                    extraDataConfig: {
                      ...baseExtra,
                      programOutline:
                        nextOutline ?? (null as unknown as EventProgramOutline),
                    },
                  })
                );
              } finally {
                setSavingOutline(false);
              }
            }}
            onImportParsedBlocks={async (parsedBlocks: ParsedProgramOutlineBlock[]) => {
              const seed = Date.now();
              for (let i = 0; i < parsedBlocks.length; i += 1) {
                const pb = parsedBlocks[i];
                await Promise.resolve(
                  onAddBlock({
                    id: `sch-${seed}-${i}`,
                    eventId: outlineTargetEvent.id,
                    time: pb.time,
                    duration: pb.duration,
                    title: pb.title,
                    stage: pb.stage,
                    lead: pb.lead || profile.name,
                    completed: false,
                    day: pb.day,
                    ...(pb.date ? { date: pb.date } : {}),
                    ...(pb.section ? { section: pb.section } : {}),
                  })
                );
              }
            }}
          />
        </div>
      )}

      {outlineTargetEvent && (
        <ProgramOutlineExportModal
          open={exportModalOpen}
          event={outlineTargetEvent}
          scheduleBlocks={blocks}
          fallbackLogoUrl={profile.avatarUrl}
          canEditLogo={Boolean(onUpdateEvent)}
          onUpdateLogo={
            onUpdateEvent
              ? async (nextLogoUrl) => {
                  const baseExtra = outlineTargetEvent.extraDataConfig ?? {
                    enableGiftTable: false,
                    customFields: [],
                  };
                  await Promise.resolve(
                    onUpdateEvent({
                      ...outlineTargetEvent,
                      extraDataConfig: {
                        ...baseExtra,
                        logoUrl: (nextLogoUrl ?? null) as unknown as string,
                      },
                    })
                  );
                }
              : undefined
          }
          onClose={() => setExportModalOpen(false)}
        />
      )}

      <datalist id="schedule-sections-list">
        {availableSections.map((sec) => (
          <option key={sec} value={sec} />
        ))}
      </datalist>

      {/* Inline Add Cue Form */}
      {showAddForm && (
        <form
          onSubmit={handleCreateCue}
          className="p-4 sm:p-6 rounded-3xl bg-[#F5F5F7] grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-8 gap-3 items-end"
        >
          <div className="lg:col-span-2">
            <label className="block text-xs font-semibold text-[#0B0B0B] mb-1">Cue Title</label>
            <input
              type="text"
              required
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="e.g. Keynote Mic Check"
              className="w-full h-10 px-3.5 rounded-full bg-white border border-[#E5E5EA] text-xs text-[#0B0B0B] focus:border-[#0B0B0B] focus:outline-none"
            />
          </div>
          <div className="lg:col-span-2">
            <label className="block text-xs font-semibold text-[#0B0B0B] mb-1">
              Section (Optional)
            </label>
            <input
              type="text"
              list="schedule-sections-list"
              value={newSection}
              onChange={(e) => setNewSection(e.target.value)}
              placeholder="e.g. Part 1 · Opening"
              className="w-full h-10 px-3.5 rounded-full bg-white border border-[#E5E5EA] text-xs text-[#0B0B0B] focus:border-[#0B0B0B] focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-[#0B0B0B] mb-1">Production</label>
            <select
              value={newEventId}
              onChange={(e) => {
                const nextId = e.target.value;
                setNewEventId(nextId);
                const nextEvt = eventMap.get(nextId);
                const nextDay = nextEvt && isMultiDayEvent(nextEvt) ? 'Day 1' : newDay;
                if (nextEvt && isMultiDayEvent(nextEvt)) {
                  setNewDay('Day 1');
                }
                const nextIso =
                  resolveIsoDateForScheduleDay(nextDay, nextEvt) ||
                  sanitizeIsoDate(nextEvt?.isoDate) ||
                  '';
                if (nextIso) setNewDate(nextIso);
              }}
              className="w-full h-10 px-3 rounded-full bg-white border border-[#E5E5EA] text-xs text-[#0B0B0B] focus:border-[#0B0B0B] focus:outline-none"
            >
              {events.map((evt) => (
                <option key={evt.id} value={evt.id}>
                  {evt.title}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-[#0B0B0B] mb-1">Stage</label>
            <input
              type="text"
              value={newStage}
              onChange={(e) => setNewStage(e.target.value)}
              className="w-full h-10 px-3.5 rounded-full bg-white border border-[#E5E5EA] text-xs text-[#0B0B0B] focus:border-[#0B0B0B] focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-[#0B0B0B] mb-1">Specific Date</label>
            {targetCreateDateSlots.length > 1 ? (
              <select
                value={newDate}
                onChange={(e) => {
                  const chosen = e.target.value;
                  setNewDate(chosen);
                  if (chosen) {
                    setNewDay(getScheduleBlockDayFromIso(chosen, targetCreateEvent, newDay));
                  }
                }}
                aria-label="Specific schedule date"
                className="w-full h-10 px-3 rounded-full bg-white border border-[#E5E5EA] text-xs font-semibold text-[#0B0B0B]"
              >
                {targetCreateDateSlots.map((slot) => (
                  <option key={slot.isoDate} value={slot.isoDate}>
                    {slot.fullLabel}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="date"
                value={newDate}
                onChange={(e) => {
                  const chosen = e.target.value;
                  setNewDate(chosen);
                  const clean = sanitizeIsoDate(chosen);
                  if (clean) {
                    setNewDay(getScheduleBlockDayFromIso(clean, targetCreateEvent, newDay));
                  }
                }}
                aria-label="Specific schedule date"
                className="w-full h-10 px-3 rounded-full bg-white border border-[#E5E5EA] text-xs font-mono text-[#0B0B0B]"
              />
            )}
          </div>
          <div>
            <label className="block text-xs font-semibold text-[#0B0B0B] mb-1">Day Tag</label>
            <select
              value={newDay}
              onChange={(e) => {
                const chosenDay = e.target.value as ScheduleBlock['day'];
                setNewDay(chosenDay);
                const mapped = resolveIsoDateForScheduleDay(chosenDay, targetCreateEvent);
                if (mapped) setNewDate(mapped);
              }}
              className="w-full h-10 px-2.5 rounded-full bg-white border border-[#E5E5EA] text-xs text-[#0B0B0B]"
            >
              {cueDayOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-[#0B0B0B] mb-1">Time</label>
            <input
              type="text"
              value={newTime}
              onChange={(e) => setNewTime(e.target.value)}
              className="w-full h-10 px-3 rounded-full bg-white border border-[#E5E5EA] text-xs font-mono text-[#0B0B0B] tabular-nums"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-[#0B0B0B] mb-1">Lead</label>
            <input
              type="text"
              value={newLead}
              onChange={(e) => setNewLead(e.target.value)}
              className="w-full h-10 px-3.5 rounded-full bg-white border border-[#E5E5EA] text-xs text-[#0B0B0B] focus:border-[#0B0B0B] focus:outline-none"
            />
          </div>
          <div className="sm:col-span-2 lg:col-span-2 flex items-center gap-2">
            <button
              type="submit"
              className="flex-1 h-10 rounded-full bg-[#0B0B0B] text-white text-xs font-semibold hover:bg-zinc-800 transition-colors"
            >
              Save Cue
            </button>
          </div>
        </form>
      )}

      {/* Timeline List Grouped by Section */}
      <div className="space-y-4">
        {filteredBlocks.length === 0 ? (
          <div className="p-10 rounded-3xl bg-[#F5F5F7] text-center">
            <p className="text-sm font-semibold text-[#0B0B0B]">No cues scheduled</p>
            <p className="text-xs text-[#71717A] mt-1">
              Add a production cue or adjust the active date, section, or day filter.
            </p>
          </div>
        ) : (
          groupedBlocks.map((group) => (
            <div key={group.section || '__general__'} className="space-y-2">
              {hasMultipleSectionGroups && (
                <div className="flex items-center justify-between gap-2 px-1">
                  <div className="flex items-center gap-2 min-w-0">
                    <Layers className="w-3.5 h-3.5 text-[#71717A] shrink-0" />
                    <h2 className="font-display text-sm sm:text-base font-bold text-[#0B0B0B] truncate">
                      {group.section}
                    </h2>
                  </div>
                  <span className="text-[11px] font-semibold text-[#71717A] tabular-nums shrink-0">
                    {group.blocks.length} {group.blocks.length === 1 ? 'cue' : 'cues'}
                  </span>
                </div>
              )}

              <div className="rounded-2xl bg-white border border-[#E5E5EA] divide-y divide-[#E5E5EA] overflow-hidden">
                {group.blocks.map((block) => {
                  const evt = eventMap.get(block.eventId);
                  const dateBadge = formatScheduleBlockDateBadge(block, evt ?? null);
                  const resolvedBlockIso = resolveScheduleBlockDate(block, evt ?? null) || '';
                  const evtDateSlots = getEventDateSlots(evt);
                  const blockSection = sanitizeScheduleSection(block.section);
                  const isEditingSection = editingSectionBlockId === block.id;

                  return (
                    <div
                      key={block.id}
                      className="p-3.5 sm:p-5 hover:bg-[#FAFAFC] transition-colors flex flex-col lg:flex-row lg:items-center justify-between gap-3"
                    >
                      <div className="flex items-start gap-3 min-w-0">
                        <button
                          type="button"
                          onClick={() => {
                            void Promise.resolve(onToggleBlock(block.id)).catch(() => {});
                          }}
                          aria-label={block.completed ? 'Mark cue pending' : 'Mark cue ready'}
                          className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 transition-colors ${
                            block.completed
                              ? 'bg-[#0B0B0B] text-white'
                              : 'bg-[#F5F5F7] border border-[#E5E5EA] text-transparent hover:border-[#0B0B0B]'
                          }`}
                        >
                          <Check className="w-4 h-4" />
                        </button>

                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-[#71717A] tabular-nums">
                            <span className="font-mono text-xs sm:text-sm font-semibold text-[#0B0B0B]">
                              {block.time}
                            </span>
                            <span className="inline-flex items-center gap-1">
                              <Clock className="w-3 h-3 shrink-0" />
                              {dateBadge} · {block.duration}
                            </span>
                            {blockSection && !hasMultipleSectionGroups && (
                              <span className="text-[#0B0B0B] font-semibold">
                                · {blockSection}
                              </span>
                            )}
                          </div>

                          <h3
                            className={`text-sm sm:text-base font-semibold break-words leading-snug ${
                              block.completed ? 'text-[#71717A] line-through' : 'text-[#0B0B0B]'
                            }`}
                          >
                            {block.title}
                          </h3>

                          <p className="text-xs text-[#71717A] break-words">
                            {evt ? (
                              <button
                                type="button"
                                onClick={() => onManageEvent(evt)}
                                className="font-medium text-[#0B0B0B] hover:underline text-left"
                              >
                                {evt.title}
                              </button>
                            ) : (
                              'Production'
                            )}{' '}
                            · {block.stage} · Lead: {block.lead}
                          </p>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center justify-start lg:justify-end gap-2 pl-12 lg:pl-0 shrink-0">
                        {onUpdateBlock && isEditingSection ? (
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <input
                              type="text"
                              list="schedule-sections-list"
                              value={editingSectionDraft}
                              onChange={(e) => setEditingSectionDraft(e.target.value)}
                              placeholder="Section name"
                              aria-label={`Section for ${block.title}`}
                              className="h-9 w-40 px-3 rounded-full bg-[#F5F5F7] border border-[#0B0B0B] text-[11px] text-[#0B0B0B] focus:outline-none"
                            />
                            <button
                              type="button"
                              onClick={() => {
                                const clean = sanitizeScheduleSection(editingSectionDraft);
                                setEditingSectionBlockId(null);
                                void Promise.resolve(
                                  onUpdateBlock(block.id, { section: clean ?? '' })
                                ).catch(() => {});
                              }}
                              className="min-h-[36px] px-3 rounded-full bg-[#0B0B0B] text-white text-[11px] font-semibold"
                            >
                              Save
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingSectionBlockId(null)}
                              className="min-h-[36px] px-2.5 rounded-full bg-[#F5F5F7] text-[#71717A] text-[11px] font-semibold"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          onUpdateBlock && (
                            <button
                              type="button"
                              onClick={() => {
                                setEditingSectionBlockId(block.id);
                                setEditingSectionDraft(blockSection ?? '');
                              }}
                              className="min-h-[36px] px-3 rounded-full bg-[#F5F5F7] hover:bg-[#E5E5EA] text-[11px] font-semibold text-[#0B0B0B] inline-flex items-center gap-1 whitespace-nowrap"
                            >
                              <Layers className="w-3 h-3 text-[#71717A]" />
                              <span>{blockSection ? blockSection : 'Add Section'}</span>
                            </button>
                          )
                        )}
                        {onUpdateBlock && (
                          <input
                            type="date"
                            value={resolvedBlockIso}
                            aria-label={`Assign calendar date for ${block.title}`}
                            onChange={(e) => {
                              const clean = sanitizeIsoDate(e.target.value);
                              if (!clean) return;
                              void Promise.resolve(
                                onUpdateBlock(block.id, {
                                  date: clean,
                                  day: getScheduleBlockDayFromIso(clean, evt ?? null, block.day),
                                })
                              ).catch(() => {});
                            }}
                            className="h-9 px-2.5 rounded-full bg-[#F5F5F7] border border-[#E5E5EA] text-[11px] font-mono text-[#0B0B0B] focus:bg-white focus:border-[#0B0B0B] focus:outline-none"
                          />
                        )}
                        {onUpdateBlock && evtDateSlots.length > 1 && (
                          <select
                            value={resolvedBlockIso}
                            aria-label={`Select event day for ${block.title}`}
                            onChange={(e) => {
                              const clean = sanitizeIsoDate(e.target.value);
                              if (!clean) return;
                              void Promise.resolve(
                                onUpdateBlock(block.id, {
                                  date: clean,
                                  day: getScheduleBlockDayFromIso(clean, evt ?? null, block.day),
                                })
                              ).catch(() => {});
                            }}
                            className="h-9 px-2.5 rounded-full bg-[#F5F5F7] border border-[#E5E5EA] text-[11px] font-semibold text-[#0B0B0B] focus:bg-white focus:border-[#0B0B0B] focus:outline-none"
                          >
                            {!evtDateSlots.some((s) => s.isoDate === resolvedBlockIso) && resolvedBlockIso && (
                              <option value={resolvedBlockIso}>{formatIsoDateShort(resolvedBlockIso, true)}</option>
                            )}
                            {evtDateSlots.map((slot) => (
                              <option key={slot.isoDate} value={slot.isoDate}>
                                {slot.fullLabel}
                              </option>
                            ))}
                          </select>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            void Promise.resolve(onToggleBlock(block.id)).catch(() => {});
                          }}
                          className={`min-h-[36px] px-4 py-1.5 rounded-full text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                            block.completed
                              ? 'bg-[#F5F5F7] text-[#71717A] hover:text-[#0B0B0B]'
                              : 'bg-[#0B0B0B] text-white hover:bg-zinc-800'
                          }`}
                        >
                          {block.completed ? 'Verified' : 'Mark Ready'}
                        </button>
                        {onDeleteBlock && (
                          <button
                            type="button"
                            onClick={() => {
                              void Promise.resolve(onDeleteBlock(block.id)).catch(() => {});
                            }}
                            aria-label="Delete cue"
                            className="w-9 h-9 rounded-full bg-[#F5F5F7] flex items-center justify-center text-[#71717A] hover:text-[#EF4444] hover:bg-[#EF4444]/10 transition-colors"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
