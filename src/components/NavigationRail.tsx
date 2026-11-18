import React from 'react';
import {
  BarChart3,
  CalendarDays,
  Camera,
  CreditCard,
  Home,
  Layers,
  LogOut,
  QrCode,
  Settings,
  Terminal,
  Users,
} from 'lucide-react';
import { AppRole, NavScreen } from '../types/events';

interface NavigationRailProps {
  activeScreen: NavScreen;
  userRole?: AppRole;
  onNavigate: (screen: NavScreen) => void;
  onBackToPublicHome: () => void;
  onSignOut: () => void;
  unresolvedAlertCount: number;
}

const NAV_ITEMS: { id: NavScreen; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'overview', label: 'Overview', icon: Home },
  { id: 'checkin', label: 'Check-In & QR Scanner', icon: QrCode },
  { id: 'camera', label: 'Disposable Camera', icon: Camera },
  { id: 'events', label: 'Events', icon: Layers },
  { id: 'schedule', label: 'Schedule', icon: CalendarDays },
  { id: 'attendees', label: 'Attendees', icon: Users },
  { id: 'analytics', label: 'Analytics', icon: BarChart3 },
  { id: 'console', label: 'Apps Creator Console', icon: Terminal },
  { id: 'billing', label: 'Plan & Credits', icon: CreditCard },
];

export const NavigationRail: React.FC<NavigationRailProps> = ({
  activeScreen,
  userRole = 'organizer',
  onNavigate,
  onBackToPublicHome,
  onSignOut,
  unresolvedAlertCount,
}) => {
  const visibleItems = NAV_ITEMS.filter((item) => {
    if (item.id === 'console' && userRole !== 'creator') return false;
    if (item.id === 'billing' && userRole === 'gate_staff') return false;
    return true;
  });
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
          {visibleItems.map((item) => {
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

        {/* Bottom Settings & Log Out Controls */}
        <div className="flex flex-col items-center gap-1.5 lg:gap-2 shrink-0">
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
          <button
            type="button"
            onClick={onSignOut}
            aria-label="Log Out"
            title="Log Out"
            className="w-10 h-10 lg:w-11 lg:h-11 rounded-full flex items-center justify-center text-zinc-400 hover:text-white hover:bg-white/10 transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            <LogOut className="w-5 h-5" />
          </button>
        </div>
      </aside>

      {/* Mobile Floating Bottom Tab Bar (< 768px) */}
      <nav
        aria-label="Mobile Navigation"
        className="md:hidden fixed bottom-[max(0.75rem,env(safe-area-inset-bottom))] left-2 right-2 sm:left-4 sm:right-4 z-40 h-14 bg-[#0B0B0B] text-white rounded-full px-2 sm:px-3 flex items-center justify-between gap-1 overflow-x-auto capsule-shadow"
      >
        {visibleItems.map((item) => {
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
              className={`relative w-8 h-8 sm:w-9 sm:h-9 rounded-full flex items-center justify-center shrink-0 transition-colors duration-150 ${
                isActive ? 'bg-white text-[#0B0B0B]' : 'text-zinc-400 hover:text-white'
              }`}
            >
              <Icon className="w-4 h-4" />
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => onNavigate('settings')}
          aria-label="Settings"
          aria-current={activeScreen === 'settings' ? 'page' : undefined}
          title="Settings"
          className={`w-8 h-8 sm:w-9 sm:h-9 rounded-full flex items-center justify-center shrink-0 transition-colors duration-150 ${
            activeScreen === 'settings' ? 'bg-white text-[#0B0B0B]' : 'text-zinc-400 hover:text-white'
          }`}
        >
          <Settings className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={onSignOut}
          aria-label="Log Out"
          title="Log Out"
          className="w-8 h-8 sm:w-9 sm:h-9 rounded-full flex items-center justify-center shrink-0 text-zinc-400 hover:text-white transition-colors duration-150"
        >
          <LogOut className="w-4 h-4" />
        </button>
      </nav>
    </>
  );
};
