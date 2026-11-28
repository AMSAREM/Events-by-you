import React, { useEffect, useMemo, useState } from 'react';
import { CalendarPlus, CheckCircle2, ClipboardCheck } from 'lucide-react';
import { formatEventDateSpan } from '../lib/eventDates';
import { computeEventReadiness } from '../lib/planningTemplates';
import type {
  EventItem,
  EventPlanningConfig,
  OrganizerProfile,
  SystemAlert,
} from '../types/events';
import { EventPlanningPanel } from './EventPlanningPanel';
import { TopUtilityBar } from './TopUtilityBar';

interface EventPlanningHubScreenProps {
  events: EventItem[];
  alerts: SystemAlert[];
  profile: OrganizerProfile;
  initialEventId?: string;
  onUpdateEvent: (updated: EventItem) => Promise<void> | void;
  onSavePlanning?: (eventId: string, planningConfig: EventPlanningConfig) => Promise<void> | void;
  onOpenCreateModal: () => void;
  onManageEvent: (event: EventItem) => void;
  onNavigateSettings: () => void;
  onResolveAlert: (id: string) => void;
}

export const EventPlanningHubScreen: React.FC<EventPlanningHubScreenProps> = ({
  events,
  alerts,
  profile,
  initialEventId,
  onUpdateEvent,
  onSavePlanning,
  onOpenCreateModal,
  onManageEvent,
  onNavigateSettings,
  onResolveAlert,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedEventId, setSelectedEventId] = useState<string>(
    initialEventId && events.some((e) => e.id === initialEventId)
      ? initialEventId
      : events[0]?.id ?? ''
  );

  useEffect(() => {
    if (initialEventId && events.some((e) => e.id === initialEventId)) {
      setSelectedEventId(initialEventId);
    }
  }, [initialEventId, events]);

  const orderedEvents = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const statusWeight: Record<EventItem['status'], number> = {
      live: 0,
      upcoming: 1,
      draft: 2,
      past: 3,
    };
    return [...events]
      .filter(
        (evt) =>
          !q ||
          evt.title.toLowerCase().includes(q) ||
          evt.category.toLowerCase().includes(q) ||
          evt.venue.toLowerCase().includes(q)
      )
      .sort((a, b) => (statusWeight[a.status] ?? 9) - (statusWeight[b.status] ?? 9));
  }, [events, searchQuery]);

  useEffect(() => {
    if (events.length > 0 && !events.some((e) => e.id === selectedEventId)) {
      setSelectedEventId(orderedEvents[0]?.id ?? events[0].id);
    }
  }, [events, orderedEvents, selectedEventId]);

  const activeEvent =
    events.find((e) => e.id === selectedEventId) ?? orderedEvents[0] ?? events[0] ?? null;

  const canEdit = profile.appRole !== 'gate_staff';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-[28px] sm:text-[32px] font-bold tracking-[-0.02em] text-[#0B0B0B]">
            Event Preparation &amp; Planning
          </h1>
          <p className="text-sm text-[#71717A] mt-0.5 tabular-nums">
            Pre-event checklists, budgets, vendor contacts, and usher briefings across {events.length}{' '}
            {events.length === 1 ? 'event' : 'events'}
          </p>
        </div>

        <div className="lg:w-[440px]">
          <TopUtilityBar
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            searchPlaceholder="Filter events to plan..."
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

      {/* Empty Events State */}
      {events.length === 0 ? (
        <div className="p-10 rounded-3xl bg-[#F5F5F7] border border-[#E5E5EA] text-center space-y-4">
          <div className="w-12 h-12 rounded-2xl bg-white border border-[#E5E5EA] flex items-center justify-center mx-auto">
            <ClipboardCheck className="w-6 h-6 text-[#0B0B0B]" />
          </div>
          <div className="space-y-1 max-w-md mx-auto">
            <h2 className="font-display text-lg font-bold text-[#0B0B0B]">
              Create your first event to start planning
            </h2>
            <p className="text-xs sm:text-sm text-[#71717A]">
              Every new event automatically gets a category-matched checklist, budget baseline, vendor slots, and usher roles.
            </p>
          </div>
          {canEdit && (
            <button
              type="button"
              onClick={onOpenCreateModal}
              className="min-h-[42px] px-5 py-2.5 rounded-full bg-[#0B0B0B] hover:bg-zinc-800 text-white text-xs font-semibold inline-flex items-center gap-2"
            >
              <CalendarPlus className="w-4 h-4" />
              <span>Create Event</span>
            </button>
          )}
        </div>
      ) : (
        <>
          {/* Cross-Event Readiness Switcher Strip */}
          <div className="flex items-stretch gap-3 overflow-x-auto pb-1">
            {orderedEvents.map((evt) => {
              const summary = computeEventReadiness(evt);
              const isSelected = activeEvent?.id === evt.id;
              return (
                <button
                  key={evt.id}
                  type="button"
                  onClick={() => setSelectedEventId(evt.id)}
                  className={`min-w-[230px] max-w-[280px] p-3.5 rounded-2xl border text-left shrink-0 transition-all ${
                    isSelected
                      ? 'bg-[#0B0B0B] text-white border-[#0B0B0B] shadow-sm'
                      : 'bg-white text-[#0B0B0B] border-[#E5E5EA] hover:border-[#0B0B0B]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={`text-[11px] font-medium truncate ${
                        isSelected ? 'text-zinc-300' : 'text-[#71717A]'
                      }`}
                    >
                      {evt.category} · {formatEventDateSpan(evt.isoDate, evt.endIsoDate, evt.date)}
                    </span>
                    <span
                      className={`font-mono tabular-nums text-xs font-bold shrink-0 inline-flex items-center gap-1 ${
                        summary.scorePct >= 90
                          ? isSelected
                            ? 'text-[#7BF66E]'
                            : 'text-[#16A34A]'
                          : isSelected
                            ? 'text-white'
                            : 'text-[#0B0B0B]'
                      }`}
                    >
                      {summary.scorePct >= 90 && <CheckCircle2 className="w-3 h-3" />}
                      {summary.scorePct}%
                    </span>
                  </div>
                  <p className="text-sm font-bold truncate mt-1">{evt.title}</p>
                  <p
                    className={`text-[11px] font-mono tabular-nums mt-1 ${
                      isSelected ? 'text-zinc-300' : 'text-[#71717A]'
                    }`}
                  >
                    {summary.completedTasks}/{summary.totalTasks} tasks · {summary.confirmedVendors}/
                    {summary.totalVendors} vendors
                  </p>
                </button>
              );
            })}

            {canEdit && (
              <button
                type="button"
                onClick={onOpenCreateModal}
                className="min-w-[160px] p-3.5 rounded-2xl border border-dashed border-[#D4D4D8] hover:border-[#0B0B0B] bg-[#F5F5F7] text-[#0B0B0B] flex flex-col items-center justify-center gap-1.5 shrink-0 transition-colors"
              >
                <CalendarPlus className="w-4 h-4" />
                <span className="text-xs font-semibold">New Event</span>
              </button>
            )}
          </div>

          {/* Active Event Planning Panel */}
          {activeEvent && (
            <EventPlanningPanel
              event={activeEvent}
              organizerName={profile.name || profile.studio || 'Organiser'}
              onUpdateEvent={onUpdateEvent}
              onSavePlanning={onSavePlanning}
              canEdit={canEdit}
              onOpenEventWorkspace={() => onManageEvent(activeEvent)}
            />
          )}
        </>
      )}
    </div>
  );
};
