import React, { useEffect, useMemo, useState } from 'react';
import { Check, Clock, Plus, Trash2 } from 'lucide-react';
import { EventItem, OrganizerProfile, ScheduleBlock, SystemAlert } from '../types/events';
import { TopUtilityBar } from './TopUtilityBar';

interface ScheduleScreenProps {
  events: EventItem[];
  blocks: ScheduleBlock[];
  alerts: SystemAlert[];
  profile: OrganizerProfile;
  onToggleBlock: (id: string) => void;
  onAddBlock: (block: ScheduleBlock) => void;
  onDeleteBlock?: (id: string) => void;
  onManageEvent: (event: EventItem) => void;
  onNavigateSettings: () => void;
  onResolveAlert: (id: string) => void;
}

const DAYS: ('All' | ScheduleBlock['day'])[] = ['All', 'Tue', 'Wed', 'Thu', 'Sat'];

export const ScheduleScreen: React.FC<ScheduleScreenProps> = ({
  events,
  blocks,
  alerts,
  profile,
  onToggleBlock,
  onAddBlock,
  onDeleteBlock,
  onManageEvent,
  onNavigateSettings,
  onResolveAlert,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDay, setSelectedDay] = useState<'All' | ScheduleBlock['day']>('All');
  const [selectedEventId, setSelectedEventId] = useState<string>('all');
  const [showAddForm, setShowAddForm] = useState(false);

  const [newTitle, setNewTitle] = useState('');
  const [newTime, setNewTime] = useState('14:00');
  const [newDuration, setNewDuration] = useState('45m');
  const [newStage, setNewStage] = useState('Main Stage');
  const [newLead, setNewLead] = useState(profile.name);
  const [newDay, setNewDay] = useState<ScheduleBlock['day']>('Wed');
  const [newEventId, setNewEventId] = useState(events[0]?.id ?? '');

  useEffect(() => {
    if (events.length > 0 && (!newEventId || !events.some((e) => e.id === newEventId))) {
      setNewEventId(events[0].id);
    }
  }, [events, newEventId]);

  const eventMap = useMemo(() => {
    const map = new Map<string, EventItem>();
    events.forEach((e) => map.set(e.id, e));
    return map;
  }, [events]);

  const filteredBlocks = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return blocks
      .filter((b) => {
        const matchesDay = selectedDay === 'All' || b.day === selectedDay;
        const matchesEvent = selectedEventId === 'all' || b.eventId === selectedEventId;
        const evtTitle = eventMap.get(b.eventId)?.title.toLowerCase() ?? '';
        const matchesQuery =
          !q ||
          b.title.toLowerCase().includes(q) ||
          b.stage.toLowerCase().includes(q) ||
          b.lead.toLowerCase().includes(q) ||
          evtTitle.includes(q);
        return matchesDay && matchesEvent && matchesQuery;
      })
      .sort((a, b) => a.time.localeCompare(b.time));
  }, [blocks, selectedDay, selectedEventId, searchQuery, eventMap]);

  const completedCount = filteredBlocks.filter((b) => b.completed).length;

  const handleCreateCue = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim() || !newEventId) return;
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
          day: newDay,
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
            searchPlaceholder="Search cues, stages, leads..."
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1 p-1 bg-[#F5F5F7] rounded-full">
            {DAYS.map((day) => (
              <button
                key={day}
                type="button"
                onClick={() => setSelectedDay(day)}
                className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                  selectedDay === day
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
            onChange={(e) => setSelectedEventId(e.target.value)}
            aria-label="Filter by event"
            className="h-10 px-4 rounded-full bg-[#F5F5F7] text-xs font-semibold text-[#0B0B0B] border border-transparent focus:border-[#0B0B0B] focus:bg-white focus:outline-none"
          >
            <option value="all">All Productions</option>
            {events.map((evt) => (
              <option key={evt.id} value={evt.id}>
                {evt.title}
              </option>
            ))}
          </select>
        </div>

        <button
          type="button"
          onClick={() => setShowAddForm((prev) => !prev)}
          className="px-5 py-2.5 rounded-full bg-[#0B0B0B] text-white text-xs font-semibold hover:bg-zinc-800 transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
        >
          <Plus className="w-4 h-4" />
          Add Cue
        </button>
      </div>

      {/* Inline Add Cue Form */}
      {showAddForm && (
        <form
          onSubmit={handleCreateCue}
          className="p-6 rounded-3xl bg-[#F5F5F7] grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 items-end"
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
          <div>
            <label className="block text-xs font-semibold text-[#0B0B0B] mb-1">Production</label>
            <select
              value={newEventId}
              onChange={(e) => setNewEventId(e.target.value)}
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
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs font-semibold text-[#0B0B0B] mb-1">Day</label>
              <select
                value={newDay}
                onChange={(e) => setNewDay(e.target.value as ScheduleBlock['day'])}
                className="w-full h-10 px-2.5 rounded-full bg-white border border-[#E5E5EA] text-xs text-[#0B0B0B]"
              >
                <option value="Tue">Tue</option>
                <option value="Wed">Wed</option>
                <option value="Thu">Thu</option>
                <option value="Fri">Fri</option>
                <option value="Sat">Sat</option>
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
          </div>
          <div className="flex items-center gap-2">
            <button
              type="submit"
              className="flex-1 h-10 rounded-full bg-[#0B0B0B] text-white text-xs font-semibold hover:bg-zinc-800 transition-colors"
            >
              Save Cue
            </button>
          </div>
        </form>
      )}

      {/* Timeline List */}
      <div className="space-y-3">
        {filteredBlocks.length === 0 ? (
          <div className="p-10 rounded-3xl bg-[#F5F5F7] text-center">
            <p className="text-sm font-semibold text-[#0B0B0B]">No cues scheduled</p>
            <p className="text-xs text-[#71717A] mt-1">
              Add a production cue or adjust the active day filter.
            </p>
          </div>
        ) : (
          filteredBlocks.map((block) => {
            const evt = eventMap.get(block.eventId);
            return (
              <div
                key={block.id}
                className="p-4 sm:p-5 rounded-2xl bg-[#F5F5F7] border border-transparent hover:bg-white hover:border-[#E5E5EA] transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-4"
              >
                <div className="flex items-start sm:items-center gap-4 min-w-0">
                  <button
                    type="button"
                    onClick={() => {
                      void Promise.resolve(onToggleBlock(block.id)).catch(() => {});
                    }}
                    aria-label={block.completed ? 'Mark cue pending' : 'Mark cue ready'}
                    className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 transition-colors ${
                      block.completed
                        ? 'bg-[#0B0B0B] text-white'
                        : 'bg-white border border-[#E5E5EA] text-transparent hover:border-[#0B0B0B]'
                    }`}
                  >
                    <Check className="w-3.5 h-3.5" />
                  </button>

                  <div className="w-20 shrink-0">
                    <p className="font-mono text-sm font-semibold text-[#0B0B0B] tabular-nums">
                      {block.time}
                    </p>
                    <p className="text-[11px] text-[#71717A] tabular-nums inline-flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {block.day} · {block.duration}
                    </p>
                  </div>

                  <div className="min-w-0">
                    <h2
                      className={`text-sm font-semibold truncate ${
                        block.completed ? 'text-[#71717A] line-through' : 'text-[#0B0B0B]'
                      }`}
                    >
                      {block.title}
                    </h2>
                    <p className="text-xs text-[#71717A] mt-0.5 truncate">
                      {evt ? (
                        <button
                          type="button"
                          onClick={() => onManageEvent(evt)}
                          className="font-medium text-[#0B0B0B] hover:underline"
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

                <div className="flex items-center justify-end gap-2.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      void Promise.resolve(onToggleBlock(block.id)).catch(() => {});
                    }}
                    className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                      block.completed
                        ? 'bg-white border border-[#E5E5EA] text-[#71717A] hover:text-[#0B0B0B]'
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
                      className="w-8 h-8 rounded-full bg-white border border-[#E5E5EA] flex items-center justify-center text-[#71717A] hover:text-[#EF4444] hover:border-[#EF4444] transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
