import React from 'react';
import {
  BarChart3,
  CalendarDays,
  CreditCard,
  Globe,
  Home,
  Layers,
  QrCode,
  Settings,
  Users,
} from 'lucide-react';
import { NavScreen } from '../types/events';

interface NavigationRailProps {
  activeScreen: NavScreen;
  onNavigate: (screen: NavScreen) => void;
  onBackToPublicHome: () => void;
  unresolvedAlertCount: number;
}

const NAV_ITEMS: { id: NavScreen; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'overview', label: 'Overview', icon: Home },
  { id: 'checkin', label: 'Check-In & QR Scanner', icon: QrCode },
  { id: 'events', label: 'Events', icon: Layers },
  { id: 'schedule', label: 'Schedule', icon: CalendarDays },
  { id: 'attendees', label: 'Attendees', icon: Users },
  { id: 'analytics', label: 'Analytics', icon: BarChart3 },
  { id: 'billing', label: 'Plan & Credits', icon: CreditCard },
];

export const NavigationRail: React.FC<NavigationRailProps> = ({
  activeScreen,
  onNavigate,
  onBackToPublicHome,
  unresolvedAlertCount,
}) => {
  return (
    <>
      {/* Desktop & Tablet Left Floating Dark Pill Capsule */}
      <aside
        aria-label="Primary Navigation"
        className="hidden md:flex flex-col items-center justify-between w-[72px] lg:w-[76px] shrink-0 bg-[#0B0B0B] text-white rounded-[28px] lg:rounded-[32px] py-4 lg:py-6 px-2.5 lg:px-3 capsule-shadow sticky top-4 lg:top-6 h-[calc(100vh-2rem)] lg:h-[calc(100vh-3rem)] max-h-[840px] overflow-y-auto"
      >
        {/* Minimal Brand Monogram -> returns to Home Page */}
        <button
          type="button"
          onClick={onBackToPublicHome}
          aria-label="Events App Home Page"
          title="Back to Public Home Page"
          className="w-10 h-10 lg:w-11 lg:h-11 rounded-2xl bg-white text-[#0B0B0B] flex items-center justify-center font-display font-bold text-base lg:text-lg tracking-tighter shrink-0 hover:scale-105 transition-transform duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#0B0B0B]"
        >
          E.
        </button>

        {/* Main Screen Icons */}
        <nav className="flex flex-col items-center gap-1.5 lg:gap-2.5 my-2">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = activeScreen === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onNavigate(item.id)}
                aria-label={item.label}
                aria-current={isActive ? 'page' : undefined}
                title={item.label}
                className={`group relative w-10 h-10 lg:w-11 lg:h-11 rounded-full flex items-center justify-center shrink-0 transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white ${
                  isActive
                    ? 'bg-white text-[#0B0B0B]'
                    : 'text-zinc-400 hover:text-white hover:bg-white/10'
                }`}
              >
                <Icon className="w-5 h-5" />
                {item.id === 'attendees' && unresolvedAlertCount > 0 && !isActive && (
                  <span
                    className="absolute top-2 right-2 w-2 h-2 rounded-full bg-[#EF4444]"
                    aria-hidden="true"
                  />
                )}
              </button>
            );
          })}
        </nav>

        {/* Bottom Public Site + Settings Controls */}
        <div className="flex flex-col items-center gap-1.5 lg:gap-2 shrink-0">
          <button
            type="button"
            onClick={onBackToPublicHome}
            aria-label="Public Home Page"
            title="Public Home Page"
            className="w-10 h-10 lg:w-11 lg:h-11 rounded-full flex items-center justify-center text-zinc-400 hover:text-white hover:bg-white/10 transition-all duration-150"
          >
            <Globe className="w-5 h-5" />
          </button>
          <button
            type="button"
            onClick={() => onNavigate('settings')}
            aria-label="Settings"
            aria-current={activeScreen === 'settings' ? 'page' : undefined}
            title="Settings"
            className={`w-10 h-10 lg:w-11 lg:h-11 rounded-full flex items-center justify-center transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white ${
              activeScreen === 'settings'
                ? 'bg-white text-[#0B0B0B]'
                : 'text-zinc-400 hover:text-white hover:bg-white/10'
            }`}
          >
            <Settings className="w-5 h-5" />
          </button>
        </div>
      </aside>

      {/* Mobile Floating Bottom Tab Bar (< 768px) */}
      <nav
        aria-label="Mobile Navigation"
        className="md:hidden fixed bottom-[max(0.75rem,env(safe-area-inset-bottom))] left-2 right-2 sm:left-4 sm:right-4 z-40 h-14 bg-[#0B0B0B] text-white rounded-full px-1.5 sm:px-3 flex items-center justify-around capsule-shadow"
      >
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = activeScreen === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onNavigate(item.id)}
              aria-label={item.label}
              aria-current={isActive ? 'page' : undefined}
              title={item.label}
              className={`relative w-9 h-9 sm:w-10 sm:h-10 rounded-full flex items-center justify-center shrink-0 transition-colors duration-150 ${
                isActive ? 'bg-white text-[#0B0B0B]' : 'text-zinc-400 hover:text-white'
              }`}
            >
              <Icon className="w-4 h-4 sm:w-4.5 sm:h-4.5" />
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => onNavigate('settings')}
          aria-label="Settings"
          aria-current={activeScreen === 'settings' ? 'page' : undefined}
          title="Settings"
          className={`w-9 h-9 sm:w-10 sm:h-10 rounded-full flex items-center justify-center shrink-0 transition-colors duration-150 ${
            activeScreen === 'settings' ? 'bg-white text-[#0B0B0B]' : 'text-zinc-400 hover:text-white'
          }`}
        >
          <Settings className="w-4 h-4 sm:w-4.5 sm:h-4.5" />
        </button>
      </nav>
    </>
  );
};
