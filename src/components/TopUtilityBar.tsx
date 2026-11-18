import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, Bell, Check, Search, X } from 'lucide-react';
import { OrganizerProfile, SystemAlert } from '../types/events';

interface TopUtilityBarProps {
  searchQuery: string;
  onSearchChange: (q: string) => void;
  searchPlaceholder?: string;
  alerts: SystemAlert[];
  onResolveAlert: (id: string) => void;
  onInspectAlertEvent?: (eventId: string) => void;
  profile: OrganizerProfile;
  onOpenSettings: () => void;
}

export const TopUtilityBar: React.FC<TopUtilityBarProps> = ({
  searchQuery,
  onSearchChange,
  searchPlaceholder = 'Search events, venues...',
  alerts,
  onResolveAlert,
  onInspectAlertEvent,
  profile,
  onOpenSettings,
}) => {
  const [alertsOpen, setAlertsOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const unresolvedAlerts = alerts.filter((a) => !a.resolved);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setAlertsOpen(false);
      }
    };
    if (alertsOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [alertsOpen]);

  const initials = profile.name
    .split(' ')
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="flex items-center gap-3 w-full">
      {/* Capsule Search Field */}
      <div className="relative flex-1 min-w-0">
        <Search className="w-4 h-4 text-[#71717A] absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={searchPlaceholder}
          aria-label={searchPlaceholder}
          className="w-full h-11 pl-10 pr-9 rounded-full bg-[#F5F5F7] text-sm text-[#0B0B0B] placeholder:text-[#71717A] border border-transparent focus:bg-white focus:border-[#0B0B0B] focus:outline-none transition-colors duration-150"
        />
        {searchQuery && (
          <button
            type="button"
            onClick={() => onSearchChange('')}
            aria-label="Clear search"
            className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full flex items-center justify-center text-[#71717A] hover:text-[#0B0B0B]"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Notification Bell with Singular Alert Red Dot */}
      <div className="relative shrink-0" ref={popoverRef}>
        <button
          type="button"
          onClick={() => setAlertsOpen((prev) => !prev)}
          aria-label={`Notifications (${unresolvedAlerts.length} unresolved)`}
          aria-expanded={alertsOpen}
          className="relative w-11 h-11 rounded-full bg-[#F5F5F7] hover:bg-[#E5E5EA]/70 flex items-center justify-center text-[#0B0B0B] transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0B0B0B]"
        >
          <Bell className="w-4.5 h-4.5" />
          {unresolvedAlerts.length > 0 && (
            <span
              className="absolute top-2.5 right-2.5 w-2 h-2 rounded-full bg-[#EF4444] ring-2 ring-white"
              aria-hidden="true"
            />
          )}
        </button>

        {alertsOpen && (
          <div className="absolute right-0 mt-2 w-80 sm:w-96 bg-white rounded-3xl border border-[#E5E5EA] p-4 z-50 soft-popover-shadow">
            <div className="flex items-center justify-between pb-3 border-b border-[#E5E5EA]">
              <div>
                <h3 className="text-sm font-semibold text-[#0B0B0B]">Operational Alerts</h3>
                <p className="text-xs text-[#71717A] tabular-nums">
                  {unresolvedAlerts.length} active {unresolvedAlerts.length === 1 ? 'warning' : 'warnings'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setAlertsOpen(false)}
                aria-label="Close alerts"
                className="w-7 h-7 rounded-full flex items-center justify-center text-[#71717A] hover:bg-[#F5F5F7] hover:text-[#0B0B0B]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="mt-3 space-y-2 max-h-72 overflow-y-auto">
              {unresolvedAlerts.length === 0 ? (
                <div className="py-6 text-center">
                  <p className="text-sm font-medium text-[#0B0B0B]">All systems nominal</p>
                  <p className="text-xs text-[#71717A] mt-1">No capacity ceilings or dispatch errors.</p>
                </div>
              ) : (
                unresolvedAlerts.map((alert) => (
                  <div
                    key={alert.id}
                    className="p-3 rounded-2xl bg-[#F5F5F7] flex flex-col gap-2"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-start gap-2">
                        <AlertCircle className="w-4 h-4 text-[#EF4444] shrink-0 mt-0.5" />
                        <div>
                          <p className="text-xs font-semibold text-[#0B0B0B]">{alert.title}</p>
                          <p className="text-xs text-[#71717A] mt-0.5 leading-relaxed">{alert.detail}</p>
                        </div>
                      </div>
                      <span className="text-[11px] text-[#71717A] shrink-0 tabular-nums">
                        {alert.timestamp}
                      </span>
                    </div>
                    <div className="flex items-center justify-end gap-2">
                      {alert.eventId && onInspectAlertEvent && (
                        <button
                          type="button"
                          onClick={() => {
                            onInspectAlertEvent(alert.eventId!);
                            setAlertsOpen(false);
                          }}
                          className="px-3 py-1 rounded-full text-[11px] font-semibold bg-white border border-[#E5E5EA] text-[#0B0B0B] hover:border-[#0B0B0B] transition-colors whitespace-nowrap shrink-0"
                        >
                          Inspect Event
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => onResolveAlert(alert.id)}
                        className="px-3 py-1 rounded-full text-[11px] font-semibold bg-[#0B0B0B] text-white hover:bg-zinc-800 transition-colors inline-flex items-center gap-1 whitespace-nowrap shrink-0"
                      >
                        <Check className="w-3 h-3" />
                        Resolve
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      {/* Organizer Profile Avatar */}
      <button
        type="button"
        onClick={onOpenSettings}
        aria-label={`Profile settings for ${profile.name}`}
        title={`${profile.name} · ${profile.role}`}
        className="w-11 h-11 rounded-full bg-[#0B0B0B] text-white font-display font-semibold text-xs tracking-tight flex items-center justify-center shrink-0 hover:scale-105 transition-transform duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0B0B0B] focus-visible:ring-offset-2"
      >
        {initials}
      </button>
    </div>
  );
};
