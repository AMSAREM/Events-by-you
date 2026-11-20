import React, { useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import {
  Attendee,
  EventItem,
  OrganizerProfile,
  SystemAlert,
  TimeRange,
} from '../types/events';
import { computeVelocitySeries } from '../data/initialData';
import { CircularGauge, SplineChart } from './MonochromeArtwork';
import { TopUtilityBar } from './TopUtilityBar';

interface AnalyticsScreenProps {
  events: EventItem[];
  attendees: Attendee[];
  alerts: SystemAlert[];
  profile: OrganizerProfile;
  onManageEvent: (event: EventItem) => void;
  onNavigateSettings: () => void;
  onResolveAlert: (id: string) => void;
}

export const AnalyticsScreen: React.FC<AnalyticsScreenProps> = ({
  events,
  attendees,
  alerts,
  profile,
  onManageEvent,
  onNavigateSettings,
  onResolveAlert,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [timeRange, setTimeRange] = useState<TimeRange>('30D');

  const totalRevenue = useMemo(
    () => events.reduce((acc, e) => acc + e.revenue, 0),
    [events]
  );
  const totalRegistered = useMemo(
    () => events.reduce((acc, e) => acc + e.registered, 0),
    [events]
  );
  const totalCapacity = useMemo(
    () => events.reduce((acc, e) => acc + e.capacity, 0),
    [events]
  );
  const occupancy = totalCapacity > 0 ? Math.round((totalRegistered / totalCapacity) * 100) : 0;

  const filteredEvents = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return events.filter(
      (e) =>
        !q ||
        e.title.toLowerCase().includes(q) ||
        e.city.toLowerCase().includes(q) ||
        e.category.toLowerCase().includes(q)
    );
  }, [events, searchQuery]);

  const handleExportCsv = () => {
    const headers = ['Title', 'Status', 'Date', 'Venue', 'City', 'Registered', 'Capacity', 'Revenue'];
    const rows = events.map((e) => [
      `"${e.title.replace(/"/g, '""')}"`,
      e.status,
      e.isoDate,
      `"${e.venue.replace(/"/g, '""')}"`,
      e.city,
      e.registered,
      e.capacity,
      e.revenue,
    ]);
    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'eventsapp-analytics-report.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-[28px] sm:text-[32px] font-bold tracking-[-0.02em] text-[#0B0B0B]">
            Analytics & Revenue
          </h1>
          <p className="text-sm text-[#71717A] mt-0.5">
            Real-time registration velocity, venue saturation, and pass revenue.
          </p>
        </div>

        <div className="flex items-center gap-3 lg:w-[480px]">
          <TopUtilityBar
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            searchPlaceholder="Filter metrics by event..."
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

      {/* 4-Column KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-5 rounded-3xl bg-[#F5F5F7]">
          <p className="text-xs text-[#71717A]">Gross Ticket Revenue</p>
          <p className="font-display text-[28px] sm:text-[32px] font-bold tracking-tight text-[#0B0B0B] tabular-nums mt-2">
            ${totalRevenue.toLocaleString()}
          </p>
          <p className="text-[11px] text-[#71717A] mt-1 tabular-nums">
            Across {events.length} productions
          </p>
        </div>

        <div className="p-5 rounded-3xl bg-[#F5F5F7] flex items-center justify-between gap-3">
          <div>
            <p className="text-xs text-[#71717A]">Fleet Occupancy</p>
            <p className="font-display text-[28px] sm:text-[32px] font-bold tracking-tight text-[#0B0B0B] tabular-nums mt-2">
              {occupancy}%
            </p>
            <p className="text-[11px] text-[#71717A] mt-1 tabular-nums">
              {totalRegistered} / {totalCapacity} seats
            </p>
          </div>
          <CircularGauge value={occupancy} size={52} alertThreshold={profile.capacityAlertThreshold} />
        </div>

        <div className="p-5 rounded-3xl bg-[#F5F5F7]">
          <p className="text-xs text-[#71717A]">Avg. Pass Yield</p>
          <p className="font-display text-[28px] sm:text-[32px] font-bold tracking-tight text-[#0B0B0B] tabular-nums mt-2">
            ${totalRegistered > 0 ? Math.round(totalRevenue / totalRegistered) : 0}
          </p>
          <p className="text-[11px] text-[#71717A] mt-1">Weighted across all tiers</p>
        </div>

        <div className="p-5 rounded-3xl bg-[#F5F5F7] flex flex-col justify-between">
          <div>
            <p className="text-xs text-[#71717A]">Guest Ledger</p>
            <p className="font-display text-[28px] sm:text-[32px] font-bold tracking-tight text-[#0B0B0B] tabular-nums mt-2">
              {attendees.length}
            </p>
          </div>
          <button
            type="button"
            onClick={handleExportCsv}
            className="mt-2 px-4 py-2 rounded-full bg-[#0B0B0B] text-white text-xs font-semibold hover:bg-zinc-800 transition-colors inline-flex items-center justify-center gap-1.5 whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5" />
            Export CSV
          </button>
        </div>
      </div>

      {/* Main Analytics Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Dual-Stroke Spline Chart */}
        <div className="lg:col-span-3 p-6 rounded-3xl bg-[#F5F5F7]">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
            <div>
              <h2 className="text-base font-bold text-[#0B0B0B]">
                Registrations vs. Gate Check-Ins
              </h2>
              <p className="text-xs text-[#71717A] mt-0.5">
                Solid black: registrations · Dashed grey: verified gate arrivals
              </p>
            </div>
            <div className="flex items-center gap-1 p-1 bg-white rounded-full border border-[#E5E5EA]">
              {(['7D', '30D', '90D'] as TimeRange[]).map((range) => (
                <button
                  key={range}
                  type="button"
                  onClick={() => setTimeRange(range)}
                  className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors ${
                    timeRange === range
                      ? 'bg-[#0B0B0B] text-white'
                      : 'text-[#71717A] hover:text-[#0B0B0B]'
                  }`}
                >
                  {range}
                </button>
              ))}
            </div>
          </div>

          <SplineChart data={computeVelocitySeries(filteredEvents, attendees, timeRange)} height={210} showSecondary />
        </div>

        {/* Venue Capacity Utilization Breakdown */}
        <div className="lg:col-span-2 p-6 rounded-3xl bg-[#F5F5F7]">
          <h2 className="text-base font-bold text-[#0B0B0B] mb-1">Venue Utilization</h2>
          <p className="text-xs text-[#71717A] mb-5">
            Threshold alert triggers at {profile.capacityAlertThreshold}% capacity
          </p>

          <div className="space-y-4">
            {filteredEvents.map((evt) => {
              const pct = Math.round((evt.registered / Math.max(1, evt.capacity)) * 100);
              const isAlert = pct >= profile.capacityAlertThreshold;
              return (
                <div key={evt.id}>
                  <div className="flex items-center justify-between text-xs mb-1.5">
                    <button
                      type="button"
                      onClick={() => onManageEvent(evt)}
                      className="font-semibold text-[#0B0B0B] hover:underline truncate pr-2 text-left"
                    >
                      {evt.title}
                    </button>
                    <span
                      className={`tabular-nums font-semibold shrink-0 ${
                        isAlert ? 'text-[#EF4444]' : 'text-[#0B0B0B]'
                      }`}
                    >
                      {pct}%
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-[#E5E5EA] overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-300 ${
                        isAlert ? 'bg-[#EF4444]' : 'bg-[#0B0B0B]'
                      }`}
                      style={{ width: `${Math.min(100, pct)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
