import React from 'react';
import { Link } from 'react-router-dom';
import { BrandLogo, BrandOfficialBadge } from './BrandLogo';

interface MarketingLayoutProps {
  activePath:
    | '/features'
    | '/pricing'
    | '/how-it-works'
    | '/faq'
    | '/about'
    | '/contact'
    | '/blog';
  isSignedIn: boolean;
  onNavigateStudio?: () => void;
  onSignOut?: () => void;
  children: React.ReactNode;
}

const NAV_ITEMS = [
  { to: '/', label: 'Home' },
  { to: '/features', label: 'Features' },
  { to: '/how-it-works', label: 'How It Works' },
  { to: '/pricing', label: 'Pricing' },
  { to: '/faq', label: 'FAQ' },
  { to: '/blog', label: 'Blog' },
] as const;

export const MarketingLayout: React.FC<MarketingLayoutProps> = ({
  activePath,
  isSignedIn,
  onNavigateStudio,
  onSignOut,
  children,
}) => {
  return (
    <div className="min-h-dvh w-full max-w-full bg-[#F5F5F7] text-[#1A1C1D] antialiased flex flex-col overflow-x-clip">
      <header className="fixed top-0 inset-x-0 w-full z-50 bg-[#F5F5F7]/88 backdrop-blur-xl shadow-[0_1px_8px_rgba(0,0,0,0.04)] pt-[env(safe-area-inset-top)]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-2.5 md:py-0 md:h-20 flex flex-wrap md:flex-nowrap xl:grid xl:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center justify-between gap-x-3 lg:gap-x-5 gap-y-2">
          <Link
            to="/"
            className="xl:justify-self-start flex items-center text-left shrink-0 min-w-0 group rounded-xl py-1 pr-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D3822]/20"
          >
            <BrandLogo
              variant="light"
              size="md"
              subtitle="Weddings · Church · Corporate · Tech"
              subtitleClassName="hidden xl:block text-[#71717A]"
            />
          </Link>

          <nav
            aria-label="Primary navigation"
            className="order-3 md:order-2 xl:justify-self-center w-full md:w-auto min-w-0 flex items-center md:justify-center gap-1 sm:gap-1.5 md:gap-0.5 lg:gap-1 overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden border-t border-black/[0.06] md:border md:border-black/[0.06] md:bg-white/75 md:rounded-full md:p-1 md:shadow-[0_1px_3px_rgba(0,0,0,0.04)] pt-2 md:pt-1 pb-0.5 md:pb-1 text-xs lg:text-[13px]"
          >
            {NAV_ITEMS.map((item) => {
              const active = activePath === item.to;
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className={`rounded-full px-2.5 lg:px-3 py-1.5 whitespace-nowrap shrink-0 transition-colors ${
                    active
                      ? 'text-[#0B0B0B] font-semibold bg-black/[0.05] md:bg-[#F5F5F7]'
                      : 'text-[#444748] hover:text-[#0B0B0B] hover:bg-black/[0.04] font-medium'
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div className="order-2 md:order-3 xl:justify-self-end flex items-center gap-1.5 sm:gap-2 shrink-0">
            {isSignedIn && onSignOut ? (
              <button
                type="button"
                onClick={onSignOut}
                className="inline-flex items-center justify-center h-9 rounded-full text-xs lg:text-[13px] font-medium text-[#444748] hover:text-[#0B0B0B] hover:bg-black/[0.05] transition-colors px-2.5 sm:px-3 whitespace-nowrap shrink-0"
              >
                Log Out
              </button>
            ) : (
              <Link
                to="/signin"
                className="inline-flex items-center justify-center h-9 rounded-full text-xs lg:text-[13px] font-medium text-[#444748] hover:text-[#0B0B0B] hover:bg-black/[0.05] transition-colors px-2.5 sm:px-3 whitespace-nowrap shrink-0"
              >
                Sign In
              </Link>
            )}

            {isSignedIn && onNavigateStudio ? (
              <button
                type="button"
                onClick={onNavigateStudio}
                className="inline-flex items-center justify-center h-9 bg-[#0B0B0B] text-white text-xs font-semibold px-3.5 sm:px-4 lg:px-5 rounded-full hover:bg-neutral-800 active:scale-[0.98] transition-all shadow-[0_6px_16px_-4px_rgba(11,11,11,0.22)] whitespace-nowrap shrink-0"
              >
                Open Studio
              </button>
            ) : (
              <Link
                to="/signin"
                className="inline-flex items-center justify-center h-9 bg-[#0B0B0B] text-white text-xs font-semibold px-3.5 sm:px-4 lg:px-5 rounded-full hover:bg-neutral-800 active:scale-[0.98] transition-all shadow-[0_6px_16px_-4px_rgba(11,11,11,0.22)] whitespace-nowrap shrink-0"
              >
                Create Event
              </Link>
            )}
          </div>
        </div>
      </header>

      <main className="w-full pt-[102px] sm:pt-[106px] md:pt-20 flex-1 overflow-x-clip">
        {children}
      </main>

      <footer className="w-full bg-[#F3F3F5] border-t border-[#E5E5EA]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-10 xl:px-12 pt-10 pb-8">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-8 pb-8">
            <div className="lg:col-span-2 flex flex-col gap-4">
              <div className="flex flex-wrap items-center gap-3">
                <BrandLogo variant="light" size="md" />
                <BrandOfficialBadge className="w-36 sm:w-40" />
              </div>
              <p className="text-sm text-[#71717A] max-w-sm leading-relaxed">
                Event infrastructure for weddings, funerals, church conventions, musical concerts,
                corporate galas, and tech summits across Ghana and Africa.
              </p>
              <div className="flex flex-wrap items-center gap-3 text-[11px] font-medium text-[#444748]">
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  Ghana NCA Telecom Verified
                </span>
                <span aria-hidden="true">·</span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#0B0B0B]" />
                  Resend &amp; Arkesel Infrastructure
                </span>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <span className="text-xs font-semibold text-[#1A1C1D] uppercase tracking-wider">
                Platform
              </span>
              <Link to="/features" className="text-sm text-[#444748] hover:text-[#0B0B0B]">
                Platform Features
              </Link>
              <Link to="/how-it-works" className="text-sm text-[#444748] hover:text-[#0B0B0B]">
                How It Works
              </Link>
              <Link to="/pricing" className="text-sm text-[#444748] hover:text-[#0B0B0B]">
                Pricing (GHS &amp; USD)
              </Link>
              <Link to="/faq" className="text-sm text-[#444748] hover:text-[#0B0B0B]">
                FAQ &amp; Help
              </Link>
            </div>

            <div className="flex flex-col gap-2">
              <span className="text-xs font-semibold text-[#1A1C1D] uppercase tracking-wider">
                Company &amp; Guides
              </span>
              <Link to="/about" className="text-sm text-[#444748] hover:text-[#0B0B0B]">
                About Events By You
              </Link>
              <Link to="/blog" className="text-sm text-[#444748] hover:text-[#0B0B0B]">
                Organiser Blog
              </Link>
              <Link to="/contact" className="text-sm text-[#444748] hover:text-[#0B0B0B]">
                Contact Sales &amp; Support
              </Link>
            </div>

            <div className="flex flex-col gap-2">
              <span className="text-xs font-semibold text-[#1A1C1D] uppercase tracking-wider">
                Access &amp; Legal
              </span>
              <Link to="/signin" className="text-sm text-[#444748] hover:text-[#0B0B0B]">
                Organiser Login
              </Link>
              <Link to="/terms" className="text-sm text-[#444748] hover:text-[#0B0B0B]">
                Terms &amp; Conditions
              </Link>
              <Link to="/privacy" className="text-sm text-[#444748] hover:text-[#0B0B0B]">
                Privacy Policy
              </Link>
            </div>
          </div>

          <div className="pt-4 border-t border-[#E5E5EA] flex flex-col sm:flex-row items-center justify-between gap-3 text-[11px] text-[#71717A]">
            <p>
              © 2026 Events By You Inc. Built for weddings, funerals, church, musical, corporate
              &amp; tech gatherings.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-4 sm:gap-6">
              <Link to="/terms" className="hover:text-[#0B0B0B] transition-colors">
                Terms &amp; Conditions
              </Link>
              <Link to="/privacy" className="hover:text-[#0B0B0B] transition-colors">
                Privacy Policy
              </Link>
              <a href="/sitemap.xml" className="hover:text-[#0B0B0B] transition-colors">
                Sitemap
              </a>
              <a href="/robots.txt" className="hover:text-[#0B0B0B] transition-colors">
                Robots
              </a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
};
