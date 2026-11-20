import React, { useEffect, useState } from 'react';
import {
  BarChart3,
  CalendarDays,
  CalendarPlus,
  Camera,
  CreditCard,
  Gift,
  Globe,
  Home,
  Layers,
  LayoutGrid,
  LogOut,
  Plus,
  QrCode,
  Settings,
  Terminal,
  Users,
  X,
} from 'lucide-react';
import { AppRole, NavScreen } from '../types/events';
import { PWAInstallButton } from './PWAInstallButton';

interface NavigationRailProps {
  activeScreen: NavScreen;
  userRole?: AppRole;
  onNavigate: (screen: NavScreen) => void;
  onCreateEvent?: () => void;
  onBackToPublicHome: () => void;
  onSignOut: () => void;
  unresolvedAlertCount: number;
}

const NAV_ITEMS: { id: NavScreen; label: string; shortLabel: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'overview', label: 'Overview', shortLabel: 'Home', icon: Home },
  { id: 'checkin', label: 'Check-In & QR Scanner', shortLabel: 'Scan', icon: QrCode },
  { id: 'camera', label: 'Disposable Camera', shortLabel: 'Camera', icon: Camera },
  { id: 'gifts', label: 'Gift Table', shortLabel: 'Gifts', icon: Gift },
  { id: 'events', label: 'Events', shortLabel: 'Events', icon: Layers },
  { id: 'schedule', label: 'Schedule', shortLabel: 'Schedule', icon: CalendarDays },
  { id: 'attendees', label: 'Attendees', shortLabel: 'Guests', icon: Users },
  { id: 'analytics', label: 'Analytics', shortLabel: 'Stats', icon: BarChart3 },
  { id: 'console', label: 'Apps Creator Console', shortLabel: 'Console', icon: Terminal },
  { id: 'billing', label: 'Plan & Credits', shortLabel: 'Billing', icon: CreditCard },
];

export const NavigationRail: React.FC<NavigationRailProps> = ({
  activeScreen,
  userRole = 'organizer',
  onNavigate,
  onCreateEvent,
  onBackToPublicHome,
  onSignOut,
  unresolvedAlertCount,
}) => {
  const [mobileSheet, setMobileSheet] = useState<'none' | 'quick' | 'menu'>('none');

  const visibleItems = NAV_ITEMS.filter((item) => {
    if (item.id === 'console' && userRole !== 'creator') return false;
    if (item.id === 'billing' && userRole === 'gate_staff') return false;
    return true;
  });

  useEffect(() => {
    if (mobileSheet === 'none') return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileSheet('none');
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [mobileSheet]);

  const handleMobileNavigate = (screen: NavScreen) => {
    setMobileSheet('none');
    onNavigate(screen);
  };

  const handleQuickCreate = () => {
    setMobileSheet('none');
    if (onCreateEvent) {
      onCreateEvent();
    } else {
      onNavigate('events');
    }
  };

  const isMenuRouteActive =
    activeScreen !== 'overview' && activeScreen !== 'events' && activeScreen !== 'checkin';

  const roleBadgeLabel =
    userRole === 'creator'
      ? 'Apps Creator'
      : userRole === 'gate_staff'
        ? 'Gate Staff'
        : 'Organiser';

  return (
    <>
      {/* Desktop & Tablet Left Floating Dark Pill Capsule */}
      <aside
        aria-label="Primary Navigation"
        className="hidden md:flex flex-col items-center justify-between w-[66px] lg:w-[74px] shrink-0 bg-[#0B0B0B] text-white rounded-[26px] lg:rounded-[32px] py-3 lg:py-5 px-2 lg:px-2.5 capsule-shadow sticky top-3 lg:top-5 h-[calc(100dvh-1.5rem)] lg:h-[calc(100dvh-2.5rem)] max-h-[860px] overflow-y-auto"
      >
        {/* Minimal Brand Monogram -> returns to Home Page */}
        <button
          type="button"
          onClick={onBackToPublicHome}
          aria-label="Events App Home Page"
          title="Back to Public Home Page"
          className="w-9 h-9 lg:w-10 lg:h-10 xl:w-11 xl:h-11 rounded-2xl bg-white text-[#0B0B0B] flex items-center justify-center font-display font-bold text-sm lg:text-base xl:text-lg tracking-tighter shrink-0 hover:scale-105 transition-transform duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#0B0B0B]"
        >
          E.
        </button>

        {/* Main Screen Icons */}
        <nav className="flex flex-col items-center gap-1 lg:gap-1.5 xl:gap-2 my-1">
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
                className={`group relative w-9 h-9 lg:w-10 lg:h-10 xl:w-11 xl:h-11 rounded-full flex items-center justify-center shrink-0 transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white ${
                  isActive
                    ? 'bg-white text-[#0B0B0B]'
                    : 'text-zinc-400 hover:text-white hover:bg-white/10'
                }`}
              >
                <Icon className="w-[18px] h-[18px] xl:w-5 xl:h-5" />
                {item.id === 'attendees' && unresolvedAlertCount > 0 && !isActive && (
                  <span
                    className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-[#EF4444]"
                    aria-hidden="true"
                  />
                )}
              </button>
            );
          })}
        </nav>

        {/* Bottom Settings, Install App & Log Out Controls */}
        <div className="flex flex-col items-center gap-1 lg:gap-1.5 shrink-0">
          <PWAInstallButton variant="rail" />
          <button
            type="button"
            onClick={() => onNavigate('settings')}
            aria-label="Settings"
            aria-current={activeScreen === 'settings' ? 'page' : undefined}
            title="Settings"
            className={`w-9 h-9 lg:w-10 lg:h-10 xl:w-11 xl:h-11 rounded-full flex items-center justify-center transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white ${
              activeScreen === 'settings'
                ? 'bg-white text-[#0B0B0B]'
                : 'text-zinc-400 hover:text-white hover:bg-white/10'
            }`}
          >
            <Settings className="w-[18px] h-[18px] xl:w-5 xl:h-5" />
          </button>
          <button
            type="button"
            onClick={onSignOut}
            aria-label="Log Out"
            title="Log Out"
            className="w-9 h-9 lg:w-10 lg:h-10 xl:w-11 xl:h-11 rounded-full flex items-center justify-center text-zinc-400 hover:text-white hover:bg-white/10 transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            <LogOut className="w-[18px] h-[18px] xl:w-5 xl:h-5" />
          </button>
        </div>
      </aside>

      {/* Mobile Bottom Sheet Backdrop (< 768px) */}
      {mobileSheet !== 'none' && (
        <div
          className="md:hidden fixed inset-0 z-40 bg-black/45 backdrop-blur-xs"
          onClick={() => setMobileSheet('none')}
          aria-hidden="true"
        />
      )}

      {/* Mobile Quick Actions Sheet (< 768px) */}
      {mobileSheet === 'quick' && (
        <div
          role="dialog"
          aria-label="Quick Actions"
          className="md:hidden fixed inset-x-2.5 sm:inset-x-4 bottom-[calc(5.25rem+env(safe-area-inset-bottom))] z-50 max-w-lg mx-auto bg-[#0B0B0B] text-white rounded-[24px] sm:rounded-[28px] p-3.5 sm:p-4 shadow-[0_24px_48px_rgba(0,0,0,0.45)] border border-white/12 max-h-[calc(100dvh-7rem-env(safe-area-inset-bottom))] overflow-y-auto"
        >
          <div className="flex items-center justify-between mb-3.5 px-1">
            <div>
              <p className="text-[11px] uppercase tracking-wider text-zinc-400 font-semibold">
                Studio Shortcuts
              </p>
              <h2 className="font-display text-base font-bold text-white tracking-tight">
                Quick Actions
              </h2>
            </div>
            <button
              type="button"
              onClick={() => setMobileSheet('none')}
              aria-label="Close Quick Actions"
              className="w-8 h-8 rounded-full bg-white/10 text-zinc-300 hover:text-white flex items-center justify-center"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="space-y-2">
            {userRole !== 'gate_staff' && (
              <button
                type="button"
                onClick={handleQuickCreate}
                className="w-full flex items-center gap-3 p-3.5 rounded-2xl bg-white text-[#0B0B0B] text-left active:scale-[0.99] transition-transform"
              >
                <div className="w-10 h-10 rounded-xl bg-[#0B0B0B] text-white flex items-center justify-center shrink-0">
                  <CalendarPlus className="w-5 h-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold leading-tight">Create New Event</p>
                  <p className="text-[11px] text-[#52525B] mt-0.5">
                    Launch event wizard, flyer &amp; SMS guest passes
                  </p>
                </div>
              </button>
            )}

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => handleMobileNavigate('checkin')}
                className="flex items-center gap-2.5 p-3 rounded-2xl bg-white/8 hover:bg-white/14 text-white text-left transition-colors"
              >
                <div className="w-8 h-8 rounded-xl bg-white/12 flex items-center justify-center shrink-0">
                  <QrCode className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-semibold truncate">QR Scanner</p>
                  <p className="text-[10px] text-zinc-400 truncate">Gate check-in</p>
                </div>
              </button>

              <button
                type="button"
                onClick={() => handleMobileNavigate('camera')}
                className="flex items-center gap-2.5 p-3 rounded-2xl bg-white/8 hover:bg-white/14 text-white text-left transition-colors"
              >
                <div className="w-8 h-8 rounded-xl bg-white/12 flex items-center justify-center shrink-0">
                  <Camera className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-semibold truncate">35mm Camera</p>
                  <p className="text-[10px] text-zinc-400 truncate">Snap event roll</p>
                </div>
              </button>

              <button
                type="button"
                onClick={() => handleMobileNavigate('gifts')}
                className="flex items-center gap-2.5 p-3 rounded-2xl bg-white/8 hover:bg-white/14 text-white text-left transition-colors"
              >
                <div className="w-8 h-8 rounded-xl bg-white/12 flex items-center justify-center shrink-0">
                  <Gift className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-semibold truncate">Gift Table</p>
                  <p className="text-[10px] text-zinc-400 truncate">Desk &amp; attendant links</p>
                </div>
              </button>

              <button
                type="button"
                onClick={() => handleMobileNavigate('attendees')}
                className="flex items-center gap-2.5 p-3 rounded-2xl bg-white/8 hover:bg-white/14 text-white text-left transition-colors"
              >
                <div className="w-8 h-8 rounded-xl bg-white/12 flex items-center justify-center shrink-0">
                  <Users className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-semibold truncate">Guest Roster</p>
                  <p className="text-[10px] text-zinc-400 truncate">Manage RSVPs</p>
                </div>
              </button>

              <button
                type="button"
                onClick={() => {
                  setMobileSheet('none');
                  onBackToPublicHome();
                }}
                className="col-span-2 flex items-center gap-2.5 p-3 rounded-2xl bg-white/8 hover:bg-white/14 text-white text-left transition-colors"
              >
                <div className="w-8 h-8 rounded-xl bg-white/12 flex items-center justify-center shrink-0">
                  <Globe className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-semibold truncate">Public Site</p>
                  <p className="text-[10px] text-zinc-400 truncate">Live showcase &amp; invitations</p>
                </div>
              </button>

              <div className="col-span-2">
                <PWAInstallButton
                  variant="menu-row"
                  onActionComplete={() => setMobileSheet('none')}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Mobile Full Workspace Menus Drawer (< 768px) */}
      {mobileSheet === 'menu' && (
        <div
          role="dialog"
          aria-label="Workspace Menus"
          className="md:hidden fixed inset-x-2.5 sm:inset-x-4 bottom-[calc(5.25rem+env(safe-area-inset-bottom))] z-50 max-w-lg mx-auto bg-[#0B0B0B] text-white rounded-[24px] sm:rounded-[28px] p-3.5 sm:p-4 shadow-[0_24px_48px_rgba(0,0,0,0.45)] border border-white/12 max-h-[calc(100dvh-7rem-env(safe-area-inset-bottom))] overflow-y-auto"
        >
          <div className="flex items-center justify-between mb-3.5 px-1">
            <div className="flex items-center gap-2">
              <h2 className="font-display text-base font-bold text-white tracking-tight">
                Menus
              </h2>
              <span className="px-2 py-0.5 rounded-full bg-white/12 text-[10px] font-semibold text-zinc-200">
                {roleBadgeLabel}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setMobileSheet('none')}
              aria-label="Close Menus"
              className="w-8 h-8 rounded-full bg-white/10 text-zinc-300 hover:text-white flex items-center justify-center"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-1 min-[340px]:grid-cols-2 gap-2">
            {visibleItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeScreen === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleMobileNavigate(item.id)}
                  aria-current={isActive ? 'page' : undefined}
                  className={`relative flex items-center gap-2.5 p-3 rounded-2xl text-left transition-colors ${
                    isActive
                      ? 'bg-white text-[#0B0B0B]'
                      : 'bg-white/8 text-zinc-200 hover:bg-white/14'
                  }`}
                >
                  <div
                    className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${
                      isActive ? 'bg-[#0B0B0B] text-white' : 'bg-white/12 text-white'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                  </div>
                  <span className="text-xs font-semibold leading-tight truncate">
                    {item.id === 'checkin'
                      ? 'Check-In QR'
                      : item.id === 'camera'
                        ? '35mm Camera'
                        : item.id === 'console'
                          ? 'Creator Console'
                          : item.label}
                  </span>
                  {item.id === 'attendees' && unresolvedAlertCount > 0 && (
                    <span
                      className={`ml-auto px-1.5 py-0.5 rounded-full text-[10px] font-bold tabular-nums ${
                        isActive ? 'bg-[#EF4444] text-white' : 'bg-[#EF4444] text-white'
                      }`}
                    >
                      {unresolvedAlertCount}
                    </span>
                  )}
                </button>
              );
            })}

            <button
              type="button"
              onClick={() => handleMobileNavigate('settings')}
              aria-current={activeScreen === 'settings' ? 'page' : undefined}
              className={`flex items-center gap-2.5 p-3 rounded-2xl text-left transition-colors ${
                activeScreen === 'settings'
                  ? 'bg-white text-[#0B0B0B]'
                  : 'bg-white/8 text-zinc-200 hover:bg-white/14'
              }`}
            >
              <div
                className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${
                  activeScreen === 'settings' ? 'bg-[#0B0B0B] text-white' : 'bg-white/12 text-white'
                }`}
              >
                <Settings className="w-4 h-4" />
              </div>
              <span className="text-xs font-semibold leading-tight truncate">Settings</span>
            </button>
          </div>

          <div className="mt-3 pt-3 border-t border-white/10 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => {
                setMobileSheet('none');
                onBackToPublicHome();
              }}
              className="flex items-center justify-center gap-2 py-2.5 px-3 rounded-2xl bg-white/8 hover:bg-white/14 text-xs font-semibold text-zinc-200 transition-colors"
            >
              <Globe className="w-4 h-4" />
              <span>Public Home</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setMobileSheet('none');
                onSignOut();
              }}
              className="flex items-center justify-center gap-2 py-2.5 px-3 rounded-2xl bg-[#EF4444]/15 hover:bg-[#EF4444]/25 text-xs font-semibold text-red-300 transition-colors"
            >
              <LogOut className="w-4 h-4" />
              <span>Log Out</span>
            </button>
          </div>
        </div>
      )}

      {/* Mobile Floating Bottom Bar with Menus + Center Quick Action Button (< 768px) */}
      <nav
        aria-label="Mobile Navigation"
        className="md:hidden fixed bottom-[max(0.5rem,env(safe-area-inset-bottom))] left-[max(0.625rem,env(safe-area-inset-left))] right-[max(0.625rem,env(safe-area-inset-right))] sm:left-4 sm:right-4 max-w-lg mx-auto z-50 h-15 sm:h-16 bg-[#0B0B0B] text-white rounded-[24px] sm:rounded-[26px] px-1 sm:px-2 grid grid-cols-5 items-center border border-white/10 capsule-shadow"
      >
        {/* Menu Slot 1: Overview */}
        <button
          type="button"
          onClick={() => handleMobileNavigate('overview')}
          aria-label="Home Overview"
          aria-current={activeScreen === 'overview' && mobileSheet === 'none' ? 'page' : undefined}
          className={`flex flex-col items-center justify-center gap-0.5 py-1.5 rounded-2xl transition-colors ${
            activeScreen === 'overview' && mobileSheet === 'none'
              ? 'text-white'
              : 'text-zinc-400 hover:text-white'
          }`}
        >
          <span
            className={`w-8 h-7 rounded-full flex items-center justify-center transition-colors ${
              activeScreen === 'overview' && mobileSheet === 'none' ? 'bg-white text-[#0B0B0B]' : ''
            }`}
          >
            <Home className="w-4 h-4" />
          </span>
          <span className="text-[10px] font-semibold leading-none tracking-tight">Home</span>
        </button>

        {/* Menu Slot 2: Events */}
        <button
          type="button"
          onClick={() => handleMobileNavigate('events')}
          aria-label="Events"
          aria-current={activeScreen === 'events' && mobileSheet === 'none' ? 'page' : undefined}
          className={`flex flex-col items-center justify-center gap-0.5 py-1.5 rounded-2xl transition-colors ${
            activeScreen === 'events' && mobileSheet === 'none'
              ? 'text-white'
              : 'text-zinc-400 hover:text-white'
          }`}
        >
          <span
            className={`w-8 h-7 rounded-full flex items-center justify-center transition-colors ${
              activeScreen === 'events' && mobileSheet === 'none' ? 'bg-white text-[#0B0B0B]' : ''
            }`}
          >
            <Layers className="w-4 h-4" />
          </span>
          <span className="text-[10px] font-semibold leading-none tracking-tight">Events</span>
        </button>

        {/* Center Prominent Quick Action Button */}
        <div className="flex flex-col items-center justify-center -mt-4">
          <button
            type="button"
            onClick={() => setMobileSheet((prev) => (prev === 'quick' ? 'none' : 'quick'))}
            aria-label={mobileSheet === 'quick' ? 'Close Quick Actions' : 'Quick Actions'}
            aria-expanded={mobileSheet === 'quick'}
            className={`w-12 h-12 rounded-full flex items-center justify-center shadow-[0_10px_24px_rgba(0,0,0,0.45)] ring-4 ring-[#0B0B0B] transition-all duration-150 active:scale-95 ${
              mobileSheet === 'quick'
                ? 'bg-zinc-200 text-[#0B0B0B] rotate-45'
                : 'bg-white text-[#0B0B0B] hover:bg-zinc-100'
            }`}
          >
            <Plus className="w-5 h-5 stroke-[2.5]" />
          </button>
          <span className="text-[10px] font-semibold text-white leading-none tracking-tight mt-1">
            Quick
          </span>
        </div>

        {/* Menu Slot 4: Check-In QR */}
        <button
          type="button"
          onClick={() => handleMobileNavigate('checkin')}
          aria-label="Check-In & QR Scanner"
          aria-current={activeScreen === 'checkin' && mobileSheet === 'none' ? 'page' : undefined}
          className={`flex flex-col items-center justify-center gap-0.5 py-1.5 rounded-2xl transition-colors ${
            activeScreen === 'checkin' && mobileSheet === 'none'
              ? 'text-white'
              : 'text-zinc-400 hover:text-white'
          }`}
        >
          <span
            className={`w-8 h-7 rounded-full flex items-center justify-center transition-colors ${
              activeScreen === 'checkin' && mobileSheet === 'none' ? 'bg-white text-[#0B0B0B]' : ''
            }`}
          >
            <QrCode className="w-4 h-4" />
          </span>
          <span className="text-[10px] font-semibold leading-none tracking-tight">Scan</span>
        </button>

        {/* Menu Slot 5: All Workspace Menus */}
        <button
          type="button"
          onClick={() => setMobileSheet((prev) => (prev === 'menu' ? 'none' : 'menu'))}
          aria-label="Menus"
          aria-expanded={mobileSheet === 'menu'}
          className={`relative flex flex-col items-center justify-center gap-0.5 py-1.5 rounded-2xl transition-colors ${
            mobileSheet === 'menu' || isMenuRouteActive
              ? 'text-white'
              : 'text-zinc-400 hover:text-white'
          }`}
        >
          <span
            className={`relative w-8 h-7 rounded-full flex items-center justify-center transition-colors ${
              mobileSheet === 'menu' || isMenuRouteActive ? 'bg-white text-[#0B0B0B]' : ''
            }`}
          >
            {mobileSheet === 'menu' ? (
              <X className="w-4 h-4" />
            ) : (
              <LayoutGrid className="w-4 h-4" />
            )}
            {unresolvedAlertCount > 0 && mobileSheet !== 'menu' && !isMenuRouteActive && (
              <span
                className="absolute top-0.5 right-0.5 w-2 h-2 rounded-full bg-[#EF4444]"
                aria-hidden="true"
              />
            )}
          </span>
          <span className="text-[10px] font-semibold leading-none tracking-tight">Menus</span>
        </button>
      </nav>
    </>
  );
};
